import { z } from "zod";

/**
 * The only thing the language model is allowed to produce. It is a whitelist of read-only
 * filters over students — there is no SQL, no table names and no write verbs to hallucinate.
 */
const Op = z.enum(["lt", "lte", "gt", "gte"]);
export const Period = z.enum(["overall", "this_month", "last_month", "last_7_days", "last_30_days"]);

export const QuerySpec = z.object({
  output: z.enum(["count", "list"]).default("list"),
  filters: z
    .object({
      yearOfStudy: z.number().int().min(1).max(5).optional(),
      programmeCodes: z.array(z.string().max(30)).max(10).optional(),
      section: z.string().regex(/^[A-Z]$/).optional(),
      category: z.array(z.enum(["GEN", "OBC", "SC", "ST", "EWS"])).max(5).optional(),
      attendance: z.object({ op: Op, value: z.number().min(0).max(100), period: Period.default("overall") }).optional(),
      internalMarks: z.object({ op: Op, value: z.number().min(0).max(40) }).optional(),
      feeDue: z.object({ op: Op, value: z.number().min(0).max(10_000_000) }).optional(),
      atRisk: z.boolean().optional(),
      nameContains: z.string().max(60).optional(),
    })
    .default({}),
  sort: z
    .object({ field: z.enum(["attendance", "marks", "fee_due", "roll_no"]), dir: z.enum(["asc", "desc"]) })
    .optional(),
  limit: z.number().int().min(1).max(500).default(200),
  /** Parts of the question the model could not express with these filters. */
  unsupported: z.string().max(300).nullable().default(null),
});
export type QuerySpec = z.infer<typeof QuerySpec>;

const opWord = { lt: "below", lte: "at or below", gt: "above", gte: "at or above" } as const;
const periodWord = {
  overall: "overall",
  this_month: "this month",
  last_month: "last month",
  last_7_days: "in the last 7 days",
  last_30_days: "in the last 30 days",
} as const;

/** Human-readable chips so staff can check what was actually run. */
export function describeFilters(spec: QuerySpec, programmeNames: Record<string, string>): string[] {
  const f = spec.filters;
  const out: string[] = [];
  if (f.yearOfStudy) out.push(`Year ${f.yearOfStudy}`);
  if (f.programmeCodes?.length) out.push(f.programmeCodes.map((c) => programmeNames[c] ?? c).join(" or "));
  if (f.section) out.push(`Section ${f.section}`);
  if (f.category?.length) out.push(`Category ${f.category.join("/")}`);
  if (f.attendance) out.push(`Attendance ${opWord[f.attendance.op]} ${f.attendance.value}% ${periodWord[f.attendance.period]}`);
  if (f.internalMarks) out.push(`Internal marks ${opWord[f.internalMarks.op]} ${f.internalMarks.value}/40`);
  if (f.feeDue) out.push(f.feeDue.op === "gt" && f.feeDue.value === 0 ? "Has fee dues" : `Fee due ${opWord[f.feeDue.op]} ₹${f.feeDue.value.toLocaleString("en-IN")}`);
  if (f.atRisk !== undefined) out.push(f.atRisk ? "Flagged at risk" : "Not flagged at risk");
  if (f.nameContains) out.push(`Name contains “${f.nameContains}”`);
  if (spec.sort) out.push(`Sorted by ${spec.sort.field.replace("_", " ")} ${spec.sort.dir === "asc" ? "↑" : "↓"}`);
  return out;
}

export function compare(op: z.infer<typeof Op>, a: number, b: number): boolean {
  switch (op) {
    case "lt": return a < b;
    case "lte": return a <= b;
    case "gt": return a > b;
    case "gte": return a >= b;
  }
}
