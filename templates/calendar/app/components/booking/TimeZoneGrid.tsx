import { useT } from "@agent-native/core/client/i18n";
import { IconPlus, IconX } from "@tabler/icons-react";
import { Fragment, useEffect, useState } from "react";

import {
  getTimezoneCity,
  TimezoneCombobox,
} from "@/components/TimezoneCombobox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface TimeZoneGridHost {
  id: string;
  label: string;
  timezone: string;
}

interface TimeZoneGridProps {
  slots: { start: string; end: string }[];
  selectedSlot: string | null;
  onSelect: (start: string) => void;
  loading?: boolean;
  errorMessage?: string;
  /** Hosts (owner + eligible overlay hosts) with a resolved time zone. */
  hosts: TimeZoneGridHost[];
  /**
   * Manually added extra time zones. Lifted to the parent so they survive
   * this component unmounting — e.g. toggling "Hide time zones" swaps this
   * component out for TimeSlotPicker, which would otherwise reset local state.
   */
  extraTimezones: string[];
  onExtraTimezonesChange: (timezones: string[]) => void;
}

function formatInTimeZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "--";
  }
}

export function TimeZoneGrid({
  slots,
  selectedSlot,
  onSelect,
  loading,
  errorMessage,
  hosts,
  extraTimezones,
  onExtraTimezonesChange,
}: TimeZoneGridProps) {
  const t = useT();
  const [addingTimezone, setAddingTimezone] = useState(false);
  const [hoveredSlot, setHoveredSlot] = useState<string | null>(null);
  // Resolved after mount only — the browser's timezone can differ from the
  // server's, so computing it during render would cause a hydration mismatch.
  const [browserTimezone, setBrowserTimezone] = useState<string | null>(null);

  useEffect(() => {
    try {
      setBrowserTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      setBrowserTimezone("UTC");
    }
  }, []);

  const rows: TimeZoneGridHost[] = [
    ...(browserTimezone
      ? [
          {
            id: "you",
            label: t("bookingLinks.youLabel"),
            timezone: browserTimezone,
          },
        ]
      : []),
    ...hosts,
    ...extraTimezones.map((timezone) => ({
      id: timezone,
      label: getTimezoneCity(timezone),
      timezone,
    })),
  ];

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded-md" />
        ))}
      </div>
    );
  }

  if (errorMessage) {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-3 text-sm text-destructive">
        {errorMessage}
      </p>
    );
  }

  if (slots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        {t("bookingLinks.noAvailableSlotsForDate")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <div
          className="grid items-center gap-x-1 gap-y-1.5"
          style={{
            gridTemplateColumns: `10rem repeat(${slots.length}, minmax(5.5rem, 1fr))`,
          }}
        >
          {rows.map((row) => (
            <Fragment key={row.id}>
              <div className="flex min-w-0 items-center justify-between gap-1 pr-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.timezone}
                  </p>
                </div>
                {row.id !== "you" && extraTimezones.includes(row.timezone) && (
                  <button
                    type="button"
                    onClick={() =>
                      onExtraTimezonesChange(
                        extraTimezones.filter((tz) => tz !== row.timezone),
                      )
                    }
                    className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={t("bookingLinks.removeTimeZone", {
                      timezone: row.timezone,
                    })}
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {slots.map((slot) => {
                const isSelected = selectedSlot === slot.start;
                const isHovered = hoveredSlot === slot.start;
                return (
                  <button
                    key={slot.start}
                    type="button"
                    onClick={() => onSelect(slot.start)}
                    onMouseEnter={() => setHoveredSlot(slot.start)}
                    onMouseLeave={() =>
                      setHoveredSlot((prev) =>
                        prev === slot.start ? null : prev,
                      )
                    }
                    className={cn(
                      "whitespace-nowrap rounded-md px-2 py-1.5 text-center text-sm transition-colors",
                      isSelected
                        ? "bg-primary font-medium text-primary-foreground"
                        : isHovered
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    {formatInTimeZone(slot.start, row.timezone)}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      {addingTimezone ? (
        <div className="flex items-center gap-2">
          <div className="w-56">
            <TimezoneCombobox
              value=""
              onChange={(timezone) => {
                if (!extraTimezones.includes(timezone)) {
                  onExtraTimezonesChange([...extraTimezones, timezone]);
                }
                setAddingTimezone(false);
              }}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAddingTimezone(false)}
          >
            {t("bookingLinks.back")}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAddingTimezone(true)}
          className="gap-1.5"
        >
          <IconPlus className="h-3.5 w-3.5" />
          {t("bookingLinks.addTimeZone")}
        </Button>
      )}
    </div>
  );
}
