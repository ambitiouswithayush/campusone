import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { feeInvoices, messages, students } from "@/db/schema";
import { attendanceByStudent, isShort } from "./attendance";
import { RULES } from "./config";
import { isoDateIST, isoWeek } from "./dates";
import { inr } from "./format";
import { feeReminderMessage, shortageMessage } from "./messages";

/**
 * Queue a shortage alert for each student below the threshold — at most one per student per week.
 * Parents are only messaged when consent is on record (DPDP Act 2023).
 */
export async function runShortageAlerts(db: DB, studentIds: number[], now = new Date()) {
  if (!studentIds.length) return { queued: 0, skipped: 0 };
  const stats = await attendanceByStudent(db, studentIds);
  const short = [...stats.values()].filter((s) => s.held >= 10 && isShort(s.pct));
  if (!short.length) return { queued: 0, skipped: 0 };
  const people = await db.select().from(students).where(inArray(students.id, short.map((s) => s.studentId)));
  const week = isoWeek(isoDateIST(now));
  let queued = 0;
  let skipped = 0;
  for (const p of people) {
    const st = stats.get(p.id)!;
    const status = p.parentConsentAt ? "sent_mock" : "skipped_no_consent";
    const inserted = await db
      .insert(messages)
      .values({
        campusId: p.campusId,
        studentId: p.id,
        kind: "shortage",
        lang: p.guardianLang,
        toPhone: p.guardianPhone,
        body: shortageMessage(p.guardianLang, p.name, st.pct!, RULES.attendanceThreshold),
        status,
        dedupeKey: `shortage:${p.id}:${week}`,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    if (inserted.length) status === "sent_mock" ? queued++ : skipped++;
  }
  return { queued, skipped };
}

/** Weekly reminder for overdue fee balances. */
export async function runFeeReminders(db: DB, campusId: number, now = new Date()) {
  const today = isoDateIST(now);
  const rows = await db
    .select({
      invoice: feeInvoices,
      student: students,
      paid: sql<number>`coalesce((select sum(p.amount) from payments p where p.invoice_id = "fee_invoices"."id" and p.status = 'success'), 0)::int`,
    })
    .from(feeInvoices)
    .innerJoin(students, eq(students.id, feeInvoices.studentId))
    .where(and(eq(students.campusId, campusId), lt(feeInvoices.dueDate, today)));
  const week = isoWeek(today);
  let queued = 0;
  let skipped = 0;
  for (const r of rows) {
    const due = r.invoice.gross - r.invoice.concession - r.paid;
    if (due <= 0) continue;
    const status = r.student.parentConsentAt ? "sent_mock" : "skipped_no_consent";
    const inserted = await db
      .insert(messages)
      .values({
        campusId,
        studentId: r.student.id,
        kind: "fee_reminder",
        lang: r.student.guardianLang,
        toPhone: r.student.guardianPhone,
        body: feeReminderMessage(r.student.guardianLang, r.student.name, inr(due), r.invoice.dueDate),
        status,
        dedupeKey: `fee:${r.invoice.id}:${week}`,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    if (inserted.length) status === "sent_mock" ? queued++ : skipped++;
  }
  return { queued, skipped };
}
