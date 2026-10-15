export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function fmtTime(sec: number, frames = true) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec % 1) * 30);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${frames ? ":" + String(f).padStart(2, "0") : ""}`;
}

export function fmtDur(sec: number) {
  if (sec < 60) return `${Math.round(sec)} s`;
  return `${Math.floor(sec / 60)} min ${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function normalizeUrl(raw: string) {
  let u = raw.trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  u = u.replace(/\/+(\?.*)?$/, "");
  // People paste the UI link with a trailing "/?__theme=dark" or a path into the API docs.
  u = u.replace(/\/(gradio_api|api|docs|\?view=api).*$/i, "");
  return u + "/";
}

export function extFor(mime: string, kind: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  return kind === "image" ? "png" : kind === "audio" ? "wav" : "mp4";
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
