import { idb } from "./idb";
import type { ClassPack, OutboxItem } from "./types";

const PACK_KEY = "pack";

export const getPack = () => idb.get<ClassPack>("kv", PACK_KEY);
export const savePack = (p: ClassPack) => idb.set("kv", PACK_KEY, p);

export const outboxAll = () => idb.all<OutboxItem>("outbox");
export const outboxPut = (item: OutboxItem) => idb.set("outbox", item.id, item);
export const outboxDel = (id: string) => idb.del("outbox", id);

/** In-progress marking, saved on every tap so a crash or a call mid-class loses nothing. */
export const getDraft = (classKey: string) => idb.get<number[]>("drafts", classKey);
export const saveDraft = (classKey: string, absentIds: number[]) => idb.set("drafts", classKey, absentIds);
export const clearDraft = (classKey: string) => idb.del("drafts", classKey);

/** Called on sign-out: staff-room phones are shared. */
export async function clearOfflineData() {
  try {
    if (typeof indexedDB !== "undefined") {
      const pending = (await outboxAll()).filter((o) => o.status === "pending" || o.status === "syncing");
      if (pending.length && !confirm(`${pending.length} class(es) have not synced yet. Sign out and discard them?`)) {
        throw new Error("cancelled");
      }
      await Promise.all([idb.clear("kv"), idb.clear("outbox"), idb.clear("drafts")]);
    }
    if (typeof caches !== "undefined") {
      for (const k of await caches.keys()) await caches.delete(k);
    }
  } catch (e) {
    if (e instanceof Error && e.message === "cancelled") throw e;
  }
}
