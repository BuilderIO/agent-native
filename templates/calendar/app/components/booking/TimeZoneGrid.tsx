import { useT } from "@agent-native/core/client/i18n";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useState } from "react";

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
}: TimeZoneGridProps) {
  const t = useT();
  const [extraTimezones, setExtraTimezones] = useState<string[]>([]);
  const [addingTimezone, setAddingTimezone] = useState(false);

  const browserTimezone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC";

  const rows: TimeZoneGridHost[] = [
    { id: "you", label: t("bookingLinks.youLabel"), timezone: browserTimezone },
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
        <div className="min-w-max space-y-1.5">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-3">
              <div className="flex w-40 shrink-0 items-center justify-between gap-1 pr-2">
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
                      setExtraTimezones((prev) =>
                        prev.filter((tz) => tz !== row.timezone),
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
              <div className="flex gap-2">
                {slots.map((slot) => {
                  const isSelected = selectedSlot === slot.start;
                  return (
                    <Button
                      key={slot.start}
                      type="button"
                      size="sm"
                      variant={isSelected ? "default" : "outline"}
                      className={cn("min-w-[84px]")}
                      onClick={() => onSelect(slot.start)}
                    >
                      {formatInTimeZone(slot.start, row.timezone)}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {addingTimezone ? (
        <div className="flex items-center gap-2">
          <div className="w-56">
            <TimezoneCombobox
              value=""
              onChange={(timezone) => {
                setExtraTimezones((prev) =>
                  prev.includes(timezone) ? prev : [...prev, timezone],
                );
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
