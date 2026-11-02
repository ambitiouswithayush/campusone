import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { students } from "@/db/schema";
import { runFeeReminders, runShortageAlerts } from "./automations";
import { runRiskScan } from "./risk";

/** The nightly job: shortage alerts, fee reminders and the risk scan for one campus. */
export async function runDailyJobs(db: DB, campusId: number) {
  const ids = (await db.select({ id: students.id }).from(students).where(eq(students.campusId, campusId))).map((s) => s.id);
  const shortage = await runShortageAlerts(db, ids);
  const fees = await runFeeReminders(db, campusId);
  const risk = await runRiskScan(db, campusId);
  return { shortage, fees, risk };
}
