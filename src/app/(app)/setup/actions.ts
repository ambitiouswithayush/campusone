"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { assessmentComponents, batches, calendarEvents, departments, faculty, programmes, subjects, teachingAssignments } from "@/db/schema";
import { act, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";

type State = { ok: boolean; error?: string; message?: string } | null;
const done = (path = "/setup") => revalidatePath(path);

const SubjectInput = z.object({
  programmeId: z.coerce.number().int().positive(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}\d{3}$/, "Code looks like CS301."),
  name: z.string().trim().min(3, "Name is too short.").max(80),
  semester: z.coerce.number().int().min(1).max(10),
  credits: z.coerce.number().int().min(1).max(6),
});

export async function addSubjectAction(_: State, form: FormData): Promise<State> {
  return act(async () => {
    const user = await requireUser("office_admin");
    const input = SubjectInput.parse(Object.fromEntries(form));
    const db = await getDb();
    const [p] = await db.select().from(programmes).where(and(eq(programmes.id, input.programmeId), eq(programmes.campusId, user.campusId)));
    if (!p) throw new UserError("Programme not found.");
    const [dup] = await db.select().from(subjects).where(and(eq(subjects.programmeId, p.id), eq(subjects.code, input.code)));
    if (dup) throw new UserError(`${input.code} already exists in ${p.name}.`);
    const [s] = await db.insert(subjects).values(input).returning();
    // University internal scheme (fixed setting): Quiz 5 + Mid-sem 20 + Assignment 10 + Quiz 5 = 40.
    await db.insert(assessmentComponents).values([
      { subjectId: s.id, code: "Q1", name: "Quiz 1", maxMarks: 5, sortOrder: 1 },
      { subjectId: s.id, code: "MID", name: "Mid-semester", maxMarks: 20, sortOrder: 2 },
      { subjectId: s.id, code: "ASG", name: "Assignment", maxMarks: 10, sortOrder: 3 },
      { subjectId: s.id, code: "Q2", name: "Quiz 2", maxMarks: 5, sortOrder: 4 },
    ]);
    await audit(db, { campusId: user.campusId, actorUserId: user.uid, entity: "subject", entityId: s.id, action: "created", after: input });
    done();
  }, "Subject added with the standard 40-mark internal scheme.");
}

const FacultyInput = z.object({
  departmentId: z.coerce.number().int().positive(),
  empCode: z.string().trim().toUpperCase().regex(/^F-[A-Z]{2,4}-\d{3}$/, "Employee code looks like F-CSE-030."),
  name: z.string().trim().min(3).max(80),
  email: z.email("Enter a valid email.").max(120),
  designation: z.enum(["Professor", "Associate Professor", "Assistant Professor", "Lecturer"]),
});

export async function addFacultyAction(_: State, form: FormData): Promise<State> {
  return act(async () => {
    const user = await requireUser("office_admin");
    const input = FacultyInput.parse(Object.fromEntries(form));
    const db = await getDb();
    const [d] = await db.select().from(departments).where(and(eq(departments.id, input.departmentId), eq(departments.campusId, user.campusId)));
    if (!d) throw new UserError("Department not found.");
    const [dup] = await db.select().from(faculty).where(eq(faculty.empCode, input.empCode));
    if (dup) throw new UserError("That employee code is already used.");
    const [f] = await db.insert(faculty).values({ ...input, campusId: user.campusId }).returning();
    await audit(db, { campusId: user.campusId, actorUserId: user.uid, entity: "faculty", entityId: f.id, action: "created", after: input });
    done();
  }, "Faculty member added.");
}

export async function reassignAction(_: State, form: FormData): Promise<State> {
  return act(async () => {
    const user = await requireUser("office_admin");
    const { assignmentId, facultyId } = z.object({ assignmentId: z.coerce.number().int().positive(), facultyId: z.coerce.number().int().positive() }).parse(Object.fromEntries(form));
    const db = await getDb();
    const [a] = await db
      .select({ a: teachingAssignments, campusId: programmes.campusId })
      .from(teachingAssignments)
      .innerJoin(batches, eq(batches.id, teachingAssignments.batchId))
      .innerJoin(programmes, eq(programmes.id, batches.programmeId))
      .where(eq(teachingAssignments.id, assignmentId));
    const [f] = await db.select().from(faculty).where(and(eq(faculty.id, facultyId), eq(faculty.campusId, user.campusId)));
    if (!a || a.campusId !== user.campusId || !f) throw new UserError("Not found.");
    if (a.a.facultyId === facultyId) return;
    await db.update(teachingAssignments).set({ facultyId }).where(eq(teachingAssignments.id, assignmentId));
    await audit(db, { campusId: user.campusId, actorUserId: user.uid, entity: "teaching_assignment", entityId: assignmentId, action: "reassigned", before: { facultyId: a.a.facultyId }, after: { facultyId } });
    done();
  }, "Teacher changed. Their phone gets the class on next sync.");
}

const EventInput = z.object({
  date: z.iso.date("Pick a date."),
  kind: z.enum(["holiday", "exam", "event"]),
  title: z.string().trim().min(3, "Give it a title.").max(80),
});

export async function addEventAction(_: State, form: FormData): Promise<State> {
  return act(async () => {
    const user = await requireUser("office_admin");
    const input = EventInput.parse(Object.fromEntries(form));
    const db = await getDb();
    const [e] = await db.insert(calendarEvents).values({ ...input, campusId: user.campusId }).returning();
    await audit(db, { campusId: user.campusId, actorUserId: user.uid, entity: "calendar", entityId: e.id, action: "created", after: input });
    done();
  }, "Added to the calendar.");
}

export async function deleteEventAction(_: State, form: FormData): Promise<State> {
  return act(async () => {
    const user = await requireUser("office_admin");
    const id = z.coerce.number().int().positive().parse(form.get("id"));
    const db = await getDb();
    const [e] = await db.delete(calendarEvents).where(and(eq(calendarEvents.id, id), eq(calendarEvents.campusId, user.campusId))).returning();
    if (!e) throw new UserError("Event not found.");
    await audit(db, { campusId: user.campusId, actorUserId: user.uid, entity: "calendar", entityId: id, action: "deleted", before: e });
    done();
  }, "Removed.");
}
