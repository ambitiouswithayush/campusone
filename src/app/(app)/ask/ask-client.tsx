"use client";
import clsx from "clsx";
import { ArrowUp, Filter, Info, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { AttendanceBar, Badge, Card, EmptyState, Notice, RiskBadge, Skeleton } from "@/components/ui";
import type { AssistantAnswer } from "@/lib/assistant/execute";
import { inr } from "@/lib/format";

const EXAMPLES = [
  "How many second-year students are below 75% this month?",
  "B.Tech CSE students with fee dues above 20000",
  "Which students are at risk with internal marks below 20?",
  "First year students with attendance under 80% in the last 30 days",
];

export function AskClient({ recent, llm }: { recent: string[]; llm: boolean }) {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const submit = async (question: string) => {
    const text = question.trim();
    if (text.length < 3 || loading) return;
    setLoading(true);
    setError(null);
    setAsked(text);
    try {
      const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed");
      setAnswer(body);
    } catch (e) {
      setAnswer(null);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
        className="relative"
      >
        <textarea
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(q);
            }
          }}
          rows={2}
          maxLength={300}
          placeholder="e.g. How many second-year students are below 75% this month?"
          className="w-full resize-none rounded-xl border border-line-strong bg-surface px-4 py-3 pr-14 text-[15px] shadow-sm focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/10"
        />
        <button type="submit" disabled={loading || q.trim().length < 3} aria-label="Ask" className="absolute bottom-3 right-3 flex size-9 items-center justify-center rounded-lg bg-accent text-white disabled:bg-line-strong">
          <ArrowUp size={18} />
        </button>
      </form>

      {!answer && !loading && !error && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Try</p>
          <div className="flex flex-wrap gap-2">
            {[...recent, ...EXAMPLES.filter((e) => !recent.includes(e))].slice(0, 6).map((e) => (
              <button key={e} onClick={() => { setQ(e); submit(e); }} className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-sm text-ink-2 hover:border-line-strong hover:text-ink">
                {e}
              </button>
            ))}
          </div>
          <p className="mt-5 flex items-start gap-2 text-xs text-ink-3">
            <ShieldCheck size={14} className="mt-px shrink-0" />
            {llm
              ? "Your question is turned into a fixed set of filters by an AI model. Only the question is sent — never student data. Results are limited to your campus."
              : "AI model not configured — questions are understood by the built-in rule parser. Results are limited to your campus."}
          </p>
        </div>
      )}

      {loading && (
        <Card className="space-y-3 p-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-8 w-1/4" />
          <Skeleton className="h-24 w-full" />
        </Card>
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      {answer && !loading && (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <p className="text-sm text-ink-2">“{asked}”</p>
            {answer.status === "unsure" ? (
              <div className="mt-3 flex gap-2 text-sm text-warn"><Info size={16} className="mt-0.5 shrink-0" />{answer.note}</div>
            ) : (
              <>
                <p className="mt-2 text-3xl font-semibold tabular tracking-tight">
                  {answer.rowCount} <span className="text-base font-normal text-ink-2">student{answer.rowCount === 1 ? "" : "s"}</span>
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 flex items-center gap-1 text-xs text-ink-3"><Filter size={12} /> Filters used</span>
                  {answer.filters.map((f) => <Badge key={f} tone="accent">{f}</Badge>)}
                  <Badge>Campus scope</Badge>
                </div>
                <p className="mt-2 text-xs text-ink-3">
                  Understood by {answer.engine === "llm" ? "AI model (validated)" : "rule parser"} · check the filters — if they don&apos;t match your question, rephrase it.
                </p>
                {answer.note && <Notice tone="warn" className="mt-3">{answer.note}</Notice>}
              </>
            )}
          </div>
          {answer.status === "ok" && answer.output === "list" && answer.rows.length > 0 && <ResultTable rows={answer.rows} />}
          {answer.status === "ok" && answer.output === "count" && answer.rows.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer px-5 py-3 text-sm text-accent">Show the {answer.rowCount} students</summary>
              <ResultTable rows={answer.rows} />
            </details>
          )}
          {answer.status === "ok" && answer.rowCount === 0 && <EmptyState title="No students match these filters" body="That may be the right answer — or try loosening a filter." />}
          {answer.truncated && <p className="border-t border-line px-5 py-2.5 text-xs text-ink-3">Showing the first {answer.rows.length}.</p>}
        </Card>
      )}
      {(answer || error) && !loading && (
        <button onClick={() => { setAnswer(null); setError(null); setQ(""); input.current?.focus(); }} className="text-sm text-ink-3 hover:text-ink">
          ← New question
        </button>
      )}
    </div>
  );
}

function ResultTable({ rows }: { rows: AssistantAnswer["rows"] }) {
  return (
    <div className="max-h-[480px] overflow-auto">
      <table className="table-base">
        <thead className="sticky top-0">
          <tr><th>Student</th><th>Batch</th><th>Attendance</th><th className="text-right">Internal</th><th className="text-right">Fee due</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/students/${r.id}`} className="font-medium hover:text-accent">{r.name}</Link><p className="text-xs text-ink-3 tabular">{r.rollNo}</p></td>
              <td className="whitespace-nowrap text-ink-2">{r.programmeName} {r.yearOfStudy}-{r.section}</td>
              <td><AttendanceBar pct={r.attendancePct} /></td>
              <td className="text-right tabular">{r.internal40 ?? "—"}</td>
              <td className={clsx("text-right tabular", !r.feeDue && "text-ink-3")}>{r.feeDue ? inr(r.feeDue) : "—"}</td>
              <td className="text-right"><RiskBadge level={r.risk} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
