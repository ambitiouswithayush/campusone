"use client";
import clsx from "clsx";
import { AlertTriangle, Check, ChevronRight, CloudOff, Loader2, RefreshCw, Smartphone } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Notice, PageHeader, Skeleton } from "@/components/ui";
import { dayLabel, todayIST, visibleDays } from "@/lib/offline/days";
import { getPack, outboxAll, savePack } from "@/lib/offline/store";
import { flushOutbox } from "@/lib/offline/sync-client";
import type { ClassPack, OutboxItem, PackClass } from "@/lib/offline/types";
import { useOnline } from "@/lib/offline/use-online";
import { TakeClass } from "./take-class";

type LoadState = "loading" | "ready" | "empty-offline" | "error";

export type ClassStatus = "marked" | "waiting" | "conflict" | "rejected" | "now" | "missed" | "upcoming" | "closed";

export function classStatus(c: PackClass, outbox: OutboxItem | undefined, now: Date): ClassStatus {
  if (outbox?.status === "conflict") return "conflict";
  if (outbox?.status === "rejected") return "rejected";
  if (outbox) return "waiting";
  if (c.session) return "marked";
  const start = new Date(`${c.date}T${c.start}:00+05:30`);
  const end = new Date(`${c.date}T${c.end}:00+05:30`);
  if (now < start) return "upcoming";
  if (now <= end) return "now";
  return now > new Date(c.editableUntil) ? "closed" : "missed";
}

const STATUS: Record<ClassStatus, { label: string; tone: "ok" | "warn" | "danger" | "accent" | "neutral" }> = {
  marked: { label: "Marked", tone: "ok" },
  waiting: { label: "Saved on phone", tone: "accent" },
  conflict: { label: "Needs attention", tone: "danger" },
  rejected: { label: "Not accepted", tone: "danger" },
  now: { label: "In progress", tone: "accent" },
  missed: { label: "Not marked", tone: "warn" },
  upcoming: { label: "Upcoming", tone: "neutral" },
  closed: { label: "Window closed", tone: "neutral" },
};

export function TodayApp() {
  const online = useOnline();
  const [pack, setPack] = useState<ClassPack | null>(null);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const reloadOutbox = useCallback(async () => setOutbox(await outboxAll()), []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/faculty/pack", { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (res.status === 401) {
        window.location.href = "/login?next=/today";
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const p: ClassPack = await res.json();
      await savePack(p);
      setPack(p);
      setState("ready");
    } catch {
      setState((s) => (s === "loading" ? "error" : s));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const sync = useCallback(
    async (quiet = false) => {
      setSyncing(true);
      const r = await flushOutbox();
      setSyncing(false);
      await reloadOutbox();
      if (!quiet || r.conflicts || r.rejected) {
        if (r.synced) setToast(`${r.synced} class${r.synced > 1 ? "es" : ""} synced`);
        if (r.conflicts) setToast(`${r.conflicts} class needs your attention`);
        if (r.rejected) setToast(`${r.rejected} class was not accepted — open it to see why`);
        if (r.warnings[0]) setToast(r.warnings[0]);
      }
      if (r.synced && navigator.onLine) refresh();
    },
    [refresh, reloadOutbox],
  );

  // Cached pack first (instant, works offline), then the network.
  useEffect(() => {
    (async () => {
      const [cached] = await Promise.all([getPack().catch(() => undefined), reloadOutbox()]);
      if (cached) {
        setPack(cached);
        setState("ready");
      }
      if (navigator.onLine) {
        await refresh();
        sync(true);
      } else if (!cached) setState("empty-offline");
    })();
    const params = new URLSearchParams(window.location.search);
    if (params.get("c")) setOpenKey(params.get("c"));
    const onPop = () => setOpenKey(new URLSearchParams(window.location.search).get("c"));
    window.addEventListener("popstate", onPop);
    const tick = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      window.removeEventListener("popstate", onPop);
      clearInterval(tick);
    };
  }, [refresh, reloadOutbox, sync]);

  // Reconnect → sync. Also retry every 20 s while anything is waiting.
  useEffect(() => {
    if (online) sync(true);
  }, [online, sync]);
  const waiting = outbox.filter((o) => o.status === "pending" || o.status === "syncing").length;
  useEffect(() => {
    if (!waiting || !online) return;
    const t = setInterval(() => sync(true), 20_000);
    return () => clearInterval(t);
  }, [waiting, online, sync]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const days = useMemo(() => (pack ? visibleDays(pack, now) : []), [pack, now]);
  const outboxByKey = useMemo(() => new Map(outbox.map((o) => [o.classKey, o])), [outbox]);
  const allClasses = days.flatMap((d) => d.classes);
  const openClass = openKey ? allClasses.find((c) => c.key === openKey) : undefined;

  const open = (key: string | null) => {
    setOpenKey(key);
    const url = key ? `/today?c=${encodeURIComponent(key)}` : "/today";
    if (key) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  };

  if (openClass && pack) {
    return (
      <TakeClass
        cls={openClass}
        roster={pack.rosters[openClass.batchId] ?? []}
        outbox={outboxByKey.get(openClass.key)}
        facultyName={pack.facultyName}
        onDone={async (msg) => {
          await reloadOutbox();
          setPack((await getPack()) ?? pack);
          if (msg) setToast(msg);
          open(null);
          sync(true);
        }}
        onBack={() => open(null)}
      />
    );
  }

  const staleDay = pack && todayIST(new Date(pack.downloadedAt)) !== todayIST(now);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Attendance"
        subtitle={pack ? `${pack.facultyName} · ${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" })}` : undefined}
        actions={<SyncChip online={online} waiting={waiting} syncing={syncing || refreshing} onSync={() => (online ? (sync(), refresh()) : null)} lastUpdated={pack?.downloadedAt} />}
      />

      {state === "loading" && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[72px] w-full" />
          ))}
        </div>
      )}
      {state === "empty-offline" && (
        <Card>
          <EmptyState icon={<CloudOff size={28} />} title="Connect once to download your classes" body="After the first download, attendance works without signal and syncs when you're back online." />
        </Card>
      )}
      {state === "error" && !pack && (
        <Card>
          <EmptyState
            icon={<AlertTriangle size={28} />}
            title="Couldn't load your classes"
            body="Check your connection and try again."
            action={<Button onClick={refresh}>Try again</Button>}
          />
        </Card>
      )}

      {pack && staleDay && !online && (
        <Notice tone="warn" className="mb-4">
          Class list last downloaded {new Date(pack.downloadedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" })}. Today&apos;s classes come from your saved timetable.
        </Notice>
      )}

      {pack &&
        days.map((d, i) => {
          if (i > 0 && !d.classes.length) return null;
          const needs = d.classes.filter((c) => ["missed", "conflict", "rejected"].includes(classStatus(c, outboxByKey.get(c.key), now)));
          return (
            <section key={d.date} className="mb-7">
              <div className="mb-2.5 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-ink">{dayLabel(d.date, now)}</h2>
                {i > 0 && needs.length > 0 && <span className="text-xs text-warn">{needs.length} still to mark</span>}
                {i === 0 && d.classes.length > 0 && (
                  <span className="text-xs text-ink-3">
                    {d.classes.filter((c) => ["marked", "waiting"].includes(classStatus(c, outboxByKey.get(c.key), now))).length} of {d.classes.length} done
                  </span>
                )}
              </div>
              {d.holiday ? (
                <Card><EmptyState title={`Holiday — ${d.holiday}`} body="No classes today." /></Card>
              ) : !d.classes.length ? (
                <Card><EmptyState title="No classes on your timetable today" body={i === 0 ? "Classes from the last two days that still need marking appear below." : undefined} /></Card>
              ) : (
                <Card className="divide-y divide-line overflow-hidden">
                  {d.classes.map((c) => (
                    <ClassRow key={c.key} cls={c} status={classStatus(c, outboxByKey.get(c.key), now)} onOpen={() => open(c.key)} />
                  ))}
                </Card>
              )}
            </section>
          );
        })}

      {pack && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
          <Smartphone size={13} /> Works without signal. Marks are kept on this phone until they reach the server.
        </p>
      )}

      {toast && (
        <div role="status" className="animate-fade-up fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm rounded-lg bg-ink px-4 py-3 text-center text-sm text-white shadow-lg lg:bottom-8">
          {toast}
        </div>
      )}
    </div>
  );
}

function ClassRow({ cls, status, onOpen }: { cls: PackClass; status: ClassStatus; onOpen: () => void }) {
  const s = STATUS[status];
  const absent = cls.session?.absentIds.length ?? 0;
  return (
    <button onClick={onOpen} className={clsx("flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-canvas sm:px-5", status === "now" && "bg-accent-soft/50")}>
      <div className="w-12 shrink-0 tabular">
        <p className="text-sm font-semibold">{cls.start}</p>
        <p className="text-xs text-ink-3">P{cls.period}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{cls.subjectName}</p>
        <p className="mt-0.5 text-xs text-ink-2">
          {cls.subjectCode} · {cls.batchLabel}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone={s.tone}>
          {status === "marked" && <Check size={12} />}
          {s.label}
        </Badge>
        {status === "marked" && <span className="text-[11px] text-ink-3 tabular">{absent} absent</span>}
      </div>
      <ChevronRight size={16} className="hidden shrink-0 text-ink-3 sm:block" />
    </button>
  );
}

function SyncChip({ online, waiting, syncing, onSync, lastUpdated }: { online: boolean; waiting: number; syncing: boolean; onSync: () => void; lastUpdated?: string }) {
  if (!online) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs text-white">
        <CloudOff size={13} /> Offline{waiting ? ` · ${waiting} saved on phone` : ""}
      </span>
    );
  }
  return (
    <button onClick={onSync} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-2 hover:bg-canvas" title={lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}` : undefined}>
      {syncing ? <Loader2 size={13} className="animate-spin" /> : waiting ? <RefreshCw size={13} /> : <Check size={13} className="text-ok" />}
      {syncing ? "Syncing…" : waiting ? `${waiting} waiting · Sync now` : "All synced"}
    </button>
  );
}
