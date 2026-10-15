import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Upload, MoreHorizontal, Plus, Download, Trash2, Sparkles, Loader2, X, CircleAlert, Check, Film, ImageIcon, AudioLines, Layers } from "lucide-react";
import { useStore, type Asset } from "../store";
import { MODELS, MODEL_BY_ID, type MediaKind } from "../lib/models";
import { kindOf } from "../lib/media";
import { getBlob } from "../lib/db";
import { cancelJob } from "../lib/gradio";
import { download, extFor, fmtDur } from "../lib/util";
import { Thumb } from "./Thumb";
import { KIND_COLOR } from "./Inspector";

type Filter = "all" | MediaKind;

export function MediaBin() {
  const assets = useStore((s) => s.assets);
  const addAsset = useStore((s) => s.addAsset);
  const [filter, setFilter] = useState<Filter>("all");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = assets.filter((a) => filter === "all" || a.kind === filter);

  const importFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      const kind = kindOf(f.type, f.name);
      if (kind) await addAsset(f, { kind, name: f.name, mime: f.type || "application/octet-stream", source: "upload" });
    }
  };

  return (
    <div className={clsx("flex min-h-0 flex-1 flex-col", over && "bg-accent/5")}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void importFiles(e.dataTransfer.files); }}>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <span className="px-1 text-[12.5px] font-medium">Médias</span>
        <span className="tc text-faint">{assets.length}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {([["all", Layers], ["image", ImageIcon], ["video", Film], ["audio", AudioLines]] as const).map(([k, Icon]) => (
            <button key={k} title={k} onClick={() => setFilter(k)} className={clsx("icon-btn size-6", filter === k && "bg-raised text-fg")}><Icon size={13} /></button>
          ))}
          <button className="icon-btn size-6" title="Importer des fichiers" onClick={() => input.current?.click()}><Upload size={13} /></button>
        </div>
        <input ref={input} type="file" multiple accept="image/*,video/*,audio/*" className="hidden" onChange={(e) => e.target.files && void importFiles(e.target.files)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {list.length ? (
          <div className="grid grid-cols-2 gap-2">{list.map((a) => <AssetCard key={a.id} a={a} />)}</div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-faint">
            <Upload size={18} />
            Glisse des images, vidéos ou sons ici, ou génère-les depuis le panneau de droite.
          </div>
        )}
      </div>
    </div>
  );
}

function AssetCard({ a }: { a: Asset }) {
  const selected = useStore((s) => s.selectedAsset === a.id);
  const select = useStore((s) => s.selectAsset);
  const append = useStore((s) => s.appendToTimeline);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  return (
    <div className="group relative">
      <button draggable onDragStart={(e) => { e.dataTransfer.setData("text/atelier-asset", a.id); e.dataTransfer.effectAllowed = "copy"; }}
        onClick={() => select(a.id)} onDoubleClick={() => append(a.id)}
        className={clsx("block w-full overflow-hidden rounded-[5px] border text-left transition-colors", selected ? "border-accent" : "border-line hover:border-line-strong")}>
        <div className="relative">
          <Thumb id={a.id} className="aspect-video w-full" />
          <span className={clsx("absolute left-0 top-0 h-full w-[3px]", KIND_COLOR[a.kind])} />
          {a.duration ? <span className="tc absolute bottom-1 right-1 rounded-[3px] bg-black/75 px-1 text-[10.5px]">{fmtDur(a.duration)}</span> : null}
          {a.source === "generated" && <Sparkles size={11} className="absolute right-1 top-1 text-white/80 drop-shadow" />}
        </div>
        <div className="truncate bg-raised px-1.5 py-1 text-[11px] text-muted">{a.name}</div>
      </button>
      <button className="absolute right-1 top-1 hidden rounded-[4px] bg-black/75 p-0.5 group-hover:block" onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}><MoreHorizontal size={14} /></button>
      {menu && <AssetMenu a={a} at={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Every model input that accepts this asset's kind, so a result can feed the next generation in one click. */
function targetsFor(kind: MediaKind) {
  const out: { modelId: string; key: string; label: string; multi: boolean; mask: boolean }[] = [];
  for (const m of MODELS)
    for (const f of m.fields) {
      if ((f.type === "asset" || f.type === "assets") && f.kind === kind) out.push({ modelId: m.id, key: f.key, label: `${m.short} · ${f.label}`, multi: f.type === "assets", mask: false });
    }
  return out;
}

const MODE_FOR: Record<string, Record<string, unknown>> = {
  "flux3.refs": { mode: "edit" },
  "qwen.refs": { task: "refs" },
  "qwen.outpaintImage": { task: "outpaint" },
  "omnivoice.refAudio": { mode: "clone" },
};

function AssetMenu({ a, at, onClose }: { a: Asset; at: DOMRect; onClose: () => void }) {
  const append = useStore((s) => s.appendToTimeline);
  const remove = useStore((s) => s.removeAsset);
  const setParams = useStore((s) => s.setParams);
  const setActive = useStore((s) => s.setActiveModel);
  const targets = targetsFor(a.kind);
  const use = (t: (typeof targets)[number]) => {
    const st = useStore.getState();
    const cur = st.params[t.modelId][t.key];
    const value = t.multi ? [...((cur as string[]) ?? []).filter((x) => x !== a.id), a.id].slice(0, 10) : a.id;
    setParams(t.modelId, { [t.key]: value, ...(MODE_FOR[`${t.modelId}.${t.key}`] ?? {}) });
    setActive(t.modelId);
    onClose();
  };
  const reuse = () => {
    if (a.modelId && a.params) {
      setParams(a.modelId, a.params);
      setActive(a.modelId);
    }
    onClose();
  };
  // Portaled with fixed coordinates: the media grid scrolls and would clip it.
  const left = Math.min(at.left, window.innerWidth - 250);
  const top = Math.min(at.bottom + 4, window.innerHeight - 40 - (4 + targets.length) * 30);
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed z-50 max-h-[80vh] w-60 overflow-y-auto rounded-[6px] border border-line-strong bg-raised py-1 shadow-2xl shadow-black/60" style={{ left, top: Math.max(8, top) }}>
        <MenuItem icon={Plus} onClick={() => { append(a.id); onClose(); }}>Ajouter à la timeline</MenuItem>
        {a.modelId && a.params && <MenuItem icon={Sparkles} onClick={reuse}>Reprendre ces réglages ({MODEL_BY_ID[a.modelId]?.short})</MenuItem>}
        {targets.length > 0 && <div className="label px-3 pb-1 pt-2 text-[10px]">Utiliser comme</div>}
        {targets.map((t) => <MenuItem key={t.modelId + t.key} onClick={() => use(t)}>{t.label}</MenuItem>)}
        <div className="my-1 border-t border-line" />
        <MenuItem icon={Download} onClick={async () => { const b = await getBlob(a.id); if (b) download(b, `${a.name.replace(/[^\w\- ]+/g, "").trim() || "media"}.${extFor(b.type || a.mime, a.kind)}`); onClose(); }}>Télécharger</MenuItem>
        <MenuItem icon={Trash2} danger onClick={() => { remove(a.id); onClose(); }}>Supprimer</MenuItem>
      </div>
    </>,
    document.body,
  );
}

function MenuItem({ children, onClick, icon: Icon, danger }: { children: React.ReactNode; onClick: () => void; icon?: React.ComponentType<{ size?: number }>; danger?: boolean }) {
  return (
    <button onClick={onClick} className={clsx("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-line", danger ? "text-danger" : "text-fg")}>
      <span className="w-3.5 shrink-0">{Icon && <Icon size={13} />}</span>
      <span className="truncate">{children}</span>
    </button>
  );
}

export function Jobs() {
  const jobs = useStore((s) => s.jobs);
  const clear = useStore((s) => s.clearFinishedJobs);
  const select = useStore((s) => s.selectAsset);
  if (!jobs.length) return null;
  return (
    <div className="flex max-h-[42%] shrink-0 flex-col border-t border-line">
      <div className="flex h-8 shrink-0 items-center px-3">
        <span className="text-[12px] font-medium">File de rendu</span>
        <span className="tc ml-1.5 text-faint">{jobs.filter((j) => j.status === "running" || j.status === "queued").length}</span>
        <button className="ml-auto text-[11px] text-muted hover:text-fg" onClick={clear}>Vider</button>
      </div>
      <div className="min-h-0 overflow-y-auto pb-1">
        {jobs.map((j) => {
          const live = j.status === "running" || j.status === "queued";
          const m = MODEL_BY_ID[j.modelId];
          return (
            <div key={j.id} className="group px-3 py-1.5 hover:bg-raised/50">
              <div className="flex items-center gap-2">
                <span className={clsx("h-3 w-[3px] shrink-0 rounded-full", m && KIND_COLOR[m.kind])} />
                <span className="truncate text-[12px]">{j.label}</span>
                <span className="ml-auto shrink-0">
                  {live ? <Loader2 size={12} className="animate-spin text-accent" /> : j.status === "done" ? <Check size={12} className="text-ok" /> : <CircleAlert size={12} className="text-danger" />}
                </span>
                {live && <button className="hidden shrink-0 text-muted hover:text-danger group-hover:block" title="Annuler" onClick={() => cancelJob(j.id)}><X size={12} /></button>}
              </div>
              {j.prompt && <p className="mt-0.5 truncate pl-[11px] text-[11px] text-faint">{j.prompt}</p>}
              {live && (
                <div className="mt-1 ml-[11px] h-[3px] overflow-hidden rounded-full bg-line">
                  {j.progress != null && j.progress > 0 ? <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(j.progress * 100)}%` }} /> : <div className="indeterminate h-full w-1/3 bg-accent/70" />}
                </div>
              )}
              {j.message && (j.status !== "done" || live) && <p className={clsx("mt-0.5 line-clamp-2 pl-[11px] text-[11px] leading-snug", j.status === "error" ? "text-danger" : "text-muted")}>{j.message}</p>}
              {j.status === "done" && j.assetIds.length > 0 && (
                <div className="mt-1 flex gap-1 pl-[11px]">
                  {j.assetIds.map((id) => <button key={id} onClick={() => select(id)}><Thumb id={id} className="h-7 w-11 rounded-[3px]" /></button>)}
                  {j.finishedAt && j.startedAt && <span className="tc ml-auto self-end text-[10.5px] text-faint">{fmtDur((j.finishedAt - j.startedAt) / 1000)}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
