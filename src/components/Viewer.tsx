import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Pause, Play, SkipBack, SkipForward, StepBack, StepForward, Plus, Sparkles, X } from "lucide-react";
import { useStore, timelineEnd } from "../store";
import { engine, CANVAS_SIZE } from "../engine/engine";
import { objectUrl } from "../lib/db";
import { MODEL_BY_ID } from "../lib/models";
import { fmtTime } from "../lib/util";

export function usePlaying() {
  const [p, setP] = useState(engine.playing);
  useEffect(() => engine.onPlayState(setP), []);
  return p;
}

export function Viewer() {
  const selected = useStore((s) => s.selectedAsset);
  return (
    <section className="relative flex min-h-0 min-w-0 flex-col bg-bg">
      <Program hidden={!!selected} />
      {selected && <Source id={selected} />}
    </section>
  );
}

function Program({ hidden }: { hidden: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const aspect = useStore((s) => s.aspect);
  const playhead = useStore((s) => s.playhead);
  const end = useStore((s) => timelineEnd(s.clips));
  const playing = usePlaying();
  const [W, H] = CANVAS_SIZE[aspect];

  useEffect(() => {
    engine.attach(cv.current);
    return () => engine.attach(null);
  }, []);
  // Redraw on any edit while paused.
  useEffect(() => useStore.subscribe((s, p) => {
    if (engine.playing) return;
    if (s.clips !== p.clips || s.tracks !== p.tracks || s.aspect !== p.aspect || s.assets !== p.assets) {
      engine.sync(s.playhead);
      engine.draw(s.playhead);
    }
  }), []);

  return (
    <div className={clsx("flex min-h-0 flex-1 flex-col", hidden && "hidden")}>
      <ViewerHead title="Programme" />
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <canvas ref={cv} width={W} height={H} onClick={() => engine.toggle()}
          className="max-h-full max-w-full bg-black shadow-[0_0_0_1px_var(--color-line)]" style={{ aspectRatio: `${W}/${H}` }} />
      </div>
      <div className="flex h-11 shrink-0 items-center gap-1 border-t border-line px-3">
        <span className="tc w-24 text-accent">{fmtTime(playhead)}</span>
        <div className="mx-auto flex items-center gap-0.5">
          <button className="icon-btn" title="Début (Home)" onClick={() => engine.seek(0)}><SkipBack size={15} /></button>
          <button className="icon-btn" title="Image précédente (←)" onClick={() => engine.seek(Math.max(0, playhead - 1 / 30))}><StepBack size={15} /></button>
          <button className="mx-1 inline-flex size-8 items-center justify-center rounded-full bg-fg text-bg transition-transform hover:scale-105" title="Lecture (Espace)" onClick={() => engine.toggle()}>
            {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
          </button>
          <button className="icon-btn" title="Image suivante (→)" onClick={() => engine.seek(playhead + 1 / 30)}><StepForward size={15} /></button>
          <button className="icon-btn" title="Fin (End)" onClick={() => engine.seek(end)}><SkipForward size={15} /></button>
        </div>
        <span className="tc w-24 text-right text-faint">{fmtTime(end)}</span>
      </div>
    </div>
  );
}

function ViewerHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
      <span className="text-[12.5px] font-medium">{title}</span>
      {children}
    </div>
  );
}

function Source({ id }: { id: string }) {
  const a = useStore((s) => s.assets.find((x) => x.id === id));
  const select = useStore((s) => s.selectAsset);
  const append = useStore((s) => s.appendToTimeline);
  const setParams = useStore((s) => s.setParams);
  const setActive = useStore((s) => s.setActiveModel);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => void objectUrl(id).then(setUrl), [id]);
  if (!a) return null;
  const m = a.modelId ? MODEL_BY_ID[a.modelId] : null;
  const prompt = String(a.params?.prompt ?? a.params?.text ?? "");
  return (
    <div className="absolute inset-0 flex flex-col bg-bg">
      <ViewerHead title="Source">
        <span className="min-w-0 truncate text-[12px] text-muted">{a.name}</span>
        <button className="btn ml-auto" onClick={() => { append(a.id); select(null); }}><Plus size={13} /> Timeline</button>
        {m && a.params && <button className="btn" onClick={() => { setParams(m.id, a.params!); setActive(m.id); }}><Sparkles size={13} /> Reprendre les réglages</button>}
        <button className="icon-btn" title="Retour au programme" onClick={() => select(null)}><X size={15} /></button>
      </ViewerHead>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {url && a.kind === "image" && <img src={url} alt="" className="checker max-h-full max-w-full object-contain shadow-[0_0_0_1px_var(--color-line)]" />}
        {url && a.kind === "video" && <video src={url} controls autoPlay className="max-h-full max-w-full bg-black" />}
        {url && a.kind === "audio" && (
          <div className="w-full max-w-xl">
            <div className="mb-4 flex h-28 items-center gap-[2px]">
              {(a.peaks ?? []).filter((_, i) => i % 2 === 0).map((p, i) => <span key={i} className="flex-1 rounded-full bg-audio/80" style={{ height: `${Math.max(3, p * 100)}%` }} />)}
            </div>
            <audio src={url} controls autoPlay className="w-full" />
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-line px-4 py-2.5 text-[12px]">
        <div className="tc flex flex-wrap gap-x-4 gap-y-1 text-faint">
          {m && <span className="text-muted">{m.name}</span>}
          {a.width && <span>{a.width}×{a.height}</span>}
          {a.duration ? <span>{a.duration.toFixed(2)} s</span> : null}
          {a.info && <span className="min-w-0 truncate">{a.info}</span>}
        </div>
        {prompt && <p className="mt-1 line-clamp-2 leading-snug text-muted">{prompt}</p>}
      </div>
    </div>
  );
}
