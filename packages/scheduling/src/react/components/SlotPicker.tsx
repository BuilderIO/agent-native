/**
 * SlotPicker — minimal, unstyled primitive that renders a vertical list of
 * available slots grouped by date. Consumers style the buttons via their
 * own Tailwind class layer.
 *
 * This is the "headless" spec: if you want a fully styled picker, look at
 * `templates/scheduling/app/components/booker/SlotPicker.tsx`.
 */
import type { Slot } from "../../shared/index.js";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import React from "react";

export interface SlotPickerProps {
  slots: Slot[];
  timezone: string;
  selectedStart?: string;
  onSelect: (slot: Slot) => void;
  timeFormat?: "12h" | "24h";
  className?: string;
  slotClassName?: string;
  dayClassName?: string;
}

export function SlotPicker(props: SlotPickerProps) {
  const grouped = new Map<string, Slot[]>();
  for (const s of props.slots) {
    const localDay = format(
      new TZDate(new Date(s.start).getTime(), props.timezone),
      "yyyy-MM-dd",
    );
    if (!grouped.has(localDay)) grouped.set(localDay, []);
    grouped.get(localDay)!.push(s);
  }
  const fmt = props.timeFormat === "24h" ? "HH:mm" : "h:mma";

  return (
    <div className={props.className ?? ""}>
      {Array.from(grouped.entries()).map(([date, daySlots]) => (
        <section key={date} className={props.dayClassName ?? ""}>
          <header>
            {format(
              new TZDate(`${date}T12:00:00Z`, props.timezone),
              "EEEE, MMM d",
            )}
          </header>
          <ul>
            {daySlots.map((s) => (
              <li key={s.start}>
                <button
                  type="button"
                  className={props.slotClassName ?? ""}
                  aria-pressed={props.selectedStart === s.start}
                  disabled={!s.available}
                  onClick={() => props.onSelect(s)}
                >
                  {format(
                    new TZDate(new Date(s.start).getTime(), props.timezone),
                    fmt,
                  )}
                  {s.seatsRemaining != null && s.seatsRemaining > 0 && (
                    <span> · {s.seatsRemaining} left</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
