import { useState } from "react";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
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

function getSupportedTimezones(currentTimezone: string) {
  const supported =
    typeof Intl !== "undefined" && (Intl as any).supportedValuesOf
      ? ((Intl as any).supportedValuesOf("timeZone") as string[])
      : FALLBACK_TIMEZONES;
  return Array.from(new Set([currentTimezone, ...supported].filter(Boolean)));
}

function getTimezoneCity(timezone: string) {
  const city = timezone.split("/").pop() || timezone;
  return city.replace(/_/g, " ");
}

function getTimezoneRegion(timezone: string) {
  const region = timezone.split("/")[0] || "";
  return region.replace(/_/g, " ");
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
  const options = getSupportedTimezones(value).map((timezone) => {
    const city = getTimezoneCity(timezone);
    const region = getTimezoneRegion(timezone);
    return {
      timezone,
      city,
      region,
      searchValue: `${city} ${region} ${timezone}`.trim(),
    };
  });
  const selected = options.find((option) => option.timezone === value);

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
              ? `${selected.city} (${selected.timezone})`
              : "Select timezone"}
          </span>
          <IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] p-0"
      >
        <Command>
          <CommandInput placeholder="Search timezone or city..." />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
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
                      "mr-2 h-4 w-4",
                      value === option.timezone ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{option.city}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {option.timezone}
                    </p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
