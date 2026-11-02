import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { attendanceRecords, attendanceSessions, calendarEvents, students, timetableSlots, users } from "@/db/schema";
import { getAssignmentFor, AccessError } from "./access";
import { audit } from "./audit";
import { PERIODS, RULES } from "./config";
import { dayOfWeek, isoDateIST, istInstant } from "./dates";
import type { SessionUser } from "./session";

/**
 * Offline attendance sync.
 *
 * The phone records each class as a session with a UUID it generates itself, so a request that
 * times out on weak Wi-Fi can be resent without creating duplicates. Rules, in order:
 *   1. Same UUID already stored with the same marks         → "duplicate" (safe retry, no-op)
 *   2. Same UUID, different marks                           → "updated"   (teacher corrected it)
 *   3. Another UUID already holds this batch/date/period:
 *        incoming marked later, or teacher chose override   → "replaced"  (old copy kept in audit log)
 *        incoming marked earlier                            → "conflict"  (server copy returned to phone)
 *   4. Otherwise                                            → "created"
 * Edit windows are judged on when the teacher marked the class (markedAt), not when the phone
 * got signal, so a class taken offline on Monday and synced on Tuesday still counts.
 */

export const SessionPayload = z.object({
  id: z.uuid(),
  assignmentId: z.number().int().positive(),
  date: z.iso.date(),
  period: z.number().int().min(1).max(Object.keys(PERIODS).length),
  markedAt: z.iso.datetime({ offset: true }),
  records: z
    .array(z.object({ studentId: z.number().int().positive(), present: z.boolean() }))
    .min(1)
    .max(200),
  offline: z.boolean().default(false),
  override: z.boolean().default(false),
});
export const SyncRequest = z.object({ sessions: z.array(SessionPayload).min(1).max(50) });
export type SessionPayload = z.infer<typeof SessionPayload>;

export type SyncStatus = "created" | "duplicate" | "updated" | "replaced" | "conflict" | "rejected";
export interface SyncResult {
  id: string;
  status: SyncStatus;
  message?: string;
  warnings?: string[];
  server?: { id: string; markedAt: string; takenBy: string; absentStudentIds: number[] };
}

const CLOCK_SKEW_MS = 5 * 60 * 1000;

export async function syncSessions(
  db: DB,
  user: SessionUser,
  sessions: SessionPayload[],
  now: Date = new Date(),
): Promise<{ results: SyncResult[]; touchedStudentIds: number[] }> {
  const results: SyncResult[] = [];
  const touched = new Set<number>();
  for (const s of sessions) {
    try {
      const r = await syncOne(db, user, s, now);
      results.push(r);
      if (["created", "updated", "replaced"].includes(r.status)) s.records.forEach((x) => touched.add(x.studentId));
    } catch (e) {
      const message = e instanceof AccessError || e instanceof RejectError ? e.message : "Server error, will retry.";
      if (!(e instanceof AccessError || e instanceof RejectError)) console.error("sync failed", e);
      results.push({ id: s.id, status: "rejected", message });
    }
  }
  return { results, touchedStudentIds: [...touched] };
}

class RejectError extends Error {}

async function syncOne(db: DB, user: SessionUser, s: SessionPayload, now: Date): Promise<SyncResult> {
  const assignment = await getAssignmentFor(db, user, s.assignmentId);
  const warnings: string[] = [];

  // The class must be on the timetable for that weekday and period.
  const [slot] = await db
    .select({ id: timetableSlots.id })
    .from(timetableSlots)
    .where(
      and(
        eq(timetableSlots.assignmentId, assignment.id),
        eq(timetableSlots.dayOfWeek, dayOfWeek(s.date)),
        eq(timetableSlots.period, s.period),
      ),
    );
  if (!slot) throw new RejectError("This class is not on the timetable for that day and period.");

  const [holiday] = await db
    .select({ title: calendarEvents.title })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.campusId, user.campusId), eq(calendarEvents.date, s.date), eq(calendarEvents.kind, "holiday")));
  if (holiday) throw new RejectError(`${s.date} is a holiday (${holiday.title}).`);

  if (s.date > isoDateIST(now)) throw new RejectError("Attendance cannot be marked for a future date.");
  const classStart = istInstant(s.date, PERIODS[s.period].start);

  // Device clocks drift; never trust a timestamp from the future or from before the class.
  let markedAt = new Date(s.markedAt);
  if (markedAt.getTime() > now.getTime() + CLOCK_SKEW_MS) {
    markedAt = now;
    warnings.push("Phone clock is ahead; server time used.");
  }
  if (markedAt.getTime() < classStart.getTime() - 15 * 60 * 1000) {
    throw new RejectError("Marked before the class started — check the phone's date and time.");
  }
  if (user.role === "faculty") {
    const deadline = istInstant(s.date, PERIODS[s.period].end).getTime() + RULES.facultyEditWindowHours * 3600_000;
    if (markedAt.getTime() > deadline) {
      throw new RejectError(`The ${RULES.facultyEditWindowHours}-hour edit window has closed. Ask the office to correct it.`);
    }
  }

  // Only students currently in the batch are recorded.
  const roster = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.batchId, assignment.batchId), eq(students.status, "active")));
  const rosterIds = new Set(roster.map((r) => r.id));
  const seen = new Set<number>();
  const records = s.records.filter((r) => {
    if (!rosterIds.has(r.studentId) || seen.has(r.studentId)) return false;
    seen.add(r.studentId);
    return true;
  });
  if (records.length < s.records.length) warnings.push(`${s.records.length - records.length} entries ignored (not in this batch).`);
  const missing = roster.length - records.length;
  if (missing > 0) warnings.push(`${missing} student(s) joined after your list was downloaded and were not marked.`);
  if (!records.length) throw new RejectError("No students in this list belong to the batch.");

  const presentCount = records.filter((r) => r.present).length;
  const absentIds = records.filter((r) => !r.present).map((r) => r.studentId).sort((a, b) => a - b);
  const source = s.offline ? "offline" : "online";

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(attendanceSessions)
      .where(
        and(eq(attendanceSessions.batchId, assignment.batchId), eq(attendanceSessions.date, s.date), eq(attendanceSessions.period, s.period)),
      )
      .for("update");

    const write = async (sessionId: string) => {
      await tx.delete(attendanceRecords).where(eq(attendanceRecords.sessionId, sessionId));
      await tx.insert(attendanceRecords).values(records.map((r) => ({ sessionId, studentId: r.studentId, present: r.present })));
    };

    if (existing) {
      const existingAbsent = (
        await tx
          .select({ id: attendanceRecords.studentId })
          .from(attendanceRecords)
          .where(and(eq(attendanceRecords.sessionId, existing.id), eq(attendanceRecords.present, false)))
      )
        .map((r) => r.id)
        .sort((a, b) => a - b);
      const same = existing.presentCount + existing.absentCount === records.length && sameIds(existingAbsent, absentIds);

      if (existing.id === s.id) {
        if (same) return { id: s.id, status: "duplicate", warnings } satisfies SyncResult;
        await tx
          .update(attendanceSessions)
          .set({ markedAt, syncedAt: new Date(), presentCount, absentCount: absentIds.length, takenByUserId: user.uid })
          .where(eq(attendanceSessions.id, s.id));
        await write(s.id);
        await audit(tx, {
          campusId: user.campusId,
          actorUserId: user.uid,
          entity: "attendance_session",
          entityId: s.id,
          action: "corrected",
          before: { absent: existingAbsent },
          after: { absent: absentIds },
        });
        return { id: s.id, status: "updated", warnings } satisfies SyncResult;
      }

      if (s.override || markedAt.getTime() > existing.markedAt.getTime()) {
        await tx.delete(attendanceSessions).where(eq(attendanceSessions.id, existing.id));
        await tx.insert(attendanceSessions).values({
          id: s.id,
          assignmentId: assignment.id,
          batchId: assignment.batchId,
          date: s.date,
          period: s.period,
          takenByUserId: user.uid,
          markedAt,
          source,
          presentCount,
          absentCount: absentIds.length,
        });
        await write(s.id);
        await audit(tx, {
          campusId: user.campusId,
          actorUserId: user.uid,
          entity: "attendance_session",
          entityId: s.id,
          action: s.override ? "overridden" : "replaced_older_copy",
          before: { id: existing.id, markedAt: existing.markedAt, absent: existingAbsent, takenBy: existing.takenByUserId },
          after: { absent: absentIds },
        });
        return { id: s.id, status: "replaced", warnings, message: "Replaced an earlier copy of this class." } satisfies SyncResult;
      }

      const [taker] = await tx.select({ name: users.name }).from(users).where(eq(users.id, existing.takenByUserId));
      return {
        id: s.id,
        status: "conflict",
        message: `Already marked by ${taker?.name ?? "someone"} at a later time.`,
        server: { id: existing.id, markedAt: existing.markedAt.toISOString(), takenBy: taker?.name ?? "", absentStudentIds: existingAbsent },
      } satisfies SyncResult;
    }

    await tx.insert(attendanceSessions).values({
      id: s.id,
      assignmentId: assignment.id,
      batchId: assignment.batchId,
      date: s.date,
      period: s.period,
      takenByUserId: user.uid,
      markedAt,
      source,
      presentCount,
      absentCount: absentIds.length,
    });
    await write(s.id);
    return { id: s.id, status: "created", warnings } satisfies SyncResult;
  });
}

function sameIds(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
