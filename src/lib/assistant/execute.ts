import { eq, ilike, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { assistantQueries, batches, programmes, students } from "@/db/schema";
import { addDays, isoDateIST, startOfMonth } from "../dates";
import type { SessionUser } from "../session";
import { studentRows, type StudentRow } from "../students";
import { parseWithLlm } from "./llm";
import { parseWithRules, type ProgrammeRef } from "./rules";
import { compare, describeFilters, QuerySpec } from "./spec";

export interface AssistantAnswer {
  status: "ok" | "unsure";
  engine: "llm" | "rules" | "none";
  filters: string[];
  rowCount: number;
  rows: StudentRow[];
  output: "count" | "list";
  note: string | null;
  truncated: boolean;
}

const ALIASES: Record<string, string[]> = {
  CSE: ["cse", "computer science", "cs", "computer"],
  ME: ["me", "mech", "mechanical"],
  ECE: ["ece", "electronics"],
  EE: ["ee", "electrical"],
  CE: ["civil"],
  MBA: ["mba", "management"],
};

export async function campusProgrammes(db: DB, campusId: number): Promise<ProgrammeRef[]> {
  const rows = await db.select({ code: programmes.code, name: programmes.name }).from(programmes).where(eq(programmes.campusId, campusId));
  return rows.map((r) => {
    const suffix = r.code.split("-").pop()!;
    return { ...r, aliases: [r.code.toLowerCase(), ...(ALIASES[suffix] ?? [suffix.toLowerCase()])] };
  });
}

function periodRange(period: string, today: string): { from?: string; to?: string } | undefined {
  switch (period) {
    case "this_month": return { from: startOfMonth(today), to: today };
    case "last_month": {
      const end = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(end), to: end };
    }
    case "last_7_days": return { from: addDays(today, -6), to: today };
    case "last_30_days": return { from: addDays(today, -29), to: today };
    default: return undefined;
  }
}

/** Run a validated spec. Campus/department scope comes from the session, never from the spec. */
export async function runSpec(db: DB, user: SessionUser, spec: QuerySpec, today = isoDateIST()) {
  const f = spec.filters;
  const where = [];
  if (f.yearOfStudy) where.push(eq(batches.yearOfStudy, f.yearOfStudy));
  if (f.programmeCodes?.length) where.push(inArray(programmes.code, f.programmeCodes));
  if (f.section) where.push(eq(batches.section, f.section));
  if (f.category?.length) where.push(inArray(students.category, f.category));
  if (f.nameContains) where.push(ilike(students.name, `%${f.nameContains.replace(/[%_]/g, "")}%`));
  const range = f.attendance ? periodRange(f.attendance.period, today) : undefined;

  let rows = await studentRows(db, user, { where, attendanceRange: range });
  if (f.attendance) rows = rows.filter((r) => r.attendancePct !== null && compare(f.attendance!.op, r.attendancePct, f.attendance!.value));
  if (f.internalMarks) rows = rows.filter((r) => r.internal40 !== null && compare(f.internalMarks!.op, r.internal40, f.internalMarks!.value));
  if (f.feeDue) rows = rows.filter((r) => compare(f.feeDue!.op, r.feeDue, f.feeDue!.value));
  if (f.atRisk !== undefined) rows = rows.filter((r) => (r.risk !== null) === f.atRisk);

  if (spec.sort) {
    const key = { attendance: "attendancePct", marks: "internal40", fee_due: "feeDue", roll_no: "rollNo" } as const;
    const k = key[spec.sort.field];
    const dir = spec.sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const x = a[k] ?? -1;
      const y = b[k] ?? -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }
  const rowCount = rows.length;
  return { rowCount, rows: rows.slice(0, spec.limit), truncated: rowCount > spec.limit };
}

const WRITE_INTENT = /\b(delete|remove|update|change|set|mark|send|email|sms|insert|drop|modify|edit|approve|lock|unlock|pay)\b/i;

export async function ask(db: DB, user: SessionUser, question: string): Promise<AssistantAnswer> {
  const q = question.trim().slice(0, 300);
  const progs = await campusProgrammes(db, user.campusId);
  const names = Object.fromEntries(progs.map((p) => [p.code, p.name]));
  const today = isoDateIST();

  const log = (spec: QuerySpec | null, engine: AssistantAnswer["engine"], rowCount: number | null) =>
    db.insert(assistantQueries).values({ userId: user.uid, question: q, spec, engine, rowCount });

  if (WRITE_INTENT.test(q) && !/\b(how many|list|show|which|who)\b/i.test(q)) {
    await log(null, "none", null);
    return { status: "unsure", engine: "none", filters: [], rowCount: 0, rows: [], output: "list", truncated: false,
      note: "I can only look things up — I can't change records or send messages. Try asking “which students …” or “how many …”." };
  }

  let engine: AssistantAnswer["engine"] = "llm";
  let spec = await parseWithLlm(q, progs, today);
  if (!spec) {
    engine = "rules";
    spec = parseWithRules(q, progs).spec;
  }
  if (!spec) {
    await log(null, "none", null);
    return { status: "unsure", engine: "none", filters: [], rowCount: 0, rows: [], output: "list", truncated: false,
      note: "I couldn't turn that into a report. Mention year, programme, attendance %, internal marks, fee dues or “at risk”." };
  }
  const result = await runSpec(db, user, spec, today);
  await log(spec, engine, result.rowCount);
  const filters = describeFilters(spec, names);
  const notes = [spec.unsupported, filters.length ? null : "No filters were applied — showing every student you can see."].filter(Boolean);
  return { status: "ok", engine, filters, output: spec.output, note: notes.join(" ") || null, ...result };
}
