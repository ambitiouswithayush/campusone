import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { assessmentComponents, markSheets, marks, students, subjects } from "@/db/schema";
import { getAssignmentFor } from "./access";
import { audit } from "./audit";
import { RULES } from "./config";
import type { SessionUser } from "./session";

/**
 * Internal marks workflow:  draft ──submit──▶ submitted ──lock──▶ locked
 *                              ▲                │  (office moderates)  │
 *                              └────return──────┘◀──unlock + reason────┘
 * Faculty edit only in draft. Office admin may adjust during moderation. Nobody edits a locked
 * sheet; unlocking needs a written reason. Every changed value is written to the audit log.
 */

export type SheetStatus = "draft" | "submitted" | "locked";

export class MarksError extends Error {}

export const MarkEntry = z.object({
  studentId: z.number().int().positive(),
  componentId: z.number().int().positive(),
  score: z.number().min(0).max(100).multipleOf(0.5).nullable(),
  absent: z.boolean(),
});
export type MarkEntry = z.infer<typeof MarkEntry>;

export function canEdit(status: SheetStatus, role: SessionUser["role"]): boolean {
  if (status === "locked") return false;
  if (role === "faculty") return status === "draft";
  return true;
}

/** Validate one value against its component; returns an error message or null. */
export function validateEntry(e: MarkEntry, maxMarks: number): string | null {
  if (e.absent && e.score !== null) return "Absent students cannot have a score.";
  if (e.score !== null && e.score > maxMarks) return `Score cannot exceed ${maxMarks}.`;
  return null;
}

/** Sum of components, scaled to the university internal maximum if the scheme differs. */
export function internalTotal(
  entries: { score: number | null; absent: boolean; maxMarks: number }[],
  internalMax: number = RULES.internalMax,
): number | null {
  if (!entries.length || entries.every((e) => e.score === null && !e.absent)) return null;
  const max = entries.reduce((s, e) => s + e.maxMarks, 0);
  const got = entries.reduce((s, e) => s + (e.absent ? 0 : (e.score ?? 0)), 0);
  if (max === 0) return null;
  return Math.round(((got * internalMax) / max) * 2) / 2;
}

async function sheetStatus(db: DB, assignmentId: number): Promise<SheetStatus> {
  const [s] = await db.select().from(markSheets).where(eq(markSheets.assignmentId, assignmentId));
  return (s?.status ?? "draft") as SheetStatus;
}

export async function loadSheet(db: DB, user: SessionUser, assignmentId: number) {
  const a = await getAssignmentFor(db, user, assignmentId);
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, a.subjectId));
  const components = await db
    .select()
    .from(assessmentComponents)
    .where(eq(assessmentComponents.subjectId, a.subjectId))
    .orderBy(asc(assessmentComponents.sortOrder));
  const roster = await db
    .select({ id: students.id, rollNo: students.rollNo, name: students.name })
    .from(students)
    .where(and(eq(students.batchId, a.batchId), eq(students.status, "active")))
    .orderBy(asc(students.rollNo));
  const values = components.length && roster.length
    ? await db
        .select()
        .from(marks)
        .where(and(inArray(marks.componentId, components.map((c) => c.id)), inArray(marks.studentId, roster.map((r) => r.id))))
    : [];
  const [sheet] = await db.select().from(markSheets).where(eq(markSheets.assignmentId, assignmentId));
  return { assignment: a, subject, components, roster, values, sheet: sheet ?? null, status: (sheet?.status ?? "draft") as SheetStatus };
}

export async function saveMarks(db: DB, user: SessionUser, assignmentId: number, entries: MarkEntry[]) {
  const a = await getAssignmentFor(db, user, assignmentId);
  const status = await sheetStatus(db, assignmentId);
  if (!canEdit(status, user.role)) {
    throw new MarksError(status === "locked" ? "Marks are locked after moderation." : "Sheet is with the exam cell for moderation.");
  }
  const comps = await db.select().from(assessmentComponents).where(eq(assessmentComponents.subjectId, a.subjectId));
  const compMax = new Map(comps.map((c) => [c.id, c.maxMarks]));
  const roster = new Set(
    (await db.select({ id: students.id }).from(students).where(eq(students.batchId, a.batchId))).map((r) => r.id),
  );
  for (const e of entries) {
    const max = compMax.get(e.componentId);
    if (max === undefined) throw new MarksError("Unknown assessment component.");
    if (!roster.has(e.studentId)) throw new MarksError("Student is not in this batch.");
    const err = validateEntry(e, max);
    if (err) throw new MarksError(err);
  }

  return db.transaction(async (tx) => {
    const current = entries.length
      ? await tx
          .select()
          .from(marks)
          .where(and(inArray(marks.componentId, [...compMax.keys()]), inArray(marks.studentId, [...roster])))
      : [];
    const key = (s: number, c: number) => `${s}:${c}`;
    const byKey = new Map(current.map((m) => [key(m.studentId, m.componentId), m]));
    const changes: { studentId: number; componentId: number; from: string; to: string }[] = [];
    for (const e of entries) {
      const prev = byKey.get(key(e.studentId, e.componentId));
      const fmt = (score: number | null, absent: boolean) => (absent ? "AB" : score === null ? "" : String(score));
      const from = prev ? fmt(prev.score, prev.absent) : "";
      const to = fmt(e.score, e.absent);
      if (from === to) continue;
      changes.push({ studentId: e.studentId, componentId: e.componentId, from, to });
      await tx
        .insert(marks)
        .values({ studentId: e.studentId, componentId: e.componentId, score: e.score, absent: e.absent, updatedByUserId: user.uid })
        .onConflictDoUpdate({
          target: [marks.studentId, marks.componentId],
          set: { score: e.score, absent: e.absent, updatedByUserId: user.uid, updatedAt: new Date() },
        });
    }
    if (changes.length) {
      await audit(tx, {
        campusId: user.campusId,
        actorUserId: user.uid,
        entity: "mark_sheet",
        entityId: assignmentId,
        action: status === "submitted" ? "moderated" : "edited",
        after: { changes },
      });
    }
    return { changed: changes.length };
  });
}

async function setStatus(db: DB, user: SessionUser, assignmentId: number, from: SheetStatus[], to: SheetStatus, reason?: string) {
  const status = await sheetStatus(db, assignmentId);
  if (!from.includes(status)) throw new MarksError(`Cannot move a ${status} sheet to ${to}.`);
  const now = new Date();
  await db
    .insert(markSheets)
    .values({ assignmentId, status: to, submittedAt: to === "submitted" ? now : null })
    .onConflictDoUpdate({
      target: markSheets.assignmentId,
      set: {
        status: to,
        ...(to === "submitted" && status === "draft" ? { submittedAt: now } : {}),
        ...(to === "locked" ? { lockedAt: now, lockedByUserId: user.uid } : {}),
      },
    });
  await audit(db, {
    campusId: user.campusId,
    actorUserId: user.uid,
    entity: "mark_sheet",
    entityId: assignmentId,
    action: `${status}→${to}`,
    reason: reason ?? null,
  });
}

export async function submitSheet(db: DB, user: SessionUser, assignmentId: number) {
  const sheet = await loadSheet(db, user, assignmentId);
  const filled = new Set(sheet.values.filter((v) => v.absent || v.score !== null).map((v) => `${v.studentId}:${v.componentId}`));
  const missing = sheet.roster.length * sheet.components.length - filled.size;
  if (missing > 0) throw new MarksError(`${missing} mark(s) still empty. Enter a score or mark AB before submitting.`);
  await setStatus(db, user, assignmentId, ["draft"], "submitted");
}

export async function returnSheet(db: DB, user: SessionUser, assignmentId: number, reason: string) {
  await getAssignmentFor(db, user, assignmentId);
  await setStatus(db, user, assignmentId, ["submitted"], "draft", reason);
}

export async function lockSheet(db: DB, user: SessionUser, assignmentId: number) {
  await getAssignmentFor(db, user, assignmentId);
  await setStatus(db, user, assignmentId, ["submitted"], "locked");
}

export async function unlockSheet(db: DB, user: SessionUser, assignmentId: number, reason: string) {
  await getAssignmentFor(db, user, assignmentId);
  if (reason.trim().length < 10) throw new MarksError("Give a reason of at least 10 characters; it goes into the exam audit log.");
  await setStatus(db, user, assignmentId, ["locked"], "submitted", reason.trim());
}

/**
 * University upload file. Assumed format (labelled in TDD): one row per student per subject,
 * columns RegdNo, SubjectCode, InternalMarks, MaxMarks, Status (P / AB).
 */
export async function universityCsv(db: DB, user: SessionUser, assignmentId: number): Promise<{ filename: string; csv: string }> {
  const sheet = await loadSheet(db, user, assignmentId);
  if (sheet.status !== "locked") throw new MarksError("Only locked (moderated) sheets can be exported.");
  const byStudent = new Map<number, { score: number | null; absent: boolean; maxMarks: number }[]>();
  const maxById = new Map(sheet.components.map((c) => [c.id, c.maxMarks]));
  for (const v of sheet.values) {
    const list = byStudent.get(v.studentId) ?? [];
    list.push({ score: v.score, absent: v.absent, maxMarks: maxById.get(v.componentId)! });
    byStudent.set(v.studentId, list);
  }
  const lines = ["RegdNo,SubjectCode,InternalMarks,MaxMarks,Status"];
  for (const s of sheet.roster) {
    const list = byStudent.get(s.id) ?? [];
    const allAbsent = list.length > 0 && list.every((e) => e.absent);
    const total = internalTotal(list) ?? 0;
    lines.push([s.rollNo, sheet.subject.code, allAbsent ? 0 : total, RULES.internalMax, allAbsent ? "AB" : "P"].join(","));
  }
  return { filename: `${sheet.subject.code}_internal_${sheet.assignment.batchId}.csv`, csv: lines.join("\r\n") + "\r\n" };
}
