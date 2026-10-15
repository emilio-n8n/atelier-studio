import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MODELS, defaults, type MediaKind, type Values } from "../lib/models";
import { putBlob, deleteBlob, rememberUrl } from "../lib/db";
import { probe } from "../lib/media";
import { uid } from "../lib/util";

export interface Asset {
  id: string;
  kind: MediaKind;
  name: string;
  mime: string;
  createdAt: number;
  duration?: number;
  width?: number;
  height?: number;
  thumb?: string;
  peaks?: number[];
  source: "upload" | "generated" | "export";
  modelId?: string;
  params?: Values;
  info?: string;
}

export type ConnState = "idle" | "testing" | "ok" | "error";
export interface Connection {
  url: string;
  state: ConnState;
  message?: string;
  checkedAt?: number;
}

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";
export interface Job {
  id: string;
  modelId: string;
  label: string;
  prompt: string;
  status: JobStatus;
  progress?: number;
  message?: string;
  queuePos?: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  assetIds: string[];
}

export interface Track {
  id: string;
  kind: "video" | "audio";
  name: string;
  muted: boolean;
  hidden: boolean;
  volume: number;
}

export interface Clip {
  id: string;
  trackId: string;
  assetId: string;
  start: number; // seconds on the timeline
  offset: number; // seconds into the source
  duration: number; // seconds on the timeline
  volume: number;
  fit: "contain" | "cover";
}

export type Aspect = "16:9" | "9:16" | "1:1";
export type Panel = "generate" | "connections";

interface State {
  // connections
  connections: Record<string, Connection>;
  setConnection: (id: string, c: Partial<Connection>) => void;
  // generator
  activeModel: string;
  params: Record<string, Values>;
  setActiveModel: (id: string) => void;
  setParam: (modelId: string, key: string, value: unknown) => void;
  setParams: (modelId: string, v: Values) => void;
  resetParams: (modelId: string) => void;
  // panels
  panel: Panel;
  setPanel: (p: Panel) => void;
  // media
  assets: Asset[];
  selectedAsset: string | null;
  addAsset: (blob: Blob, a: Omit<Asset, "id" | "createdAt"> & { id?: string }) => Promise<Asset>;
  removeAsset: (id: string) => void;
  renameAsset: (id: string, name: string) => void;
  selectAsset: (id: string | null) => void;
  // jobs (not persisted beyond reload: a running Gradio call does not survive a reload)
  jobs: Job[];
  upsertJob: (j: Partial<Job> & { id: string }) => void;
  clearFinishedJobs: () => void;
  // timeline
  aspect: Aspect;
  setAspect: (a: Aspect) => void;
  tracks: Track[];
  clips: Clip[];
  selectedClip: string | null;
  playhead: number;
  zoom: number; // px per second
  setPlayhead: (t: number) => void;
  setZoom: (z: number) => void;
  selectClip: (id: string | null) => void;
  addClip: (c: Omit<Clip, "id">) => string;
  updateClip: (id: string, c: Partial<Clip>) => void;
  removeClip: (id: string) => void;
  splitAt: (id: string, t: number) => void;
  updateTrack: (id: string, t: Partial<Track>) => void;
  addTrack: (kind: "video" | "audio") => void;
  appendToTimeline: (assetId: string) => void;
}

const defaultTracks: Track[] = [
  { id: "v2", kind: "video", name: "V2", muted: false, hidden: false, volume: 1 },
  { id: "v1", kind: "video", name: "V1", muted: false, hidden: false, volume: 1 },
  { id: "a1", kind: "audio", name: "A1", muted: false, hidden: false, volume: 1 },
  { id: "a2", kind: "audio", name: "A2", muted: false, hidden: false, volume: 1 },
];

export const IMAGE_DEFAULT_DUR = 4;

export const timelineEnd = (clips: Clip[]) => clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      connections: Object.fromEntries(MODELS.map((m) => [m.id, { url: "", state: "idle" as ConnState }])),
      setConnection: (id, c) => set((s) => ({ connections: { ...s.connections, [id]: { ...s.connections[id], ...c } } })),

      activeModel: "flux3",
      params: Object.fromEntries(MODELS.map((m) => [m.id, defaults(m)])),
      setActiveModel: (id) => set({ activeModel: id, panel: "generate" }),
      setParam: (modelId, key, value) => set((s) => ({ params: { ...s.params, [modelId]: { ...s.params[modelId], [key]: value } } })),
      setParams: (modelId, v) => set((s) => ({ params: { ...s.params, [modelId]: { ...s.params[modelId], ...v } } })),
      resetParams: (modelId) => set((s) => ({ params: { ...s.params, [modelId]: defaults(MODELS.find((m) => m.id === modelId)!) } })),

      panel: "generate",
      setPanel: (panel) => set({ panel }),

      assets: [],
      selectedAsset: null,
      addAsset: async (blob, a) => {
        const id = a.id ?? uid();
        await putBlob(id, blob);
        rememberUrl(id, blob);
        const p = await probe(blob, a.kind).catch(() => ({}));
        const asset: Asset = { ...a, ...p, id, createdAt: Date.now() };
        set((s) => ({ assets: [asset, ...s.assets] }));
        return asset;
      },
      removeAsset: (id) => {
        void deleteBlob(id);
        set((s) => ({
          assets: s.assets.filter((a) => a.id !== id),
          clips: s.clips.filter((c) => c.assetId !== id),
          selectedAsset: s.selectedAsset === id ? null : s.selectedAsset,
        }));
      },
      renameAsset: (id, name) => set((s) => ({ assets: s.assets.map((a) => (a.id === id ? { ...a, name } : a)) })),
      selectAsset: (id) => set({ selectedAsset: id }),

      jobs: [],
      upsertJob: (j) =>
        set((s) => {
          const i = s.jobs.findIndex((x) => x.id === j.id);
          if (i < 0) return { jobs: [j as Job, ...s.jobs] };
          const jobs = [...s.jobs];
          jobs[i] = { ...jobs[i], ...j };
          return { jobs };
        }),
      clearFinishedJobs: () => set((s) => ({ jobs: s.jobs.filter((j) => j.status === "running" || j.status === "queued") })),

      aspect: "16:9",
      setAspect: (aspect) => set({ aspect }),
      tracks: defaultTracks,
      clips: [],
      selectedClip: null,
      playhead: 0,
      zoom: 60,
      setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
      setZoom: (z) => set({ zoom: Math.min(400, Math.max(8, z)) }),
      selectClip: (id) => set({ selectedClip: id }),
      addClip: (c) => {
        const id = uid();
        set((s) => ({ clips: [...s.clips, { ...c, id }], selectedClip: id }));
        return id;
      },
      updateClip: (id, c) => set((s) => ({ clips: s.clips.map((x) => (x.id === id ? { ...x, ...c } : x)) })),
      removeClip: (id) => set((s) => ({ clips: s.clips.filter((c) => c.id !== id), selectedClip: s.selectedClip === id ? null : s.selectedClip })),
      splitAt: (id, t) => {
        const c = get().clips.find((x) => x.id === id);
        if (!c || t <= c.start + 0.05 || t >= c.start + c.duration - 0.05) return;
        const left = t - c.start;
        const right: Clip = { ...c, id: uid(), start: t, offset: c.offset + left, duration: c.duration - left };
        set((s) => ({ clips: [...s.clips.map((x) => (x.id === id ? { ...x, duration: left } : x)), right], selectedClip: right.id }));
      },
      updateTrack: (id, t) => set((s) => ({ tracks: s.tracks.map((x) => (x.id === id ? { ...x, ...t } : x)) })),
      addTrack: (kind) =>
        set((s) => {
          const count = s.tracks.filter((t) => t.kind === kind).length + 1;
          const t: Track = { id: uid(), kind, name: `${kind === "video" ? "V" : "A"}${count}`, muted: false, hidden: false, volume: 1 };
          return { tracks: kind === "video" ? [t, ...s.tracks] : [...s.tracks, t] };
        }),
      appendToTimeline: (assetId) => {
        const s = get();
        const a = s.assets.find((x) => x.id === assetId);
        if (!a) return;
        const kind = a.kind === "audio" ? "audio" : "video";
        // V1 is the lowest video lane (video lanes are listed top-down), A1 the first audio lane.
        const track = kind === "video" ? s.tracks.filter((t) => t.kind === "video").at(-1) : s.tracks.find((t) => t.kind === "audio");
        if (!track) return;
        const end = timelineEnd(s.clips.filter((c) => c.trackId === track.id));
        s.addClip({ trackId: track.id, assetId, start: end, offset: 0, duration: a.kind === "image" ? IMAGE_DEFAULT_DUR : a.duration || IMAGE_DEFAULT_DUR, volume: 1, fit: "contain" });
      },
    }),
    {
      name: "atelier-studio",
      version: 1,
      partialize: (s) => ({
        connections: Object.fromEntries(Object.entries(s.connections).map(([k, c]) => [k, { url: c.url, state: "idle" as ConnState }])),
        activeModel: s.activeModel,
        // Inpaint masks are Blobs: they do not survive JSON, so they are dropped on save.
        params: Object.fromEntries(Object.entries(s.params).map(([k, v]) => [k, { ...v, mask: null }])),
        assets: s.assets,
        aspect: s.aspect,
        tracks: s.tracks,
        clips: s.clips,
        zoom: s.zoom,
        jobs: s.jobs.filter((j) => j.status === "done").slice(0, 30),
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<State>;
        const params = { ...current.params };
        for (const m of MODELS) params[m.id] = { ...defaults(m), ...(p.params?.[m.id] ?? {}) };
        const connections = { ...current.connections, ...(p.connections ?? {}) };
        return { ...current, ...p, params, connections };
      },
    },
  ),
);
