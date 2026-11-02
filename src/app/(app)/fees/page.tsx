import { and, desc, eq } from "drizzle-orm";
import { Download, IndianRupee } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { feeStructures, payments, programmes, students } from "@/db/schema";
import { Badge, Card, CardHeader, EmptyState, Input, PageHeader, Select, Stat, buttonClass } from "@/components/ui";
import { requirePageUser } from "@/lib/auth";
import { addDays, isoDateIST, startOfMonth } from "@/lib/dates";
import { invoicesForStudents } from "@/lib/fees";
import { inr } from "@/lib/format";
import { DueActions } from "./due-actions";

export const metadata: Metadata = { title: "Fees" };

export default async function FeesPage({ searchParams }: { searchParams: Promise<{ q?: string; programme?: string; overdue?: string }> }) {
  const user = await requirePageUser("office_admin");
  const sp = await searchParams;
  const db = await getDb();
  const today = isoDateIST();
  const progs = await db.select().from(programmes).where(eq(programmes.campusId, user.campusId));
  const studentList = await db
    .select({ id: students.id, rollNo: students.rollNo, name: students.name, programmeId: students.programmeId, category: students.category, consent: students.parentConsentAt })
    .from(students)
    .where(and(eq(students.campusId, user.campusId), eq(students.status, "active")));
  const invoices = await invoicesForStudents(db, studentList.map((s) => s.id));
  const byId = new Map(studentList.map((s) => [s.id, s]));

  const billed = invoices.reduce((a, i) => a + i.gross - i.concession, 0);
  const collected = invoices.reduce((a, i) => a + i.paid, 0);
  const outstanding = invoices.reduce((a, i) => a + i.due, 0);
  const defaulters = invoices.filter((i) => i.due > 0).length;

  let dues = invoices.filter((i) => i.due > 0).map((i) => ({ ...i, student: byId.get(i.studentId)! }));
  const q = sp.q?.trim().toLowerCase();
  if (q) dues = dues.filter((d) => d.student.rollNo.toLowerCase().includes(q) || d.student.name.toLowerCase().includes(q));
  if (sp.programme) dues = dues.filter((d) => String(d.student.programmeId) === sp.programme);
  if (sp.overdue === "1") dues = dues.filter((d) => d.dueDate < today);
  dues.sort((a, b) => b.due - a.due);

  const receipts = await db
    .select({ p: payments, rollNo: students.rollNo, name: students.name })
    .from(payments)
    .innerJoin(students, eq(students.id, payments.studentId))
    .where(and(eq(students.campusId, user.campusId), eq(payments.status, "success")))
    .orderBy(desc(payments.paidAt))
    .limit(8);
  const structures = await db
    .select({ s: feeStructures, programme: programmes.name })
    .from(feeStructures)
    .innerJoin(programmes, eq(programmes.id, feeStructures.programmeId))
    .where(eq(programmes.campusId, user.campusId));

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Fees"
        subtitle="Dues, collections and the Tally export for 2026-27."
        actions={
          <>
            <a href={`/api/fees/dues`} className={buttonClass("secondary", "sm")}><Download size={14} /> Dues CSV</a>
            <a href={`/api/fees/tally?from=${startOfMonth(addDays(today, -60))}&to=${today}`} className={buttonClass("secondary", "sm")}><Download size={14} /> Tally XML</a>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Billed (net)" value={inr(billed)} hint="After scholarships" />
        <Stat label="Collected" value={inr(collected)} hint={`${billed ? Math.round((collected / billed) * 100) : 0}% of billed`} tone="ok" />
        <Stat label="Outstanding" value={inr(outstanding)} tone={outstanding ? "warn" : undefined} />
        <Stat label="Students with dues" value={defaulters} hint={`of ${invoices.length}`} />
      </div>

      <form className="mb-3 grid grid-cols-2 gap-2 sm:flex" action="/fees">
        <Input name="q" defaultValue={sp.q} placeholder="Roll no. or name" className="col-span-2 sm:w-64" />
        <Select name="programme" defaultValue={sp.programme ?? ""} className="sm:w-48" aria-label="Programme">
          <option value="">All programmes</option>
          {progs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select name="overdue" defaultValue={sp.overdue ?? ""} className="sm:w-40" aria-label="Due status">
          <option value="">All dues</option>
          <option value="1">Overdue only</option>
        </Select>
        <button className={buttonClass() + " col-span-2 sm:col-span-1"}>Apply</button>
      </form>

      <Card className="mb-6 overflow-hidden">
        {dues.length === 0 ? (
          <EmptyState icon={<IndianRupee size={28} />} title={outstanding ? "No dues match these filters" : "No outstanding dues"} body={outstanding ? undefined : "Every student on this campus is fully paid."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Student</th><th className="text-right">Net fee</th><th className="text-right">Paid</th><th className="text-right">Due</th><th>Due date</th><th className="text-right">Actions</th></tr>
              </thead>
              <tbody>
                {dues.map((d) => (
                  <tr key={d.id}>
                    <td className="min-w-[180px]">
                      <Link href={`/students/${d.studentId}`} className="font-medium hover:text-accent">{d.student.name}</Link>
                      <p className="text-xs text-ink-3 tabular">{d.student.rollNo} · {d.student.category}</p>
                    </td>
                    <td className="text-right tabular text-ink-2">{inr(d.gross - d.concession)}</td>
                    <td className="text-right tabular text-ink-2">{inr(d.paid)}</td>
                    <td className="text-right font-semibold tabular">{inr(d.due)}</td>
                    <td>{d.dueDate < today ? <Badge tone="danger">Overdue</Badge> : <span className="text-ink-2">{d.dueDate}</span>}</td>
                    <td className="text-right"><DueActions invoiceId={d.id} studentId={d.studentId} due={d.due} name={d.student.name} canMessage={!!d.student.consent} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Recent receipts" />
          {receipts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-3">No payments yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {receipts.map(({ p, rollNo, name }) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <Link href={`/receipt/${p.id}`} className="min-w-0 flex-1 truncate hover:text-accent">
                    <span className="font-medium">{name}</span> <span className="text-xs text-ink-3 tabular">{rollNo}</span>
                  </Link>
                  <Badge tone={p.mode === "online_test" ? "accent" : "neutral"}>{p.mode === "online_test" ? "Online · test" : "Bank"}</Badge>
                  <span className="w-24 text-right tabular">{inr(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Fee structures" subtitle="By programme and category · 2026-27" />
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Programme</th><th>Category</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {structures.map(({ s, programme }) => (
                  <tr key={s.id}>
                    <td>{programme}</td>
                    <td>{s.category}</td>
                    <td className="text-right tabular" title={s.heads.map((h) => `${h.head}: ${inr(h.amount)}`).join("\n")}>{inr(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <p className="mt-3 text-xs text-ink-3">Payment links run in test mode — no real money moves.</p>
    </div>
  );
}
