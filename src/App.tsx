import { useEffect, useState } from "react";
import clsx from "clsx";
import { Download, Loader2, X } from "lucide-react";
import { useStore, timelineEnd, type Aspect } from "./store";
import { MODELS } from "./lib/models";
import { runModel } from "./lib/gradio";
import { engine } from "./engine/engine";
import { download, fmtDur } from "./lib/util";
import { Inspector, StatusDot } from "./components/Inspector";
import { MediaBin, Jobs } from "./components/MediaBin";
import { Viewer } from "./components/Viewer";
import { Timeline, useTimelineKeys } from "./components/Timeline";

export default function App() {
  useTimelineKeys();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        const st = useStore.getState();
        if (st.connections[st.activeModel]?.url) void runModel(st.activeModel);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[44px_minmax(0,1fr)_minmax(200px,38%)] overflow-hidden">
      <TopBar />
      <div className="grid min-h-0 grid-cols-[264px_minmax(0,1fr)_368px]">
        <aside className="flex min-h-0 flex-col border-r border-line bg-panel">
          <MediaBin />
          <Jobs />
        </aside>
        <Viewer />
        <Inspector />
      </div>
      <Timeline />
    </div>
  );
}

function TopBar() {
  const aspect = useStore((s) => s.aspect);
  const setAspect = useStore((s) => s.setAspect);
  const setActive = useStore((s) => s.setActiveModel);
  const setPanel = useStore((s) => s.setPanel);
  const clips = useStore((s) => s.clips);
  const [exporting, setExporting] = useState(false);
  return (
    <header className="flex items-center gap-4 border-b border-line bg-panel px-3">
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 32 32" className="size-6"><rect width="32" height="32" rx="7" fill="#1b1d21" /><rect x="6" y="9" width="20" height="3" rx="1.5" fill="#ff8a3d" /><rect x="6" y="15" width="13" height="3" rx="1.5" fill="#e9e6df" /><rect x="6" y="21" width="17" height="3" rx="1.5" fill="#5fb3a1" /></svg>
        <span className="text-[14px] font-semibold tracking-tight">Atelier</span>
        <span className="tc rounded-[3px] border border-line px-1 text-[10px] text-faint">v0.1</span>
      </div>
      <nav className="flex items-center gap-0.5">
        {MODELS.map((m) => (
          <button key={m.id} onClick={() => { setActive(m.id); setPanel("connections"); }} title={`${m.name} · connexion`}
            className="flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-[12px] text-muted hover:bg-raised hover:text-fg">
            <StatusDot id={m.id} /> {m.short}
          </button>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <div className="flex rounded-[5px] border border-line bg-sunken p-0.5">
          {(["16:9", "9:16", "1:1"] as Aspect[]).map((a) => (
            <button key={a} onClick={() => setAspect(a)} className={clsx("tc rounded-[3px] px-2 py-0.5 text-[11.5px]", aspect === a ? "bg-raised text-fg" : "text-muted hover:text-fg")}>{a}</button>
          ))}
        </div>
        <button className="btn-primary py-1.5" disabled={!clips.length} onClick={() => setExporting(true)}><Download size={14} /> Exporter</button>
      </div>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </header>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const end = useStore((s) => timelineEnd(s.clips));
  const aspect = useStore((s) => s.aspect);
  const addAsset = useStore((s) => s.addAsset);
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState("");
  const [signal] = useState({ cancelled: false });

  const start = async () => {
    setState("running");
    useStore.getState().selectAsset(null);
    try {
      const blob = await engine.export(setProgress, signal);
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      const name = `Atelier ${new Date().toLocaleString("fr-FR").replace(/[/:]/g, "-")}`;
      download(blob, `${name}.${ext}`);
      await addAsset(blob, { kind: "video", name: `Export · ${aspect}`, mime: blob.type, source: "export" });
      setMsg(`${ext.toUpperCase()} · ${(blob.size / 1e6).toFixed(1)} Mo, téléchargé et ajouté à la médiathèque.`);
      setState("done");
    } catch (e) {
      setMsg((e as Error).message);
      setState("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[420px] rounded-[8px] border border-line-strong bg-panel p-5 shadow-2xl">
        <div className="mb-3 flex items-center">
          <h3 className="text-[15px] font-semibold">Exporter le montage</h3>
          <button className="icon-btn ml-auto" onClick={() => { signal.cancelled = true; onClose(); }}><X size={15} /></button>
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted">
          Rendu en temps réel dans le navigateur ({fmtDur(end)}, format {aspect}, 30 i/s). MP4 si ton navigateur sait l'enregistrer, WebM sinon. Garde l'onglet au premier plan pendant le rendu.
        </p>
        {state !== "idle" && (
          <div className="mt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <p className={clsx("mt-2 text-[12px]", state === "error" ? "text-danger" : state === "done" ? "text-ok" : "text-muted")}>
              {state === "running" ? `Rendu… ${Math.round(progress * 100)} %` : msg}
            </p>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          {state === "running" ? (
            <button className="btn" onClick={() => (signal.cancelled = true)}><Loader2 size={13} className="animate-spin" /> Annuler</button>
          ) : (
            <>
              <button className="btn" onClick={onClose}>Fermer</button>
              {state !== "done" && <button className="btn-primary" onClick={start}><Download size={14} /> Lancer le rendu</button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
