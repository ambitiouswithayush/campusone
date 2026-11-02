import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { campuses, payments, students } from "@/db/schema";
import { Logo } from "@/components/logo";
import { inr } from "@/lib/format";
import { PayButtons } from "./pay-buttons";

export const metadata: Metadata = { title: "Pay fees", robots: { index: false } };

/** Mock payment gateway page. The UUID in the URL is the only credential, like a real pay link. */
export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await getDb();
  const [row] = await db
    .select({ p: payments, name: students.name, rollNo: students.rollNo, campus: campuses.name })
    .from(payments)
    .innerJoin(students, eq(students.id, payments.studentId))
    .innerJoin(campuses, eq(campuses.id, students.campusId))
    .where(eq(payments.id, id));
  if (!row || row.p.mode !== "online_test") notFound();
  // Show only what a parent needs: first name and a masked roll number.
  const maskedRoll = row.rollNo.replace(/\d(?=\d{2})/g, "•");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-center text-xs font-medium text-warn">TEST MODE — no real money moves</div>
        <div className="rounded-2xl border border-line bg-surface p-6">
          <div className="mb-6 flex items-center gap-2">
            <Logo size={26} />
            <div>
              <p className="text-sm font-semibold leading-tight">{row.campus}</p>
              <p className="text-xs text-ink-3">Fee payment · 2026-27</p>
            </div>
          </div>
          <p className="text-sm text-ink-2">{row.name.split(" ")[0]} · <span className="tabular">{maskedRoll}</span></p>
          <p className="mt-1 text-3xl font-semibold tabular tracking-tight">{inr(row.p.amount)}</p>
          <PayButtons id={id} status={row.p.status} receiptPath={row.p.status === "success" ? `/receipt/${id}` : null} />
        </div>
      </div>
    </main>
  );
}
