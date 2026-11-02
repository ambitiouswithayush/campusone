import type { ClassPack, PackClass, PackDay } from "./types";

/** Client-side date helpers (IST), mirroring lib/dates without server imports. */
export function todayIST(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function addDaysISO(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dow(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * Days to show: today and the two before it. Uses the server's view where the pack has it, and
 * the stored timetable otherwise (phone offline since an earlier day).
 */
export function visibleDays(pack: ClassPack, now = new Date()): PackDay[] {
  const today = todayIST(now);
  return [today, addDaysISO(today, -1), addDaysISO(today, -2)].map((date) => {
    const known = pack.days.find((d) => d.date === date);
    if (known) return known;
    const holiday = pack.holidays.find((h) => h.date === date)?.title ?? null;
    const classes: PackClass[] = holiday
      ? []
      : pack.timetable
          .filter((t) => t.dayOfWeek === dow(date))
          .map((t) => ({
            ...t,
            key: `${t.assignmentId}:${date}:${t.period}`,
            date,
            editableUntil: new Date(new Date(`${date}T${t.end}:00+05:30`).getTime() + pack.editWindowHours * 3600_000).toISOString(),
            session: null,
          }))
          .sort((a, b) => a.period - b.period);
    return { date, holiday, classes };
  });
}

export function dayLabel(date: string, now = new Date()) {
  const today = todayIST(now);
  if (date === today) return "Today";
  if (date === addDaysISO(today, -1)) return "Yesterday";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
}

export function newSessionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
