import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { BookOpenCheck, ChevronRight, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { assessmentComponents, batches, faculty, markSheets, marks, programmes, students, subjects, teachingAssignments } from "@/db/schema";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/auth";
import { batchLabel } from "@/lib/pack";
import clsx from "clsx";

export const metadata: Metadata = { title: "Internal marks" };

const STATUS = {
  draft: { label: "Draft", tone: "neutral" as const },
  submitted: { label: "Awaiting moderation", tone: "warn" as const },
  locked: { label: "Locked", tone: "ok" as const },
};

export default async function MarksPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requirePageUser();
  const { status: filter } = await searchParams;
  const db = await getDb();
  const rows = await db
    .select({
      id: teachingAssignments.id,
      batchId: teachingAssignments.batchId,
      subjectId: subjects.id,
      subjectCode: subjects.code,
      subjectName: subjects.name,
      section: batches.section,
      yearOfStudy: batches.yearOfStudy,
      programmeName: programmes.name,
      facultyName: faculty.name,
      status: sql<"draft" | "submitted" | "locked">`coalesce(${markSheets.status}, 'draft')`,
    })
    .from(teachingAssignments)
    .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
    .innerJoin(batches, eq(batches.id, teachingAssignments.batchId))
    .innerJoin(programmes, eq(programmes.id, batches.programmeId))
    .innerJoin(faculty, eq(faculty.id, teachingAssignments.facultyId))
    .leftJoin(markSheets, eq(markSheets.assignmentId, teachingAssignments.id))
    .where(and(eq(programmes.campusId, user.campusId), user.role === "faculty" ? eq(teachingAssignments.facultyId, user.facultyId ?? -1) : undefined))
    .orderBy(asc(programmes.name), asc(batches.yearOfStudy), asc(batches.section), asc(subjects.code));

  // Progress = filled cells / (students × components)
  const progress = new Map<number, { filled: number; total: number }>();
  if (rows.length) {
    const counts = await db
      .select({
        assignmentId: teachingAssignments.id,
        filled: sql<number>`count(${marks.studentId})::int`,
      })
      .from(teachingAssignments)
      .innerJoin(assessmentComponents, eq(assessmentComponents.subjectId, teachingAssignments.subjectId))
      .innerJoin(students, eq(students.batchId, teachingAssignments.batchId))
      .leftJoin(marks, and(eq(marks.componentId, assessmentComponents.id), eq(marks.studentId, students.id)))
      .where(inArray(teachingAssignments.id, rows.map((r) => r.id)))
      .groupBy(teachingAssignments.id);
    const totals = await db
      .select({
        assignmentId: teachingAssignments.id,
        total: sql<number>`(count(distinct ${students.id}) * count(distinct ${assessmentComponents.id}))::int`,
      })
      .from(teachingAssignments)
      .innerJoin(assessmentComponents, eq(assessmentComponents.subjectId, teachingAssignments.subjectId))
      .innerJoin(students, eq(students.batchId, teachingAssignments.batchId))
      .where(inArray(teachingAssignments.id, rows.map((r) => r.id)))
      .groupBy(teachingAssignments.id);
    for (const t of totals) progress.set(t.assignmentId, { total: t.total, filled: counts.find((c) => c.assignmentId === t.assignmentId)?.filled ?? 0 });
  }

  const shown = filter && filter in STATUS ? rows.filter((r) => r.status === filter) : rows;
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const tabs = [
    { key: undefined, label: "All", n: rows.length },
    { key: "draft", label: "Draft", n: count("draft") },
    { key: "submitted", label: user.role === "faculty" ? "Submitted" : "To moderate", n: count("submitted") },
    { key: "locked", label: "Locked", n: count("locked") },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Internal marks"
        subtitle={user.role === "faculty" ? "Enter marks once. Submit when complete; the exam cell moderates and locks." : "Moderate submitted sheets and lock them for the university upload."}
      />
      <div className="mb-4 flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <Link
            key={t.label}
            href={t.key ? `/marks?status=${t.key}` : "/marks"}
            className={clsx("whitespace-nowrap rounded-full px-3 py-1.5 text-sm", filter === t.key || (!filter && !t.key) ? "bg-ink text-white" : "text-ink-2 hover:bg-surface")}
          >
            {t.label} <span className="tabular opacity-60">{t.n}</span>
          </Link>
        ))}
      </div>
      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState icon={<BookOpenCheck size={28} />} title="No sheets here" body={rows.length ? "Try another filter." : "No subjects are assigned to you yet. The office sets this up under Setup → Teaching."} />
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((r) => {
              const p = progress.get(r.id) ?? { filled: 0, total: 0 };
              const pc = p.total ? Math.round((p.filled / p.total) * 100) : 0;
              return (
                <li key={r.id}>
                  <Link href={`/marks/${r.id}`} className="flex items-center gap-4 px-4 py-3.5 hover:bg-canvas sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {r.subjectName} <span className="font-normal text-ink-3">· {r.subjectCode}</span>
                      </p>
                      <p className="text-xs text-ink-2">
                        {batchLabel(r, r.programmeName)}
                        {user.role === "office_admin" && ` · ${r.facultyName}`}
                      </p>
                    </div>
                    <div className="hidden w-32 sm:block">
                      <div className="h-1.5 rounded-full bg-line">
                        <div className={clsx("h-full rounded-full", pc === 100 ? "bg-ok" : "bg-accent")} style={{ width: `${pc}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-ink-3 tabular">{pc}% entered</p>
                    </div>
                    <Badge tone={STATUS[r.status].tone}>
                      {r.status === "locked" && <Lock size={11} />}
                      {STATUS[r.status].label}
                    </Badge>
                    <ChevronRight size={16} className="text-ink-3" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
