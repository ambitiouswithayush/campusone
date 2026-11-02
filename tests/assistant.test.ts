import { inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { students } from "@/db/schema";
import { ask, campusProgrammes, runSpec } from "@/lib/assistant/execute";
import { parseWithRules } from "@/lib/assistant/rules";
import { QuerySpec } from "@/lib/assistant/spec";
import { attendanceByStudent } from "@/lib/attendance";
import { duesByStudent } from "@/lib/fees";
import type { SessionUser } from "@/lib/session";
import { marksByStudent } from "@/lib/students";
import { sessionFor, testDb } from "./helpers";

const PROGS = [
  { code: "BTECH-CSE", name: "B.Tech CSE", aliases: ["btech-cse", "cse", "computer science", "cs", "computer"] },
  { code: "BTECH-ME", name: "B.Tech Mechanical", aliases: ["btech-me", "me", "mech", "mechanical"] },
];

describe("rule parser", () => {
  it("understands the brief's example question", () => {
    const { spec } = parseWithRules("How many second-year students are below 75% this month?", PROGS);
    expect(spec?.output).toBe("count");
    expect(spec?.filters.yearOfStudy).toBe(2);
    expect(spec?.filters.attendance).toEqual({ op: "lt", value: 75, period: "this_month" });
  });

  it("combines programme, marks and dues", () => {
    const { spec } = parseWithRules("mechanical students with internal marks below 20 and fees due above 20,000", PROGS);
    expect(spec?.filters.programmeCodes).toEqual(["BTECH-ME"]);
    expect(spec?.filters.internalMarks).toEqual({ op: "lt", value: 20 });
    expect(spec?.filters.feeDue).toEqual({ op: "gt", value: 20000 });
    expect(spec?.filters.attendance).toBeUndefined();
  });

  it("keeps decimals and Indian-style thousands", () => {
    expect(parseWithRules("attendance below 72.5%", PROGS).spec?.filters.attendance?.value).toBe(72.5);
    expect(parseWithRules("dues above 1,40,000", PROGS).spec?.filters.feeDue?.value).toBe(140000);
  });

  it("admits when it does not understand", () => {
    expect(parseWithRules("what is the weather tomorrow", PROGS).spec).toBeNull();
  });
});

describe("query spec validation", () => {
  it("rejects anything outside the whitelist", () => {
    expect(QuerySpec.safeParse({ filters: { sql: "drop table students" } }).success).toBe(true); // unknown keys are stripped…
    expect(QuerySpec.parse({ filters: { sql: "drop table students" } }).filters).toEqual({}); // …and never reach the query
    expect(QuerySpec.safeParse({ filters: { attendance: { op: "eq", value: 75 } } }).success).toBe(false);
    expect(QuerySpec.safeParse({ filters: { internalMarks: { op: "lt", value: 400 } } }).success).toBe(false);
  });
});

describe("assistant on data", () => {
  let db: DB;
  let admin: SessionUser;
  let mgt: SessionUser;
  beforeAll(async () => {
    db = await testDb();
    admin = await sessionFor(db, "admin@campusone.test");
    mgt = await sessionFor(db, "mgt.admin@campusone.test");
    delete process.env.GEMINI_API_KEY;
  });

  it("matches the brief's sample students exactly", async () => {
    const rows = await db.select().from(students).where(inArray(students.rollNo, ["ENG-24-CSE-0412", "ENG-24-ME-0177", "MBA-25-0093"]));
    const ids = rows.map((r) => r.id);
    const [att, mk, dues] = await Promise.all([attendanceByStudent(db, ids), marksByStudent(db, ids), duesByStudent(db, ids)]);
    const get = (roll: string) => {
      const s = rows.find((r) => r.rollNo === roll)!;
      return [att.get(s.id)?.pct, mk.get(s.id), dues.get(s.id)];
    };
    expect(get("ENG-24-CSE-0412")).toEqual([81.5, 33, 0]);
    expect(get("ENG-24-ME-0177")).toEqual([68.2, 21, 45000]);
    expect(get("MBA-25-0093")).toEqual([92, 36, 0]);
  });

  it("never returns students from another campus, whatever the filters say", async () => {
    const everyone = QuerySpec.parse({ filters: {} });
    const eng = await runSpec(db, admin, everyone);
    const man = await runSpec(db, mgt, everyone);
    expect(eng.rows.every((r) => r.rollNo.startsWith("ENG-"))).toBe(true);
    expect(man.rows.every((r) => r.rollNo.startsWith("MBA-"))).toBe(true);
    const mba = await runSpec(db, admin, QuerySpec.parse({ filters: { programmeCodes: ["MBA"] } }));
    expect(mba.rowCount).toBe(0);
  });

  it("answers with filters and a row count, and refuses write requests", async () => {
    const a = await ask(db, admin, "students below 75% attendance");
    expect(a.status).toBe("ok");
    expect(a.engine).toBe("rules");
    expect(a.filters).toContain("Attendance below 75% overall");
    expect(a.rows.every((r) => (r.attendancePct ?? 100) < 75)).toBe(true);
    const w = await ask(db, admin, "delete all students with dues");
    expect(w.status).toBe("unsure");
    expect(w.note).toMatch(/only look things up/);
  });

  it("lists campus programmes for the model prompt", async () => {
    const progs = await campusProgrammes(db, admin.campusId);
    expect(progs.map((p) => p.code).sort()).toEqual(["BTECH-CSE", "BTECH-ME"]);
  });
});
