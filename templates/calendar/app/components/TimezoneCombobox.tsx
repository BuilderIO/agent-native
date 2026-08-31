import { useT } from "@agent-native/core/client/i18n";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const FALLBACK_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Africa/Cairo",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Pacific/Auckland",
];

// Zoom/Calendly-style quick-access group for the most commonly booked
// continental US zones, surfaced ahead of the full IANA region list.
const US_TIMEZONE_LABELS: Record<string, string> = {
  "America/New_York": "Eastern Time",
  "America/Chicago": "Central Time",
  "America/Denver": "Mountain Time",
  "America/Los_Angeles": "Pacific Time",
  "America/Anchorage": "Alaska Time",
  "Pacific/Honolulu": "Hawaii Time",
};

const REGION_ORDER = [
  "US",
  "Europe",
  "Africa",
  "America",
  "Asia",
  "Australia",
  "Atlantic",
  "Indian",
  "Pacific",
  "Antarctica",
  "Arctic",
];

function getSupportedTimezones(currentTimezone: string) {
  const supported =
    typeof Intl !== "undefined" && (Intl as any).supportedValuesOf
      ? ((Intl as any).supportedValuesOf("timeZone") as string[])
      : FALLBACK_TIMEZONES;
  return Array.from(new Set([currentTimezone, ...supported].filter(Boolean)));
}

export function getTimezoneCity(timezone: string) {
  const city = timezone.split("/").pop() || timezone;
  return city.replace(/_/g, " ");
}

function getTimezoneRegion(timezone: string) {
  if (timezone in US_TIMEZONE_LABELS) return "US";
  return timezone.split("/")[0] || "";
}

function getUtcOffsetMinutes(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    const offset = parts.find((part) => part.type === "timeZoneName")?.value;
    const match = offset?.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!match) return 0;
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3]));
  } catch {
    return 0;
  }
}

function formatUtcOffsetLabel(minutes: number) {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC ${sign}${hh}:${mm}`;
}

function getTimezoneDisplayName(timezone: string) {
  return US_TIMEZONE_LABELS[timezone] ?? getTimezoneCity(timezone);
}

function buildTimezoneOptions(currentTimezone: string) {
  const options = getSupportedTimezones(currentTimezone).map((timezone) => {
    const offsetMinutes = getUtcOffsetMinutes(timezone);
    const displayName = getTimezoneDisplayName(timezone);
    const offsetLabel = formatUtcOffsetLabel(offsetMinutes);
    return {
      timezone,
      region: getTimezoneRegion(timezone),
      displayName,
      offsetMinutes,
      offsetLabel,
      searchValue:
        `${displayName} ${offsetLabel} ${timezone}`.trim(),
    };
  });

  const groups = new Map<string, typeof options>();
  for (const option of options) {
    const group = groups.get(option.region) ?? [];
    group.push(option);
    groups.set(option.region, group);
  }
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        a.offsetMinutes - b.offsetMinutes ||
        a.displayName.localeCompare(b.displayName),
    );
  }

  const orderedRegions = [
    ...REGION_ORDER.filter((region) => groups.has(region)),
    ...Array.from(groups.keys())
      .filter((region) => !REGION_ORDER.includes(region))
      .sort(),
  ];

  return orderedRegions.map((region) => ({
    region,
    options: groups.get(region) ?? [],
  }));
}

export function TimezoneCombobox({
  id = "timezone",
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (timezone: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const groups = buildTimezoneOptions(value);
  const selected = groups
    .flatMap((group) => group.options)
    .find((option) => option.timezone === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-between px-3 font-normal"
        >
          <span className="min-w-0 truncate text-left">
            {selected
              ? `${selected.offsetLabel} ${selected.displayName}`
              : t("timezone.select")}
          </span>
          <IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] p-0"
      >
        <Command>
          <CommandInput placeholder={t("timezone.searchPlaceholder")} />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>{t("timezone.empty")}</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.region} heading={group.region}>
                {group.options.map((option) => (
                  <CommandItem
                    key={option.timezone}
                    value={option.searchValue}
                    onSelect={() => {
                      onChange(option.timezone);
                      setOpen(false);
                    }}
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        value === option.timezone
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <span className="truncate">
                      {option.offsetLabel} {option.displayName}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
