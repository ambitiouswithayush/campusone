import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { attendanceRecords, attendanceSessions, auditLog, calendarEvents } from "@/db/schema";
import { PERIODS } from "@/lib/config";
import { addDays, isoDateIST, istInstant } from "@/lib/dates";
import type { SessionUser } from "@/lib/session";
import { syncSessions, type SessionPayload } from "@/lib/sync";
import { freeSlot, pastWorkingDay, sessionFor, testDb } from "./helpers";

let db: DB;
let priya: SessionUser;
let rakesh: SessionUser;
let admin: SessionUser;

beforeAll(async () => {
  db = await testDb();
  priya = await sessionFor(db, "priya.das@campusone.test");
  rakesh = await sessionFor(db, "rakesh.sahu@campusone.test");
  admin = await sessionFor(db, "admin@campusone.test");
});

async function payload(date: string, absentCount = 2, over: Partial<SessionPayload> = {}) {
  const slot = await freeSlot(db, priya, date);
  const markedAt = new Date(istInstant(date, PERIODS[slot.period].end).getTime() + 10 * 60_000);
  const p: SessionPayload = {
    id: randomUUID(),
    assignmentId: slot.assignmentId,
    date,
    period: slot.period,
    markedAt: markedAt.toISOString(),
    records: slot.roster.map((id, i) => ({ studentId: id, present: i >= absentCount })),
    offline: true,
    override: false,
    ...over,
  };
  return { p, slot, now: new Date(markedAt.getTime() + 3600_000) };
}

describe("offline attendance sync", () => {
  it("creates a session, and a resend of the same UUID is a harmless duplicate", async () => {
    const { p, now } = await payload(await pastWorkingDay(db, 3));
    const first = await syncSessions(db, priya, [p], now);
    expect(first.results[0].status).toBe("created");
    const retry = await syncSessions(db, priya, [p], now);
    expect(retry.results[0].status).toBe("duplicate");
    const rows = await db.select().from(attendanceRecords).where(eq(attendanceRecords.sessionId, p.id));
    expect(rows).toHaveLength(p.records.length);
    expect(rows.filter((r) => !r.present)).toHaveLength(2);
  });

  it("treats changed marks under the same UUID as a logged correction", async () => {
    const { p, now } = await payload(await pastWorkingDay(db, 3));
    await syncSessions(db, priya, [p], now);
    const corrected = { ...p, records: p.records.map((r, i) => ({ ...r, present: i !== 5 })) };
    const r = await syncSessions(db, priya, [corrected], now);
    expect(r.results[0].status).toBe("updated");
    const [s] = await db.select().from(attendanceSessions).where(eq(attendanceSessions.id, p.id));
    expect(s.absentCount).toBe(1);
    const log = await db.select().from(auditLog).where(and(eq(auditLog.entity, "attendance_session"), eq(auditLog.entityId, p.id)));
    expect(log.map((l) => l.action)).toContain("corrected");
  });

  it("returns a conflict when an older copy from another device arrives late", async () => {
    const { p, now } = await payload(await pastWorkingDay(db, 3));
    await syncSessions(db, priya, [p], now);
    const older = { ...p, id: randomUUID(), markedAt: new Date(new Date(p.markedAt).getTime() - 5 * 60_000).toISOString(), records: p.records.map((r) => ({ ...r, present: true })) };
    const r = await syncSessions(db, priya, [older], now);
    expect(r.results[0].status).toBe("conflict");
    expect(r.results[0].server?.id).toBe(p.id);
    expect(r.results[0].server?.absentStudentIds).toHaveLength(2);
  });

  it("lets a newer copy, or an explicit override, replace the stored one and keeps the old in the audit log", async () => {
    const { p, now } = await payload(await pastWorkingDay(db, 3));
    await syncSessions(db, priya, [p], now);
    const newer = { ...p, id: randomUUID(), markedAt: new Date(new Date(p.markedAt).getTime() + 60_000).toISOString() };
    expect((await syncSessions(db, priya, [newer], now)).results[0].status).toBe("replaced");
    const forced = { ...p, id: randomUUID(), override: true };
    expect((await syncSessions(db, priya, [forced], now)).results[0].status).toBe("replaced");
    const sessions = await db.select().from(attendanceSessions).where(and(eq(attendanceSessions.date, p.date), eq(attendanceSessions.period, p.period), eq(attendanceSessions.assignmentId, p.assignmentId)));
    expect(sessions.map((s) => s.id)).toEqual([forced.id]);
  });

  it("refuses classes the teacher does not teach", async () => {
    const { p, now } = await payload(await pastWorkingDay(db, 3));
    const r = await syncSessions(db, rakesh, [p], now);
    expect(r.results[0].status).toBe("rejected");
    expect(r.results[0].message).toMatch(/another teacher/);
  });

  it("refuses future dates, holidays and slots not on the timetable", async () => {
    const { p, now } = await payload(await pastWorkingDay(db, 3));
    expect((await syncSessions(db, priya, [{ ...p, date: addDays(isoDateIST(now), 7) }], now)).results[0].status).toBe("rejected");
    expect((await syncSessions(db, priya, [{ ...p, period: 7 }], now)).results[0].message).toMatch(/timetable|started/);
    await db.insert(calendarEvents).values({ campusId: priya.campusId, date: p.date, kind: "holiday", title: "Test holiday" });
    const r = await syncSessions(db, priya, [p], now);
    expect(r.results[0].message).toMatch(/holiday/);
    await db.delete(calendarEvents).where(eq(calendarEvents.title, "Test holiday"));
  });

  it("judges the 48-hour window on when the class was marked, not when the phone synced", async () => {
    const { p } = await payload(await pastWorkingDay(db, 3));
    const lateSync = new Date(new Date(p.markedAt).getTime() + 5 * 86400_000);
    expect((await syncSessions(db, priya, [p], lateSync)).results[0].status).toBe("created");

    const { p: stale } = await payload(await pastWorkingDay(db, 6));
    const markedLate = new Date(new Date(stale.markedAt).getTime() + 3 * 86400_000);
    const r = await syncSessions(db, priya, [{ ...stale, markedAt: markedLate.toISOString() }], new Date(markedLate.getTime() + 1000));
    expect(r.results[0].status).toBe("rejected");
    expect(r.results[0].message).toMatch(/window/);
    // The office can still correct it.
    const r2 = await syncSessions(db, admin, [{ ...stale, markedAt: markedLate.toISOString() }], new Date(markedLate.getTime() + 1000));
    expect(r2.results[0].status).toBe("created");
  });

  it("clamps a phone clock that runs ahead and ignores students from other batches", async () => {
    const { p, now } = await payload(await pastWorkingDay(db, 3));
    const ahead = { ...p, markedAt: new Date(now.getTime() + 3 * 3600_000).toISOString(), records: [...p.records, { studentId: 99999, present: true }] };
    const r = await syncSessions(db, priya, [ahead], now);
    expect(r.results[0].status).toBe("created");
    expect(r.results[0].warnings?.join(" ")).toMatch(/clock/);
    expect(r.results[0].warnings?.join(" ")).toMatch(/ignored/);
    const [s] = await db.select().from(attendanceSessions).where(eq(attendanceSessions.id, p.id));
    expect(s.markedAt.getTime()).toBe(now.getTime());
  });
});
