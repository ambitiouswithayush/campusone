import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import {
  attendanceRecords,
  attendanceSessions,
  batches,
  calendarEvents,
  faculty,
  markSheets,
  messages,
  programmes,
  students,
  subjects,
  teachingAssignments,
  timetableSlots,
} from "@/db/schema";
import { Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { WeekBars } from "@/components/week-bars";
import { requirePageUser } from "@/lib/auth";
import { PERIODS, RULES } from "@/lib/config";
import { addDays, dayOfWeek, formatDate, isoDateIST, istInstant } from "@/lib/dates";
import { inr } from "@/lib/format";
import { studentRows } from "@/lib/students";
import { RunJobs } from "./run-jobs";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requirePageUser("office_admin");
  const db = await getDb();
  const today = isoDateIST();
  const now = new Date();
  const weekAgo = addDays(today, -6);
  const campus = eq(programmes.campusId, user.campusId);

  // Scheduled classes = timetable slots on working days; completion = sessions marked the same day.
  const slots = await db
    .select({ assignmentId: timetableSlots.assignmentId, batchId: timetableSlots.batchId, dayOfWeek: timetableSlots.dayOfWeek, period: timetableSlots.period, subject: subjects.name, teacher: faculty.name, section: batches.section, year: batches.yearOfStudy, programme: programmes.name })
    .from(timetableSlots)
    .innerJoin(teachingAssignments, eq(teachingAssignments.id, timetableSlots.assignmentId))
    .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
    .innerJoin(faculty, eq(faculty.id, teachingAssignments.facultyId))
    .innerJoin(batches, eq(batches.id, timetableSlots.batchId))
    .innerJoin(programmes, eq(programmes.id, batches.programmeId))
    .where(campus);
  const holidays = new Set((await db.select({ date: calendarEvents.date }).from(calendarEvents).where(and(eq(calendarEvents.campusId, user.campusId), eq(calendarEvents.kind, "holiday")))).map((h) => h.date));
  const sessions = await db
    .select({ assignmentId: attendanceSessions.assignmentId, date: attendanceSessions.date, period: attendanceSessions.period, markedAt: attendanceSessions.markedAt })
    .from(attendanceSessions)
    .where(and(gte(attendanceSessions.date, addDays(today, -7)), inArray(attendanceSessions.batchId, [...new Set(slots.map((s) => s.batchId))].concat(-1))));
  const marked = new Map(sessions.map((s) => [`${s.assignmentId}:${s.date}:${s.period}`, s]));

  let scheduled = 0;
  let sameDay = 0;
  for (let d = weekAgo; d < today; d = addDays(d, 1)) {
    if (dayOfWeek(d) === 7 || holidays.has(d)) continue;
    for (const s of slots.filter((x) => x.dayOfWeek === dayOfWeek(d))) {
      scheduled++;
      const m = marked.get(`${s.assignmentId}:${d}:${s.period}`);
      if (m && isoDateIST(m.markedAt) === d) sameDay++;
    }
  }
  const sameDayPct = scheduled ? (sameDay / scheduled) * 100 : null;

  // Classes that have ended and are still unmarked (today and the edit window).
  const chase: { date: string; period: number; subject: string; teacher: string; batch: string }[] = [];
  for (const d of [addDays(today, -2), addDays(today, -1), today]) {
    if (dayOfWeek(d) === 7 || holidays.has(d)) continue;
    for (const s of slots.filter((x) => x.dayOfWeek === dayOfWeek(d))) {
      if (istInstant(d, PERIODS[s.period].end) > now) continue;
      if (!marked.has(`${s.assignmentId}:${d}:${s.period}`)) chase.push({ date: d, period: s.period, subject: s.subject, teacher: s.teacher, batch: `${s.programme} ${s.year}-${s.section}` });
    }
  }
  const todaySlots = dayOfWeek(today) === 7 || holidays.has(today) ? [] : slots.filter((s) => s.dayOfWeek === dayOfWeek(today));
  const todayDone = todaySlots.filter((s) => marked.has(`${s.assignmentId}:${today}:${s.period}`)).length;

  const rows = await studentRows(db, user);
  const short = rows.filter((r) => r.attendancePct !== null && r.attendancePct < RULES.attendanceThreshold);
  const outstanding = rows.reduce((a, r) => a + r.feeDue, 0);
  const openRisk = rows.filter((r) => r.risk).length;

  const sheetCounts = await db
    .select({ status: sql<string>`coalesce(${markSheets.status}, 'draft')`, n: sql<number>`count(*)::int` })
    .from(teachingAssignments)
    .innerJoin(batches, eq(batches.id, teachingAssignments.batchId))
    .innerJoin(programmes, eq(programmes.id, batches.programmeId))
    .leftJoin(markSheets, eq(markSheets.assignmentId, teachingAssignments.id))
    .where(campus)
    .groupBy(sql`1`);
  const sc = (s: string) => sheetCounts.find((x) => x.status === s)?.n ?? 0;
  const sheetsTotal = sheetCounts.reduce((a, x) => a + x.n, 0);

  const weekly = await db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${attendanceSessions.date}::timestamp), 'YYYY-MM-DD')`,
      held: sql<number>`count(*)::int`,
      present: sql<number>`sum(case when ${attendanceRecords.present} then 1 else 0 end)::int`,
    })
    .from(attendanceRecords)
    .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
    .innerJoin(students, eq(students.id, attendanceRecords.studentId))
    .where(and(eq(students.campusId, user.campusId), gte(attendanceSessions.date, addDays(today, -7 * 12)), lte(attendanceSessions.date, addDays(today, -dayOfWeek(today)))))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const byBatch = new Map<string, { label: string; n: number; short: number; risk: number; sum: number; counted: number }>();
  for (const r of rows) {
    const k = `${r.programmeName} ${r.yearOfStudy}-${r.section}`;
    const b = byBatch.get(k) ?? { label: k, n: 0, short: 0, risk: 0, sum: 0, counted: 0 };
    b.n++;
    if (r.attendancePct !== null) { b.sum += r.attendancePct; b.counted++; }
    if (r.attendancePct !== null && r.attendancePct < RULES.attendanceThreshold) b.short++;
    if (r.risk) b.risk++;
    byBatch.set(k, b);
  }

  const msgWeek = await db
    .select({ kind: messages.kind, status: messages.status, n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.campusId, user.campusId), gte(messages.createdAt, new Date(Date.now() - 7 * 86400_000))))
    .groupBy(messages.kind, messages.status);
  const mc = (kind: string, status: string) => msgWeek.find((m) => m.kind === kind && m.status === status)?.n ?? 0;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Dashboard" subtitle={`${formatDate(today)} · ${rows.length} students`} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Marked same day · 7 days"
          value={sameDayPct === null ? "—" : `${sameDayPct.toFixed(0)}%`}
          tone={sameDayPct === null ? undefined : sameDayPct >= 95 ? "ok" : "warn"}
          hint={`${sameDay} of ${scheduled} classes · target 95%`}
        />
        <Link href="/students?flag=short" className="block">
          <Stat label={`Below ${RULES.attendanceThreshold}%`} value={short.length} tone={short.length ? "danger" : "ok"} hint={`${rows.length ? ((short.length / rows.length) * 100).toFixed(0) : 0}% of students →`} />
        </Link>
        <Link href="/risk" className="block">
          <Stat label="Open mentor tasks" value={openRisk} tone={openRisk ? "warn" : undefined} hint="From the at-risk model →" />
        </Link>
        <Link href="/fees" className="block">
          <Stat label="Fees outstanding" value={inr(outstanding)} hint={`${rows.filter((r) => r.feeDue > 0).length} students →`} />
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Campus attendance by week" subtitle="Share of student-classes attended · completed weeks" />
          <WeekBars data={weekly.map((w) => ({ week: w.week, pct: (w.present / w.held) * 100 }))} threshold={RULES.attendanceThreshold} />
        </Card>
        <Card className="flex flex-col">
          <CardHeader
            title="Classes to chase"
            subtitle={todaySlots.length ? `Today: ${todayDone} of ${todaySlots.length} marked so far` : "No classes today"}
          />
          {chase.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-3">Every finished class in the last two days is marked.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-line overflow-auto">
              {chase.reverse().map((c, i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="w-16 shrink-0 text-xs text-ink-3">{c.date === today ? "Today" : formatDate(c.date)} P{c.period}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{c.subject} · {c.batch}</span>
                    <span className="block truncate text-xs text-ink-3">{c.teacher}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader title="By batch" />
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Batch</th><th className="text-right">Students</th><th className="text-right">Avg att.</th><th className="text-right">&lt;{RULES.attendanceThreshold}%</th><th className="text-right">Risk</th></tr></thead>
              <tbody>
                {[...byBatch.values()].map((b) => (
                  <tr key={b.label}>
                    <td className="whitespace-nowrap font-medium">{b.label}</td>
                    <td className="text-right tabular">{b.n}</td>
                    <td className="text-right tabular">{b.counted ? `${(b.sum / b.counted).toFixed(1)}%` : "—"}</td>
                    <td className={"text-right tabular " + (b.short ? "font-medium text-danger" : "text-ink-3")}>{b.short}</td>
                    <td className="text-right tabular">{b.risk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Internal marks" subtitle={`${sheetsTotal} subject sheets`} actions={<Link href="/marks?status=submitted" className="text-sm text-accent hover:underline">Moderate →</Link>} />
            <div className="px-5 py-4">
              <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
                <div className="bg-ok" style={{ width: `${(sc("locked") / Math.max(1, sheetsTotal)) * 100}%` }} />
                <div className="bg-warn" style={{ width: `${(sc("submitted") / Math.max(1, sheetsTotal)) * 100}%` }} />
                <div className="flex-1 bg-line" />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-ok" />Locked {sc("locked")}</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-warn" />Awaiting moderation {sc("submitted")}</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-line-strong" />Draft {sc("draft")}</span>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Automations · last 7 days" subtitle="Run nightly; parent messages are mocked" actions={<RunJobs />} />
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 px-5 py-4 text-sm">
              <dt className="text-ink-2">Shortage alerts sent</dt><dd className="tabular">{mc("shortage", "sent_mock")}</dd>
              <dt className="text-ink-2">Fee reminders sent</dt><dd className="tabular">{mc("fee_reminder", "sent_mock")}</dd>
              <dt className="text-ink-2">Held back · no parental consent</dt>
              <dd><Badge>{mc("shortage", "skipped_no_consent") + mc("fee_reminder", "skipped_no_consent")}</Badge></dd>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
