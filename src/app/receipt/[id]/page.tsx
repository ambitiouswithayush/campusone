import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { Logo } from "@/components/logo";
import { receipt } from "@/lib/fees";
import { inr } from "@/lib/format";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Fee receipt", robots: { index: false } };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const r = await receipt(await getDb(), id);
  if (!r || r.payment.status !== "success") notFound();
  const { payment: p, student: s, programme, invoice } = r;
  return (
    <main className="min-h-dvh bg-canvas px-4 py-10 print:bg-white print:p-0">
      <div className="mx-auto max-w-lg rounded-2xl border border-line bg-surface p-6 sm:p-8 print:border-0">
        <div className="flex items-start justify-between gap-4 border-b border-line pb-5">
          <div className="flex items-center gap-2.5">
            <Logo size={30} />
            <div>
              <p className="text-sm font-semibold">Company A Educational Trust</p>
              <p className="text-xs text-ink-3">Bhubaneswar, Odisha</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-ink-3">Fee receipt</p>
            <p className="text-sm font-semibold tabular">{p.receiptNo}</p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 py-5 text-sm">
          <dt className="text-ink-3">Student</dt><dd className="text-right font-medium">{s.name}</dd>
          <dt className="text-ink-3">Roll no.</dt><dd className="text-right tabular">{s.rollNo}</dd>
          <dt className="text-ink-3">Programme</dt><dd className="text-right">{programme.name}</dd>
          <dt className="text-ink-3">Academic year</dt><dd className="text-right">{invoice.academicYear}</dd>
          <dt className="text-ink-3">Date</dt><dd className="text-right">{p.paidAt?.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</dd>
          <dt className="text-ink-3">Mode</dt><dd className="text-right">{p.mode === "bank_counter" ? "Bank counter" : "Online (test mode)"}</dd>
          <dt className="text-ink-3">Reference</dt><dd className="text-right tabular">{p.reference}</dd>
        </dl>
        <div className="flex items-baseline justify-between border-t border-line pt-4">
          <span className="text-sm text-ink-2">Amount received</span>
          <span className="text-2xl font-semibold tabular">{inr(p.amount)}</span>
        </div>
        <p className="mt-6 text-xs text-ink-3">Computer-generated receipt. No signature required.</p>
        <div className="mt-6 print:hidden"><PrintButton /></div>
      </div>
    </main>
  );
}
