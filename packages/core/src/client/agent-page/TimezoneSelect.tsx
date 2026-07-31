import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@agent-native/toolkit/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { useMemo, useState } from "react";

const SYSTEM_VALUE = "system";

/** The browser's IANA zone, or UTC when the runtime cannot report one. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function supportedTimezones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  const zones = supported ? supported("timeZone") : [];
  // Older runtimes omit supportedValuesOf; the browser zone plus UTC still
  // covers the common case rather than leaving an empty, unusable menu.
  const base = zones.length ? zones : [browserTimezone()];
  return [...new Set(["UTC", ...base])];
}

interface ZoneOption {
  zone: string;
  /** Minutes east of GMT, used to order the list the way a map reads. */
  offsetMinutes: number;
  offsetLabel: string;
  timeLabel: string;
  placeLabel: string;
}

function describeZone(zone: string, now: Date): ZoneOption | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "longOffset",
    }).formatToParts(now);
  } catch {
    // A zone this runtime cannot resolve would otherwise throw during render.
    return null;
  }

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  // `longOffset` collapses to a bare "GMT" at zero rather than "GMT+00:00".
  const raw = part("timeZoneName");
  const offsetLabel = raw === "GMT" ? "GMT+00:00" : raw;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offsetLabel);
  const offsetMinutes = match
    ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 0;

  return {
    zone,
    offsetMinutes,
    offsetLabel,
    timeLabel: `${part("hour")}:${part("minute")}${part("dayPeriod").toLowerCase()}`,
    placeLabel: zone.replace(/_/g, " "),
  };
}

function zoneOptions(extra: string[], now: Date): ZoneOption[] {
  const zones = [...new Set([...extra, ...supportedTimezones()])];
  return zones
    .map((zone) => describeZone(zone, now))
    .filter((option): option is ZoneOption => option !== null)
    .sort(
      (a, b) =>
        a.offsetMinutes - b.offsetMinutes ||
        a.placeLabel.localeCompare(b.placeLabel),
    );
}

export interface TimezoneSelectProps {
  value: string;
  disabled?: boolean;
  onChange: (timezone: string) => void;
  /** Zones to surface above the full list, e.g. the currently stored one. */
  suggested?: string[];
  /**
   * Label for a leading `system` choice. Settings offer it so the preference
   * stays revertible; a schedule must name a concrete zone and omits it.
   */
  systemLabel?: string;
  id?: string;
}

export function TimezoneSelect({
  value,
  disabled,
  onChange,
  suggested = [],
  systemLabel,
  id,
}: TimezoneSelectProps) {
  const [open, setOpen] = useState(false);
  const detected = browserTimezone();

  // 418 zones each need their own formatter, so only pay for that once the
  // list is actually on screen. Reopening re-reads the clock.
  const options = useMemo(() => {
    if (!open) return [];
    const pinned = [...suggested, value].filter(
      (zone) => zone && zone !== SYSTEM_VALUE,
    );
    return zoneOptions(pinned, new Date());
  }, [open, suggested, value]);

  const selected = useMemo(
    () => (value === SYSTEM_VALUE ? null : describeZone(value, new Date())),
    [value],
  );

  const triggerLabel =
    value === SYSTEM_VALUE
      ? (systemLabel ?? SYSTEM_VALUE)
      : selected
        ? `(${selected.offsetLabel}) ${selected.placeLabel}`
        : value;

  function choose(zone: string) {
    setOpen(false);
    if (zone !== value) onChange(zone);
  }

  function renderZone(option: ZoneOption, key: string) {
    return (
      <CommandItem
        key={key}
        // Searched text: place and offset both need to match what users type.
        // The key is folded in because the detected zone is listed twice, and
        // cmdk treats two items with the same value as the same item.
        value={`${option.placeLabel} ${option.offsetLabel} ${option.zone} ${key}`}
        onSelect={() => choose(option.zone)}
        className="gap-2"
      >
        <IconCheck
          className={`size-4 shrink-0 ${
            option.zone === value ? "opacity-100" : "opacity-0"
          }`}
        />
        <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
          ({option.offsetLabel})
        </span>
        <span className="truncate">{option.placeLabel}</span>
        <span className="ms-auto shrink-0 tabular-nums text-muted-foreground">
          {option.timeLabel}
        </span>
      </CommandItem>
    );
  }

  const detectedOption = options.find((option) => option.zone === detected);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          // Matches the text inputs it sits beside, not a button.
          className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="truncate">{triggerLabel}</span>
          <IconChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] p-0"
      >
        <Command
          // cmdk's default scorer matches loose subsequences, so "Perth" would
          // otherwise surface most of the list.
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase().trim())
              ? 1
              : 0
          }
        >
          <CommandInput placeholder="Search a city or region…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No matching timezone.</CommandEmpty>
            {systemLabel || detectedOption ? (
              <>
                <CommandGroup>
                  {systemLabel ? (
                    <CommandItem
                      value={`${systemLabel} follow browser automatic`}
                      onSelect={() => choose(SYSTEM_VALUE)}
                      className="gap-2"
                    >
                      <IconCheck
                        className={`size-4 shrink-0 ${
                          value === SYSTEM_VALUE ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <span className="truncate">{systemLabel}</span>
                    </CommandItem>
                  ) : null}
                  {detectedOption
                    ? renderZone(detectedOption, "detected")
                    : null}
                </CommandGroup>
                <CommandSeparator />
              </>
            ) : null}
            <CommandGroup>
              {options.map((option) => renderZone(option, option.zone))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
