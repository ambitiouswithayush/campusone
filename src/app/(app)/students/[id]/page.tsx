import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import {
  assessmentComponents,
  attendanceRecords,
  attendanceSessions,
  batches,
  faculty,
  feeStructures,
  marks,
  messages,
  payments,
  programmes,
  riskFlags,
  subjects,
  teachingAssignments,
} from "@/db/schema";
import { AttendanceBar, Badge, Card, CardHeader, Notice, PageHeader, RiskBadge, Stat } from "@/components/ui";
import { AccessError, assertStudentAccess } from "@/lib/access";
import { attendancePct, classesNeeded } from "@/lib/attendance";
import { requirePageUser } from "@/lib/auth";
import { RULES } from "@/lib/config";
import { invoicesForStudents, scholarshipsFor } from "@/lib/fees";
import { inr } from "@/lib/format";
import { internalTotal } from "@/lib/marks-calc";
import { batchLabel } from "@/lib/pack";

export const metadata: Metadata = { title: "Student" };

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = await getDb();
  let s;
  try {
    s = await assertStudentAccess(db, user, id);
  } catch (e) {
    if (e instanceof AccessError) notFound();
    throw e;
  }
  const isAdmin = user.role === "office_admin";

  const [b] = await db
    .select({ section: batches.section, yearOfStudy: batches.yearOfStudy, semester: batches.semester, programmeName: programmes.name })
    .from(batches)
    .innerJoin(programmes, eq(programmes.id, batches.programmeId))
    .where(eq(batches.id, s.batchId));
  const [mentor] = s.mentorFacultyId ? await db.select({ name: faculty.name }).from(faculty).where(eq(faculty.id, s.mentorFacultyId)) : [];

  const subjectRows = await db
    .select({ assignmentId: teachingAssignments.id, subjectId: subjects.id, code: subjects.code, name: subjects.name, teacher: faculty.name })
    .from(teachingAssignments)
    .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
    .innerJoin(faculty, eq(faculty.id, teachingAssignments.facultyId))
    .where(eq(teachingAssignments.batchId, s.batchId))
    .orderBy(asc(subjects.code));
  const att = await db
    .select({
      assignmentId: attendanceSessions.assignmentId,
      held: sql<number>`count(*)::int`,
      present: sql<number>`sum(case when ${attendanceRecords.present} then 1 else 0 end)::int`,
    })
    .from(attendanceRecords)
    .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
    .where(eq(attendanceRecords.studentId, id))
    .groupBy(attendanceSessions.assignmentId);
  const mk = await db
    .select({ subjectId: assessmentComponents.subjectId, score: marks.score, absent: marks.absent, maxMarks: assessmentComponents.maxMarks })
    .from(marks)
    .innerJoin(assessmentComponents, eq(assessmentComponents.id, marks.componentId))
    .where(eq(marks.studentId, id));

  const held = att.reduce((a, r) => a + r.held, 0);
  const present = att.reduce((a, r) => a + r.present, 0);
  const overall = attendancePct(present, held);
  const need = classesNeeded(present, held);
  const perSubject = subjectRows.map((r) => {
    const a = att.find((x) => x.assignmentId === r.assignmentId);
    return { ...r, held: a?.held ?? 0, present: a?.present ?? 0, pct: a ? attendancePct(a.present, a.held) : null, internal: internalTotal(mk.filter((m) => m.subjectId === r.subjectId)) };
  });
  const internals = perSubject.map((p) => p.internal).filter((x): x is number => x !== null);
  const avgInternal = internals.length ? Math.round((internals.reduce((a, x) => a + x, 0) / internals.length) * 10) / 10 : null;

  const flags = await db.select().from(riskFlags).where(eq(riskFlags.studentId, id)).orderBy(desc(riskFlags.createdAt)).limit(5);
  const openFlag = flags.find((f) => f.status === "open" || f.status === "in_progress");

  const invoices = isAdmin ? await invoicesForStudents(db, [id]) : [];
  const due = invoices.reduce((a, i) => a + i.due, 0);
  const schol = isAdmin ? await scholarshipsFor(db, id) : [];
  const pays = isAdmin ? await db.select().from(payments).where(and(eq(payments.studentId, id), eq(payments.status, "success"))).orderBy(desc(payments.paidAt)) : [];
  const structure = isAdmin && invoices[0] ? (await db.select().from(feeStructures).where(eq(feeStructures.id, invoices[0].structureId)))[0] : null;
  const msgs = isAdmin ? await db.select().from(messages).where(eq(messages.studentId, id)).orderBy(desc(messages.createdAt)).limit(6) : [];

  const age = Math.floor((Date.now() - new Date(s.dob).getTime()) / (365.25 * 86400_000));
  const minor = age < 18;

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={{ href: "/students", label: "Students" }}
        title={s.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tabular">{s.rollNo}</span>
            <span>· {batchLabel(b, b.programmeName)} · Sem {b.semester}</span>
            {mentor && <span>· Mentor {mentor.name}</span>}
            <RiskBadge level={openFlag?.level ?? null} />
          </span>
        }
      />

      {minor && (
        <Notice tone={s.parentConsentAt ? "neutral" : "warn"} className="mb-4">
          Minor (age {age}).{" "}
          {s.parentConsentAt
            ? `Parental consent recorded ${s.parentConsentAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} (DPDP Act 2023).`
            : "Parental consent pending — no messages are sent to the parent until it is recorded (DPDP Act 2023)."}
        </Notice>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Attendance"
          value={overall === null ? "—" : `${overall.toFixed(1)}%`}
          tone={overall !== null && overall < RULES.attendanceThreshold ? "danger" : undefined}
          hint={need > 0 ? `Needs ${need} classes in a row to reach ${RULES.attendanceThreshold}%` : `${present} of ${held} classes`}
        />
        <Stat label="Internal average" value={avgInternal === null ? "—" : `${avgInternal}/40`} hint={`${internals.length} of ${perSubject.length} subjects graded`} />
        {isAdmin ? (
          <Stat label="Fee due" value={due ? inr(due) : "Nil"} tone={due ? "warn" : "ok"} hint={invoices[0] ? `Due ${new Date(invoices[0].dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : undefined} />
        ) : (
          <Stat label="Classes held" value={held} hint="All subjects, this semester" />
        )}
        <Stat label="Risk" value={openFlag ? `${openFlag.score}/100` : "—"} tone={openFlag?.level === "high" ? "danger" : openFlag ? "warn" : undefined} hint={openFlag ? `Mentor task ${openFlag.status.replace("_", " ")}` : "No open flag"} />
      </div>

      {openFlag && (
        <Card className="mb-6">
          <CardHeader title="Why this student is flagged" subtitle="Explainable early-warning score. It only creates a mentor task — it never changes records." actions={<Link href="/risk" className="text-sm text-accent hover:underline">Mentor tasks →</Link>} />
          <ul className="space-y-1.5 px-5 py-4 text-sm">
            {openFlag.reasons.map((r) => (
              <li key={r} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-danger" />{r}</li>
            ))}
          </ul>
          {openFlag.note && <p className="border-t border-line px-5 py-3 text-sm text-ink-2">Mentor note: {openFlag.note}</p>}
        </Card>
      )}

      <Card className="mb-6 overflow-hidden">
        <CardHeader title="Subjects" subtitle="Attendance and internal marks this semester" />
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Subject</th><th>Attendance</th><th className="text-right">Classes</th><th className="text-right">Internal /40</th></tr>
            </thead>
            <tbody>
              {perSubject.map((p) => (
                <tr key={p.assignmentId}>
                  <td><p className="font-medium">{p.name}</p><p className="text-xs text-ink-3">{p.code} · {p.teacher}</p></td>
                  <td><AttendanceBar pct={p.pct} /></td>
                  <td className="text-right tabular text-ink-2">{p.present}/{p.held}</td>
                  <td className="text-right tabular">{p.internal ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {isAdmin && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader title="Fees 2026-27" subtitle={structure ? `${s.category} structure · ${structure.heads.map((h) => `${h.head} ${inr(h.amount)}`).join(" · ")}` : undefined} actions={due > 0 ? <Link href={`/fees?q=${encodeURIComponent(s.rollNo)}`} className="text-sm text-accent hover:underline">Collect →</Link> : null} />
            <dl className="grid grid-cols-2 gap-y-2 px-5 py-4 text-sm">
              {invoices.map((i) => (
                <div key={i.id} className="contents">
                  <dt className="text-ink-2">Fee</dt><dd className="text-right tabular">{inr(i.gross)}</dd>
                  <dt className="text-ink-2">Scholarships</dt><dd className="text-right tabular">− {inr(i.concession)}</dd>
                  <dt className="text-ink-2">Paid</dt><dd className="text-right tabular">− {inr(i.paid)}</dd>
                  <dt className="font-medium">Balance</dt><dd className="text-right font-semibold tabular">{inr(i.due)}</dd>
                </div>
              ))}
            </dl>
            {schol.length > 0 && <p className="border-t border-line px-5 py-2.5 text-xs text-ink-2">{schol.map((x) => `${x.name} ${inr(x.amount)}`).join(" · ")}</p>}
            {pays.length > 0 && (
              <ul className="divide-y divide-line border-t border-line">
                {pays.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <Link href={`/receipt/${p.id}`} className="text-accent hover:underline tabular">{p.receiptNo}</Link>
                    <span className="text-xs text-ink-3">{p.paidAt?.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {p.mode === "bank_counter" ? "Bank" : "Online (test)"}</span>
                    <span className="tabular">{inr(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Messages to parent" subtitle={`${s.guardianName} · ${s.guardianPhone} · ${s.guardianLang === "or" ? "Odia" : "English"}`} />
            {msgs.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-3">No automated messages yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {msgs.map((m) => (
                  <li key={m.id} className="px-5 py-3">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge tone={m.kind === "shortage" ? "danger" : "warn"}>{m.kind === "shortage" ? "Shortage alert" : "Fee reminder"}</Badge>
                      {m.status === "skipped_no_consent" ? <Badge>Not sent · no consent</Badge> : <Badge tone="accent">Sent (mock SMS)</Badge>}
                      <span className="ml-auto text-xs text-ink-3">{m.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                    </div>
                    <p className="text-sm text-ink-2" lang={m.lang}>{m.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
