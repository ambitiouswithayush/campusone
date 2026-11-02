import type { QuerySpec } from "./spec";

export interface ProgrammeRef {
  code: string;
  name: string;
  aliases: string[];
}

/**
 * Deterministic fallback when the language model is unavailable or returns something invalid.
 * Handles the common question shapes; anything it cannot map is reported, not guessed.
 */
export function parseWithRules(question: string, programmes: ProgrammeRef[]): { spec: QuerySpec | null; matched: string[] } {
  // Keep thousands separators and decimals ("20,000", "72.5") intact; drop other punctuation.
  const q = ` ${question
    .toLowerCase()
    .replace(/(\d),(?=\d{2,3}\b)/g, "$1")
    .replace(/(?<!\d)[.,]|[.,](?!\d)|[?!]/g, " ")
    .replace(/\s+/g, " ")} `;
  const matched: string[] = [];
  const filters: QuerySpec["filters"] = {};

  const years: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, final: 4 };
  const y = q.match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|final)[- ]years?\b/) ?? q.match(/\byear (\d)\b/);
  if (y) {
    filters.yearOfStudy = years[y[1]] ?? Number(y[1]);
    matched.push(y[0].trim());
  }

  const progs = programmes.filter((p) => p.aliases.some((a) => new RegExp(`\\b${a}\\b`).test(q)));
  if (progs.length) {
    filters.programmeCodes = progs.map((p) => p.code);
    matched.push(progs.map((p) => p.name).join(", "));
  }

  const sec = q.match(/\bsection ([a-d])\b/);
  if (sec) {
    filters.section = sec[1].toUpperCase();
    matched.push(sec[0].trim());
  }

  const cats = [...q.matchAll(/\b(sc|st|obc|ews|general)\b/g)].map((m) => (m[1] === "general" ? "GEN" : m[1].toUpperCase()));
  if (cats.length) filters.category = [...new Set(cats)] as QuerySpec["filters"]["category"];

  const cmp = (word: string) => (/(below|under|less than|lower than|<)/.test(word) ? "lt" : "gt");
  const num = "(below|under|less than|lower than|above|over|more than|greater than|<|>)\\s*(?:rs\\.?|₹)?\\s*(\\d[\\d,]*(?:\\.\\d+)?)";

  const marksM = q.match(new RegExp(`(?:marks?|internals?|internal marks?)\\s*(?:of\\s*)?${num}`)) ?? q.match(new RegExp(`${num}\\s*(?:/\\s*40\\s*)?(?:marks|in internals)`));
  if (marksM) {
    filters.internalMarks = { op: cmp(marksM[1]), value: Number(marksM[2].replace(/,/g, "")) };
    matched.push(marksM[0].trim());
  }

  const feeM = q.match(new RegExp(`(?:dues?|fees?|balance)\\s*(?:due\\s*)?${num}`));
  if (feeM) {
    filters.feeDue = { op: cmp(feeM[1]), value: Number(feeM[2].replace(/,/g, "")) };
    matched.push(feeM[0].trim());
  } else if (/\b(dues|fee due|fees due|fee pending|fees pending|unpaid|outstanding|owe|defaulters?)\b/.test(q)) {
    filters.feeDue = { op: "gt", value: 0 };
    matched.push("fee dues");
  }

  const attM =
    q.match(new RegExp(`attendance\\s*(?:is\\s*|of\\s*)?${num}\\s*%?`)) ??
    q.match(new RegExp(`${num}\\s*%\\s*(?:attendance)?`)) ??
    (q.includes("shortage") ? ["shortage", "below", "75"] : null);
  if (attM && !(marksM && attM.index === marksM.index)) {
    let period: NonNullable<QuerySpec["filters"]["attendance"]>["period"] = "overall";
    if (/this month/.test(q)) period = "this_month";
    else if (/last month/.test(q)) period = "last_month";
    else if (/last (7 days|week)|this week/.test(q)) period = "last_7_days";
    else if (/last 30 days/.test(q)) period = "last_30_days";
    filters.attendance = { op: cmp(attM[1]), value: Number(String(attM[2]).replace(/,/g, "")), period };
    matched.push(String(attM[0]).trim());
  }

  if (/\bat[- ]?risk\b/.test(q)) {
    filters.atRisk = !/\bnot at[- ]?risk\b/.test(q);
    matched.push("at risk");
  }

  if (!Object.keys(filters).length && !/\b(all|every|list|students)\b/.test(q)) return { spec: null, matched };

  const output = /\b(how many|count|number of|total)\b/.test(q) ? "count" : "list";
  let sort: QuerySpec["sort"];
  if (/\b(lowest|worst|least) attendance\b/.test(q)) sort = { field: "attendance", dir: "asc" };
  else if (/\b(highest|most|top) (dues?|fees?)\b/.test(q)) sort = { field: "fee_due", dir: "desc" };
  else if (/\b(lowest|worst) marks\b/.test(q)) sort = { field: "marks", dir: "asc" };
  else if (filters.attendance) sort = { field: "attendance", dir: "asc" };

  return { spec: { output, filters, sort, limit: 200, unsupported: null }, matched };
}
