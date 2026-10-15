import { createStore, get, set, del } from "idb-keyval";

// Generated media outlives the Kaggle/Colab session: every result is copied into IndexedDB.
const blobs = createStore("atelier-media", "blobs");
const urls = new Map<string, string>();

export async function putBlob(id: string, blob: Blob) {
  await set(id, blob, blobs);
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  return get<Blob>(id, blobs);
}

export async function deleteBlob(id: string) {
  const u = urls.get(id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(id);
  await del(id, blobs);
}

export async function objectUrl(id: string): Promise<string | null> {
  const cached = urls.get(id);
  if (cached) return cached;
  const b = await getBlob(id);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urls.set(id, u);
  return u;
}

export function cachedUrl(id: string) {
  return urls.get(id) ?? null;
}

export function rememberUrl(id: string, blob: Blob) {
  if (!urls.has(id)) urls.set(id, URL.createObjectURL(blob));
  return urls.get(id)!;
}
