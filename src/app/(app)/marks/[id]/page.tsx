import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { auditLog, batches, faculty, programmes, users } from "@/db/schema";
import { PageHeader } from "@/components/ui";
import { AccessError } from "@/lib/access";
import { requirePageUser } from "@/lib/auth";
import { loadSheet } from "@/lib/marks";
import { batchLabel } from "@/lib/pack";
import { MarksGrid } from "./marks-grid";

export const metadata: Metadata = { title: "Mark sheet" };

export default async function SheetPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = await getDb();
  let sheet;
  try {
    sheet = await loadSheet(db, user, id);
  } catch (e) {
    if (e instanceof AccessError) notFound();
    throw e;
  }
  const [b] = await db
    .select({ section: batches.section, yearOfStudy: batches.yearOfStudy, programmeName: programmes.name })
    .from(batches)
    .innerJoin(programmes, eq(programmes.id, batches.programmeId))
    .where(eq(batches.id, sheet.assignment.batchId));
  const [teacher] = await db.select({ name: faculty.name }).from(faculty).where(eq(faculty.id, sheet.assignment.facultyId));
  const history = await db
    .select({ id: auditLog.id, action: auditLog.action, reason: auditLog.reason, after: auditLog.after, createdAt: auditLog.createdAt, actor: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(and(eq(auditLog.entity, "mark_sheet"), eq(auditLog.entityId, String(id))))
    .orderBy(desc(auditLog.createdAt))
    .limit(50);

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={{ href: "/marks", label: "Internal marks" }}
        title={`${sheet.subject.name}`}
        subtitle={`${sheet.subject.code} · ${batchLabel(b, b.programmeName)} · ${teacher?.name ?? ""}`}
      />
      <MarksGrid
        assignmentId={id}
        role={user.role}
        status={sheet.status}
        components={sheet.components.map((c) => ({ id: c.id, code: c.code, name: c.name, maxMarks: c.maxMarks }))}
        roster={sheet.roster}
        values={sheet.values.map((v) => ({ studentId: v.studentId, componentId: v.componentId, score: v.score, absent: v.absent }))}
        lockedAt={sheet.sheet?.lockedAt?.toISOString() ?? null}
        history={history.map((h) => ({
          id: h.id,
          action: h.action,
          reason: h.reason,
          actor: h.actor ?? "System",
          at: h.createdAt.toISOString(),
          changes: ((h.after as { changes?: unknown[] } | null)?.changes ?? []).length,
        }))}
      />
    </div>
  );
}
