import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Scissors, Trash2, Magnet, ZoomIn, ZoomOut, Volume2, VolumeX, Eye, EyeOff, Plus, Maximize2, Minimize2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStore, timelineEnd, IMAGE_DEFAULT_DUR, type Clip, type Track, type Asset } from "../store";
import { engine } from "../engine/engine";
import { fmtTime } from "../lib/util";

const HEAD_W = 112;
const RULER_H = 24;
const laneH = (t: Track) => (t.kind === "video" ? 56 : 44);

export function Timeline() {
  const tracks = useStore((s) => s.tracks);
  const clips = useStore((s) => s.clips);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const selectedClip = useStore((s) => s.selectedClip);
  const removeClip = useStore((s) => s.removeClip);
  const splitAt = useStore((s) => s.splitAt);
  const addTrack = useStore((s) => s.addTrack);
  const [snap, setSnap] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const end = timelineEnd(clips);
  const width = Math.max(end + 30, 60) * zoom;

  const fit = () => {
    const w = (scroller.current?.clientWidth ?? 800) - 40;
    setZoom(end > 0 ? w / end : 60);
  };

  const splitSelected = () => {
    const st = useStore.getState();
    const target = st.clips.find((c) => c.id === st.selectedClip && st.playhead > c.start && st.playhead < c.start + c.duration)
      ?? st.clips.find((c) => st.playhead > c.start && st.playhead < c.start + c.duration);
    if (target) splitAt(target.id, st.playhead);
  };

  return (
    <section className="flex min-h-0 flex-col border-t border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <span className="px-1 text-[12.5px] font-medium">Timeline</span>
        <div className="ml-3 flex items-center gap-0.5">
          <button className="icon-btn" title="Couper au curseur (S)" onClick={splitSelected}><Scissors size={14} /></button>
          <button className="icon-btn" title="Supprimer le clip (Suppr)" disabled={!selectedClip} onClick={() => selectedClip && removeClip(selectedClip)}><Trash2 size={14} /></button>
          <button className={clsx("icon-btn", snap && "bg-raised text-accent")} title="Magnétisme" onClick={() => setSnap(!snap)}><Magnet size={14} /></button>
        </div>
        <ClipInspector />
        <div className="ml-auto flex items-center gap-1">
          <button className="btn py-1" onClick={() => addTrack("video")}><Plus size={12} /> Piste vidéo</button>
          <button className="btn py-1" onClick={() => addTrack("audio")}><Plus size={12} /> Piste audio</button>
          <div className="mx-2 h-4 w-px bg-line" />
          <button className="icon-btn" title="Tout afficher" onClick={fit}><Maximize2 size={13} /></button>
          <button className="icon-btn" onClick={() => setZoom(zoom / 1.4)}><ZoomOut size={14} /></button>
          <input type="range" min={8} max={400} value={zoom} className="w-24" style={{ ["--p" as string]: `${((zoom - 8) / 392) * 100}%` }} onChange={(e) => setZoom(Number(e.target.value))} />
          <button className="icon-btn" onClick={() => setZoom(zoom * 1.4)}><ZoomIn size={14} /></button>
        </div>
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto"
        onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)); } }}>
        <div className="relative" style={{ width: width + HEAD_W, minHeight: "100%" }}>
          <Ruler width={width} zoom={zoom} />
          {tracks.map((t) => <Lane key={t.id} track={t} zoom={zoom} width={width} snap={snap} />)}
          <Playhead zoom={zoom} />
          {!clips.length && (
            <div className="pointer-events-none absolute inset-x-0 flex justify-center text-[12px] text-faint" style={{ top: RULER_H + 70, left: HEAD_W }}>
              Glisse un média ici, ou double-clique dessus dans la médiathèque.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Ruler({ width, zoom }: { width: number; zoom: number }) {
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * zoom >= 70) ?? 300;
  const ticks = useMemo(() => Array.from({ length: Math.ceil(width / zoom / step) + 1 }, (_, i) => i * step), [width, zoom, step]);
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    useStore.getState().selectAsset(null);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      engine.seek(Math.max(0, (ev.clientX - r.left) / zoom));
    };
    move(e.nativeEvent);
    el.onpointermove = move;
    el.onpointerup = () => (el.onpointermove = null);
  };
  return (
    <div className="sticky top-0 z-20 flex" style={{ height: RULER_H }}>
      <div className="sticky left-0 z-10 shrink-0 border-b border-r border-line bg-panel" style={{ width: HEAD_W }} />
      <div className="relative cursor-ew-resize border-b border-line bg-panel" style={{ width }} onPointerDown={scrub}>
        {ticks.map((t) => (
          <div key={t} className="absolute top-0 h-full border-l border-line-strong/70" style={{ left: t * zoom }}>
            <span className="tc absolute left-1 top-1 text-[10px] text-faint">{fmtTime(t, false)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Playhead({ zoom }: { zoom: number }) {
  const t = useStore((s) => s.playhead);
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-accent" style={{ left: HEAD_W + t * zoom }}>
      <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-accent" />
    </div>
  );
}

function Lane({ track, zoom, width, snap }: { track: Track; zoom: number; width: number; snap: boolean }) {
  const clips = useStore(useShallow((s) => s.clips.filter((c) => c.trackId === track.id)));
  const updateTrack = useStore((s) => s.updateTrack);
  const addClip = useStore((s) => s.addClip);
  const [over, setOver] = useState(false);
  const h = laneH(track);

  const drop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData("text/atelier-asset");
    const st = useStore.getState();
    const a = st.assets.find((x) => x.id === id);
    if (!a) return;
    if ((a.kind === "audio") !== (track.kind === "audio")) return;
    const r = e.currentTarget.getBoundingClientRect();
    let start = Math.max(0, (e.clientX - r.left) / zoom);
    if (snap) start = snapTime(start, st.clips, st.playhead, 10 / zoom);
    addClip({ trackId: track.id, assetId: a.id, start, offset: 0, duration: a.kind === "image" ? IMAGE_DEFAULT_DUR : a.duration || IMAGE_DEFAULT_DUR, volume: 1, fit: "contain" });
  };

  return (
    <div className="flex border-b border-line" style={{ height: h }}>
      <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-line bg-panel px-2" style={{ width: HEAD_W }}>
        <span className={clsx("h-6 w-[3px] rounded-full", track.kind === "video" ? "bg-video" : "bg-audio")} />
        <span className="tc ml-1 text-[12px] font-medium">{track.name}</span>
        <div className="ml-auto flex">
          {track.kind === "video" && (
            <button className="icon-btn size-6" title={track.hidden ? "Afficher" : "Masquer"} onClick={() => updateTrack(track.id, { hidden: !track.hidden })}>
              {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          )}
          <button className={clsx("icon-btn size-6", track.muted && "text-danger")} title={track.muted ? "Réactiver le son" : "Couper le son"} onClick={() => updateTrack(track.id, { muted: !track.muted })}>
            {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        </div>
      </div>
      <div data-track={track.id} data-kind={track.kind} className={clsx("relative transition-colors", over ? "bg-accent/8" : "bg-sunken/60", track.hidden && "opacity-40")} style={{ width }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
        onPointerDown={(e) => { if (e.target === e.currentTarget) { useStore.getState().selectClip(null); } }}>
        {clips.map((c) => <ClipView key={c.id} clip={c} track={track} zoom={zoom} h={h} snap={snap} />)}
      </div>
    </div>
  );
}

function snapTime(t: number, clips: Clip[], playhead: number, tol: number, exclude?: string) {
  const pts = [0, playhead];
  for (const c of clips) if (c.id !== exclude) pts.push(c.start, c.start + c.duration);
  let best = t;
  let d = tol;
  for (const p of pts) if (Math.abs(p - t) < d) { d = Math.abs(p - t); best = p; }
  return best;
}

function ClipView({ clip, track, zoom, h, snap }: { clip: Clip; track: Track; zoom: number; h: number; snap: boolean }) {
  const asset = useStore((s) => s.assets.find((a) => a.id === clip.assetId));
  const selected = useStore((s) => s.selectedClip === clip.id);
  const update = useStore((s) => s.updateClip);
  if (!asset) return null;
  const left = clip.start * zoom;
  const w = Math.max(4, clip.duration * zoom);

  const drag = (e: React.PointerEvent, mode: "move" | "left" | "right") => {
    e.stopPropagation();
    const st = useStore.getState();
    st.selectClip(clip.id);
    st.selectAsset(null);
    const x0 = e.clientX;
    const c0 = { ...clip };
    const max = asset.kind === "image" ? Infinity : asset.duration ?? Infinity;
    const tol = 8 / zoom;
    const others = st.clips;
    const onMove = (ev: PointerEvent) => {
      const d = (ev.clientX - x0) / zoom;
      const ph = useStore.getState().playhead;
      if (mode === "move") {
        let start = Math.max(0, c0.start + d);
        if (snap) {
          const s1 = snapTime(start, others, ph, tol, clip.id);
          const s2 = snapTime(start + c0.duration, others, ph, tol, clip.id) - c0.duration;
          start = s1 !== start ? s1 : s2 !== start ? Math.max(0, s2) : start;
        }
        // Vertical move between lanes of the same kind.
        const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((el) => (el as HTMLElement).dataset?.track) as HTMLElement | undefined;
        const trackId = under && under.dataset.kind === track.kind ? under.dataset.track! : undefined;
        update(clip.id, { start, ...(trackId ? { trackId } : {}) });
      } else if (mode === "left") {
        let start = c0.start + d;
        if (snap) start = snapTime(start, others, ph, tol, clip.id);
        let dd = start - c0.start;
        dd = Math.max(dd, -c0.offset, -c0.start);
        dd = Math.min(dd, c0.duration - 0.1);
        update(clip.id, { start: c0.start + dd, offset: c0.offset + dd, duration: c0.duration - dd });
      } else {
        let endT = c0.start + c0.duration + d;
        if (snap) endT = snapTime(endT, others, ph, tol, clip.id);
        const dur = Math.min(Math.max(0.1, endT - c0.start), max - c0.offset);
        update(clip.id, { duration: dur });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const color = asset.kind === "audio" ? "audio" : asset.kind === "video" ? "video" : "image";
  return (
    <div className={clsx("group absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-[4px] border active:cursor-grabbing",
      selected ? "border-fg shadow-[0_0_0_1px_var(--color-fg)]" : "border-black/40")}
      style={{ left, width: w, background: `color-mix(in oklab, var(--color-${color}) 28%, #111)` }}
      onPointerDown={(e) => drag(e, "move")}>
      {asset.kind !== "audio" && asset.thumb && (
        <div className="absolute inset-0 opacity-70" style={{ backgroundImage: `url(${asset.thumb})`, backgroundSize: `auto 100%`, backgroundRepeat: "repeat-x" }} />
      )}
      {(asset.kind === "audio" || asset.kind === "video") && asset.peaks && asset.duration ? (
        <Wave asset={asset} clip={clip} className={asset.kind === "video" ? "absolute inset-x-0 bottom-0 h-1/3 opacity-90" : "absolute inset-0"} />
      ) : null}
      <div className={clsx("absolute inset-x-0 top-0 flex items-center gap-1 px-1.5 py-0.5", asset.kind !== "audio" && "bg-gradient-to-b from-black/70 to-transparent")}>
        <span className="truncate text-[11px] font-medium text-white/95">{asset.name}</span>
        {clip.volume !== 1 && <span className="tc ml-auto text-[10px] text-white/70">{Math.round(clip.volume * 100)}%</span>}
      </div>
      <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-fg/40" onPointerDown={(e) => drag(e, "left")} />
      <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-fg/40" onPointerDown={(e) => drag(e, "right")} />
      <span className="sr-only">{h}</span>
    </div>
  );
}

function Wave({ asset, clip, className }: { asset: Asset; clip: Clip; className?: string }) {
  const peaks = asset.peaks!;
  const dur = asset.duration!;
  const a = Math.floor((clip.offset / dur) * peaks.length);
  const b = Math.min(peaks.length, Math.ceil(((clip.offset + clip.duration) / dur) * peaks.length));
  const slice = peaks.slice(a, Math.max(a + 1, b));
  const d = slice.map((p, i) => `M${i + 0.5},${50 - p * 48}V${50 + p * 48}`).join("");
  return (
    <svg className={clsx("pointer-events-none", className)} viewBox={`0 0 ${slice.length} 100`} preserveAspectRatio="none">
      <path d={d} stroke="var(--color-audio)" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ClipInspector() {
  const clip = useStore((s) => s.clips.find((c) => c.id === s.selectedClip));
  const asset = useStore((s) => s.assets.find((a) => a.id === clip?.assetId));
  const update = useStore((s) => s.updateClip);
  if (!clip || !asset) return null;
  return (
    <div className="ml-4 flex items-center gap-3 border-l border-line pl-4 text-[11.5px] text-muted">
      <span className="tc">{fmtTime(clip.start)} → {fmtTime(clip.start + clip.duration)}</span>
      {asset.kind === "image" && (
        <label className="flex items-center gap-1.5">
          Durée
          <input type="number" min={0.2} step={0.5} className="field tc w-16 py-0.5" value={Number(clip.duration.toFixed(2))} onChange={(e) => update(clip.id, { duration: Math.max(0.2, Number(e.target.value)) })} />
        </label>
      )}
      {asset.kind !== "image" && (
        <label className="flex items-center gap-1.5">
          Volume
          <input type="range" min={0} max={2} step={0.05} className="w-20" value={clip.volume} style={{ ["--p" as string]: `${(clip.volume / 2) * 100}%` }} onChange={(e) => update(clip.id, { volume: Number(e.target.value) })} />
          <span className="tc w-9">{Math.round(clip.volume * 100)}%</span>
        </label>
      )}
      {asset.kind !== "audio" && (
        <button className="btn py-0.5" onClick={() => update(clip.id, { fit: clip.fit === "contain" ? "cover" : "contain" })}>
          {clip.fit === "contain" ? <Maximize2 size={12} /> : <Minimize2 size={12} />} {clip.fit === "contain" ? "Ajuster" : "Remplir"}
        </button>
      )}
    </div>
  );
}

export function useTimelineKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const st = useStore.getState();
      if (e.code === "Space") { e.preventDefault(); st.selectAsset(null); engine.toggle(); }
      else if (e.key === "ArrowLeft") engine.seek(Math.max(0, st.playhead - (e.shiftKey ? 1 : 1 / 30)));
      else if (e.key === "ArrowRight") engine.seek(st.playhead + (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === "Home") engine.seek(0);
      else if (e.key === "End") engine.seek(timelineEnd(st.clips));
      else if ((e.key === "Delete" || e.key === "Backspace") && st.selectedClip) st.removeClip(st.selectedClip);
      else if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) {
        const c = st.clips.find((x) => x.id === st.selectedClip && st.playhead > x.start && st.playhead < x.start + x.duration)
          ?? st.clips.find((x) => st.playhead > x.start && st.playhead < x.start + x.duration);
        if (c) st.splitAt(c.id, st.playhead);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
