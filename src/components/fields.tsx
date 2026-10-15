import { useRef, useState } from "react";
import clsx from "clsx";
import { Dices, Plus, X, Brush, Upload, AudioLines, Film } from "lucide-react";
import type { Field, MediaKind, Values, MaskValue } from "../lib/models";
import { useStore, type Asset } from "../store";
import { kindOf } from "../lib/media";
import { MaskPainter } from "./MaskPainter";
import { Thumb } from "./Thumb";

type Props = { field: Field; value: unknown; values: Values; onChange: (v: unknown) => void };

export function FieldView({ field, value, onChange }: Props) {
  const head = (extra?: React.ReactNode) => (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="label">{field.label}</span>
      {extra}
    </div>
  );
  const hint = field.hint ? <p className="mt-1 text-[11.5px] leading-snug text-faint">{field.hint}</p> : null;

  switch (field.type) {
    case "text":
      return (
        <div>
          {head()}
          <input className="field" value={String(value ?? "")} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
          {hint}
        </div>
      );
    case "textarea":
      return (
        <div>
          {head(<span className="tc text-faint">{String(value ?? "").length}</span>)}
          <TextArea field={field} value={String(value ?? "")} onChange={onChange} />
          {hint}
        </div>
      );
    case "select":
      return (
        <div>
          {head()}
          <select className="field appearance-none bg-[length:10px] bg-[right_10px_center] bg-no-repeat pr-7" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239a978f' fill='none' stroke-width='1.5'/%3E%3C/svg%3E\")" }}
            value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {field.options.map((o) => (
              <option key={o} value={o} className="bg-panel">
                {field.labels?.[o] ?? o}
              </option>
            ))}
          </select>
          {hint}
        </div>
      );
    case "segmented":
      return (
        <div>
          {head()}
          <div className="flex flex-wrap gap-0.5 rounded-[6px] border border-line bg-sunken p-0.5">
            {field.options.map((o) => (
              <button key={o} type="button" onClick={() => onChange(o)}
                className={clsx("min-w-0 flex-1 whitespace-nowrap rounded-[4px] px-2 py-1 text-[12px] transition-colors",
                  value === o ? "bg-raised font-medium text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-muted hover:text-fg")}>
                {field.labels?.[o] ?? o}
              </button>
            ))}
          </div>
          {hint}
        </div>
      );
    case "slider": {
      const v = Number(value ?? field.default);
      const p = ((v - field.min) / (field.max - field.min)) * 100;
      const dec = String(field.step).split(".")[1]?.length ?? 0;
      return (
        <div>
          {head(
            <input type="number" className="tc w-16 rounded-[4px] border border-transparent bg-transparent px-1 text-right text-fg hover:border-line focus:border-line-strong focus:outline-none"
              value={v.toFixed(dec)} step={field.step} min={field.min} max={field.max}
              onChange={(e) => onChange(Math.min(field.max, Math.max(field.min, Number(e.target.value))))} />,
          )}
          <div className="flex items-center gap-2">
            <input type="range" min={field.min} max={field.max} step={field.step} value={v} style={{ ["--p" as string]: `${p}%` }}
              onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(field.default)} />
            {field.unit && <span className="tc w-3 text-faint">{field.unit}</span>}
          </div>
          {hint}
        </div>
      );
    }
    case "seed": {
      const v = Number(value ?? -1);
      return (
        <div>
          {head(<span className="text-[11px] text-faint">−1 = aléatoire</span>)}
          <div className="flex gap-1.5">
            <input type="number" className="field tc" value={v} onChange={(e) => onChange(Math.trunc(Number(e.target.value)))} />
            <button type="button" className="btn shrink-0" title="Seed fixe aléatoire" onClick={() => onChange(Math.floor(Math.random() * 2 ** 31))}>
              <Dices size={14} />
            </button>
            {v !== -1 && (
              <button type="button" className="btn shrink-0" title="Revenir à aléatoire" onClick={() => onChange(-1)}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      );
    }
    case "checkbox":
      return (
        <label className="flex cursor-pointer items-center gap-2.5 py-0.5">
          <span className={clsx("relative h-[18px] w-8 shrink-0 rounded-full border transition-colors", value ? "border-accent bg-accent/90" : "border-line-strong bg-sunken")}>
            <span className={clsx("absolute top-[2px] size-3 rounded-full transition-all", value ? "left-[16px] bg-accent-fg" : "left-[2px] bg-muted")} />
          </span>
          <input type="checkbox" className="sr-only" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span className="text-[12.5px] text-fg">{field.label}</span>
        </label>
      );
    case "asset":
      return (
        <div>
          {head()}
          <AssetSlot kind={field.kind} id={(value as string) ?? null} onChange={onChange} />
          {hint}
        </div>
      );
    case "assets": {
      const ids = (value as string[]) ?? [];
      return (
        <div>
          {head(<span className="tc text-faint">{ids.length}/{field.max}</span>)}
          <div className="grid grid-cols-4 gap-1.5">
            {ids.map((id, i) => (
              <div key={id + i} className="group relative">
                <Thumb id={id} className="aspect-square w-full rounded-[4px]" />
                <span className="tc absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px]">{i + 1}</span>
                <button type="button" className="absolute right-1 top-1 hidden rounded bg-black/70 p-0.5 group-hover:block" onClick={() => onChange(ids.filter((_, j) => j !== i))}>
                  <X size={12} />
                </button>
              </div>
            ))}
            {ids.length < field.max && <AssetAdd kind={field.kind} onPick={(id) => onChange([...ids, id])} />}
          </div>
          {hint}
        </div>
      );
    }
    case "mask":
      return (
        <div>
          {head()}
          <MaskSlot value={value as MaskValue} onChange={onChange} />
          {hint}
        </div>
      );
  }
}

function TextArea({ field, value, onChange }: { field: Extract<Field, { type: "textarea" }>; value: string; onChange: (v: unknown) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (tag: string) => {
    const el = ref.current;
    if (!el) return onChange(value + tag);
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const pad = a > 0 && !/\s$/.test(value.slice(0, a)) ? " " : "";
    const next = value.slice(0, a) + pad + tag + " " + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = a + pad.length + tag.length + 1;
    });
  };
  return (
    <>
      <textarea ref={ref} className="field resize-y leading-relaxed" rows={field.rows ?? 4} value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      {field.tags && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {field.tags.map((t) => (
            <button key={t} type="button" onClick={() => insert(t)} className="tc rounded-[4px] border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-line-strong hover:text-fg">
              {t}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function useImport(kind: MediaKind) {
  const addAsset = useStore((s) => s.addAsset);
  return async (f: File) => {
    const k = kindOf(f.type, f.name);
    if (k !== kind) throw new Error(`Ce fichier n'est pas ${kind === "image" ? "une image" : kind === "audio" ? "un audio" : "une vidéo"}.`);
    const a = await addAsset(f, { kind: k, name: f.name, mime: f.type, source: "upload" });
    return a.id;
  };
}

/** Pick a library asset of the right kind, or import a file. */
function Picker({ kind, onPick, onClose }: { kind: MediaKind; onPick: (id: string) => void; onClose: () => void }) {
  const assets = useStore((s) => s.assets).filter((a) => a.kind === kind);
  const imp = useImport(kind);
  const input = useRef<HTMLInputElement>(null);
  const accept = kind === "image" ? "image/*" : kind === "audio" ? "audio/*" : "video/*";
  return (
    <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-[6px] border border-line-strong bg-raised p-2 shadow-2xl shadow-black/60">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Depuis la médiathèque</span>
        <button className="icon-btn size-6" onClick={onClose}><X size={13} /></button>
      </div>
      <div className="grid max-h-52 grid-cols-4 gap-1.5 overflow-y-auto">
        <button type="button" onClick={() => input.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[4px] border border-dashed border-line-strong text-muted hover:text-fg">
          <Upload size={14} />
          <span className="text-[10.5px]">Importer</span>
        </button>
        {assets.map((a) => (
          <button key={a.id} type="button" title={a.name} onClick={() => { onPick(a.id); onClose(); }} className="overflow-hidden rounded-[4px] ring-accent hover:ring-1">
            <Thumb id={a.id} className="aspect-square w-full" />
          </button>
        ))}
      </div>
      {!assets.length && <p className="mt-2 text-[11.5px] text-faint">Rien de ce type encore. Importe un fichier ou génère-en un.</p>}
      <input ref={input} type="file" accept={accept} className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try { onPick(await imp(f)); onClose(); } catch (err) { alert((err as Error).message); }
      }} />
    </div>
  );
}

function AssetAdd({ kind, onPick }: { kind: MediaKind; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const imp = useImport(kind);
  return (
    <div className="relative col-span-1">
      <button type="button" onClick={() => setOpen(!open)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/atelier-asset");
          if (id) return onPick(id);
          const f = e.dataTransfer.files[0];
          if (f) try { onPick(await imp(f)); } catch (err) { alert((err as Error).message); }
        }}
        className="flex aspect-square w-full items-center justify-center rounded-[4px] border border-dashed border-line-strong text-muted transition-colors hover:border-accent/60 hover:text-fg">
        <Plus size={16} />
      </button>
      {open && <div className="absolute left-0 top-0 w-[300px]"><Picker kind={kind} onPick={onPick} onClose={() => setOpen(false)} /></div>}
    </div>
  );
}

function AssetSlot({ kind, id, onChange }: { kind: MediaKind; id: string | null; onChange: (v: unknown) => void }) {
  const [open, setOpen] = useState(false);
  const asset = useStore((s) => s.assets.find((a) => a.id === id));
  const imp = useImport(kind);
  const Icon = kind === "audio" ? AudioLines : kind === "video" ? Film : Plus;
  return (
    <div className="relative">
      <div onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          const aid = e.dataTransfer.getData("text/atelier-asset");
          const a = useStore.getState().assets.find((x) => x.id === aid);
          if (a && a.kind === kind) return onChange(aid);
          const f = e.dataTransfer.files[0];
          if (f) try { onChange(await imp(f)); } catch (err) { alert((err as Error).message); }
        }}
        className="flex items-center gap-2 rounded-[5px] border border-dashed border-line-strong bg-sunken p-1.5 transition-colors hover:border-accent/50">
        {asset ? (
          <>
            {kind === "audio" ? <AudioChip asset={asset} /> : <Thumb id={asset.id} className="size-11 shrink-0 rounded-[3px]" />}
            {kind !== "audio" && <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{asset.name}</span>}
            <button type="button" className="icon-btn size-6 shrink-0" onClick={() => onChange(null)}><X size={13} /></button>
          </>
        ) : (
          <button type="button" className="flex w-full items-center gap-2 px-1 py-2 text-[12px] text-muted hover:text-fg" onClick={() => setOpen(!open)}>
            <Icon size={14} /> Choisir, ou glisser {kind === "image" ? "une image" : kind === "audio" ? "un audio" : "une vidéo"} ici
          </button>
        )}
      </div>
      {open && <Picker kind={kind} onPick={onChange} onClose={() => setOpen(false)} />}
    </div>
  );
}

function AudioChip({ asset }: { asset: Asset }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="flex h-8 w-20 shrink-0 items-center gap-px overflow-hidden">
        {(asset.peaks ?? []).filter((_, i) => i % 8 === 0).map((p, i) => (
          <span key={i} className="w-[2px] shrink-0 rounded-full bg-audio/80" style={{ height: `${Math.max(8, p * 100)}%` }} />
        ))}
      </div>
      <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{asset.name}</span>
      <span className="tc text-faint">{asset.duration ? asset.duration.toFixed(1) + " s" : ""}</span>
    </div>
  );
}

function MaskSlot({ value, onChange }: { value: MaskValue; onChange: (v: unknown) => void }) {
  const [pick, setPick] = useState(false);
  const [paint, setPaint] = useState<string | null>(null);
  return (
    <div className="relative">
      {value ? (
        <div className="flex items-center gap-2 rounded-[5px] border border-line bg-sunken p-1.5">
          <MaskPreview value={value} />
          <div className="flex flex-1 flex-col gap-1">
            <button type="button" className="btn" onClick={() => setPaint(value.sourceId)}><Brush size={13} /> Retoucher le masque</button>
            <button type="button" className="btn" onClick={() => onChange(null)}><X size={13} /> Retirer</button>
          </div>
        </div>
      ) : (
        <button type="button" className="flex w-full items-center gap-2 rounded-[5px] border border-dashed border-line-strong bg-sunken px-2.5 py-3 text-[12px] text-muted hover:text-fg" onClick={() => setPick(true)}>
          <Brush size={14} /> Choisir une image puis peindre la zone
        </button>
      )}
      {pick && <Picker kind="image" onPick={(id) => setPaint(id)} onClose={() => setPick(false)} />}
      {paint && (
        <MaskPainter assetId={paint} initial={value?.sourceId === paint ? value.mask : null}
          onCancel={() => setPaint(null)}
          onDone={(mask) => { onChange({ sourceId: paint, mask }); setPaint(null); }} />
      )}
    </div>
  );
}

function MaskPreview({ value }: { value: NonNullable<MaskValue> }) {
  const [u] = useState(() => URL.createObjectURL(value.mask));
  return (
    <div className="relative size-16 shrink-0 overflow-hidden rounded-[3px]">
      <Thumb id={value.sourceId} className="absolute inset-0 size-full" />
      <img src={u} className="absolute inset-0 size-full object-cover opacity-70" alt="" />
    </div>
  );
}
