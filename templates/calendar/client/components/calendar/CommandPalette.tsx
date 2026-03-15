import { useState, useMemo } from "react";
import { format, parseISO, parse, isValid } from "date-fns";
import {
  Calendar,
  CalendarDays,
  CalendarRange,
  Clock,
  Plus,
  Zap,
  ArrowRight,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@shared/api";

type ViewMode = "month" | "week" | "day";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  events: CalendarEvent[];
  onGoToDate: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  onCreateEvent: () => void;
  onViewChange: (view: ViewMode) => void;
  onToday: () => void;
}

const DATE_FORMATS = [
  "MM/dd/yyyy",
  "MM/dd",
  "MMMM d",
  "MMM d",
  "yyyy-MM-dd",
  "M/d",
  "MMMM d, yyyy",
];

export function CommandPalette({
  open,
  onClose,
  events,
  onGoToDate,
  onEventClick,
  onCreateEvent,
  onViewChange,
  onToday,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  const parsedDate = useMemo(() => {
    if (!query.trim()) return null;
    for (const fmt of DATE_FORMATS) {
      try {
        const d = parse(query.trim(), fmt, new Date());
        if (isValid(d) && d.getFullYear() > 1970) return d;
      } catch {
        // continue
      }
    }
    return null;
  }, [query]);

  const matchingEvents = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return events
      .filter((e) => e.title.toLowerCase().includes(q))
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 6);
  }, [query, events]);

  function run(fn: () => void) {
    fn();
    setQuery("");
    onClose();
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setQuery("");
      onClose();
    }
  }

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <CommandInput
        placeholder="Search events, go to date, or run a command…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          No results. Try typing a date like "Jan 15" or an event name.
        </CommandEmpty>

        {parsedDate && (
          <CommandGroup heading="Jump to">
            <CommandItem onSelect={() => run(() => onGoToDate(parsedDate))}>
              <Calendar className="mr-2 h-4 w-4" />
              Go to {format(parsedDate, "MMMM d, yyyy")}
              <CommandShortcut>
                <ArrowRight className="h-3 w-3" />
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>
        )}

        {matchingEvents.length > 0 && (
          <CommandGroup heading="Events">
            {matchingEvents.map((event) => (
              <CommandItem
                key={event.id}
                onSelect={() => run(() => onEventClick(event))}
              >
                <span
                  className={cn(
                    "mr-2 h-2 w-2 shrink-0 rounded-full",
                    event.color
                      ? ""
                      : event.source === "google"
                        ? "bg-emerald-500"
                        : "bg-primary",
                  )}
                  style={event.color ? { background: event.color } : undefined}
                />
                <span className="flex-1 truncate">{event.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {format(parseISO(event.start), "MMM d")}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(onCreateEvent)}>
            <Plus className="mr-2 h-4 w-4" />
            Create new event
            <CommandShortcut>C</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(onToday)}>
            <Zap className="mr-2 h-4 w-4" />
            Go to today
            <CommandShortcut>T</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Views">
          <CommandItem onSelect={() => run(() => onViewChange("month"))}>
            <CalendarDays className="mr-2 h-4 w-4" />
            Month view
            <CommandShortcut>M</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => onViewChange("week"))}>
            <CalendarRange className="mr-2 h-4 w-4" />
            Week view
            <CommandShortcut>W</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => onViewChange("day"))}>
            <Clock className="mr-2 h-4 w-4" />
            Day view
            <CommandShortcut>D</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
