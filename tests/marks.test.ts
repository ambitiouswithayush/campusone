import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { auditLog, markSheets, subjects, teachingAssignments } from "@/db/schema";
import { canEdit, internalTotal, validateEntry } from "@/lib/marks-calc";
import { loadSheet, lockSheet, MarksError, saveMarks, submitSheet, universityCsv, unlockSheet } from "@/lib/marks";
import type { SessionUser } from "@/lib/session";
import { sessionFor, testDb } from "./helpers";

describe("marks rules (pure)", () => {
  it("sums components and scales to 40", () => {
    expect(internalTotal([{ score: 4, absent: false, maxMarks: 5 }, { score: 17, absent: false, maxMarks: 20 }, { score: 8, absent: false, maxMarks: 10 }, { score: 4, absent: false, maxMarks: 5 }])).toBe(33);
    // Only Quiz 1 + Mid entered (25 marks) → scaled to 40, rounded to half marks
    expect(internalTotal([{ score: 4, absent: false, maxMarks: 5 }, { score: 15, absent: false, maxMarks: 20 }])).toBe(30.5);
    expect(internalTotal([{ score: null, absent: true, maxMarks: 20 }])).toBe(0);
    expect(internalTotal([{ score: null, absent: false, maxMarks: 20 }])).toBeNull();
  });

  it("rejects scores over the maximum and absent-with-score", () => {
    expect(validateEntry({ studentId: 1, componentId: 1, score: 21, absent: false }, 20)).toMatch(/exceed/);
    expect(validateEntry({ studentId: 1, componentId: 1, score: 3, absent: true }, 20)).toMatch(/Absent/);
    expect(validateEntry({ studentId: 1, componentId: 1, score: 19.5, absent: false }, 20)).toBeNull();
  });

  it("allows faculty to edit drafts and the office to edit only during moderation", () => {
    expect(canEdit("draft", "faculty")).toBe(true);
    expect(canEdit("submitted", "faculty")).toBe(false);
    expect(canEdit("draft", "office_admin")).toBe(false);
    expect(canEdit("submitted", "office_admin")).toBe(true);
    expect(canEdit("locked", "office_admin")).toBe(false);
  });
});

describe("marks workflow (database)", () => {
  let db: DB;
  let priya: SessionUser;
  let rakesh: SessionUser;
  let admin: SessionUser;
  let draftId: number;

  beforeAll(async () => {
    db = await testDb();
    priya = await sessionFor(db, "priya.das@campusone.test");
    rakesh = await sessionFor(db, "rakesh.sahu@campusone.test");
    admin = await sessionFor(db, "admin@campusone.test");
    const [a] = await db
      .select({ id: teachingAssignments.id })
      .from(teachingAssignments)
      .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
      .innerJoin(markSheets, eq(markSheets.assignmentId, teachingAssignments.id))
      .where(and(eq(teachingAssignments.facultyId, priya.facultyId!), eq(markSheets.status, "draft")));
    draftId = a.id;
  });

  it("blocks other teachers and invalid values", async () => {
    await expect(saveMarks(db, rakesh, draftId, [])).rejects.toThrow(/another teacher/);
    const sheet = await loadSheet(db, priya, draftId);
    const mid = sheet.components.find((c) => c.code === "MID")!;
    await expect(saveMarks(db, priya, draftId, [{ studentId: sheet.roster[0].id, componentId: mid.id, score: 25, absent: false }])).rejects.toThrow(MarksError);
  });

  it("will not submit with empty cells, then submits once complete", async () => {
    await expect(submitSheet(db, priya, draftId)).rejects.toThrow(/still empty/);
    const sheet = await loadSheet(db, priya, draftId);
    const filled = new Set(sheet.values.map((v) => `${v.studentId}:${v.componentId}`));
    const entries = sheet.roster.flatMap((s) =>
      sheet.components.filter((c) => !filled.has(`${s.id}:${c.id}`)).map((c) => ({ studentId: s.id, componentId: c.id, score: 3, absent: false })),
    );
    const { changed } = await saveMarks(db, priya, draftId, entries);
    expect(changed).toBe(entries.length);
    await submitSheet(db, priya, draftId);
    expect((await loadSheet(db, priya, draftId)).status).toBe("submitted");
  });

  it("freezes the teacher out after submission, lets the office moderate and lock", async () => {
    const sheet = await loadSheet(db, admin, draftId);
    const entry = { studentId: sheet.roster[0].id, componentId: sheet.components[0].id, score: 5, absent: false };
    await expect(saveMarks(db, priya, draftId, [entry])).rejects.toThrow(/moderation/);
    await saveMarks(db, admin, draftId, [entry]);
    await expect(universityCsv(db, admin, draftId)).rejects.toThrow(/locked/);
    await lockSheet(db, admin, draftId);
    await expect(saveMarks(db, admin, draftId, [{ ...entry, score: 4 }])).rejects.toThrow(/locked/);
  });

  it("needs a written reason to unlock, and logs every step", async () => {
    await expect(unlockSheet(db, admin, draftId, "typo")).rejects.toThrow(/reason/);
    await unlockSheet(db, admin, draftId, "Re-evaluation ordered by the exam committee");
    const log = await db.select().from(auditLog).where(and(eq(auditLog.entity, "mark_sheet"), eq(auditLog.entityId, String(draftId))));
    const actions = log.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["edited", "draft→submitted", "moderated", "submitted→locked", "locked→submitted"]));
    expect(log.find((l) => l.action === "locked→submitted")?.reason).toMatch(/exam committee/);
  });

  it("exports the university file in the agreed column format", async () => {
    await lockSheet(db, admin, draftId);
    const { csv } = await universityCsv(db, admin, draftId);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("RegdNo,SubjectCode,InternalMarks,MaxMarks,Status");
    expect(lines[1]).toMatch(/^ENG-\d{2}-[A-Z]+-\d{4},CS\d{3},\d+(\.5)?,40,(P|AB)$/);
  });
});
