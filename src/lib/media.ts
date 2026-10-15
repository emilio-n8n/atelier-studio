import type { MediaKind } from "./models";

export interface Probe {
  duration?: number;
  width?: number;
  height?: number;
  thumb?: string;
  peaks?: number[];
}

export function kindOf(mime: string, name = ""): MediaKind | null {
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif)$/i.test(name)) return "image";
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(name)) return "video";
  if (mime.startsWith("audio/") || /\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(name)) return "audio";
  return null;
}

function thumbFrom(src: CanvasImageSource, w: number, h: number) {
  const c = document.createElement("canvas");
  const scale = 240 / Math.max(w, h);
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.72);
}

export async function probe(blob: Blob, kind: MediaKind): Promise<Probe> {
  const url = URL.createObjectURL(blob);
  try {
    if (kind === "image") {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight, thumb: thumbFrom(img, img.naturalWidth, img.naturalHeight) };
    }
    if (kind === "video") {
      const v = document.createElement("video");
      v.muted = true;
      v.preload = "auto";
      v.src = url;
      await new Promise<void>((res, rej) => {
        v.onloadeddata = () => res();
        v.onerror = () => rej(new Error("vidéo illisible"));
      });
      const duration = v.duration;
      v.currentTime = Math.min(0.5, duration / 3);
      await new Promise<void>((res) => { v.onseeked = () => res(); setTimeout(res, 1500); });
      const thumb = thumbFrom(v, v.videoWidth, v.videoHeight);
      return { duration, width: v.videoWidth, height: v.videoHeight, thumb, peaks: await peaksOf(blob).catch(() => undefined) };
    }
    const peaks = await peaksOf(blob);
    const a = document.createElement("audio");
    a.src = url;
    const duration = await new Promise<number>((res) => {
      a.onloadedmetadata = () => res(a.duration);
      a.onerror = () => res(0);
    });
    return { duration, peaks };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function peaksOf(blob: Blob, n = 400): Promise<number[]> {
  const Ctx = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new Ctx(1, 2, 44100);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const data = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / n));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) m = Math.max(m, Math.abs(data[j]));
    out.push(Math.round(m * 100) / 100);
  }
  return out;
}
