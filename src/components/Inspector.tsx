import { useState } from "react";
import clsx from "clsx";
import { ChevronDown, ExternalLink, Loader2, Play, RotateCcw, Sparkles, Link2, CircleCheck, CircleAlert, Clipboard } from "lucide-react";
import { MODELS, MODEL_BY_ID, H3_LORA_SCALE, type ModelSpec } from "../lib/models";
import { useStore } from "../store";
import { runModel, testConnection } from "../lib/gradio";
import { normalizeUrl } from "../lib/util";
import { FieldView } from "./fields";

export const KIND_COLOR = { image: "bg-image", video: "bg-video", audio: "bg-audio" } as const;
const KIND_LABEL = { image: "Image", video: "Vidéo", audio: "Voix" } as const;

export function StatusDot({ id, className }: { id: string; className?: string }) {
  const st = useStore((s) => s.connections[id]?.state ?? "idle");
  const url = useStore((s) => s.connections[id]?.url);
  return (
    <span className={clsx("inline-block size-1.5 shrink-0 rounded-full",
      st === "ok" ? "bg-ok" : st === "error" ? "bg-danger" : st === "testing" ? "animate-pulse bg-warn" : url ? "bg-muted" : "bg-line-strong", className)} />
  );
}

export function Inspector() {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  return (
    <aside className="flex min-h-0 flex-col border-l border-line bg-panel">
      <div className="flex h-9 shrink-0 items-stretch border-b border-line px-1.5">
        {(["generate", "connections"] as const).map((p) => (
          <button key={p} onClick={() => setPanel(p)}
            className={clsx("relative px-3 text-[12.5px] font-medium transition-colors", panel === p ? "text-fg" : "text-muted hover:text-fg")}>
            {p === "generate" ? "Générer" : "Connexions"}
            {panel === p && <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-accent" />}
          </button>
        ))}
      </div>
      {panel === "generate" ? <Generator /> : <Connections />}
    </aside>
  );
}

function Generator() {
  const activeId = useStore((s) => s.activeModel);
  const setActive = useStore((s) => s.setActiveModel);
  const m = MODEL_BY_ID[activeId] ?? MODELS[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-5 gap-1 border-b border-line p-1.5">
        {MODELS.map((x) => (
          <button key={x.id} onClick={() => setActive(x.id)} title={x.name}
            className={clsx("flex flex-col items-start gap-1 rounded-[5px] border px-1.5 py-1.5 text-left transition-colors",
              x.id === m.id ? "border-line-strong bg-raised" : "border-transparent hover:bg-raised/60")}>
            <span className="flex w-full items-center gap-1">
              <span className={clsx("h-2.5 w-[3px] rounded-full", KIND_COLOR[x.kind])} />
              <StatusDot id={x.id} className="ml-auto" />
            </span>
            <span className={clsx("w-full truncate text-[11.5px] font-medium leading-tight", x.id === m.id ? "text-fg" : "text-muted")}>{x.short}</span>
          </button>
        ))}
      </div>
      <ModelForm key={m.id} m={m} />
    </div>
  );
}

function ModelForm({ m }: { m: ModelSpec }) {
  const values = useStore((s) => s.params[m.id]);
  const setParam = useStore((s) => s.setParam);
  const reset = useStore((s) => s.resetParams);
  const conn = useStore((s) => s.connections[m.id]);
  const setPanel = useStore((s) => s.setPanel);
  const running = useStore((s) => s.jobs.filter((j) => j.modelId === m.id && (j.status === "running" || j.status === "queued")).length);
  const [adv, setAdv] = useState(false);
  const visible = m.fields.filter((f) => !f.showIf || f.showIf(values));
  const basic = visible.filter((f) => !f.advanced);
  const advanced = visible.filter((f) => f.advanced);

  const change = (key: string, v: unknown) => {
    setParam(m.id, key, v);
    // The H3 notebook resets a LoRA's strength to its recommended value when you pick it.
    if (m.id === "minimax" && (key === "lora1" || key === "lora2")) setParam(m.id, key === "lora1" ? "s1" : "s2", H3_LORA_SCALE[v as string] ?? 1);
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={clsx("rounded-[3px] px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide text-black/80", KIND_COLOR[m.kind])}>{KIND_LABEL[m.kind]}</span>
            <h2 className="truncate text-[14px] font-semibold">{m.name}</h2>
            <button className="icon-btn ml-auto size-6" title="Réglages par défaut" onClick={() => reset(m.id)}><RotateCcw size={13} /></button>
          </div>
          <p className="mt-1.5 text-[12px] leading-snug text-muted">{m.blurb}</p>
          <p className="tc mt-1 text-[11px] text-faint">{m.vendor} · {m.hardware} · {m.speedHint}</p>
          {!conn?.url && (
            <button onClick={() => setPanel("connections")} className="mt-2.5 flex w-full items-center gap-2 rounded-[5px] border border-warn/30 bg-warn/8 px-2.5 py-2 text-left text-[12px] text-warn">
              <Link2 size={14} /> Colle le lien Gradio de ce notebook pour générer.
            </button>
          )}
        </div>
        <div className="space-y-4 px-4 py-4">
          {basic.map((f) => <FieldView key={f.key} field={f} value={values[f.key]} values={values} onChange={(v) => change(f.key, v)} />)}
        </div>
        {advanced.length > 0 && (
          <div className="border-t border-line">
            <button onClick={() => setAdv(!adv)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
              <span className="label">Avancé</span>
              <span className="tc text-faint">{advanced.length}</span>
              <ChevronDown size={14} className={clsx("ml-auto text-muted transition-transform", adv && "rotate-180")} />
            </button>
            {adv && <div className="space-y-4 px-4 pb-5">{advanced.map((f) => <FieldView key={f.key} field={f} value={values[f.key]} values={values} onChange={(v) => change(f.key, v)} />)}</div>}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-line p-3">
        <button className="btn-primary w-full" disabled={!conn?.url} onClick={() => void runModel(m.id)}>
          <Sparkles size={15} /> Générer {running > 0 && <span className="tc rounded bg-black/20 px-1.5 text-[11px]">{running} en cours</span>}
        </button>
        <p className="mt-1.5 text-center text-[11px] text-faint">⌘/Ctrl + Entrée · les générations s'empilent dans la file du notebook</p>
      </div>
    </>
  );
}

function Connections() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-line px-4 py-3 text-[12px] leading-relaxed text-muted">
        Lance le notebook sur Kaggle ou Colab, puis colle ici le lien public qu'il affiche (<span className="tc text-fg">*.gradio.live</span> ou <span className="tc text-fg">*.trycloudflare.com</span>).
        Le studio parle directement à l'API Gradio, depuis ton navigateur : rien ne passe par un serveur.
      </div>
      {MODELS.map((m) => <ConnectionRow key={m.id} m={m} />)}
      <AgentsMcp />
      <div className="px-4 py-4 text-[11.5px] leading-relaxed text-faint">
        Les liens changent à chaque session. Les médias générés sont copiés dans ton navigateur (IndexedDB) : ils restent quand la session Kaggle s'arrête.
      </div>
    </div>
  );
}

function ConnectionRow({ m }: { m: ModelSpec }) {
  const c = useStore((s) => s.connections[m.id]);
  const setConnection = useStore((s) => s.setConnection);
  const [draft, setDraft] = useState(c?.url ?? "");
  const save = (u: string) => {
    const url = u.trim() ? normalizeUrl(u) : "";
    setDraft(url);
    setConnection(m.id, { url, state: "idle", message: undefined });
    if (url) void testConnection(m.id);
  };
  return (
    <div className="border-b border-line px-4 py-3.5">
      <div className="mb-2 flex items-center gap-2">
        <span className={clsx("h-3 w-[3px] rounded-full", KIND_COLOR[m.kind])} />
        <span className="font-medium">{m.name}</span>
        <span className="tc text-[11px] text-faint">{m.hardware}</span>
        <a href={m.notebookUrl} target="_blank" rel="noreferrer" className="icon-btn ml-auto size-6" title="Ouvrir le notebook"><ExternalLink size={13} /></a>
      </div>
      <div className="flex gap-1.5">
        <input className="field tc text-[12px]" placeholder="https://xxxx.gradio.live" value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save(draft)} onBlur={() => draft !== c?.url && save(draft)} />
        <button className="btn shrink-0" title="Coller" onClick={async () => { try { save(await navigator.clipboard.readText()); } catch { /* permission */ } }}><Clipboard size={13} /></button>
        <button className="btn shrink-0" disabled={!c?.url || c.state === "testing"} onClick={() => void testConnection(m.id)}>
          {c?.state === "testing" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Tester
        </button>
      </div>
      {c?.message && (
        <p className={clsx("mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-snug", c.state === "ok" ? "text-ok" : c.state === "error" ? "text-danger" : "text-muted")}>
          {c.state === "ok" ? <CircleCheck size={13} className="mt-px shrink-0" /> : <CircleAlert size={13} className="mt-px shrink-0" />} {c.message}
        </p>
      )}
    </div>
  );
}

const ENV_KEYS: Record<string, string> = { flux3: "ATELIER_FLUX_URL", qwen: "ATELIER_QWEN_URL", minimax: "ATELIER_MINIMAX_URL", drama3: "ATELIER_DRAMA_URL", omnivoice: "ATELIER_OMNIVOICE_URL" };

/** Copy-paste setup so Claude Code or Codex can call the same notebooks through the Atelier MCP server. */
function AgentsMcp() {
  const conns = useStore((s) => s.connections);
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof location !== "undefined" ? location.origin : "https://atelier-studio-pi.vercel.app";
  const urls = MODELS.filter((m) => conns[m.id]?.url).map((m) => [ENV_KEYS[m.id], conns[m.id]!.url] as const);
  const download = `mkdir -p ~/.atelier && curl -fsSL ${origin}/atelier-mcp.mjs -o ~/.atelier/atelier-mcp.mjs`;
  const claude = `claude mcp add --scope user ${urls.map(([k, u]) => `-e ${k}=${u} `).join("")}atelier -- node ~/.atelier/atelier-mcp.mjs`;
  const codex = `codex mcp add atelier ${urls.map(([k, u]) => `--env ${k}=${u} `).join("")}-- node ~/.atelier/atelier-mcp.mjs`;
  const Block = ({ id, title, cmd }: { id: string; title: string; cmd: string }) => (
    <div className="mt-2.5">
      <div className="mb-1 flex items-center text-[11.5px] text-muted">
        {title}
        <button className="icon-btn ml-auto size-6" title="Copier" onClick={() => { void navigator.clipboard.writeText(cmd); setCopied(id); setTimeout(() => setCopied(null), 1500); }}>
          {copied === id ? <CircleCheck size={13} className="text-ok" /> : <Clipboard size={13} />}
        </button>
      </div>
      <pre className="tc overflow-x-auto whitespace-pre-wrap break-all rounded-[5px] border border-line bg-black/30 px-2.5 py-2 text-[11px] leading-relaxed text-fg">{cmd}</pre>
    </div>
  );
  return (
    <div className="border-b border-line px-4 py-4">
      <div className="mb-1 flex items-center gap-2"><Sparkles size={14} className="text-accent" /><span className="font-medium">Agents · Claude Code / Codex (MCP)</span></div>
      <p className="text-[11.5px] leading-relaxed text-muted">
        Donne à ton agent les mêmes modèles : il génère images, vidéos et voix lui-même et récupère les fichiers dans <span className="tc text-fg">./atelier-output</span>. Node 20+ requis.
        Les liens connectés ici sont déjà inclus ; quand un lien expire, demande simplement à l'agent d'utiliser le nouveau (outil <span className="tc text-fg">set_connection</span>).
      </p>
      <Block id="dl" title="1 · Télécharger le serveur MCP" cmd={download} />
      <Block id="claude" title="2a · Claude Code" cmd={claude} />
      <Block id="codex" title="2b · Codex" cmd={codex} />
    </div>
  );
}
