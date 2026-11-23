import { useReaderLocale } from "@agent-native/toolkit/app/shared/reader-locale";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { getCachedDateTimeFormat } from "@/lib/intl-cache";

import type { CustomDateMode } from "./custom-date-range";
import {
  addDays,
  addMonths,
  dayState,
  monthGrid,
  monthLabel,
  nextRangeForClick,
  todayDay,
  weekdayLabels,
  type DayState,
} from "./date-grid";

/**
 * The calendar the reference's Date filter opens. It is what the reader picks a
 * day in, so a mode that names one day (After, Before) draws a single month and a
 * mode that names two (Between) draws the month beside it. The grid, its heading,
 * the weekday columns and one button per day all come from date-grid.ts; this
 * component owns only the visible month and the click.
 *
 * The reference disables shortcuts on the two-ended picker and offers them on the
 * single-day one, so the quick picks below appear only in single-day mode.
 */

/** Quick picks the original's calendar offers beside the grid ("Today", "Yesterday"). */
const QUICK_DAYS: ReadonlyArray<{ label: string; offset: number }> = [
  { label: "Today", offset: 0 },
  { label: "Yesterday", offset: -1 },
];

export type SearchDatePickerProps = {
  mode: CustomDateMode;
  value: { from: string; to: string } | null;
  onChange: (next: { from: string; to: string }) => void;
  /** Test hook; production draws the current month. */
  now?: string;
};

export function SearchDatePicker({
  mode,
  value,
  onChange,
  now,
}: SearchDatePickerProps) {
  const locale = useReaderLocale();
  const today = now ?? todayDay();
  const [viewMonth, setViewMonth] = useState(() =>
    monthStartOf(value?.from || value?.to || today),
  );
  const months = useMemo(
    () =>
      mode === "between" ? [viewMonth, addMonths(viewMonth, 1)] : [viewMonth],
    [mode, viewMonth],
  );
  const weekdays = useMemo(() => weekdayLabels(locale), [locale]);

  const step = (count: number) =>
    setViewMonth((current) => addMonths(current, count));

  return (
    <div
      className="ws-calendar"
      data-part="search.date.calendar"
      data-rid="search.date.calendar"
    >
      <div className="ws-calendar-head">
        <button
          aria-label="Previous month"
          className="ws-calendar-nav"
          data-rid="search.date.prev"
          onClick={() => step(-1)}
          type="button"
        >
          <IconChevronLeft size={16} aria-hidden="true" />
        </button>
        <div className="ws-calendar-months">
          {months.map((month) => (
            <div className="ws-calendar-month" key={month}>
              <div className="ws-calendar-title" data-rid="search.date.month">
                {monthLabel(month, locale)}
              </div>
              <div className="ws-calendar-weekdays" role="presentation">
                {weekdays.map((label, index) => (
                  <span
                    key={`${label}-${index}`}
                    className="ws-calendar-weekday"
                  >
                    {label}
                  </span>
                ))}
              </div>
              <div className="ws-calendar-grid" role="grid">
                {monthGrid(month).map(({ day, inMonth }) => {
                  const state = dayState(day, value);
                  return (
                    <button
                      aria-label={dayAria(day, state, locale)}
                      aria-pressed={
                        state === "selected" ||
                        state === "range-start" ||
                        state === "range-end"
                      }
                      className="ws-calendar-day"
                      data-in-month={inMonth}
                      data-rid={`search.date.day.${day}`}
                      data-state={state}
                      key={day}
                      onClick={() =>
                        onChange(nextRangeForClick(day, mode, value))
                      }
                      type="button"
                    >
                      {Number(day.slice(8, 10))}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <button
          aria-label="Next month"
          className="ws-calendar-nav"
          data-rid="search.date.next"
          onClick={() => step(1)}
          type="button"
        >
          <IconChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      {mode === "between" ? null : (
        <div className="ws-calendar-quick">
          {QUICK_DAYS.map((quick) => (
            <button
              className="ws-calendar-quick-day"
              data-rid={`search.date.quick.${quick.label.toLowerCase()}`}
              key={quick.label}
              onClick={() =>
                onChange({ from: addDays(today, quick.offset), to: "" })
              }
              type="button"
            >
              {quick.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function monthStartOf(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function dayAria(day: string, state: DayState, locale: string): string {
  const label = getCachedDateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(Date.parse(`${day}T00:00:00Z`)));
  if (
    state === "selected" ||
    state === "range-start" ||
    state === "range-end"
  ) {
    return `${label}, selected`;
  }
  return label;
}
