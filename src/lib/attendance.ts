import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { attendanceRecords, attendanceSessions } from "@/db/schema";
import { RULES } from "./config";

export function attendancePct(present: number, held: number): number | null {
  if (held <= 0) return null;
  return Math.round((present / held) * 1000) / 10;
}

export function isShort(p: number | null): boolean {
  return p !== null && p < RULES.attendanceThreshold;
}

/**
 * How many more consecutive classes a student must attend to reach the threshold.
 * Shown to mentors so a shortage turns into a concrete target.
 */
export function classesNeeded(present: number, held: number, threshold: number = RULES.attendanceThreshold): number {
  const t = threshold / 100;
  if (held === 0 || present / held >= t) return 0;
  return Math.ceil((t * held - present) / (1 - t));
}

export interface AttendanceStat {
  studentId: number;
  held: number;
  present: number;
  pct: number | null;
}

/** Per-student totals across all subjects for the given students, optionally in a date range. */
export async function attendanceByStudent(
  db: DB,
  studentIds: number[],
  range?: { from?: string; to?: string; assignmentId?: number },
): Promise<Map<number, AttendanceStat>> {
  const out = new Map<number, AttendanceStat>();
  if (!studentIds.length) return out;
  const conds = [inArray(attendanceRecords.studentId, studentIds)];
  if (range?.from) conds.push(gte(attendanceSessions.date, range.from));
  if (range?.to) conds.push(lte(attendanceSessions.date, range.to));
  if (range?.assignmentId) conds.push(eq(attendanceSessions.assignmentId, range.assignmentId));
  const rows = await db
    .select({
      studentId: attendanceRecords.studentId,
      held: sql<number>`count(*)::int`,
      present: sql<number>`sum(case when ${attendanceRecords.present} then 1 else 0 end)::int`,
    })
    .from(attendanceRecords)
    .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
    .where(and(...conds))
    .groupBy(attendanceRecords.studentId);
  for (const r of rows) {
    out.set(r.studentId, { studentId: r.studentId, held: r.held, present: r.present, pct: attendancePct(r.present, r.held) });
  }
  return out;
}

/** Weekly attendance % per student for trend analysis (oldest week first). */
export async function weeklyAttendance(db: DB, studentIds: number[], from: string) {
  if (!studentIds.length) return new Map<number, { week: string; pct: number; held: number }[]>();
  const rows = await db
    .select({
      studentId: attendanceRecords.studentId,
      week: sql<string>`to_char(date_trunc('week', ${attendanceSessions.date}::timestamp), 'YYYY-MM-DD')`,
      held: sql<number>`count(*)::int`,
      present: sql<number>`sum(case when ${attendanceRecords.present} then 1 else 0 end)::int`,
    })
    .from(attendanceRecords)
    .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
    .where(and(inArray(attendanceRecords.studentId, studentIds), gte(attendanceSessions.date, from)))
    .groupBy(attendanceRecords.studentId, sql`2`)
    .orderBy(sql`2`);
  const out = new Map<number, { week: string; pct: number; held: number }[]>();
  for (const r of rows) {
    const list = out.get(r.studentId) ?? [];
    list.push({ week: r.week, held: r.held, pct: (r.present / r.held) * 100 });
    out.set(r.studentId, list);
  }
  return out;
}
