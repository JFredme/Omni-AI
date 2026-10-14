import type { DayPoint } from "@/lib/analytics/types";

/** A small accessible bar chart. Each bar carries a title, and a visually hidden table-like list backs it for screen readers. */
export function BarChart({
  title,
  points,
  format = (value) => String(value),
  tone = "primary",
}: {
  title: string;
  points: DayPoint[];
  format?: (value: number) => string;
  tone?: "primary" | "muted";
}) {
  const max = Math.max(...points.map((p) => p.value), 0);
  const width = 600;
  const height = 120;
  const gap = points.length > 45 ? 1 : 3;
  const barWidth = Math.max(1, (width - gap * (points.length - 1)) / Math.max(points.length, 1));
  const first = points[0]?.date;
  const last = points[points.length - 1]?.date;

  return (
    <figure className="min-w-0">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} className="h-32 w-full" preserveAspectRatio="none">
        <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {points.map((point, index) => {
          const barHeight = max > 0 ? Math.max(point.value > 0 ? 2 : 0, (point.value / max) * (height - 6)) : 0;
          return (
            <rect
              key={point.date}
              x={index * (barWidth + gap)}
              y={height - 1 - barHeight}
              width={barWidth}
              height={barHeight}
              rx="1"
              className={tone === "primary" ? "fill-primary" : "fill-muted-foreground/50"}
            >
              <title>{`${point.date}: ${format(point.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{first}</span>
        <span className="num">peak {format(max)}</span>
        <span>{last}</span>
      </figcaption>
    </figure>
  );
}
