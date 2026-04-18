/**
 * Time slot list for the selected day. Styled with the brand color and
 * 12/24h toggle.
 */
import { useState } from "react";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import type { Slot } from "@agent-native/scheduling/shared";
import { cn } from "@/lib/utils";

export interface SlotPickerProps {
  slots: Slot[];
  timezone: string;
  onSelect: (slot: Slot) => void;
}

export function SlotPicker(props: SlotPickerProps) {
  const [format24h, setFormat24h] = useState(false);
  const pattern = format24h ? "HH:mm" : "h:mma";
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {props.slots.length} slot{props.slots.length === 1 ? "" : "s"}{" "}
          available
        </span>
        <div className="flex overflow-hidden rounded-md border border-border">
          <button
            type="button"
            aria-pressed={!format24h}
            onClick={() => setFormat24h(false)}
            className={cn(
              "px-2 py-0.5",
              !format24h && "bg-muted text-foreground",
            )}
          >
            12h
          </button>
          <button
            type="button"
            aria-pressed={format24h}
            onClick={() => setFormat24h(true)}
            className={cn(
              "px-2 py-0.5",
              format24h && "bg-muted text-foreground",
            )}
          >
            24h
          </button>
        </div>
      </div>
      {props.slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No times available on this day.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {props.slots.map((s) => (
            <li key={s.start}>
              <button
                type="button"
                onClick={() => props.onSelect(s)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:border-[color:var(--brand-accent)] hover:bg-[color:var(--brand-accent)]/5 focus-visible:outline focus-visible:outline-2"
              >
                {format(
                  new TZDate(new Date(s.start).getTime(), props.timezone),
                  pattern,
                )}
                {s.seatsRemaining != null && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {s.seatsRemaining} left
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
