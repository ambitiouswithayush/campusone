import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import { assessmentComponents, batches, marks, programmes, riskFlags, students } from "@/db/schema";
import { visibleStudentFilter } from "./access";
import { attendanceByStudent } from "./attendance";
import { duesByStudent } from "./fees";
import { internalTotal } from "./marks";
import type { SessionUser } from "./session";

/**
 * Average internal total (out of 40) across subjects with any marks. This is how the sample data's
 * single "Internal Marks of 40" figure is interpreted (assumption, see TDD).
 */
export async function marksByStudent(db: DB, ids: number[]): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  if (!ids.length) return out;
  const rows = await db
    .select({ studentId: marks.studentId, subjectId: assessmentComponents.subjectId, score: marks.score, absent: marks.absent, maxMarks: assessmentComponents.maxMarks })
    .from(marks)
    .innerJoin(assessmentComponents, eq(assessmentComponents.id, marks.componentId))
    .where(inArray(marks.studentId, ids));
  const grouped = new Map<number, Map<number, { score: number | null; absent: boolean; maxMarks: number }[]>>();
  for (const r of rows) {
    const subj = grouped.get(r.studentId) ?? new Map();
    const list = subj.get(r.subjectId) ?? [];
    list.push(r);
    subj.set(r.subjectId, list);
    grouped.set(r.studentId, subj);
  }
  for (const [id, subj] of grouped) {
    const totals = [...subj.values()].map((l) => internalTotal(l)).filter((t): t is number => t !== null);
    out.set(id, totals.length ? Math.round((totals.reduce((s, t) => s + t, 0) / totals.length) * 10) / 10 : null);
  }
  return out;
}

export interface StudentRow {
  id: number;
  rollNo: string;
  name: string;
  programmeCode: string;
  programmeName: string;
  yearOfStudy: number;
  section: string;
  category: string;
  attendancePct: number | null;
  sessionsHeld: number;
  internal40: number | null;
  feeDue: number;
  risk: "high" | "medium" | null;
}

export async function studentRows(
  db: DB,
  user: SessionUser,
  opts: { where?: SQL[]; attendanceRange?: { from?: string; to?: string } } = {},
): Promise<StudentRow[]> {
  const scope = await visibleStudentFilter(db, user);
  const base = await db
    .select({
      id: students.id,
      rollNo: students.rollNo,
      name: students.name,
      category: students.category,
      programmeCode: programmes.code,
      programmeName: programmes.name,
      yearOfStudy: batches.yearOfStudy,
      section: batches.section,
    })
    .from(students)
    .innerJoin(batches, eq(batches.id, students.batchId))
    .innerJoin(programmes, eq(programmes.id, students.programmeId))
    .where(and(scope, eq(students.status, "active"), ...(opts.where ?? [])))
    .orderBy(asc(students.rollNo));
  const ids = base.map((b) => b.id);
  const [att, mk, dues, flags] = await Promise.all([
    attendanceByStudent(db, ids, opts.attendanceRange),
    marksByStudent(db, ids),
    duesByStudent(db, ids),
    ids.length
      ? db.select({ studentId: riskFlags.studentId, level: riskFlags.level })
          .from(riskFlags)
          .where(and(inArray(riskFlags.studentId, ids), inArray(riskFlags.status, ["open", "in_progress"])))
      : Promise.resolve([]),
  ]);
  const risk = new Map(flags.map((f) => [f.studentId, f.level]));
  return base.map((b) => ({
    ...b,
    attendancePct: att.get(b.id)?.pct ?? null,
    sessionsHeld: att.get(b.id)?.held ?? 0,
    internal40: mk.get(b.id) ?? null,
    feeDue: dues.get(b.id) ?? 0,
    risk: risk.get(b.id) ?? null,
  }));
}
