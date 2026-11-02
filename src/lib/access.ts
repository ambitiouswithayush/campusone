import { and, eq, or, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { batches, programmes, students, teachingAssignments } from "@/db/schema";
import type { SessionUser } from "./session";

export class AccessError extends Error {}

/** Load a teaching assignment with its campus, enforcing campus and ownership rules. */
export async function getAssignmentFor(db: DB, user: SessionUser, assignmentId: number) {
  const [row] = await db
    .select({
      id: teachingAssignments.id,
      batchId: teachingAssignments.batchId,
      subjectId: teachingAssignments.subjectId,
      facultyId: teachingAssignments.facultyId,
      campusId: programmes.campusId,
    })
    .from(teachingAssignments)
    .innerJoin(batches, eq(batches.id, teachingAssignments.batchId))
    .innerJoin(programmes, eq(programmes.id, batches.programmeId))
    .where(eq(teachingAssignments.id, assignmentId));
  if (!row || row.campusId !== user.campusId) throw new AccessError("Class not found.");
  if (user.role === "faculty" && row.facultyId !== user.facultyId) {
    throw new AccessError("This class is assigned to another teacher.");
  }
  return row;
}

/** Batch ids a user may read: whole campus for office admin, taught batches for faculty. */
export async function readableBatchIds(db: DB, user: SessionUser): Promise<number[]> {
  if (user.role === "office_admin") {
    const rows = await db
      .select({ id: batches.id })
      .from(batches)
      .innerJoin(programmes, eq(programmes.id, batches.programmeId))
      .where(eq(programmes.campusId, user.campusId));
    return rows.map((r) => r.id);
  }
  const rows = await db
    .selectDistinct({ id: teachingAssignments.batchId })
    .from(teachingAssignments)
    .where(eq(teachingAssignments.facultyId, user.facultyId ?? -1));
  return rows.map((r) => r.id);
}

/** Students visible to the user: campus for admin; taught batches or mentees for faculty. */
export async function assertStudentAccess(db: DB, user: SessionUser, studentId: number) {
  const [s] = await db.select().from(students).where(eq(students.id, studentId));
  if (!s || s.campusId !== user.campusId) throw new AccessError("Student not found.");
  if (user.role === "faculty") {
    const batchIds = await readableBatchIds(db, user);
    if (!batchIds.includes(s.batchId) && s.mentorFacultyId !== user.facultyId) {
      throw new AccessError("Student not found.");
    }
  }
  return s;
}

export async function visibleStudentFilter(db: DB, user: SessionUser) {
  if (user.role === "office_admin") return eq(students.campusId, user.campusId);
  const batchIds = await readableBatchIds(db, user);
  return and(
    eq(students.campusId, user.campusId),
    or(
      batchIds.length ? inArray(students.batchId, batchIds) : undefined,
      eq(students.mentorFacultyId, user.facultyId ?? -1),
    ),
  )!;
}
