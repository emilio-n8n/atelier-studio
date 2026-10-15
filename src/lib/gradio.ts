import { Client } from "@gradio/client";
import { MODEL_BY_ID, type ModelSpec, type Values } from "./models";
import { useStore } from "../store";
import { getBlob } from "./db";
import { kindOf } from "./media";
import { extFor, normalizeUrl, uid } from "./util";

const clients = new Map<string, Promise<Client>>();
const cancels = new Map<string, () => void>();

function connect(url: string, fresh = false) {
  const key = normalizeUrl(url);
  if (fresh || !clients.has(key)) {
    const p = Client.connect(key, { events: ["data", "status"] });
    clients.set(key, p);
    p.catch(() => clients.delete(key));
  }
  return clients.get(key)!;
}

/** Connects, then checks the app exposes the endpoints this model's notebook defines. */
export async function testConnection(modelId: string) {
  const st = useStore.getState();
  const m = MODEL_BY_ID[modelId];
  const url = st.connections[modelId]?.url;
  if (!url) return;
  st.setConnection(modelId, { state: "testing", message: undefined });
  try {
    const c = await withTimeout(connect(url, true), 20000, "Pas de réponse en 20 s : la session tourne-t-elle encore ?");
    const api = await c.view_api();
    const names = Object.keys(api.named_endpoints ?? {});
    const missing = m.endpoints.filter((e) => !names.includes(e));
    if (missing.length) {
      throw new Error(`Ce lien ne ressemble pas au notebook ${m.short} : endpoint ${missing.join(", ")} absent (trouvé : ${names.slice(0, 4).join(", ") || "aucun"}).`);
    }
    st.setConnection(modelId, { state: "ok", message: `Connecté · ${names.length} endpoints`, checkedAt: Date.now() });
  } catch (e) {
    st.setConnection(modelId, { state: "error", message: explain(e) });
  }
}

function explain(e: unknown) {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (/Failed to fetch|NetworkError|Load failed|Could not resolve|Could not get config/i.test(msg))
    return "Lien injoignable. Les liens gradio.live / trycloudflare expirent quand la session s'arrête : relance la cellule et recolle le nouveau lien.";
  return msg;
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

async function fileFor(assetId: string | null | undefined): Promise<File | null> {
  if (!assetId) return null;
  const a = useStore.getState().assets.find((x) => x.id === assetId);
  const b = await getBlob(assetId);
  if (!a || !b) return null;
  // Gradio checks file types by extension, so every upload carries a real file name.
  const base = a.name.replace(/\.[a-z0-9]+$/i, "").replace(/[^\w-]+/g, "_").slice(0, 40) || "input";
  return new File([b], `${base}.${extFor(b.type || a.mime, a.kind)}`, { type: b.type || a.mime });
}

type FileData = { url?: string; path?: string; orig_name?: string; mime_type?: string | null };

/** Pulls every file out of a Gradio output (Image, Audio, Video, Gallery, update dicts). */
function collectFiles(x: unknown, out: FileData[] = []): FileData[] {
  if (!x || typeof x !== "object") return out;
  if (Array.isArray(x)) {
    x.forEach((y) => collectFiles(y, out));
    return out;
  }
  const o = x as Record<string, unknown>;
  if (typeof o.path === "string" && (typeof o.url === "string" || o.meta)) {
    out.push(o as FileData);
    return out;
  }
  for (const k of ["value", "image", "video", "audio"]) if (k in o) collectFiles(o[k], out);
  return out;
}

function textOf(data: unknown[]): string {
  const t = data.find((d) => typeof d === "string") as string | undefined;
  return (t ?? "").replace(/[*`_#]/g, "").trim();
}

async function fetchFile(base: string, f: FileData): Promise<Blob> {
  const candidates = [f.url, f.path ? `${normalizeUrl(base)}gradio_api/file=${f.path}` : undefined].filter(Boolean) as string[];
  let lastErr: unknown;
  for (const u of candidates) {
    try {
      const r = await fetch(u);
      if (r.ok) return await r.blob();
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("fichier introuvable");
}

export function cancelJob(id: string) {
  cancels.get(id)?.();
  const st = useStore.getState();
  st.upsertJob({ id, status: "cancelled", finishedAt: Date.now(), message: "Annulé" });
}

export async function runModel(modelId: string, values?: Values) {
  const st = useStore.getState();
  const m = MODEL_BY_ID[modelId];
  const params = values ?? st.params[modelId];
  const conn = st.connections[modelId];
  const id = uid();
  const prompt = String(params.prompt ?? params.text ?? "").trim();
  st.upsertJob({ id, modelId, label: m.short, prompt, status: "queued", createdAt: Date.now(), assetIds: [], message: "Préparation…" });
  try {
    if (!conn?.url) throw new Error(`Colle d'abord le lien Gradio du notebook ${m.short} dans Connexions.`);
    const plan = await m.build(params, fileFor);
    st.upsertJob({ id, label: plan.label, message: "Connexion…" });
    const client = await withTimeout(connect(conn.url), 25000, "Pas de réponse du notebook en 25 s.");
    let data: unknown[];
    if (plan.style === "minimax-job") data = await runMinimax(id, conn.url, client, plan.data);
    else data = await runQueued(id, m, conn.url, client, plan.endpoint, plan.data);
    if (useStore.getState().jobs.find((j) => j.id === id)?.status === "cancelled") return;
    const files = collectFiles(data);
    const info = textOf(data);
    if (!files.length) throw new Error(info || "Le notebook n'a renvoyé aucun fichier.");
    st.upsertJob({ id, message: "Récupération du résultat…", progress: 1 });
    const assetIds: string[] = [];
    for (const [i, f] of files.entries()) {
      const blob = await fetchFile(conn.url, f);
      const kind = kindOf(blob.type || f.mime_type || "", f.orig_name || f.path || "") ?? plan.output;
      const typed = blob.type ? blob : new Blob([blob], { type: kind === "image" ? "image/png" : kind === "audio" ? "audio/wav" : "video/mp4" });
      const name = `${prompt ? `${m.short} · ${prompt.slice(0, 38)}` : plan.label}${files.length > 1 ? ` (${i + 1})` : ""}`;
      const asset = await st.addAsset(typed, { kind, name, mime: typed.type, source: "generated", modelId, params: { ...params, mask: undefined }, info });
      assetIds.push(asset.id);
    }
    st.upsertJob({ id, status: "done", finishedAt: Date.now(), assetIds, message: info || "Terminé" });
    if (assetIds[0]) useStore.getState().selectAsset(assetIds[0]);
  } catch (e) {
    if (useStore.getState().jobs.find((j) => j.id === id)?.status === "cancelled") return;
    st.upsertJob({ id, status: "error", finishedAt: Date.now(), message: explain(e) });
  } finally {
    cancels.delete(id);
  }
}

async function runQueued(id: string, m: ModelSpec, base: string, client: Client, endpoint: string, payload: unknown[]) {
  const st = useStore.getState();
  const job = client.submit(endpoint, payload);
  cancels.set(id, () => void job.cancel());
  let last: unknown[] | null = null;
  let poll: ReturnType<typeof setInterval> | undefined;
  if (m.progressRoute) poll = pollProgress(id, base);
  try {
    for await (const ev of job) {
      if (ev.type === "status") {
        if (ev.stage === "error") throw new Error(typeof ev.message === "string" && ev.message ? ev.message : JSON.stringify(ev.message ?? "Erreur côté notebook"));
        if (ev.stage === "pending") st.upsertJob({ id, status: "queued", queuePos: ev.position ?? undefined, message: ev.position ? `En file · position ${ev.position + 1}` : "En file…" });
        if (ev.stage === "generating") {
          const pd = ev.progress_data?.[0];
          const frac = pd?.progress ?? (pd?.index != null && pd?.length ? pd.index / pd.length : undefined);
          st.upsertJob({ id, status: "running", startedAt: useStore.getState().jobs.find((j) => j.id === id)?.startedAt ?? Date.now(), ...(frac != null ? { progress: frac } : {}), ...(pd?.desc ? { message: pd.desc } : {}) });
        }
        if (ev.stage === "complete" && !last) continue;
      }
      if (ev.type === "data") {
        last = ev.data as unknown[];
        const t = textOf(last);
        st.upsertJob({ id, status: "running", startedAt: useStore.getState().jobs.find((j) => j.id === id)?.startedAt ?? Date.now(), ...(t ? { message: t } : {}) });
        // A one-shot function ends with its first data message; generators keep yielding until "complete".
      }
    }
  } finally {
    if (poll) clearInterval(poll);
  }
  if (!last) throw new Error("Aucune réponse du notebook.");
  if (textOf(last).startsWith("❌") || textOf(last).startsWith("⚠️")) {
    if (!collectFiles(last).length) throw new Error(textOf(last).replace(/^[❌⚠️\s]+/u, ""));
  }
  return last;
}

/** The AIQUEST notebooks expose live step progress at /aiq_progress. */
function pollProgress(id: string, base: string) {
  return setInterval(async () => {
    try {
      const r = await fetch(`${normalizeUrl(base)}aiq_progress`, { cache: "no-store" });
      if (!r.ok) return;
      const p = await r.json();
      const job = useStore.getState().jobs.find((j) => j.id === id);
      if (!job || job.status !== "running" || !p.active) return;
      useStore.getState().upsertJob({ id, progress: p.fraction, message: p.text || job.message });
    } catch {
      /* the progress route is a bonus */
    }
  }, 1500);
}

/** MiniMax H3's notebook starts a background job and returns at once; the result is fetched when it finishes. */
async function runMinimax(id: string, base: string, client: Client, payload: unknown[]): Promise<unknown[]> {
  const st = useStore.getState();
  const startedAt = Date.now();
  const root = normalizeUrl(base);
  // Server and browser clocks can disagree: a job is finished when the notebook's "finished" stamp moves.
  const before = await fetch(`${root}aiq_progress`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ finished: 0 }));
  const r = await client.predict("/start_generation", payload);
  const msg = textOf(r.data as unknown[]);
  if (msg.includes("already being generated")) throw new Error("Une vidéo est déjà en cours sur ce notebook. Attends qu'elle finisse.");
  st.upsertJob({ id, status: "running", startedAt, message: "Génération lancée…", progress: 0 });
  let stopped = false;
  cancels.set(id, () => {
    stopped = true;
    void client.predict("/stop_generation", []).catch(() => undefined);
  });
  let misses = 0;
  while (!stopped) {
    await new Promise((res) => setTimeout(res, 2500));
    try {
      const p = await (await fetch(`${root}aiq_progress`, { cache: "no-store" })).json();
      misses = 0;
      if (p.active) {
        st.upsertJob({ id, progress: p.fraction, message: p.text || "Génération…" });
        continue;
      }
      if (p.finished && p.finished !== before.finished) {
        if (!p.video) throw new Error((p.message || "La génération a échoué").replace(/^[❌\s]+/u, ""));
        const polled = await client.predict("/poll_job", [0]).catch(() => null);
        const data = (polled?.data as unknown[]) ?? [];
        if (collectFiles(data).length) return data;
        // Fallback: the notebook also serves the newest video as a plain file.
        return [{ path: p.video, url: `${root}aiq_video`, orig_name: p.video }, p.message];
      }
    } catch (e) {
      if (e instanceof Error && !/fetch|network|json/i.test(e.message)) throw e;
      if (++misses > 12) throw new Error("Le notebook ne répond plus (session arrêtée ou lien expiré).");
    }
  }
  throw new Error("Annulé");
}
