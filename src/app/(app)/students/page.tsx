import { asc, eq } from "drizzle-orm";
import { Search, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { batches, programmes } from "@/db/schema";
import { AttendanceBar, Card, EmptyState, Input, PageHeader, RiskBadge, Select, buttonClass } from "@/components/ui";
import { readableBatchIds } from "@/lib/access";
import { requirePageUser } from "@/lib/auth";
import { RULES } from "@/lib/config";
import { inr } from "@/lib/format";
import { batchLabel } from "@/lib/pack";
import { studentRows } from "@/lib/students";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string; batch?: string; flag?: string }> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const db = await getDb();
  const batchIds = await readableBatchIds(db, user);
  const batchList = (
    await db
      .select({ id: batches.id, section: batches.section, yearOfStudy: batches.yearOfStudy, programmeName: programmes.name })
      .from(batches)
      .innerJoin(programmes, eq(programmes.id, batches.programmeId))
      .where(eq(programmes.campusId, user.campusId))
      .orderBy(asc(programmes.name), asc(batches.yearOfStudy), asc(batches.section))
  ).filter((b) => batchIds.includes(b.id));

  const batchId = Number(sp.batch) || null;
  let rows = await studentRows(db, user, { where: batchId ? [eq(batches.id, batchId)] : [] });
  const total = rows.length;
  const q = sp.q?.trim().toLowerCase().slice(0, 60);
  if (q) rows = rows.filter((r) => r.rollNo.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  if (sp.flag === "short") rows = rows.filter((r) => r.attendancePct !== null && r.attendancePct < RULES.attendanceThreshold);
  if (sp.flag === "risk") rows = rows.filter((r) => r.risk);
  if (sp.flag === "dues") rows = rows.filter((r) => r.feeDue > 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Students"
        subtitle={user.role === "faculty" ? "Students you teach or mentor." : `${total} active students on this campus.`}
      />
      <form className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" action="/students">
        <div className="relative col-span-2 sm:w-64">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input name="q" defaultValue={sp.q} placeholder="Roll no. or name" className="pl-9" />
        </div>
        <Select name="batch" defaultValue={sp.batch ?? ""} className="sm:w-56" aria-label="Batch">
          <option value="">All batches</option>
          {batchList.map((b) => (
            <option key={b.id} value={b.id}>{batchLabel(b, b.programmeName)}</option>
          ))}
        </Select>
        <Select name="flag" defaultValue={sp.flag ?? ""} className="sm:w-48" aria-label="Show">
          <option value="">Everyone</option>
          <option value="short">Below {RULES.attendanceThreshold}% attendance</option>
          <option value="risk">Flagged at risk</option>
          {user.role === "office_admin" && <option value="dues">With fee dues</option>}
        </Select>
        <button className={buttonClass("secondary") + " col-span-2 sm:col-span-1"}>Apply</button>
      </form>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<Users size={28} />} title="No students match" body="Clear a filter or search for a different roll number." action={<Link href="/students" className={buttonClass()}>Clear filters</Link>} />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Batch</th>
                    <th>Attendance</th>
                    <th className="text-right">Internal /40</th>
                    {user.role === "office_admin" && <th className="text-right">Fee due</th>}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/students/${r.id}`} className="font-medium hover:text-accent">{r.name}</Link>
                        <p className="text-xs text-ink-3 tabular">{r.rollNo}</p>
                      </td>
                      <td className="text-ink-2">{r.programmeName} {r.yearOfStudy}-{r.section}</td>
                      <td><AttendanceBar pct={r.attendancePct} /></td>
                      <td className="text-right tabular">{r.internal40 ?? "—"}</td>
                      {user.role === "office_admin" && <td className={"text-right tabular " + (r.feeDue ? "text-ink" : "text-ink-3")}>{r.feeDue ? inr(r.feeDue) : "—"}</td>}
                      <td className="text-right"><RiskBadge level={r.risk} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/students/${r.id}`} className="block px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.name}</p>
                        <p className="text-xs text-ink-3 tabular">{r.rollNo} · {r.programmeName} {r.yearOfStudy}-{r.section}</p>
                      </div>
                      <RiskBadge level={r.risk} />
                    </div>
                    <div className="mt-2 flex items-center gap-4 text-xs text-ink-2">
                      <AttendanceBar pct={r.attendancePct} />
                      <span className="tabular">{r.internal40 ?? "—"}/40</span>
                      {user.role === "office_admin" && r.feeDue > 0 && <span className="tabular">{inr(r.feeDue)} due</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {rows.length > 0 && <p className="mt-2 text-xs text-ink-3">{rows.length} shown</p>}
    </div>
  );
}
