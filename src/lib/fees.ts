import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { feeInvoices, feeStructures, payments, programmes, scholarships, students } from "@/db/schema";
import { audit } from "./audit";
import { ACADEMIC_YEAR } from "./config";
import type { SessionUser } from "./session";

export class FeeError extends Error {}

export function balance(gross: number, concession: number, paid: number): number {
  return Math.max(0, gross - concession - paid);
}

/** Scholarships reduce the demand but never below zero, and never beyond the fee itself. */
export function concessionFor(gross: number, scholarshipAmounts: number[]): number {
  return Math.min(gross, scholarshipAmounts.reduce((s, a) => s + a, 0));
}

const paidSql = sql<number>`coalesce((select sum(p.amount) from payments p where p.invoice_id = "fee_invoices"."id" and p.status = 'success'), 0)::int`;

export async function invoicesForStudents(db: DB, studentIds: number[]) {
  if (!studentIds.length) return [];
  const rows = await db
    .select({ invoice: feeInvoices, paid: paidSql })
    .from(feeInvoices)
    .where(inArray(feeInvoices.studentId, studentIds));
  return rows.map((r) => ({ ...r.invoice, paid: r.paid, due: balance(r.invoice.gross, r.invoice.concession, r.paid) }));
}

export async function duesByStudent(db: DB, studentIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (const inv of await invoicesForStudents(db, studentIds)) out.set(inv.studentId, (out.get(inv.studentId) ?? 0) + inv.due);
  return out;
}

async function invoiceInCampus(db: DB, user: SessionUser, invoiceId: number) {
  const [row] = await db
    .select({ invoice: feeInvoices, student: students, paid: paidSql })
    .from(feeInvoices)
    .innerJoin(students, eq(students.id, feeInvoices.studentId))
    .where(eq(feeInvoices.id, invoiceId));
  if (!row || row.student.campusId !== user.campusId) throw new FeeError("Invoice not found.");
  return { ...row, due: balance(row.invoice.gross, row.invoice.concession, row.paid) };
}

async function nextReceiptNo(db: DB) {
  const res = await db.execute(sql`select nextval('receipt_seq')::int as n`);
  const n = (res as unknown as { rows: { n: number }[] }).rows[0].n;
  return `RCPT/${ACADEMIC_YEAR}/${String(n).padStart(6, "0")}`;
}

/** Office records a payment made at the bank counter (the legacy channel). */
export async function recordCounterPayment(db: DB, user: SessionUser, invoiceId: number, amount: number, bankRef: string) {
  const inv = await invoiceInCampus(db, user, invoiceId);
  if (!Number.isInteger(amount) || amount <= 0) throw new FeeError("Enter a whole rupee amount above zero.");
  if (amount > inv.due) throw new FeeError(`Amount exceeds the balance due (₹${inv.due}).`);
  const ref = bankRef.trim().toUpperCase();
  if (!/^[A-Z0-9/-]{6,30}$/.test(ref)) throw new FeeError("Bank reference should be 6–30 letters, digits, / or -.");
  const [dup] = await db.select({ id: payments.id }).from(payments).where(eq(payments.reference, ref));
  if (dup) throw new FeeError("This bank reference is already recorded.");
  const receiptNo = await nextReceiptNo(db);
  const [p] = await db
    .insert(payments)
    .values({ invoiceId, studentId: inv.student.id, amount, mode: "bank_counter", status: "success", reference: ref, receiptNo, paidAt: new Date() })
    .returning();
  await audit(db, { campusId: user.campusId, actorUserId: user.uid, entity: "payment", entityId: p.id, action: "counter_payment", after: { amount, ref, receiptNo } });
  return p;
}

/** Create a test-mode payment link for the outstanding balance. */
export async function createPaymentLink(db: DB, user: SessionUser, invoiceId: number) {
  const inv = await invoiceInCampus(db, user, invoiceId);
  if (inv.due <= 0) throw new FeeError("Nothing is due on this invoice.");
  const [p] = await db
    .insert(payments)
    .values({ invoiceId, studentId: inv.student.id, amount: inv.due, mode: "online_test", status: "pending" })
    .returning();
  return p;
}

/**
 * Mock gateway callback. Idempotent: replaying a success returns the same receipt, and a link
 * cannot be paid if the balance was cleared another way in the meantime.
 */
export async function completeMockPayment(db: DB, paymentId: string, outcome: "success" | "failed") {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!p || p.mode !== "online_test") throw new FeeError("Payment link not found.");
    if (p.status !== "pending") return p;
    const [{ campusId }] = await tx.select({ campusId: students.campusId }).from(students).where(eq(students.id, p.studentId));
    // The gateway has no user, so the audit actor is null ("System").
    const log = (action: string, after: unknown) =>
      audit(tx, { campusId, actorUserId: null, entity: "payment", entityId: p.id, action, after });
    if (outcome === "failed") {
      const [f] = await tx.update(payments).set({ status: "failed" }).where(eq(payments.id, p.id)).returning();
      await log("gateway_failed", { amount: p.amount });
      return f;
    }
    const [inv] = await tx.select().from(feeInvoices).where(eq(feeInvoices.id, p.invoiceId));
    const [{ paid }] = await tx
      .select({ paid: sql<number>`coalesce(sum(${payments.amount}), 0)::int` })
      .from(payments)
      .where(and(eq(payments.invoiceId, p.invoiceId), eq(payments.status, "success")));
    if (p.amount > balance(inv.gross, inv.concession, paid)) {
      const [f] = await tx.update(payments).set({ status: "failed" }).where(eq(payments.id, p.id)).returning();
      await log("gateway_rejected_balance_changed", { amount: p.amount });
      return f;
    }
    const receiptNo = await nextReceiptNo(tx as unknown as DB);
    const [ok] = await tx
      .update(payments)
      .set({ status: "success", paidAt: new Date(), receiptNo, reference: `TEST-${p.id.slice(0, 8).toUpperCase()}` })
      .where(eq(payments.id, p.id))
      .returning();
    await log("gateway_payment", { amount: p.amount, receiptNo, reference: ok.reference });
    return ok;
  });
}

export async function receipt(db: DB, paymentId: string) {
  const [row] = await db
    .select({ payment: payments, invoice: feeInvoices, student: students, programme: programmes, structure: feeStructures })
    .from(payments)
    .innerJoin(feeInvoices, eq(feeInvoices.id, payments.invoiceId))
    .innerJoin(students, eq(students.id, payments.studentId))
    .innerJoin(programmes, eq(programmes.id, students.programmeId))
    .innerJoin(feeStructures, eq(feeStructures.id, feeInvoices.structureId))
    .where(eq(payments.id, paymentId));
  return row ?? null;
}

export async function scholarshipsFor(db: DB, studentId: number) {
  return db.select().from(scholarships).where(eq(scholarships.studentId, studentId));
}

function xml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Tally Prime XML import of receipt vouchers. Ledger names are assumptions to be mapped to the
 * trust's chart of accounts during onboarding.
 */
export async function tallyXml(db: DB, user: SessionUser, from: string, to: string) {
  const rows = await db
    .select({ payment: payments, student: students })
    .from(payments)
    .innerJoin(students, eq(students.id, payments.studentId))
    .where(
      and(
        eq(students.campusId, user.campusId),
        eq(payments.status, "success"),
        sql`(${payments.paidAt} at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date`,
      ),
    )
    .orderBy(payments.paidAt);
  const vouchers = rows.map(({ payment: p, student: s }) => {
    const d = new Date(p.paidAt!.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
    const bank = p.mode === "online_test" ? "Payment Gateway Clearing" : "SBI Fee Collection A/c";
    return `   <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <VOUCHER VCHTYPE="Receipt" ACTION="Create">
     <DATE>${d}</DATE>
     <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
     <VOUCHERNUMBER>${xml(p.receiptNo!)}</VOUCHERNUMBER>
     <PARTYLEDGERNAME>${xml(`${s.rollNo} ${s.name}`)}</PARTYLEDGERNAME>
     <NARRATION>${xml(`Fee ${ACADEMIC_YEAR} ref ${p.reference}`)}</NARRATION>
     <ALLLEDGERENTRIES.LIST><LEDGERNAME>Student Fees Receivable</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${p.amount.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST><LEDGERNAME>${bank}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${p.amount.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>
    </VOUCHER>
   </TALLYMESSAGE>`;
  });
  const body = `<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>
   <REQUESTDATA>
${vouchers.join("\n")}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`;
  return { count: rows.length, xml: body };
}
