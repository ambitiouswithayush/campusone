import type { DB, Tx } from "@/db";
import { auditLog } from "@/db/schema";

export async function audit(
  db: DB | Tx,
  entry: {
    campusId: number;
    actorUserId: number | null;
    entity: string;
    entityId: string | number;
    action: string;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
  },
) {
  await db.insert(auditLog).values({
    campusId: entry.campusId,
    actorUserId: entry.actorUserId,
    entity: entry.entity,
    entityId: String(entry.entityId),
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
  });
}
