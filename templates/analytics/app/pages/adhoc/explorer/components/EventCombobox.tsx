import { useState, useMemo } from "react";
import { IconCheck, IconSelector, IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { KNOWN_EVENTS } from "../types";
import { useDynamicEvents } from "../use-dynamic-schema";

interface EventComboboxProps {
  value: string;
  onChange: (value: string) => void;
}

export function EventCombobox({ value, onChange }: EventComboboxProps) {
  const [open, setOpen] = useState(false);
  const {
    events: dynamicEvents,
    eventNames,
    isLoading,
  } = useDynamicEvents(open);

  const knownSet = useMemo(() => new Set(KNOWN_EVENTS.map((e) => e.value)), []);

  // Dynamic events not in the known list
  const extraEvents = useMemo(
    () => dynamicEvents.filter((e) => !knownSet.has(e.value)),
    [dynamicEvents, knownSet],
  );

  // Event names (the `name` column, different from `event` column)
  const extraNames = useMemo(
    () =>
      eventNames.filter(
        (e) =>
          !knownSet.has(e.value) &&
          !dynamicEvents.some((d) => d.value === e.value),
      ),
    [eventNames, knownSet, dynamicEvents],
  );

  const displayLabel = useMemo(() => {
    if (!value) return null;
    const known = KNOWN_EVENTS.find((e) => e.value === value);
    if (known) return known.label;
    return value;
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal text-sm h-8"
        >
          <span className="truncate">{displayLabel || "Select event..."}</span>
          <IconSelector className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput placeholder="Search events..." />
          <CommandList className="max-h-[350px]">
            <CommandEmpty>
              {isLoading ? (
                <div className="space-y-1.5 p-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-full rounded-sm" />
                  ))}
                </div>
              ) : (
                "No events found."
              )}
            </CommandEmpty>
            <CommandGroup heading="Common Events">
              {KNOWN_EVENTS.map((ev) => (
                <CommandItem
                  key={ev.value}
                  value={ev.value}
                  keywords={[ev.label, ev.value]}
                  onSelect={(v) => {
                    onChange(v);
                    setOpen(false);
                  }}
                >
                  <IconCheck
                    className={cn(
                      "mr-2 h-3 w-3 shrink-0",
                      value === ev.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{ev.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">
                    {ev.value}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {extraEvents.length > 0 && (
              <CommandGroup heading={`All Events (${dynamicEvents.length})`}>
                {extraEvents.map((ev) => (
                  <CommandItem
                    key={`e-${ev.value}`}
                    value={ev.value}
                    onSelect={(v) => {
                      onChange(v);
                      setOpen(false);
                    }}
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 h-3 w-3 shrink-0",
                        value === ev.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{ev.value}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {ev.count.toLocaleString()}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {extraNames.length > 0 && (
              <CommandGroup heading={`Event Names (${eventNames.length})`}>
                {extraNames.slice(0, 80).map((ev) => (
                  <CommandItem
                    key={`n-${ev.value}`}
                    value={ev.value}
                    onSelect={(v) => {
                      onChange(v);
                      setOpen(false);
                    }}
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 h-3 w-3 shrink-0",
                        value === ev.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{ev.value}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {ev.count.toLocaleString()}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {isLoading && extraEvents.length === 0 && (
              <CommandGroup>
                <div className="space-y-1.5 p-1">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-full rounded-sm" />
                  ))}
                </div>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
