import { useT } from "@agent-native/core/client/i18n";
import { IconStarFilled } from "@tabler/icons-react";

import type { Translate } from "@/lib/translate";

import {
  csat,
  median,
  nps,
  percent,
  ratingViewLabel,
  type RatingEntry,
  type RatingView,
} from "./rating-stats";

const RADIUS = 66;
const STROKE = 36;

function shade(index: number, count: number): string {
  const opacity = count <= 1 ? 1 : 1 - (index / count) * 0.6;
  return `hsl(var(--forms-star) / ${opacity.toFixed(2)})`;
}

function centerStat(
  t: Translate,
  view: RatingView,
  entries: RatingEntry[],
  average: number | null,
): { value: string; label: string } {
  if (view === "median") {
    const value = median(entries);
    return {
      value: value === null ? "-" : value.toFixed(1),
      label: ratingViewLabel(t, "median"),
    };
  }
  if (view === "nps")
    return {
      value: `${Math.round(nps(entries))}`,
      label: ratingViewLabel(t, "nps"),
    };
  if (view === "csat")
    return {
      value: `${Math.round(csat(entries))}%`,
      label: ratingViewLabel(t, "csat"),
    };
  return {
    value: average === null ? "-" : average.toFixed(1),
    label: ratingViewLabel(t, "average"),
  };
}

function Legend({ entries, all }: { entries: RatingEntry[]; all: number }) {
  return (
    <div className="flex justify-center">
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-3 text-xs">
        {entries.map((entry) => (
          <div
            key={entry.value}
            className="flex items-center gap-1 font-medium"
          >
            <IconStarFilled className="size-3.5 text-[hsl(var(--forms-star))]" />
            <span>{entry.value}</span>
            <span className="text-muted-foreground">
              {percent(entry.count, all)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RatingChart({
  view,
  entries,
  average,
}: {
  view: RatingView;
  entries: RatingEntry[];
  average: number | null;
}) {
  const t = useT();
  const all = entries.reduce((sum, entry) => sum + entry.count, 0);
  if (all === 0) return null;

  if (view === "bar") {
    const peak = Math.max(...entries.map((entry) => entry.count));
    return (
      <ul className="mt-4 flex flex-col gap-2">
        {entries.map((entry) => (
          <li key={entry.value} className="flex items-center gap-3 text-sm">
            <span className="flex w-10 items-center gap-1 font-medium">
              <IconStarFilled className="size-3.5 text-[hsl(var(--forms-star))]" />
              {entry.value}
            </span>
            <div className="h-5 flex-1 rounded-[4px] bg-muted">
              <div
                className="h-5 rounded-[4px] bg-[hsl(var(--forms-star))]"
                style={{ width: `${(entry.count / peak) * 100}%` }}
              />
            </div>
            <span className="w-16 text-right text-muted-foreground">
              {entry.count} · {percent(entry.count, all)}%
            </span>
          </li>
        ))}
      </ul>
    );
  }

  const isPie = view === "pie";
  const radius = isPie ? RADIUS / 2 : RADIUS;
  const stroke = isPie ? RADIUS : STROKE;
  const circumference = 2 * Math.PI * radius;
  const center = centerStat(t, view, entries, average);

  return (
    <>
      <div className="h-[180px]">
        <div className="relative h-[180px]">
          <div className="h-[180px]">
            <svg
              viewBox="-366 -6 900 180"
              className="h-[180px] w-full"
              role="img"
              aria-label={t("forms.insights.answerDistribution")}
            >
              <g transform="rotate(-90 84 84)">
                {entries.map((entry, index) => {
                  const before = entries
                    .slice(0, index)
                    .reduce((sum, earlier) => sum + earlier.count, 0);
                  const length = (entry.count / all) * circumference;
                  return (
                    <circle
                      key={entry.value}
                      cx="84"
                      cy="84"
                      r={radius}
                      fill="none"
                      stroke={shade(index, entries.length)}
                      strokeWidth={stroke}
                      strokeDasharray={`${length} ${circumference - length}`}
                      strokeDashoffset={-(before / all) * circumference}
                    />
                  );
                })}
              </g>
            </svg>
          </div>
          {isPie ? null : (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl leading-6 font-semibold text-[color:var(--forms-ink-strong)]">
                {center.value}
              </span>
              <span className="text-xs leading-3 text-muted-foreground">
                {center.label}
              </span>
            </div>
          )}
        </div>
      </div>
      <Legend entries={entries} all={all} />
    </>
  );
}
