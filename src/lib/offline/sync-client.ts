import { outboxAll, outboxDel, outboxPut } from "./store";
import type { OutboxItem } from "./types";

export interface FlushResult {
  synced: number;
  conflicts: number;
  rejected: number;
  failed: boolean;
  warnings: string[];
}

let inFlight: Promise<FlushResult> | null = null;

/**
 * Send everything pending in one request. Safe to call often (on reconnect, on a timer, on
 * focus): concurrent calls share one request, and the server de-duplicates by session UUID.
 */
export function flushOutbox(): Promise<FlushResult> {
  if (!inFlight) inFlight = doFlush().finally(() => (inFlight = null));
  return inFlight;
}

async function doFlush(): Promise<FlushResult> {
  const result: FlushResult = { synced: 0, conflicts: 0, rejected: 0, failed: false, warnings: [] };
  const pending = (await outboxAll()).filter((o) => o.status === "pending" || o.status === "syncing");
  if (!pending.length) return result;
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ...result, failed: true };

  for (const p of pending) await outboxPut({ ...p, status: "syncing", attempts: p.attempts + 1 });
  let res: Response;
  try {
    res = await fetch("/api/attendance/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessions: pending.map((p) => ({
          id: p.id,
          assignmentId: p.assignmentId,
          date: p.date,
          period: p.period,
          markedAt: p.markedAt,
          records: p.records,
          offline: p.offline,
          override: p.override,
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    for (const p of pending) await outboxPut({ ...p, status: "pending", attempts: p.attempts + 1 });
    return { ...result, failed: true };
  }

  if (res.status === 401) {
    for (const p of pending) await outboxPut({ ...p, status: "pending", message: "Signed out — sign in again to sync." });
    return { ...result, failed: true, warnings: ["Your session expired. Sign in again — your attendance is kept on this phone."] };
  }
  if (!res.ok) {
    for (const p of pending) await outboxPut({ ...p, status: "pending", attempts: p.attempts + 1 });
    return { ...result, failed: true };
  }

  const body: { results: { id: string; status: string; message?: string; warnings?: string[]; server?: OutboxItem["server"] }[] } = await res.json();
  const byId = new Map(pending.map((p) => [p.id, p]));
  for (const r of body.results) {
    const item = byId.get(r.id);
    if (!item) continue;
    result.warnings.push(...(r.warnings ?? []));
    if (["created", "duplicate", "updated", "replaced"].includes(r.status)) {
      await outboxDel(r.id);
      result.synced++;
    } else if (r.status === "conflict") {
      await outboxPut({ ...item, status: "conflict", message: r.message, server: r.server });
      result.conflicts++;
    } else {
      // A server error is retried; a rule violation (e.g. window closed) needs the teacher.
      const retry = r.message?.includes("will retry");
      await outboxPut({ ...item, status: retry ? "pending" : "rejected", message: r.message });
      if (!retry) result.rejected++;
    }
  }
  return result;
}
