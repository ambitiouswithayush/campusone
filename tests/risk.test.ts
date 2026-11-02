import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { riskFlags, students } from "@/db/schema";
import { runRiskScan, scoreStudent, type RiskFeatures } from "@/lib/risk";
import { testDb } from "./helpers";

const base: RiskFeatures = { attendancePct: 90, sessionsHeld: 200, attendanceTrend: 0, marksPct: 80, componentsGraded: 24, marksTrend: 0, failingSubjects: 0 };

describe("at-risk score", () => {
  it("does not flag a healthy student", () => {
    const r = scoreStudent(base);
    expect(r.level).toBe("low");
    expect(r.reasons).toHaveLength(0);
  });

  it("flags the brief's Ankit Panda profile as high with readable reasons", () => {
    const r = scoreStudent({ ...base, attendancePct: 68.2, attendanceTrend: -30, marksPct: 52.5, marksTrend: -18 });
    expect(r.level).toBe("high");
    expect(r.reasons.join(" ")).toMatch(/68.2% is below the 75% minimum/);
    expect(r.reasons.join(" ")).toMatch(/fell 30 points/);
  });

  it("refuses to judge with too little data instead of guessing", () => {
    const r = scoreStudent({ ...base, attendancePct: 40, sessionsHeld: 6, marksPct: null, componentsGraded: 0 });
    expect(r.level).toBe("insufficient");
  });

  it("says when a judgement rests on one signal only", () => {
    const r = scoreStudent({ ...base, attendancePct: 55, marksPct: null, componentsGraded: 0 });
    expect(r.confidence).toBe("partial");
    expect(r.reasons.at(-1)).toMatch(/attendance only/);
  });
});

describe("risk scan", () => {
  let db: DB;
  beforeAll(async () => {
    db = await testDb();
  });

  it("creates mentor tasks, refreshes rather than duplicates, and respects a dismissal", async () => {
    const [eng] = await db.select({ campusId: students.campusId }).from(students).limit(1);
    const before = await db.select().from(riskFlags);
    expect(before.length).toBeGreaterThan(0);
    const again = await runRiskScan(db, eng.campusId);
    expect(again.created).toBe(0);

    const target = before.find((f) => f.status === "open")!;
    await db.update(riskFlags).set({ status: "dismissed", closedAt: new Date(), note: "Medical leave, documented" }).where(eq(riskFlags.id, target.id));
    const after = await runRiskScan(db, eng.campusId);
    expect(after.suppressed).toBeGreaterThanOrEqual(1);
    const open = await db.select().from(riskFlags).where(eq(riskFlags.studentId, target.studentId));
    expect(open.filter((f) => f.status === "open")).toHaveLength(0);
  });
});
