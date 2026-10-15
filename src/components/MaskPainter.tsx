import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Brush, Eraser, Trash2 } from "lucide-react";
import { objectUrl } from "../lib/db";

/** Paints the inpaint mask: red strokes on a transparent layer, exactly what Gradio's ImageEditor sends as a layer. */
export function MaskPainter({ assetId, initial, onDone, onCancel }: { assetId: string; initial: Blob | null; onDone: (b: Blob) => void; onCancel: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [size, setSize] = useState(60);
  const [erase, setErase] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number; r: number } | null>(null);

  useEffect(() => void objectUrl(assetId).then(setSrc), [assetId]);

  const onLoad = async () => {
    const i = img.current!;
    const c = cv.current!;
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    if (initial) {
      const b = await createImageBitmap(initial);
      c.getContext("2d")!.drawImage(b, 0, 0, c.width, c.height);
    }
  };

  const pos = (e: React.PointerEvent) => {
    const c = cv.current!;
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k, sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const stroke = (e: React.PointerEvent) => {
    const g = cv.current!.getContext("2d")!;
    const p = pos(e);
    g.globalCompositeOperation = erase ? "destination-out" : "source-over";
    g.strokeStyle = "rgba(255,0,0,1)";
    g.fillStyle = "rgba(255,0,0,1)";
    g.lineCap = "round";
    g.lineJoin = "round";
    g.lineWidth = size * p.k;
    g.beginPath();
    const from = last.current ?? p;
    g.moveTo(from.x, from.y);
    g.lineTo(p.x, p.y);
    g.stroke();
    last.current = p;
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <div className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
        <span className="font-medium">Masque d'inpainting</span>
        <span className="text-muted">Peins en rouge la zone à régénérer.</span>
        <div className="ml-auto flex items-center gap-2">
          <button className={clsx("btn", !erase && "border-accent text-accent")} onClick={() => setErase(false)}><Brush size={14} /> Pinceau</button>
          <button className={clsx("btn", erase && "border-accent text-accent")} onClick={() => setErase(true)}><Eraser size={14} /> Gomme</button>
          <div className="flex w-40 items-center gap-2">
            <span className="label">Taille</span>
            <input type="range" min={8} max={240} value={size} style={{ ["--p" as string]: `${((size - 8) / 232) * 100}%` }} onChange={(e) => setSize(Number(e.target.value))} />
          </div>
          <button className="btn" onClick={() => { const c = cv.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); }}><Trash2 size={14} /> Effacer</button>
          <button className="btn" onClick={onCancel}>Annuler</button>
          <button className="btn-primary" onClick={() => cv.current!.toBlob((b) => b && onDone(b), "image/png")}>Valider le masque</button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        {src && (
          <div className="relative max-h-full max-w-full" style={{ cursor: "none" }}>
            <img ref={img} src={src} onLoad={onLoad} alt="" className="block max-h-[calc(100vh-120px)] max-w-full select-none" draggable={false} />
            <canvas ref={cv} className="absolute inset-0 size-full opacity-55"
              onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); last.current = null; stroke(e); }}
              onPointerMove={(e) => { const p = pos(e); setCursor({ x: p.sx, y: p.sy, r: size / 2 }); if (e.buttons) stroke(e); }}
              onPointerUp={() => (last.current = null)}
              onPointerLeave={() => setCursor(null)} />
            {cursor && <div className="pointer-events-none absolute rounded-full border border-white/90 mix-blend-difference" style={{ left: cursor.x - cursor.r, top: cursor.y - cursor.r, width: cursor.r * 2, height: cursor.r * 2 }} />}
          </div>
        )}
      </div>
    </div>
  );
}
