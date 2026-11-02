import { QuerySpec } from "./spec";
import type { ProgrammeRef } from "./rules";

/**
 * Translate a question into a QuerySpec with Gemini. Only the question and the programme list
 * are sent — never student data (DPDP Act 2023). Returns null on any failure so the caller can
 * fall back to the rule parser.
 */
export async function parseWithLlm(question: string, programmes: ProgrammeRef[], today: string): Promise<QuerySpec | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const system = `You convert a college office staff member's question into a JSON filter for a read-only student report.
Today is ${today}. Programmes on this campus: ${programmes.map((p) => `${p.code} = ${p.name}`).join("; ")}.
Return ONLY JSON with this shape (omit filters you do not need):
{"output":"count"|"list",
 "filters":{"yearOfStudy":1-5,"programmeCodes":["CODE"],"section":"A","category":["GEN"|"OBC"|"SC"|"ST"|"EWS"],
   "attendance":{"op":"lt"|"lte"|"gt"|"gte","value":0-100,"period":"overall"|"this_month"|"last_month"|"last_7_days"|"last_30_days"},
   "internalMarks":{"op":"lt"|"lte"|"gt"|"gte","value":0-40},
   "feeDue":{"op":"lt"|"lte"|"gt"|"gte","value":rupees},
   "atRisk":true|false,"nameContains":"text"},
 "sort":{"field":"attendance"|"marks"|"fee_due"|"roll_no","dir":"asc"|"desc"},
 "limit":1-500,
 "unsupported": null or a short note naming any part of the question these filters cannot express}
Rules: "how many" means output "count". "Has dues" means feeDue {"op":"gt","value":0}. "Shortage" means attendance below 75.
Internal marks are out of 40. Never invent programme codes. If the question asks to change, delete or send anything, set unsupported to explain that the assistant is read-only.`;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: question }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn("assistant llm http", res.status);
      return null;
    }
    const data = await res.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    const parsed = QuerySpec.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    const known = new Set(programmes.map((p) => p.code));
    const codes = parsed.data.filters.programmeCodes;
    if (codes?.some((c) => !known.has(c))) {
      parsed.data.filters.programmeCodes = codes.filter((c) => known.has(c));
      parsed.data.unsupported = [parsed.data.unsupported, "Ignored an unknown programme."].filter(Boolean).join(" ");
    }
    return parsed.data;
  } catch (e) {
    console.warn("assistant llm failed", e instanceof Error ? e.message : e);
    return null;
  }
}
