import { and, asc, desc, eq, sql } from "drizzle-orm";
import clsx from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import {
  assessmentComponents,
  auditLog,
  batches,
  calendarEvents,
  departments,
  faculty,
  messages,
  programmes,
  students,
  subjects,
  teachingAssignments,
  timetableSlots,
  users,
} from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select } from "@/components/ui";
import { requirePageUser } from "@/lib/auth";
import { PERIODS } from "@/lib/config";
import { formatDate } from "@/lib/dates";
import { addEventAction, addFacultyAction, addSubjectAction, deleteEventAction, reassignAction } from "./actions";

export const metadata: Metadata = { title: "Setup" };

const TABS = [
  { key: "programmes", label: "Programmes" },
  { key: "subjects", label: "Subjects" },
  { key: "faculty", label: "Faculty" },
  { key: "teaching", label: "Teaching & timetable" },
  { key: "calendar", label: "Calendar" },
  { key: "audit", label: "Audit & messages" },
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ tab?: string; batch?: string }> }) {
  const user = await requirePageUser("office_admin");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "programmes";
  const db = await getDb();
  const progs = await db.select().from(programmes).where(eq(programmes.campusId, user.campusId)).orderBy(asc(programmes.name));
  const batchList = await db
    .select({ id: batches.id, programmeId: batches.programmeId, admissionYear: batches.admissionYear, yearOfStudy: batches.yearOfStudy, semester: batches.semester, section: batches.section, programme: programmes.name, n: sql<number>`(select count(*) from students s where s.batch_id = ${batches.id})::int` })
    .from(batches)
    .innerJoin(programmes, eq(programmes.id, batches.programmeId))
    .where(eq(programmes.campusId, user.campusId))
    .orderBy(asc(programmes.name), asc(batches.yearOfStudy), asc(batches.section));

  return (
    <div className="animate-fade-up">
      <PageHeader title="Setup" subtitle="Masters for this campus. Changes are logged." />
      <nav className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <Link key={t.key} href={`/setup?tab=${t.key}`} className={clsx("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm", t.key === tab ? "border-accent font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "programmes" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {progs.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <CardHeader title={p.name} subtitle={`${p.code} · ${p.durationYears} years`} />
              <table className="table-base">
                <thead><tr><th>Batch</th><th>Semester</th><th className="text-right">Students</th></tr></thead>
                <tbody>
                  {batchList.filter((b) => b.programmeId === p.id).map((b) => (
                    <tr key={b.id}>
                      <td>{b.admissionYear} intake · Section {b.section}</td>
                      <td>Year {b.yearOfStudy} · Sem {b.semester}</td>
                      <td className="text-right tabular"><Link href={`/students?batch=${b.id}`} className="hover:text-accent">{b.n}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}

      {tab === "subjects" && <SubjectsTab campusProgs={progs} />}
      {tab === "faculty" && <FacultyTab campusId={user.campusId} />}
      {tab === "teaching" && <TeachingTab campusId={user.campusId} batchList={batchList} selected={Number(sp.batch) || batchList[0]?.id} />}
      {tab === "calendar" && <CalendarTab campusId={user.campusId} />}
      {tab === "audit" && <AuditTab campusId={user.campusId} />}
    </div>
  );
}

async function SubjectsTab({ campusProgs }: { campusProgs: (typeof programmes.$inferSelect)[] }) {
  const db = await getDb();
  const rows = campusProgs.length
    ? await db
        .select({ s: subjects, programme: programmes.name, comps: sql<string>`(select string_agg(c.code || ' ' || c.max_marks, ' · ' order by c.sort_order) from ${assessmentComponents} c where c.subject_id = ${subjects.id})` })
        .from(subjects)
        .innerJoin(programmes, eq(programmes.id, subjects.programmeId))
        .where(eq(programmes.campusId, campusProgs[0].campusId))
        .orderBy(asc(programmes.name), asc(subjects.semester), asc(subjects.code))
    : [];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Code</th><th>Subject</th><th>Programme</th><th>Sem</th><th>Credits</th><th>Internal scheme</th></tr></thead>
            <tbody>
              {rows.map(({ s, programme, comps }) => (
                <tr key={s.id}>
                  <td className="font-medium tabular">{s.code}</td>
                  <td>{s.name}</td>
                  <td className="whitespace-nowrap text-ink-2">{programme}</td>
                  <td className="tabular">{s.semester}</td>
                  <td className="tabular">{s.credits}</td>
                  <td className="whitespace-nowrap text-xs text-ink-3">{comps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Add subject" subtitle="Gets the standard 40-mark internal scheme" />
        <ActionForm action={addSubjectAction} className="space-y-3 p-5">
          <Field label="Programme">
            <Select name="programmeId" required>{campusProgs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code"><Input name="code" required placeholder="CS301" /></Field>
            <Field label="Semester"><Input name="semester" type="number" min={1} max={10} required defaultValue={3} /></Field>
          </div>
          <Field label="Name"><Input name="name" required placeholder="Operating Systems" /></Field>
          <Field label="Credits"><Input name="credits" type="number" min={1} max={6} required defaultValue={3} /></Field>
          <Button type="submit" variant="primary" className="w-full">Add subject</Button>
        </ActionForm>
      </Card>
    </div>
  );
}

async function FacultyTab({ campusId }: { campusId: number }) {
  const db = await getDb();
  const depts = await db.select().from(departments).where(eq(departments.campusId, campusId));
  const rows = await db
    .select({ f: faculty, dept: departments.code, login: users.email, load: sql<number>`(select count(*) from ${teachingAssignments} t where t.faculty_id = ${faculty.id})::int` })
    .from(faculty)
    .innerJoin(departments, eq(departments.id, faculty.departmentId))
    .leftJoin(users, eq(users.facultyId, faculty.id))
    .where(eq(faculty.campusId, campusId))
    .orderBy(asc(departments.code), asc(faculty.name));
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Name</th><th>Dept</th><th>Designation</th><th className="text-right">Subjects</th><th>App login</th></tr></thead>
            <tbody>
              {rows.map(({ f, dept, login, load }) => (
                <tr key={f.id}>
                  <td><p className="font-medium">{f.name}</p><p className="text-xs text-ink-3 tabular">{f.empCode}</p></td>
                  <td>{dept}</td>
                  <td className="whitespace-nowrap text-ink-2">{f.designation}</td>
                  <td className="text-right tabular">{load}</td>
                  <td>{login ? <Badge tone="ok">Active</Badge> : <Badge>Not invited</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Add faculty member" />
        <ActionForm action={addFacultyAction} className="space-y-3 p-5">
          <Field label="Name"><Input name="name" required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Employee code"><Input name="empCode" required placeholder="F-CSE-030" /></Field>
            <Field label="Department">
              <Select name="departmentId">{depts.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</Select>
            </Field>
          </div>
          <Field label="Email"><Input name="email" type="email" required /></Field>
          <Field label="Designation">
            <Select name="designation">{["Assistant Professor", "Associate Professor", "Professor", "Lecturer"].map((d) => <option key={d}>{d}</option>)}</Select>
          </Field>
          <Button type="submit" variant="primary" className="w-full">Add</Button>
          <p className="text-xs text-ink-3">Sending app invitations is not part of this phase (see TDD).</p>
        </ActionForm>
      </Card>
    </div>
  );
}

async function TeachingTab({ campusId, batchList, selected }: { campusId: number; batchList: { id: number; programme: string; yearOfStudy: number; section: string }[]; selected?: number }) {
  const db = await getDb();
  const facs = await db.select().from(faculty).where(and(eq(faculty.campusId, campusId), eq(faculty.active, true))).orderBy(asc(faculty.name));
  const rows = selected
    ? await db
        .select({ a: teachingAssignments, code: subjects.code, name: subjects.name })
        .from(teachingAssignments)
        .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
        .where(eq(teachingAssignments.batchId, selected))
        .orderBy(asc(subjects.code))
    : [];
  const slots = selected ? await db.select().from(timetableSlots).where(eq(timetableSlots.batchId, selected)) : [];
  const codeOf = new Map(rows.map((r) => [r.a.id, r.code]));
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1">
        {batchList.map((b) => (
          <Link key={b.id} href={`/setup?tab=teaching&batch=${b.id}`} className={clsx("rounded-full px-3 py-1.5 text-sm", b.id === selected ? "bg-ink text-white" : "text-ink-2 hover:bg-surface")}>
            {b.programme} {b.yearOfStudy}-{b.section}
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Who teaches what" subtitle="Changing the teacher moves attendance and marks entry to them" />
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.a.id} className="px-5 py-3">
                <ActionForm action={reassignAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="assignmentId" value={r.a.id} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-ink-3">{r.code}</p>
                  </div>
                  <Select name="facultyId" defaultValue={r.a.facultyId} className="w-52" aria-label={`Teacher for ${r.code}`}>
                    {facs.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </Select>
                  <Button type="submit" size="sm">Save</Button>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Weekly timetable" subtitle="Fixed timetable (generation is out of scope)" />
          <div className="overflow-x-auto p-4">
            <table className="w-full border-separate border-spacing-1 text-xs">
              <thead><tr><th></th>{DAYS.map((d) => <th key={d} className="font-medium text-ink-3">{d}</th>)}</tr></thead>
              <tbody>
                {Object.entries(PERIODS).map(([p, t]) => (
                  <tr key={p}>
                    <td className="whitespace-nowrap pr-1 text-ink-3 tabular">P{p} <span className="hidden sm:inline">{t.start}</span></td>
                    {DAYS.map((_, i) => {
                      const s = slots.find((x) => x.dayOfWeek === i + 1 && x.period === Number(p));
                      return <td key={i} className={clsx("h-9 rounded-md text-center tabular", s ? "bg-accent-soft font-medium text-accent-ink" : "bg-canvas")}>{s ? codeOf.get(s.assignmentId) : ""}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

async function CalendarTab({ campusId }: { campusId: number }) {
  const db = await getDb();
  const events = await db.select().from(calendarEvents).where(eq(calendarEvents.campusId, campusId)).orderBy(asc(calendarEvents.date));
  const tone = { holiday: "danger", exam: "warn", event: "accent" } as const;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <span className="w-28 shrink-0 tabular text-ink-2">{formatDate(e.date)}</span>
              <Badge tone={tone[e.kind]}>{e.kind}</Badge>
              <span className="min-w-0 flex-1 truncate">{e.title}</span>
              <ActionForm action={deleteEventAction}>
                <input type="hidden" name="id" value={e.id} />
                <Button type="submit" size="sm" variant="ghost" aria-label={`Remove ${e.title}`}>Remove</Button>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Add to calendar" subtitle="Holidays stop classes and attendance for that day" />
        <ActionForm action={addEventAction} className="space-y-3 p-5">
          <Field label="Date"><Input name="date" type="date" required /></Field>
          <Field label="Type">
            <Select name="kind"><option value="holiday">Holiday</option><option value="exam">Exam</option><option value="event">Event</option></Select>
          </Field>
          <Field label="Title"><Input name="title" required placeholder="Rath Yatra" /></Field>
          <Button type="submit" variant="primary" className="w-full">Add</Button>
        </ActionForm>
      </Card>
    </div>
  );
}

async function AuditTab({ campusId }: { campusId: number }) {
  const db = await getDb();
  const log = await db
    .select({ a: auditLog, actor: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(eq(auditLog.campusId, campusId))
    .orderBy(desc(auditLog.createdAt))
    .limit(40);
  const outbox = await db
    .select({ m: messages, name: students.name })
    .from(messages)
    .innerJoin(students, eq(students.id, messages.studentId))
    .where(eq(messages.campusId, campusId))
    .orderBy(desc(messages.createdAt))
    .limit(20);
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card className="overflow-hidden">
        <CardHeader title="Audit log" subtitle="Latest 40 changes on this campus" />
        <ul className="divide-y divide-line">
          {log.map(({ a, actor }) => (
            <li key={a.id} className="px-5 py-2.5 text-sm">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{a.entity.replace(/_/g, " ")} #{/^[0-9a-f]{8}-/.test(a.entityId) ? a.entityId.slice(0, 8) : a.entityId}</span>
                <span className="text-ink-2">{a.action.replace(/_/g, " ")}</span>
                <span className="ml-auto shrink-0 text-xs text-ink-3">{a.createdAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <p className="text-xs text-ink-3">{actor ?? "System"}{a.reason ? ` · “${a.reason}”` : ""}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Parent message outbox" subtitle="Mock SMS — English or Odia per the parent's preference" />
        <ul className="divide-y divide-line">
          {outbox.map(({ m, name }) => (
            <li key={m.id} className="px-5 py-3 text-sm">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-medium">{name}</span>
                <Badge tone={m.status === "sent_mock" ? "accent" : "neutral"}>{m.status === "sent_mock" ? `Sent · ${m.lang === "or" ? "Odia" : "English"}` : "Held · no consent"}</Badge>
              </div>
              <p className="text-ink-2" lang={m.lang}>{m.body}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
