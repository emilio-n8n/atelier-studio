// Atelier MCP: lets Claude Code, Codex or any MCP client drive the same Gradio notebooks as the web studio.
// It reuses the exact model specs of the app (src/lib/models.ts), so payloads are identical.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Client } from "@gradio/client";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { MODELS, MODEL_BY_ID, defaults, type Field, type MediaKind, type Values } from "../src/lib/models";

const VERSION = "0.2.0";
const CONFIG_DIR = process.env.ATELIER_HOME || join(homedir(), ".atelier");
const CONFIG_FILE = join(CONFIG_DIR, "connections.json");
const OUT_DIR = resolve(process.env.ATELIER_OUT_DIR || join(process.cwd(), "atelier-output"));
const ENV_KEYS: Record<string, string> = { flux3: "ATELIER_FLUX_URL", qwen: "ATELIER_QWEN_URL", minimax: "ATELIER_MINIMAX_URL", drama3: "ATELIER_DRAMA_URL", omnivoice: "ATELIER_OMNIVOICE_URL" };

// ─────────────── connections ───────────────
function normalizeUrl(raw: string) {
  let u = raw.trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  u = u.replace(/\/+(\?.*)?$/, "").replace(/\/(gradio_api|api|docs|\?view=api).*$/i, "");
  return u + "/";
}
async function loadConfig(): Promise<Record<string, string>> {
  try { return JSON.parse(await readFile(CONFIG_FILE, "utf8")); } catch { return {}; }
}
async function urlFor(model: string) {
  const cfg = await loadConfig();
  return normalizeUrl(cfg[model] || process.env[ENV_KEYS[model]] || "");
}
const clients = new Map<string, Promise<Client>>();
function connect(url: string, fresh = false) {
  if (fresh || !clients.has(url)) {
    const p = Client.connect(url, { events: ["data", "status"] });
    clients.set(url, p);
    p.catch(() => clients.delete(url));
  }
  return clients.get(url)!;
}
const timeout = <T,>(p: Promise<T>, ms: number, msg: string) => Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(msg)), ms))]);
function explain(e: unknown) {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|Could not resolve|Could not get config|NetworkError/i.test(msg))
    return `Notebook unreachable (${msg}). gradio.live / trycloudflare links expire when the Kaggle/Colab session stops: restart the cell and call set_connection with the new link.`;
  return msg;
}

// ─────────────── input files ───────────────
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac", ".ogg": "audio/ogg", ".m4a": "audio/mp4" };
async function loadFile(ref: string | null | undefined): Promise<File | null> {
  if (!ref) return null;
  if (/^https?:\/\//i.test(ref)) {
    const r = await fetch(ref);
    if (!r.ok) throw new Error(`Cannot download ${ref}: HTTP ${r.status}`);
    const name = basename(new URL(ref).pathname) || "input";
    const type = r.headers.get("content-type")?.split(";")[0] || MIME[extname(name).toLowerCase()] || "application/octet-stream";
    return new File([await r.blob()], extname(name) ? name : `${name}${Object.entries(MIME).find(([, m]) => m === type)?.[0] ?? ""}`, { type });
  }
  const p = resolve(ref.replace(/^~(?=\/)/, homedir()));
  if (!existsSync(p)) throw new Error(`File not found: ${p}`);
  return new File([await readFile(p)], basename(p), { type: MIME[extname(p).toLowerCase()] || "application/octet-stream" });
}

// ─────────────── outputs ───────────────
type FileData = { url?: string; path?: string; orig_name?: string; mime_type?: string | null };
function collectFiles(x: unknown, out: FileData[] = []): FileData[] {
  if (!x || typeof x !== "object") return out;
  if (Array.isArray(x)) { x.forEach((y) => collectFiles(y, out)); return out; }
  const o = x as Record<string, unknown>;
  if (typeof o.path === "string" && (typeof o.url === "string" || o.meta)) { out.push(o as FileData); return out; }
  for (const k of ["value", "image", "video", "audio"]) if (k in o) collectFiles(o[k], out);
  return out;
}
const textOf = (d: unknown[]) => ((d.find((x) => typeof x === "string") as string | undefined) ?? "").replace(/[*`_#]/g, "").trim();
async function fetchFile(base: string, f: FileData) {
  let last: unknown;
  for (const u of [f.url, f.path ? `${base}gradio_api/file=${f.path}` : undefined].filter(Boolean) as string[]) {
    try { const r = await fetch(u); if (r.ok) return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type")?.split(";")[0] || "" }; last = new Error(`HTTP ${r.status}`); } catch (e) { last = e; }
  }
  throw last ?? new Error("output file not found");
}
const EXT: Record<MediaKind, string> = { image: ".png", video: ".mp4", audio: ".wav" };
function extOf(type: string, name: string, kind: MediaKind) {
  const e = extname(name).toLowerCase();
  if (e && MIME[e]) return e;
  return Object.entries(MIME).find(([, m]) => m === type)?.[0] ?? EXT[kind];
}

// ─────────────── jobs ───────────────
type Job = { id: string; model: string; status: "running" | "done" | "error" | "cancelled"; progress?: number; message: string; files: string[]; info?: string; startedAt: number; cancel?: () => void; promise: Promise<void> };
const jobs = new Map<string, Job>();
let seq = 0;

function startJob(model: string, params: Values): Job {
  const m = MODEL_BY_ID[model];
  const id = `${model}-${Date.now().toString(36)}-${++seq}`;
  const job = { id, model, status: "running", message: "Preparing…", files: [], startedAt: Date.now() } as unknown as Job;
  job.promise = (async () => {
    try {
      const base = await urlFor(model);
      if (!base) throw new Error(`No Gradio link for ${m.short}. Ask the user for the notebook's public link and call set_connection.`);
      const values: Values = { ...defaults(m), ...params };
      // Inpaint mask: the app paints it; here the agent gives the source image and a mask image (white = area to change).
      if (values.mask_image || values.mask) {
        const maskPath = String(values.mask_image ?? values.mask);
        const src = String(values.mask_source ?? values.source ?? values.image ?? "");
        const mf = await loadFile(maskPath);
        values.mask = mf && src ? { sourceId: src, mask: mf } : null;
      }
      const plan = await m.build(values, loadFile);
      job.message = `${plan.label}: connecting…`;
      const client = await timeout(connect(base), 30000, "Notebook did not answer within 30 s.");
      const data = plan.style === "minimax-job" ? await runMinimax(job, base, client, plan.data) : await runQueued(job, base, client, plan.endpoint, plan.data, !!m.progressRoute);
      if (job.status === "cancelled") return;
      const files = collectFiles(data);
      job.info = textOf(data);
      if (!files.length) throw new Error(job.info || "The notebook returned no file.");
      await mkdir(OUT_DIR, { recursive: true });
      for (const [i, f] of files.entries()) {
        const { buf, type } = await fetchFile(base, f);
        const p = join(OUT_DIR, `${id}${files.length > 1 ? `-${i + 1}` : ""}${extOf(type || f.mime_type || "", f.orig_name || f.path || "", plan.output)}`);
        await writeFile(p, buf);
        job.files.push(p);
      }
      await writeFile(join(OUT_DIR, `${id}.json`), JSON.stringify({ model, params: { ...params }, info: job.info, files: job.files, createdAt: new Date().toISOString() }, null, 2));
      job.status = "done";
      job.progress = 1;
      job.message = job.info || "Done";
    } catch (e) {
      if (job.status !== "cancelled") { job.status = "error"; job.message = explain(e); }
    }
  })();
  jobs.set(id, job);
  return job;
}

async function runQueued(job: Job, base: string, client: Client, endpoint: string, payload: unknown[], progressRoute: boolean) {
  const sub = client.submit(endpoint, payload);
  job.cancel = () => void sub.cancel();
  let last: unknown[] | null = null;
  const poll = progressRoute ? setInterval(async () => {
    try { const p = await (await fetch(`${base}aiq_progress`)).json(); if (p.active) { job.progress = p.fraction; job.message = p.text || job.message; } } catch { /* optional */ }
  }, 2000) : undefined;
  try {
    for await (const ev of sub) {
      if (job.status === "cancelled") break;
      if (ev.type === "status") {
        if (ev.stage === "error") throw new Error(typeof ev.message === "string" && ev.message ? ev.message : "Notebook error");
        if (ev.stage === "pending") job.message = ev.position ? `Queued, position ${ev.position + 1}` : "Queued";
        if (ev.stage === "generating") {
          const pd = ev.progress_data?.[0];
          const frac = pd?.progress ?? (pd?.index != null && pd?.length ? pd.index / pd.length : undefined);
          if (frac != null) job.progress = frac;
          if (pd?.desc) job.message = pd.desc;
        }
      }
      if (ev.type === "data") { last = ev.data as unknown[]; const t = textOf(last); if (t) job.message = t; }
    }
  } finally { if (poll) clearInterval(poll); }
  if (!last) throw new Error("No answer from the notebook.");
  const t = textOf(last);
  if ((t.startsWith("❌") || t.startsWith("⚠️")) && !collectFiles(last).length) throw new Error(t.replace(/^[❌⚠️\s]+/u, ""));
  return last;
}

async function runMinimax(job: Job, base: string, client: Client, payload: unknown[]): Promise<unknown[]> {
  const before = await fetch(`${base}aiq_progress`).then((r) => r.json()).catch(() => ({ finished: 0 }));
  const r = await client.predict("/start_generation", payload);
  if (textOf(r.data as unknown[]).includes("already being generated")) throw new Error("A video is already being generated on this notebook. Wait for it to finish.");
  job.message = "Generation started…";
  job.progress = 0;
  job.cancel = () => void client.predict("/stop_generation", []).catch(() => undefined);
  let misses = 0;
  while (job.status === "running") {
    await new Promise((res) => setTimeout(res, 3000));
    try {
      const p = await (await fetch(`${base}aiq_progress`)).json();
      misses = 0;
      if (p.active) { job.progress = p.fraction; job.message = p.text || "Generating…"; continue; }
      if (p.finished && p.finished !== before.finished) {
        if (!p.video) throw new Error((p.message || "Generation failed").replace(/^[❌\s]+/u, ""));
        const polled = await client.predict("/poll_job", [0]).catch(() => null);
        const data = (polled?.data as unknown[]) ?? [];
        if (collectFiles(data).length) return data;
        return [{ path: p.video, url: `${base}aiq_video`, orig_name: p.video }, p.message];
      }
    } catch (e) {
      if (e instanceof Error && !/fetch|network|json|ECONN/i.test(e.message)) throw e;
      if (++misses > 12) throw new Error("The notebook stopped answering (session stopped or link expired).");
    }
  }
  throw new Error("Cancelled");
}

async function wait(job: Job, seconds: number) {
  await Promise.race([job.promise, new Promise((r) => setTimeout(r, Math.max(0, seconds) * 1000))]);
}

// ─────────────── tool descriptions ───────────────
function describeField(f: Field): Record<string, unknown> {
  const d: Record<string, unknown> = { key: f.key, label: f.label, type: f.type };
  if ("options" in f) d.options = f.options;
  if (f.type === "slider") Object.assign(d, { min: f.min, max: f.max, step: f.step });
  if (f.type === "asset") d.value = `path or URL of a ${f.kind} file`;
  if (f.type === "assets") d.value = `array of up to ${f.max} ${f.kind} paths or URLs`;
  if (f.type === "mask") d.value = "pass mask_image (PNG, white = area to repaint) and mask_source (the image to edit) instead";
  if (f.type === "seed") d.value = "integer, -1 = random";
  if (f.default != null && f.type !== "assets") d.default = f.default;
  if (f.hint) d.hint = f.hint;
  if (f.advanced) d.advanced = true;
  if (f.showIf) d.conditional = "only used in some modes (see hint/label)";
  return d;
}
function modelSummary(m: (typeof MODELS)[number], url: string) {
  return { id: m.id, name: m.name, output: m.kind, connected_url: url || null, speed: m.speedHint, about: m.blurb, endpoints: m.endpoints };
}

// ─────────────── server ───────────────
const server = new McpServer({ name: "atelier", version: VERSION });
const modelIds = MODELS.map((m) => m.id) as [string, ...string[]];

server.registerTool("list_models", {
  title: "List Atelier models",
  description: "Lists the generation models (FLUX 3 Klein and Qwen-Image 2.1 for images, MiniMax H3 Turbo for video with audio, Fish Audio Drama 3 and OmniVoice for speech), whether each has a Gradio link, and, with details=true, every parameter each one accepts (keys, options, ranges, defaults). Call this before generate.",
  inputSchema: { details: z.boolean().optional().describe("Include the full parameter list of each model"), model: z.enum(modelIds).optional().describe("Only this model") },
}, async ({ details, model }) => {
  const list = await Promise.all(MODELS.filter((m) => !model || m.id === model).map(async (m) => ({ ...modelSummary(m, await urlFor(m.id)), ...(details || model ? { params: m.fields.map(describeField) } : {}) })));
  return { content: [{ type: "text", text: JSON.stringify({ output_dir: OUT_DIR, models: list }, null, 2) }] };
});

server.registerTool("set_connection", {
  title: "Set a notebook's Gradio link",
  description: "Saves the public Gradio link (gradio.live, trycloudflare, hf.space…) of a model's notebook and checks it exposes the right endpoints. Links expire with the Kaggle/Colab session, so call this again with the new link when a model becomes unreachable.",
  inputSchema: { model: z.enum(modelIds), url: z.string().describe("Public Gradio URL") },
}, async ({ model, url }) => {
  const m = MODEL_BY_ID[model];
  const base = normalizeUrl(url);
  try {
    const c = await timeout(connect(base, true), 25000, "No answer within 25 s.");
    const names = Object.keys((await c.view_api()).named_endpoints ?? {});
    const missing = m.endpoints.filter((e) => !names.includes(e));
    if (missing.length) throw new Error(`This link does not look like the ${m.short} notebook: missing ${missing.join(", ")} (found ${names.slice(0, 6).join(", ") || "none"}).`);
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CONFIG_FILE, JSON.stringify({ ...(await loadConfig()), [model]: base }, null, 2));
    return { content: [{ type: "text", text: `Connected ${m.name} at ${base} (${names.length} endpoints).` }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: explain(e) }] };
  }
});

server.registerTool("generate", {
  title: "Generate image, video or audio",
  description: "Runs a model on its notebook and saves the result files locally. params uses the keys from list_models (details=true); anything omitted takes the notebook default. Input media (references, start frame, voice to clone…) are local paths or URLs, e.g. a file a previous generate returned. Images finish in seconds; MiniMax video takes minutes: if the job is not done within wait_seconds, you get a job_id to pass to get_job.",
  inputSchema: {
    model: z.enum(modelIds),
    params: z.record(z.unknown()).describe("Model parameters, e.g. {prompt:'…', size:'1344 × 768 (16:9)', seed:-1}"),
    wait_seconds: z.number().min(0).max(600).optional().describe("How long to wait before returning a job_id (default 45; keep it under your client tool timeout)"),
  },
}, async ({ model, params, wait_seconds }) => {
  const job = startJob(model, params as Values);
  await wait(job, wait_seconds ?? 45);
  return report(job);
});

server.registerTool("get_job", {
  title: "Check a generation job",
  description: "Returns the status of a job started by generate, waiting up to wait_seconds for it to finish. Done jobs list the saved file paths.",
  inputSchema: { job_id: z.string(), wait_seconds: z.number().min(0).max(600).optional().describe("Default 45") },
}, async ({ job_id, wait_seconds }) => {
  const job = jobs.get(job_id);
  if (!job) return { isError: true, content: [{ type: "text", text: `Unknown job ${job_id} (jobs live only as long as this MCP server process).` }] };
  await wait(job, wait_seconds ?? 45);
  return report(job);
});

server.registerTool("cancel_job", {
  title: "Cancel a generation job",
  description: "Stops a running job (for MiniMax it calls the notebook's stop button).",
  inputSchema: { job_id: z.string() },
}, async ({ job_id }) => {
  const job = jobs.get(job_id);
  if (!job) return { isError: true, content: [{ type: "text", text: `Unknown job ${job_id}.` }] };
  if (job.status === "running") { job.cancel?.(); job.status = "cancelled"; job.message = "Cancelled"; }
  return report(job);
});

async function report(job: Job) {
  const secs = Math.round((Date.now() - job.startedAt) / 1000);
  const body = { job_id: job.id, model: job.model, status: job.status, elapsed_s: secs, progress: job.progress, message: job.message, files: job.files };
  const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [{ type: "text", text: JSON.stringify(body, null, 2) }];
  if (job.status === "error") return { isError: true, content };
  // Small previews so the agent can see what it made.
  for (const f of job.files.slice(0, 4)) {
    const e = extname(f).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".webp"].includes(e)) {
      const buf = await readFile(f);
      if (buf.length < 4_500_000) content.push({ type: "image", data: buf.toString("base64"), mimeType: MIME[e] });
    }
  }
  return { content };
}

await server.connect(new StdioServerTransport());
console.error(`Atelier MCP ${VERSION} ready · outputs in ${OUT_DIR}`);
