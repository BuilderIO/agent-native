import type { ReactNode } from "react";
import { Fragment } from "react";

import { Card, CardContent } from "@/components/ui/card";

export interface DayParts {
  dayNumber: string;
  month: string;
  weekday: string;
}

export function dayParts(iso: string): DayParts {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { dayNumber: "", month: "", weekday: "" };
  }
  return {
    dayNumber: d.toLocaleDateString([], { day: "numeric" }),
    month: d.toLocaleDateString([], { month: "long" }),
    weekday: d.toLocaleDateString([], { weekday: "short" }),
  };
}

export function groupByCalendarDay<T>(
  items: T[],
  getIso: (item: T) => string,
  sortWithin?: (a: T, b: T) => number,
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const d = new Date(getIso(item));
    const iso = getIso(item);
    const key = Number.isNaN(d.getTime())
      ? iso
      : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  if (sortWithin) {
    for (const list of groups.values()) list.sort(sortWithin);
  }
  return Array.from(groups.entries());
}

export function DayGroupedCard<T extends { id: string }>({
  groups,
  getIso,
  renderRow,
  markerIndex = -1,
  renderMarker,
}: {
  groups: Array<[string, T[]]>;
  getIso: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  markerIndex?: number;
  renderMarker?: () => ReactNode;
}) {
  let flatIndex = 0;
  return (
    <Card>
      {/* py-4 (not py-3) and a full-width divider, per review feedback that a
          hairline alone read as one continuous entry rather than separate days. */}
      <CardContent className="divide-y divide-border p-0">
        {groups.map(([key, items]) => {
          const { dayNumber, month, weekday } = dayParts(getIso(items[0]!));
          const dayStartIndex = flatIndex;
          flatIndex += items.length;
          return (
            <div key={key} className="flex gap-4 px-4 py-4">
              <div className="w-14 shrink-0">
                <div className="text-xl font-semibold leading-none tabular-nums text-foreground">
                  {dayNumber}
                </div>
                <div className="mt-1 text-[11px] leading-tight text-muted-foreground">
                  {month}
                </div>
                <div className="text-[11px] leading-tight text-muted-foreground">
                  {weekday}
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-2.5">
                {items.map((item, i) => (
                  <Fragment key={item.id}>
                    {renderMarker && dayStartIndex + i === markerIndex
                      ? renderMarker()
                      : null}
                    {renderRow(item)}
                  </Fragment>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
