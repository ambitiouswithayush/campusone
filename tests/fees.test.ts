import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { auditLog, students } from "@/db/schema";
import { balance, completeMockPayment, concessionFor, createPaymentLink, invoicesForStudents, recordCounterPayment, tallyXml } from "@/lib/fees";
import type { SessionUser } from "@/lib/session";
import { sessionFor, testDb } from "./helpers";

describe("fee arithmetic", () => {
  it("never shows a negative balance or a concession above the fee", () => {
    expect(balance(140000, 0, 95000)).toBe(45000);
    expect(balance(140000, 25000, 200000)).toBe(0);
    expect(concessionFor(35000, [90000])).toBe(35000);
    expect(concessionFor(140000, [25000, 10000])).toBe(35000);
  });
});

describe("payments", () => {
  let db: DB;
  let admin: SessionUser;
  let mgt: SessionUser;
  let invoiceId: number;
  beforeAll(async () => {
    db = await testDb();
    admin = await sessionFor(db, "admin@campusone.test");
    mgt = await sessionFor(db, "mgt.admin@campusone.test");
    const [ankit] = await db.select().from(students).where(eq(students.rollNo, "ENG-24-ME-0177"));
    [{ id: invoiceId }] = await invoicesForStudents(db, [ankit.id]);
  });

  it("validates counter payments and rejects reused bank references", async () => {
    await expect(recordCounterPayment(db, admin, invoiceId, 50000, "SBIN26999999")).rejects.toThrow(/exceeds/);
    await expect(recordCounterPayment(db, admin, invoiceId, 5000, "x")).rejects.toThrow(/reference/);
    await expect(recordCounterPayment(db, mgt, invoiceId, 5000, "SBIN26999999")).rejects.toThrow(/not found/);
    const p = await recordCounterPayment(db, admin, invoiceId, 5000, "sbin26999999");
    expect(p.receiptNo).toMatch(/^RCPT\/2026-27\/\d{6}$/);
    await expect(recordCounterPayment(db, admin, invoiceId, 5000, "SBIN26999999")).rejects.toThrow(/already recorded/);
  });

  it("makes the test-mode callback idempotent and safe against double payment", async () => {
    const link = await createPaymentLink(db, admin, invoiceId); // ₹40,000 left
    const second = await createPaymentLink(db, admin, invoiceId);
    const ok = await completeMockPayment(db, link.id, "success");
    expect(ok.status).toBe("success");
    const replay = await completeMockPayment(db, link.id, "success");
    expect(replay.receiptNo).toBe(ok.receiptNo);
    // The balance is now nil, so the second link must not take money.
    const dup = await completeMockPayment(db, second.id, "success");
    expect(dup.status).toBe("failed");
    const [inv] = await invoicesForStudents(db, [ok.studentId]);
    expect(inv.due).toBe(0);
    await expect(createPaymentLink(db, admin, invoiceId)).rejects.toThrow(/Nothing is due/);
    // One audit entry per gateway outcome; the replay adds nothing.
    const logged = await db.select().from(auditLog).where(and(eq(auditLog.entity, "payment"), inArray(auditLog.entityId, [link.id, second.id])));
    expect(logged.map((a) => a.action).sort()).toEqual(["gateway_payment", "gateway_rejected_balance_changed"]);
  });

  it("exports receipts as Tally vouchers for the campus only", async () => {
    const { xml, count } = await tallyXml(db, admin, "2000-01-01", "2100-01-01");
    expect(count).toBeGreaterThan(0);
    expect(xml).toContain('<VOUCHER VCHTYPE="Receipt" ACTION="Create">');
    expect(xml).not.toContain("MBA-25-");
  });
});
