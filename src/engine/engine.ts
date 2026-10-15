import { useStore, timelineEnd, type Clip, type Aspect } from "../store";
import { objectUrl, cachedUrl } from "../lib/db";

export const CANVAS_SIZE: Record<Aspect, [number, number]> = {
  "16:9": [1280, 720],
  "9:16": [720, 1280],
  "1:1": [1080, 1080],
};

type MediaEl = HTMLVideoElement | HTMLAudioElement;

/**
 * Plays the timeline: the master clock is performance.now(), each clip's <video>/<audio> element is kept in sync with it
 * (re-seeked when it drifts), and the visible video lanes are drawn bottom-up onto one canvas. The same graph feeds
 * MediaRecorder for export, so what you export is exactly what the viewer plays.
 */
class Engine {
  canvas: HTMLCanvasElement | null = null;
  private els = new Map<string, MediaEl>();
  private imgs = new Map<string, HTMLImageElement>();
  private gains = new Map<string, GainNode>();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private recDest: MediaStreamAudioDestinationNode | null = null;
  playing = false;
  private t0 = 0;
  private now0 = 0;
  private raf = 0;
  private listeners = new Set<(p: boolean) => void>();
  private onEnd: (() => void) | null = null;

  attach(c: HTMLCanvasElement | null) {
    this.canvas = c;
    this.draw(useStore.getState().playhead);
  }

  onPlayState(fn: (p: boolean) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((f) => f(this.playing));
  }

  private ensureAudio() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.recDest = this.ctx.createMediaStreamDestination();
    this.master.connect(this.recDest);
    for (const [id, el] of this.els) this.route(id, el);
  }

  private route(clipId: string, el: MediaEl) {
    if (!this.ctx || !this.master || this.gains.has(clipId)) return;
    try {
      const src = this.ctx.createMediaElementSource(el);
      const g = this.ctx.createGain();
      src.connect(g).connect(this.master);
      this.gains.set(clipId, g);
    } catch {
      /* already routed */
    }
  }

  private element(clip: Clip): MediaEl | null {
    const st = useStore.getState();
    const asset = st.assets.find((a) => a.id === clip.assetId);
    if (!asset || asset.kind === "image") return null;
    let el = this.els.get(clip.id);
    if (!el) {
      el = document.createElement(asset.kind === "video" ? "video" : "audio");
      el.preload = "auto";
      (el as HTMLVideoElement).playsInline = true;
      const url = cachedUrl(asset.id);
      if (url) el.src = url;
      else void objectUrl(asset.id).then((u) => u && el && (el.src = u));
      el.addEventListener("seeked", () => !this.playing && this.draw(useStore.getState().playhead));
      el.addEventListener("loadeddata", () => !this.playing && this.draw(useStore.getState().playhead));
      this.els.set(clip.id, el);
      this.route(clip.id, el);
    }
    return el;
  }

  private image(assetId: string) {
    let img = this.imgs.get(assetId);
    if (!img) {
      img = new Image();
      const url = cachedUrl(assetId);
      if (url) img.src = url;
      else void objectUrl(assetId).then((u) => u && img && (img.src = u));
      img.onload = () => !this.playing && this.draw(useStore.getState().playhead);
      this.imgs.set(assetId, img);
    }
    return img;
  }

  /** Brings every media element to time t; plays or pauses them with the transport. */
  sync(t: number, hard = false) {
    const { clips, tracks } = useStore.getState();
    const live = new Set<string>();
    for (const c of clips) {
      const track = tracks.find((x) => x.id === c.trackId);
      const el = this.element(c);
      if (!el || !track) continue;
      const active = t >= c.start && t < c.start + c.duration;
      if (!active) continue;
      live.add(c.id);
      const local = c.offset + (t - c.start);
      const vol = track.muted ? 0 : c.volume * track.volume;
      const g = this.gains.get(c.id);
      if (g) g.gain.value = vol;
      else el.volume = Math.min(1, vol);
      if (this.playing) {
        if (hard || Math.abs(el.currentTime - local) > 0.18) el.currentTime = local;
        if (el.paused) void el.play().catch(() => undefined);
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - local) > 0.02) el.currentTime = local;
      }
    }
    for (const [id, el] of this.els) {
      if (!live.has(id) && !el.paused) el.pause();
      if (!clips.some((c) => c.id === id)) {
        el.pause();
        el.removeAttribute("src");
        this.els.delete(id);
        this.gains.delete(id);
      }
    }
  }

  draw(t: number) {
    const cv = this.canvas;
    if (!cv) return;
    const { clips, tracks, aspect, assets } = useStore.getState();
    const [W, H] = CANVAS_SIZE[aspect];
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    const g = cv.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    const lanes = tracks.filter((x) => x.kind === "video" && !x.hidden).reverse(); // bottom lane first
    for (const lane of lanes) {
      const c = clips.find((x) => x.trackId === lane.id && t >= x.start && t < x.start + x.duration);
      if (!c) continue;
      const a = assets.find((x) => x.id === c.assetId);
      if (!a) continue;
      let src: CanvasImageSource | null = null;
      let sw = 0;
      let sh = 0;
      if (a.kind === "image") {
        const img = this.image(a.id);
        if (img.complete && img.naturalWidth) [src, sw, sh] = [img, img.naturalWidth, img.naturalHeight];
      } else if (a.kind === "video") {
        const v = this.element(c) as HTMLVideoElement | null;
        if (v && v.readyState >= 2) [src, sw, sh] = [v, v.videoWidth, v.videoHeight];
      }
      if (!src || !sw) continue;
      const scale = c.fit === "cover" ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
  }

  seek(t: number) {
    useStore.getState().setPlayhead(t);
    if (this.playing) {
      this.t0 = t;
      this.now0 = performance.now();
      this.sync(t, true);
    } else {
      this.sync(t);
      this.draw(t);
    }
  }

  play() {
    if (this.playing) return;
    this.ensureAudio();
    const st = useStore.getState();
    const end = timelineEnd(st.clips);
    if (end <= 0) return;
    let t = st.playhead;
    if (t >= end - 0.02) t = 0;
    this.playing = true;
    this.t0 = t;
    this.now0 = performance.now();
    this.sync(t, true);
    this.emit();
    const tick = () => {
      if (!this.playing) return;
      const now = this.t0 + (performance.now() - this.now0) / 1000;
      const endNow = timelineEnd(useStore.getState().clips);
      if (now >= endNow) {
        useStore.getState().setPlayhead(endNow);
        this.draw(endNow);
        this.pause();
        this.onEnd?.();
        return;
      }
      useStore.getState().setPlayhead(now);
      this.sync(now);
      this.draw(now);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const el of this.els.values()) el.pause();
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Real-time export of the canvas + mixed audio. MP4 where the browser can record it, WebM otherwise. */
  async export(onProgress: (f: number) => void, signal: { cancelled: boolean }): Promise<Blob> {
    if (!this.canvas) throw new Error("Viewer absent");
    const end = timelineEnd(useStore.getState().clips);
    if (end <= 0) throw new Error("La timeline est vide.");
    this.pause();
    this.ensureAudio();
    const types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const stream = new MediaStream([...this.canvas.captureStream(30).getVideoTracks(), ...(this.recDest?.stream.getAudioTracks() ?? [])]);
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((res) => (rec.onstop = () => res()));
    // Preload frame 0 before recording starts.
    this.seek(0);
    await new Promise((r) => setTimeout(r, 400));
    rec.start(250);
    const unsub = useStore.subscribe((s) => onProgress(Math.min(1, s.playhead / end)));
    const finished = new Promise<void>((res) => (this.onEnd = res));
    this.play();
    await Promise.race([
      finished,
      new Promise<void>((res) => {
        const i = setInterval(() => signal.cancelled && (clearInterval(i), res()), 200);
        void finished.then(() => clearInterval(i));
      }),
    ]);
    this.onEnd = null;
    this.pause();
    unsub();
    rec.stop();
    await done;
    if (signal.cancelled) throw new Error("Export annulé");
    return new Blob(chunks, { type: (mimeType || "video/webm").split(";")[0] });
  }
}

export const engine = new Engine();
