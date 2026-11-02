"use client";
import clsx from "clsx";
import { ArrowLeft, Check, Search, Timer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { dayLabel, newSessionId } from "@/lib/offline/days";
import { clearDraft, getDraft, getPack, outboxDel, outboxPut, saveDraft, savePack } from "@/lib/offline/store";
import type { OutboxItem, PackClass, PackStudent } from "@/lib/offline/types";

/**
 * Everyone starts present; the teacher taps the few who are absent and submits. Each tap is
 * saved to the phone immediately, so nothing is lost if the app is closed mid-class.
 */
export function TakeClass({
  cls,
  roster,
  outbox,
  facultyName,
  onDone,
  onBack,
}: {
  cls: PackClass;
  roster: PackStudent[];
  outbox?: OutboxItem;
  facultyName: string;
  onDone: (toast?: string) => void;
  onBack: () => void;
}) {
  const initialAbsent = outbox ? outbox.records.filter((r) => !r.present).map((r) => r.studentId) : (cls.session?.absentIds ?? []);
  const [absent, setAbsent] = useState<Set<number>>(new Set(initialAbsent));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const started = useRef(Date.now());
  const closed = new Date() > new Date(cls.editableUntil);
  const readOnly = closed && !outbox;

  useEffect(() => {
    getDraft(cls.key).then((d) => {
      if (d && !outbox) {
        setAbsent(new Set(d));
        setRestored(true);
      }
    });
  }, [cls.key, outbox]);

  const toggle = (id: number) => {
    if (readOnly) return;
    setAbsent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveDraft(cls.key, [...next]);
      return next;
    });
  };

  const setAll = (present: boolean) => {
    const next = present ? new Set<number>() : new Set(roster.map((r) => r.id));
    setAbsent(next);
    saveDraft(cls.key, [...next]);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((s) => s.rollNo.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [roster, query]);

  const submit = async (override = false) => {
    setBusy(true);
    const seconds = Math.round((Date.now() - started.current) / 1000);
    // Correcting an existing record keeps its id so the server treats it as an update.
    const id = outbox?.status === "conflict" && override ? newSessionId() : (outbox?.id ?? cls.session?.id ?? newSessionId());
    if (outbox && outbox.id !== id) await outboxDel(outbox.id);
    const item: OutboxItem = {
      id,
      classKey: cls.key,
      assignmentId: cls.assignmentId,
      date: cls.date,
      period: cls.period,
      markedAt: new Date().toISOString(),
      records: roster.map((s) => ({ studentId: s.id, present: !absent.has(s.id) })),
      offline: !navigator.onLine,
      override,
      status: "pending",
      attempts: 0,
    };
    await outboxPut(item);
    await clearDraft(cls.key);
    // Reflect it in the saved class list straight away so the list is right even offline.
    const pack = await getPack();
    if (pack) {
      for (const d of pack.days) {
        const c = d.classes.find((x) => x.key === cls.key);
        if (c) c.session = { id, markedAt: item.markedAt, takenBy: facultyName, absentIds: [...absent], total: roster.length };
      }
      await savePack(pack);
    }
    setBusy(false);
    onDone(seconds <= 120 ? `Saved in ${seconds}s · ${absent.size} absent` : `Saved · ${absent.size} absent`);
  };

  const keepServer = async () => {
    if (!outbox) return;
    await outboxDel(outbox.id);
    onDone("Kept the copy already on the server");
  };

  const present = roster.length - absent.size;

  return (
    <div className="animate-fade-up -mt-1">
      <div className="mb-4 flex items-start gap-3">
        <button onClick={onBack} className="-ml-2 rounded-lg p-2 text-ink-2 hover:bg-surface" aria-label="Back to classes">
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{cls.subjectName}</h1>
          <p className="truncate text-sm text-ink-2">
            {cls.batchLabel} · {dayLabel(cls.date)} · P{cls.period} {cls.start}–{cls.end}
          </p>
        </div>
      </div>

      {outbox?.status === "conflict" && outbox.server && (
        <Notice tone="danger" className="mb-4">
          <p className="font-medium">{outbox.message}</p>
          <p className="mt-1">
            Server copy: {outbox.server.absentStudentIds.length} absent, marked {new Date(outbox.server.markedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}. Your copy: {absent.size} absent.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={keepServer}>Keep server copy</Button>
            <Button size="sm" variant="danger" onClick={() => submit(true)} disabled={busy}>Use my copy</Button>
          </div>
        </Notice>
      )}
      {outbox?.status === "rejected" && (
        <Notice tone="danger" className="mb-4">
          <p className="font-medium">Not accepted: {outbox.message}</p>
          <div className="mt-3">
            <Button size="sm" onClick={keepServer}>Discard my copy</Button>
          </div>
        </Notice>
      )}
      {outbox?.status === "pending" && <Notice tone="accent" className="mb-4">Saved on this phone — it will sync automatically when there&apos;s signal.</Notice>}
      {!outbox && cls.session && !readOnly && (
        <Notice className="mb-4">
          Marked by {cls.session.takenBy} at {new Date(cls.session.markedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}. Changes update that record and are logged.
        </Notice>
      )}
      {readOnly && <Notice tone="warn" className="mb-4">The 48-hour correction window has closed. The office can correct this record if needed.</Notice>}
      {restored && <Notice tone="accent" className="mb-4">Restored your unsaved marks for this class.</Notice>}
      {roster.length === 0 && <Notice tone="warn" className="mb-4">No students are on this batch&apos;s roll. Ask the office to check admissions.</Notice>}

      <div className="sticky top-[53px] z-20 -mx-4 mb-3 border-b border-line bg-canvas/95 px-4 py-2.5 backdrop-blur sm:mx-0 sm:rounded-lg sm:border lg:top-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-4 tabular">
            <span><span className="text-xl font-semibold text-ok">{present}</span> <span className="text-xs text-ink-3">present</span></span>
            <span><span className={clsx("text-xl font-semibold", absent.size ? "text-danger" : "text-ink-3")}>{absent.size}</span> <span className="text-xs text-ink-3">absent</span></span>
          </div>
          {!readOnly && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setAll(true)}>All present</Button>
              <Button size="sm" variant="ghost" onClick={() => setAll(false)}>All absent</Button>
            </div>
          )}
        </div>
        {roster.length > 12 && (
          <div className="relative mt-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find roll no. or name"
              inputMode="search"
              className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm focus:border-accent focus:outline-none"
            />
          </div>
        )}
      </div>

      <p className="mb-2 text-xs text-ink-3">{readOnly ? "Read only." : "Tap a student to mark absent. Tap again to undo."}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {filtered.map((s) => {
          const isAbsent = absent.has(s.id);
          return (
            <button
              key={s.id}
              onClick={() => toggle(s.id)}
              aria-pressed={isAbsent}
              aria-label={`${s.rollNo} ${s.name} — ${isAbsent ? "absent" : "present"}`}
              disabled={readOnly}
              className={clsx(
                "relative flex min-h-[68px] flex-col items-start justify-between rounded-xl border p-2.5 text-left transition-all active:scale-[0.97] select-none",
                isAbsent ? "border-danger bg-danger-soft" : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <span className={clsx("text-lg font-semibold leading-none tabular", isAbsent ? "text-danger" : "text-ink")}>{s.rollNo.slice(-3)}</span>
              <span className={clsx("line-clamp-1 w-full text-[11px]", isAbsent ? "text-danger" : "text-ink-2")}>{s.name}</span>
              {isAbsent && <span className="absolute right-2 top-2 rounded bg-danger px-1 text-[10px] font-bold text-white">A</span>}
              {!isAbsent && s.pct !== null && s.pct < 75 && <span className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-warn" title={`Attendance ${s.pct}%`} />}
            </button>
          );
        })}
      </div>
      {filtered.length === 0 && roster.length > 0 && <p className="py-8 text-center text-sm text-ink-3">No student matches “{query}”.</p>}
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-3">
        <span className="size-1.5 rounded-full bg-warn" /> already below 75% attendance
      </p>

      {!readOnly && outbox?.status !== "conflict" && (
        <div className="fixed inset-x-0 bottom-[60px] z-30 border-t border-line bg-surface/95 p-3 backdrop-blur lg:bottom-0 lg:left-60">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <span className="hidden items-center gap-1 text-xs text-ink-3 sm:flex"><Timer size={13} /> All present by default</span>
            <Button variant="primary" size="lg" className="flex-1" disabled={busy || roster.length === 0} onClick={() => submit(false)}>
              <Check size={18} />
              {cls.session || outbox ? "Save changes" : "Submit attendance"} · {absent.size} absent
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
