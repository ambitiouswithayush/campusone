/**
 * Single-series weekly bar chart with a threshold rule. One hue (the accent); bars below the
 * threshold switch to the reserved danger status colour and carry a text label in the tooltip.
 */
export function WeekBars({ data, threshold }: { data: { week: string; pct: number }[]; threshold: number }) {
  if (!data.length) return <p className="px-5 py-10 text-center text-sm text-ink-3">No classes recorded yet.</p>;
  const min = 50;
  const y = (v: number) => `${((Math.max(v, min) - min) / (100 - min)) * 100}%`;
  return (
    <figure className="px-5 pb-4 pt-6">
      <div className="relative h-40">
        {[50, 75, 100].map((g) => (
          <div key={g} className="absolute inset-x-0 border-t border-line" style={{ bottom: y(g) }}>
            <span className="absolute -top-2 left-0 -translate-x-full pr-2 text-[10px] text-ink-3 tabular">{g}</span>
          </div>
        ))}
        <div className="absolute inset-x-0 border-t border-dashed border-danger/60" style={{ bottom: y(threshold) }} aria-hidden />
        <div className="absolute inset-0 ml-1 flex items-end gap-[2px]">
          {data.map((d) => {
            const short = d.pct < threshold;
            const label = new Date(`${d.week}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
            return (
              <div key={d.week} className="group relative flex h-full flex-1 items-end justify-center">
                <div className={`w-full max-w-7 rounded-t-[4px] ${short ? "bg-danger" : "bg-accent"} opacity-90 group-hover:opacity-100`} style={{ height: y(d.pct) }} />
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-white group-hover:block">
                  Week of {label}: <b className="tabular">{d.pct.toFixed(1)}%</b>{short ? " · below threshold" : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="ml-1 mt-1.5 flex gap-[2px]">
        {data.map((d, i) => (
          <span key={d.week} className="flex-1 text-center text-[10px] text-ink-3">
            {i % 2 === data.length % 2 ? "" : new Date(`${d.week}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}
          </span>
        ))}
      </div>
      <figcaption className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
        <span className="inline-block w-4 border-t border-dashed border-danger" /> {threshold}% university minimum
      </figcaption>
    </figure>
  );
}
