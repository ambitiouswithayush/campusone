import { and, desc, eq, inArray } from "drizzle-orm";
import { HeartHandshake } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { getDb } from "@/db";
import { batches, faculty, programmes, riskFlags, students } from "@/db/schema";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/auth";
import { relTime } from "@/lib/format";
import { FlagActions, RescanButton } from "./flag-actions";

export const metadata: Metadata = { title: "At-risk students" };

const TABS = [
  { key: "active", label: "Open", statuses: ["open", "in_progress"] as const },
  { key: "closed", label: "Closed", statuses: ["resolved", "dismissed"] as const },
];

export default async function RiskPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePageUser();
  const { tab = "active" } = await searchParams;
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];
  const db = await getDb();
  const rows = await db
    .select({
      f: riskFlags,
      name: students.name,
      rollNo: students.rollNo,
      section: batches.section,
      year: batches.yearOfStudy,
      programme: programmes.name,
      mentor: faculty.name,
    })
    .from(riskFlags)
    .innerJoin(students, eq(students.id, riskFlags.studentId))
    .innerJoin(batches, eq(batches.id, students.batchId))
    .innerJoin(programmes, eq(programmes.id, students.programmeId))
    .leftJoin(faculty, eq(faculty.id, riskFlags.mentorFacultyId))
    .where(
      and(
        eq(students.campusId, user.campusId),
        inArray(riskFlags.status, [...current.statuses]),
        user.role === "faculty" ? eq(riskFlags.mentorFacultyId, user.facultyId ?? -1) : undefined,
      ),
    )
    .orderBy(desc(riskFlags.score))
    .limit(200);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={user.role === "faculty" ? "My mentees" : "At-risk students"}
        subtitle="Flags come from attendance and internal-marks trends. Each one is a task for the mentor — never an automatic penalty."
        actions={user.role === "office_admin" ? <RescanButton /> : null}
      />
      <div className="mb-4 flex gap-1">
        {TABS.map((t) => (
          <Link key={t.key} href={`/risk?tab=${t.key}`} className={clsx("rounded-full px-3 py-1.5 text-sm", t.key === current.key ? "bg-ink text-white" : "text-ink-2 hover:bg-surface")}>
            {t.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          {rows.length === 0 ? (
            <Card>
              <EmptyState icon={<HeartHandshake size={28} />} title={current.key === "active" ? "No open mentor tasks" : "Nothing closed yet"} body={current.key === "active" ? "Students are flagged automatically when their trends slip." : undefined} />
            </Card>
          ) : (
            rows.map(({ f, ...r }) => (
              <Card key={f.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/students/${f.studentId}`} className="font-medium hover:text-accent">{r.name}</Link>
                    <p className="text-xs text-ink-3"><span className="tabular">{r.rollNo}</span> · {r.programme} {r.year}-{r.section}{user.role === "office_admin" && r.mentor ? ` · Mentor ${r.mentor}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={f.level === "high" ? "danger" : "warn"}>{f.level === "high" ? "High" : "Watch"} · {f.score}</Badge>
                    <Badge tone={f.status === "in_progress" ? "accent" : "neutral"}>{f.status.replace("_", " ")}</Badge>
                  </div>
                </div>
                <ul className="mt-3 space-y-1 text-sm text-ink-2">
                  {f.reasons.map((x) => <li key={x} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" />{x}</li>)}
                </ul>
                {f.note && <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-sm text-ink-2">Note: {f.note}</p>}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-ink-3">Flagged {relTime(f.createdAt)}</span>
                  {current.key === "active" && (user.role === "office_admin" || f.mentorFacultyId === user.facultyId) && <FlagActions id={f.id} status={f.status} />}
                </div>
              </Card>
            ))
          )}
        </div>
        <Card className="h-fit">
          <CardHeader title="How flags work" />
          <div className="space-y-3 px-5 py-4 text-sm text-ink-2">
            <p>A points score (0–100) from: attendance below or near 75%, a drop over the last 3 weeks, low internal marks, a falling latest assessment, and subjects under 40%.</p>
            <p><b className="text-ink">50+</b> is high, <b className="text-ink">30–49</b> is watch. Students with fewer than 20 classes and no marks are <b className="text-ink">not judged</b> — too little data.</p>
            <p>If a flag is wrong, dismiss it with a note. It won&apos;t be raised again for 14 days unless the score rises by 15 or more. Dismissals are kept to recalibrate the weights.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
