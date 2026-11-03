"use client";
import clsx from "clsx";
import { Download, History, Lock, Send, Undo2, Unlock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardHeader, Notice, Spinner, buttonClass } from "@/components/ui";
import { canEdit, internalTotal, type SheetStatus } from "@/lib/marks-calc";
import type { Role } from "@/lib/session";
import { lockSheetAction, returnSheetAction, saveMarksAction, submitSheetAction, unlockSheetAction } from "../actions";

interface Comp { id: number; code: string; name: string; maxMarks: number }
interface Student { id: number; rollNo: string; name: string }
interface Value { studentId: number; componentId: number; score: number | null; absent: boolean }
interface HistoryItem { id: number; action: string; reason: string | null; actor: string; at: string; changes: number }

const key = (s: number, c: number) => `${s}:${c}`;
const fmt = (v?: Value) => (!v ? "" : v.absent ? "AB" : v.score === null ? "" : String(v.score));

/** Parse a typed cell: blank, AB (or "a"), or a number in half-mark steps within the maximum. */
function parseCell(raw: string, max: number): { score: number | null; absent: boolean } | { error: string } {
  const t = raw.trim().toUpperCase();
  if (t === "") return { score: null, absent: false };
  if (t === "AB" || t === "A") return { score: null, absent: true };
  const n = Number(t);
  if (!Number.isFinite(n)) return { error: "Number or AB" };
  if (n < 0 || n > max) return { error: `0–${max}` };
  if (Math.round(n * 2) !== n * 2) return { error: "Use .5 steps" };
  return { score: n, absent: false };
}

export function MarksGrid(props: {
  assignmentId: number;
  role: Role;
  status: SheetStatus;
  components: Comp[];
  roster: Student[];
  values: Value[];
  lockedAt: string | null;
  history: HistoryItem[];
}) {
  const { assignmentId, role, status, components, roster } = props;
  const router = useRouter();
  const { toast, node } = useToast();
  const [pending, start] = useTransition();
  const initial = useMemo(() => new Map(props.values.map((v) => [key(v.studentId, v.componentId), fmt(v)])), [props.values]);
  const [cells, setCells] = useState<Map<string, string>>(initial);
  const [dialog, setDialog] = useState<null | "submit" | "lock" | "return" | "unlock">(null);
  const [reason, setReason] = useState("");
  const editable = canEdit(status, role);

  useEffect(() => setCells(initial), [initial]);

  const parsed = useMemo(() => {
    const out = new Map<string, ReturnType<typeof parseCell>>();
    for (const s of roster) for (const c of components) out.set(key(s.id, c.id), parseCell(cells.get(key(s.id, c.id)) ?? "", c.maxMarks));
    return out;
  }, [cells, roster, components]);
  const dirty = [...cells.entries()].filter(([k, v]) => (initial.get(k) ?? "") !== v.trim().toUpperCase().replace(/^A$/, "AB"));
  const invalid = [...parsed.values()].filter((p) => "error" in p).length;
  const empty = [...parsed.values()].filter((p) => !("error" in p) && p.score === null && !p.absent).length;

  // Warn before leaving with unsaved marks.
  useEffect(() => {
    if (!dirty.length) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty.length]);

  const save = () =>
    new Promise<boolean>((resolve) => {
      if (invalid) {
        toast(`Fix ${invalid} highlighted cell${invalid > 1 ? "s" : ""} first.`, "error");
        return resolve(false);
      }
      const entries = dirty.map(([k]) => {
        const [studentId, componentId] = k.split(":").map(Number);
        const p = parsed.get(k) as { score: number | null; absent: boolean };
        return { studentId, componentId, score: p.score, absent: p.absent };
      });
      start(async () => {
        const r = await saveMarksAction(assignmentId, entries);
        if (r.ok) {
          toast(`Saved ${r.data?.changed ?? entries.length} change${entries.length === 1 ? "" : "s"}`);
          router.refresh();
          resolve(true);
        } else {
          toast(r.error, "error");
          resolve(false);
        }
      });
    });

  // Cmd/Ctrl+S saves.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (editable && dirty.length) save();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(r.message ?? "Done");
        setDialog(null);
        setReason("");
        router.refresh();
      } else toast(r.error ?? "Failed", "error");
    });

  const move = (row: number, col: number) => {
    const el = document.querySelector<HTMLInputElement>(`[data-cell="${row}:${col}"]`);
    el?.focus();
    el?.select();
  };

  const statusBadge =
    status === "locked" ? <Badge tone="ok"><Lock size={11} /> Locked</Badge> : status === "submitted" ? <Badge tone="warn">Awaiting moderation</Badge> : <Badge>Draft</Badge>;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {statusBadge}
        <span className="text-xs text-ink-3">
          {roster.length} students · {components.map((c) => `${c.name} ${c.maxMarks}`).join(" · ")} · internal out of 40
        </span>
      </div>

      {status === "locked" && (
        <Notice tone="ok" className="mb-4">
          Locked after moderation{props.lockedAt ? ` on ${new Date(props.lockedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}` : ""}. No one can change these marks without unlocking with a recorded reason.
        </Notice>
      )}
      {status === "submitted" && role === "faculty" && <Notice className="mb-4">Submitted. The exam cell is moderating — they can return it to you if changes are needed.</Notice>}
      {status === "draft" && role === "office_admin" && <Notice className="mb-4">The teacher is still entering marks. You can moderate once they submit.</Notice>}
      {status === "submitted" && role === "office_admin" && <Notice tone="warn" className="mb-4">Moderation: adjustments you make are logged against your name. Lock when final.</Notice>}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-canvas">Student</th>
                {components.map((c) => (
                  <th key={c.id} className="text-center">
                    {c.code}
                    <span className="block text-[10px] font-normal normal-case tracking-normal">/{c.maxMarks}</span>
                  </th>
                ))}
                <th className="text-right">Total<span className="block text-[10px] font-normal normal-case tracking-normal">/40</span></th>
              </tr>
            </thead>
            <tbody>
              {roster.map((s, row) => {
                const entries = components.map((c) => {
                  const p = parsed.get(key(s.id, c.id))!;
                  return "error" in p ? { score: null, absent: false, maxMarks: c.maxMarks } : { ...p, maxMarks: c.maxMarks };
                });
                const total = internalTotal(entries);
                return (
                  <tr key={s.id}>
                    <td className="sticky left-0 z-10 bg-surface py-2">
                      <p className="whitespace-nowrap text-sm font-medium tabular">{s.rollNo}</p>
                      <p className="max-w-[140px] truncate text-xs text-ink-3 sm:max-w-none">{s.name}</p>
                    </td>
                    {components.map((c, col) => {
                      const k = key(s.id, c.id);
                      const p = parsed.get(k)!;
                      const err = "error" in p ? p.error : null;
                      const changed = (initial.get(k) ?? "") !== (cells.get(k) ?? "").trim().toUpperCase().replace(/^A$/, "AB");
                      return (
                        <td key={c.id} className="px-1.5 py-1.5 text-center">
                          <input
                            data-cell={`${row}:${col}`}
                            value={cells.get(k) ?? ""}
                            disabled={!editable}
                            inputMode="decimal"
                            aria-label={`${s.rollNo} ${c.name}`}
                            title={err ?? undefined}
                            onChange={(e) => setCells((m) => new Map(m).set(k, e.target.value))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); move(row + 1, col); }
                              if (e.key === "ArrowUp") { e.preventDefault(); move(row - 1, col); }
                            }}
                            className={clsx(
                              "h-9 w-14 rounded-md border text-center text-sm tabular focus:outline-none focus:ring-2",
                              err ? "border-danger bg-danger-soft text-danger focus:ring-danger/20" : changed ? "border-accent bg-accent-soft focus:ring-accent/20" : "border-line bg-surface focus:border-accent focus:ring-accent/15",
                              !editable && "border-transparent bg-transparent text-ink",
                              (cells.get(k) ?? "").toUpperCase() === "AB" && !err && "text-warn",
                            )}
                          />
                        </td>
                      );
                    })}
                    <td className={clsx("text-right font-semibold tabular", total !== null && total < 16 && "text-danger")}>{total ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-2 text-xs text-ink-3">Type a mark, <b>AB</b> for absent. Enter moves down. {editable && "⌘/Ctrl+S saves."}</p>

      {/* Action bar */}
      <div className="sticky bottom-[64px] z-20 mt-4 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line bg-surface/95 p-3 backdrop-blur lg:bottom-4">
        <span className="mr-auto text-xs text-ink-3">
          {invalid ? <span className="text-danger">{invalid} invalid</span> : dirty.length ? `${dirty.length} unsaved change${dirty.length > 1 ? "s" : ""}` : editable ? `${empty} empty` : "Read only"}
        </span>
        {editable && (
          <Button variant={role === "faculty" ? "secondary" : "primary"} onClick={save} disabled={pending || !dirty.length}>
            {pending && <Spinner />} Save{role === "office_admin" ? " moderation" : ""}
          </Button>
        )}
        {role === "faculty" && status === "draft" && (
          <Button variant="primary" onClick={() => setDialog("submit")} disabled={pending || dirty.length > 0 || empty > 0} title={empty ? "Fill every cell (or AB) first" : undefined}>
            <Send size={15} /> Submit for moderation
          </Button>
        )}
        {role === "office_admin" && status === "submitted" && (
          <>
            <Button onClick={() => setDialog("return")} disabled={pending}><Undo2 size={15} /> Return</Button>
            <Button variant="primary" onClick={() => setDialog("lock")} disabled={pending || dirty.length > 0}><Lock size={15} /> Lock</Button>
          </>
        )}
        {status === "locked" && (
          <a href={`/api/marks/${assignmentId}/export`} className={buttonClass("primary")}>
            <Download size={15} /> University CSV
          </a>
        )}
        {role === "office_admin" && status === "locked" && (
          <Button onClick={() => setDialog("unlock")} disabled={pending}><Unlock size={15} /> Unlock</Button>
        )}
      </div>

      <Card className="mt-6">
        <CardHeader title={<span className="flex items-center gap-2"><History size={15} /> Change history</span>} subtitle="Every edit, submission, lock and unlock — for exam audits." />
        {props.history.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-3">No changes recorded yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {props.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5 text-sm">
                <span className="font-medium">{describe(h)}</span>
                <span className="text-ink-3">{h.actor}</span>
                <span className="ml-auto text-xs text-ink-3 tabular">{new Date(h.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                {h.reason && <p className="w-full text-xs text-ink-2">Reason: {h.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog
        open={dialog === "submit"}
        onClose={() => setDialog(null)}
        title="Submit for moderation?"
        footer={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" disabled={pending} onClick={() => run(() => submitSheetAction(assignmentId))}>Submit</Button></>}
      >
        You won&apos;t be able to edit these marks unless the exam cell returns the sheet.
      </Dialog>
      <Dialog
        open={dialog === "lock"}
        onClose={() => setDialog(null)}
        title="Lock after moderation?"
        footer={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" disabled={pending} onClick={() => run(() => lockSheetAction(assignmentId))}>Lock marks</Button></>}
      >
        Locked marks are final for the university upload. Unlocking later needs a written reason that is kept in the audit log.
      </Dialog>
      {(["return", "unlock"] as const).map((d) => (
        <Dialog
          key={d}
          open={dialog === d}
          onClose={() => setDialog(null)}
          title={d === "return" ? "Return to the teacher" : "Unlock marks"}
          footer={
            <>
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button
                variant={d === "unlock" ? "danger" : "primary"}
                disabled={pending || reason.trim().length < 10}
                onClick={() => run(() => (d === "return" ? returnSheetAction(assignmentId, reason) : unlockSheetAction(assignmentId, reason)))}
              >
                {d === "return" ? "Return sheet" : "Unlock"}
              </Button>
            </>
          }
        >
          <p className="mb-3">{d === "return" ? "Tell the teacher what to correct." : "Why does this locked sheet need to change? This is kept for the exam audit."}</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            className="w-full rounded-lg border border-line-strong p-2.5 text-sm text-ink focus:border-accent focus:outline-none"
            placeholder="At least 10 characters"
          />
        </Dialog>
      ))}
      {node}
    </>
  );
}

function describe(h: HistoryItem) {
  switch (h.action) {
    case "edited": return `Edited ${h.changes} mark${h.changes === 1 ? "" : "s"}`;
    case "moderated": return `Moderated ${h.changes} mark${h.changes === 1 ? "" : "s"}`;
    case "draft→submitted": return "Submitted for moderation";
    case "submitted→locked": return "Locked";
    case "submitted→draft": return "Returned to teacher";
    case "locked→submitted": return "Unlocked";
    case "exported_university_csv": return "Exported university CSV";
    default: return h.action;
  }
}
