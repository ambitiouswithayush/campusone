"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db";
import { messages, students } from "@/db/schema";
import { act, UserError } from "@/lib/action";
import { requireUser } from "@/lib/auth";
import { isoDateIST, isoWeek } from "@/lib/dates";
import { createPaymentLink, invoicesForStudents, recordCounterPayment } from "@/lib/fees";
import { inr } from "@/lib/format";
import { feeReminderMessage } from "@/lib/messages";

const Id = z.number().int().positive();

export async function recordPaymentAction(invoiceId: number, amount: number, bankRef: string) {
  return act(async () => {
    const user = await requireUser("office_admin");
    const p = await recordCounterPayment(await getDb(), user, Id.parse(invoiceId), z.number().int().positive("Enter an amount.").parse(amount), z.string().max(40).parse(bankRef));
    revalidatePath("/fees");
    return { paymentId: p.id, receiptNo: p.receiptNo };
  });
}

export async function createLinkAction(invoiceId: number) {
  return act(async () => {
    const user = await requireUser("office_admin");
    const p = await createPaymentLink(await getDb(), user, Id.parse(invoiceId));
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    return { url: `${origin}/pay/${p.id}`, amount: p.amount };
  });
}

export async function remindAction(studentId: number) {
  return act(async () => {
    const user = await requireUser("office_admin");
    const db = await getDb();
    const [s] = await db.select().from(students).where(and(eq(students.id, Id.parse(studentId)), eq(students.campusId, user.campusId)));
    if (!s) throw new UserError("Student not found.");
    const [inv] = await invoicesForStudents(db, [s.id]);
    if (!inv || inv.due <= 0) throw new UserError("Nothing is due.");
    if (!s.parentConsentAt) throw new UserError("Parental consent is not on record, so no message can be sent.");
    const inserted = await db
      .insert(messages)
      .values({
        campusId: user.campusId,
        studentId: s.id,
        kind: "fee_reminder",
        lang: s.guardianLang,
        toPhone: s.guardianPhone,
        body: feeReminderMessage(s.guardianLang, s.name, inr(inv.due), inv.dueDate),
        status: "sent_mock",
        dedupeKey: `fee:${inv.id}:${isoWeek(isoDateIST())}`,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) throw new UserError("A reminder already went to this parent this week.");
    return { lang: s.guardianLang };
  }, "Reminder sent (mock SMS).");
}
