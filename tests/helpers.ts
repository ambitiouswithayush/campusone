import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import path from "node:path";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { seed } from "@/db/seed";
import { addDays, dayOfWeek, isoDateIST } from "@/lib/dates";
import type { SessionUser } from "@/lib/session";

/** Fresh in-memory Postgres with a small copy of the demo data. */
export async function testDb(): Promise<DB> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(__dirname, "..", "drizzle") });
  await seed(db, { studentsPerSection: 12, weeks: 6, quiet: true });
  return db;
}

export async function sessionFor(db: DB, email: string): Promise<SessionUser> {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  return { uid: u.id, name: u.name, role: u.role, campusId: u.campusId, facultyId: u.facultyId };
}

/** A working day a few days back (not Sunday, not a holiday). */
export function pastWorkingDay(back = 3): string {
  let d = addDays(isoDateIST(), -back);
  while (dayOfWeek(d) === 7) d = addDays(d, -1);
  return d;
}

/** One of the faculty member's timetable slots on `date`, with no attendance recorded yet. */
export async function freeSlot(db: DB, user: SessionUser, date: string) {
  const slots = await db
    .select({ assignmentId: schema.teachingAssignments.id, batchId: schema.teachingAssignments.batchId, period: schema.timetableSlots.period })
    .from(schema.timetableSlots)
    .innerJoin(schema.teachingAssignments, eq(schema.teachingAssignments.id, schema.timetableSlots.assignmentId))
    .where(and(eq(schema.teachingAssignments.facultyId, user.facultyId!), eq(schema.timetableSlots.dayOfWeek, dayOfWeek(date))));
  if (!slots.length) throw new Error(`no slot for ${date}`);
  const s = slots[0];
  await db
    .delete(schema.attendanceSessions)
    .where(and(eq(schema.attendanceSessions.batchId, s.batchId), eq(schema.attendanceSessions.date, date), eq(schema.attendanceSessions.period, s.period)));
  const roster = await db.select({ id: schema.students.id }).from(schema.students).where(eq(schema.students.batchId, s.batchId));
  return { ...s, roster: roster.map((r) => r.id) };
}
