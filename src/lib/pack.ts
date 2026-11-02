import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { DB } from "@/db";
import {
  attendanceRecords,
  attendanceSessions,
  batches,
  calendarEvents,
  programmes,
  students,
  subjects,
  teachingAssignments,
  timetableSlots,
  users,
} from "@/db/schema";
import { attendanceByStudent } from "./attendance";
import { PERIODS, RULES } from "./config";
import { addDays, dayOfWeek, isoDateIST, istInstant } from "./dates";
import type { ClassPack, PackClass, PackDay } from "./offline/types";
import type { SessionUser } from "./session";

export function batchLabel(b: { section: string; yearOfStudy: number }, programmeName: string) {
  return `${programmeName} ${b.yearOfStudy}-${b.section}`;
}

/**
 * Everything a teacher needs to take attendance with no signal: today's classes plus the two
 * previous days still inside the edit window, each with its roster and any existing marks.
 */
export async function buildPack(db: DB, user: SessionUser, now = new Date()): Promise<ClassPack> {
  if (!user.facultyId) throw new Error("Only faculty have a class pack.");
  const today = isoDateIST(now);
  const dates = [today, addDays(today, -1), addDays(today, -2)];

  const slots = await db
    .select({
      assignmentId: teachingAssignments.id,
      batchId: teachingAssignments.batchId,
      dayOfWeek: timetableSlots.dayOfWeek,
      period: timetableSlots.period,
      subjectCode: subjects.code,
      subjectName: subjects.name,
      section: batches.section,
      yearOfStudy: batches.yearOfStudy,
      programmeName: programmes.name,
    })
    .from(timetableSlots)
    .innerJoin(teachingAssignments, eq(teachingAssignments.id, timetableSlots.assignmentId))
    .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
    .innerJoin(batches, eq(batches.id, teachingAssignments.batchId))
    .innerJoin(programmes, eq(programmes.id, batches.programmeId))
    .where(eq(teachingAssignments.facultyId, user.facultyId))
    .orderBy(asc(timetableSlots.period));

  const holidays = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.campusId, user.campusId), eq(calendarEvents.kind, "holiday"), gte(calendarEvents.date, dates[2]), lte(calendarEvents.date, addDays(today, 14))));

  const assignmentIds = [...new Set(slots.map((s) => s.assignmentId))];
  const sessions = assignmentIds.length
    ? await db
        .select({ s: attendanceSessions, takenBy: users.name })
        .from(attendanceSessions)
        .innerJoin(users, eq(users.id, attendanceSessions.takenByUserId))
        .where(and(inArray(attendanceSessions.assignmentId, assignmentIds), gte(attendanceSessions.date, dates[2])))
    : [];
  const absences = sessions.length
    ? await db
        .select({ sessionId: attendanceRecords.sessionId, studentId: attendanceRecords.studentId })
        .from(attendanceRecords)
        .where(and(inArray(attendanceRecords.sessionId, sessions.map((x) => x.s.id)), eq(attendanceRecords.present, false)))
    : [];

  const days: PackDay[] = dates.map((date) => {
    const holiday = holidays.find((h) => h.date === date)?.title ?? null;
    const dow = dayOfWeek(date);
    const classes: PackClass[] = holiday
      ? []
      : slots
          .filter((s) => s.dayOfWeek === dow)
          .map((s) => {
            const sess = sessions.find((x) => x.s.assignmentId === s.assignmentId && x.s.date === date && x.s.period === s.period);
            const end = istInstant(date, PERIODS[s.period].end);
            return {
              key: `${s.assignmentId}:${date}:${s.period}`,
              assignmentId: s.assignmentId,
              batchId: s.batchId,
              date,
              period: s.period,
              start: PERIODS[s.period].start,
              end: PERIODS[s.period].end,
              subjectCode: s.subjectCode,
              subjectName: s.subjectName,
              batchLabel: batchLabel(s, s.programmeName),
              editableUntil: new Date(end.getTime() + RULES.facultyEditWindowHours * 3600_000).toISOString(),
              session: sess
                ? {
                    id: sess.s.id,
                    markedAt: sess.s.markedAt.toISOString(),
                    takenBy: sess.takenBy,
                    absentIds: absences.filter((a) => a.sessionId === sess.s.id).map((a) => a.studentId),
                    total: sess.s.presentCount + sess.s.absentCount,
                  }
                : null,
            };
          });
    return { date, holiday, classes };
  });

  const batchIds = [...new Set(slots.map((s) => s.batchId))];
  const roster = batchIds.length
    ? await db
        .select({ id: students.id, rollNo: students.rollNo, name: students.name, batchId: students.batchId })
        .from(students)
        .where(and(inArray(students.batchId, batchIds), eq(students.status, "active")))
        .orderBy(asc(students.rollNo))
    : [];
  const stats = await attendanceByStudent(db, roster.map((r) => r.id));
  const rosters: ClassPack["rosters"] = {};
  for (const r of roster) (rosters[r.batchId] ??= []).push({ id: r.id, rollNo: r.rollNo, name: r.name, pct: stats.get(r.id)?.pct ?? null });

  const timetable = slots.map((s) => ({
    assignmentId: s.assignmentId,
    batchId: s.batchId,
    dayOfWeek: s.dayOfWeek,
    period: s.period,
    start: PERIODS[s.period].start,
    end: PERIODS[s.period].end,
    subjectCode: s.subjectCode,
    subjectName: s.subjectName,
    batchLabel: batchLabel(s, s.programmeName),
  }));
  return {
    downloadedAt: now.toISOString(),
    serverTime: now.toISOString(),
    facultyName: user.name,
    days,
    rosters,
    timetable,
    holidays: holidays.map((h) => ({ date: h.date, title: h.title })),
    editWindowHours: RULES.facultyEditWindowHours,
  };
}
