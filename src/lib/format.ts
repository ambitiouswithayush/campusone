export function inr(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function relTime(d: Date | string): string {
  const t = typeof d === "string" ? new Date(d) : d;
  const s = Math.round((Date.now() - t.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return t.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
