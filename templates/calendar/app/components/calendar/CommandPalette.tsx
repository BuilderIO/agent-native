import { useState, useMemo, useEffect } from "react";
import { format, parseISO, parse, isValid } from "date-fns";
import {
  IconCalendar,
  IconClock,
  IconPlus,
  IconBolt,
  IconArrowRight,
} from "@tabler/icons-react";
import { CommandMenu } from "@agent-native/core/client";
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

  // Reset query when opening
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

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

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      setQuery("");
      onClose();
    }
  }

  return (
    <CommandMenu
      open={open}
      onOpenChange={handleOpenChange}
      placeholder="Search events, go to date, or ask AI..."
    >
      {/* Date jump - only show if query parses to a date */}
      {parsedDate && (
        <CommandMenu.Group heading="Jump to">
          <CommandMenu.Item
            onSelect={() => onGoToDate(parsedDate)}
            keywords={["date", "go", "jump"]}
          >
            <IconCalendar className="h-4 w-4" />
            Go to {format(parsedDate, "MMMM d, yyyy")}
            <CommandMenu.Shortcut>
              <IconArrowRight className="h-3 w-3" />
            </CommandMenu.Shortcut>
          </CommandMenu.Item>
        </CommandMenu.Group>
      )}

      {/* Matching events */}
      {matchingEvents.length > 0 && (
        <CommandMenu.Group heading="Events">
          {matchingEvents.map((event) => (
            <CommandMenu.Item
              key={event.id}
              onSelect={() => onEventClick(event)}
              keywords={[event.title.toLowerCase()]}
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  event.color
                    ? ""
                    : event.source === "google"
                      ? "bg-primary"
                      : "bg-primary",
                )}
                style={event.color ? { background: event.color } : undefined}
              />
              <span className="flex-1 truncate">{event.title}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {format(parseISO(event.start), "MMM d")}
              </span>
            </CommandMenu.Item>
          ))}
        </CommandMenu.Group>
      )}

      {(parsedDate || matchingEvents.length > 0) && <CommandMenu.Separator />}

      <CommandMenu.Group heading="Actions">
        <CommandMenu.Item
          onSelect={onCreateEvent}
          keywords={["create", "new", "add", "event"]}
        >
          <IconPlus className="h-4 w-4" />
          Create new event
          <CommandMenu.Shortcut>C</CommandMenu.Shortcut>
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={onToday}
          keywords={["today", "now", "current"]}
        >
          <IconBolt className="h-4 w-4" />
          Go to today
          <CommandMenu.Shortcut>T</CommandMenu.Shortcut>
        </CommandMenu.Item>
      </CommandMenu.Group>

      <CommandMenu.Separator />

      <CommandMenu.Group heading="Views">
        <CommandMenu.Item
          onSelect={() => onViewChange("month")}
          keywords={["month", "view"]}
        >
          <IconCalendar className="h-4 w-4" />
          Month view
          <CommandMenu.Shortcut>M</CommandMenu.Shortcut>
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => onViewChange("week")}
          keywords={["week", "view"]}
        >
          <IconCalendar className="h-4 w-4" />
          Week view
          <CommandMenu.Shortcut>W</CommandMenu.Shortcut>
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => onViewChange("day")}
          keywords={["day", "view"]}
        >
          <IconClock className="h-4 w-4" />
          Day view
          <CommandMenu.Shortcut>D</CommandMenu.Shortcut>
        </CommandMenu.Item>
      </CommandMenu.Group>
    </CommandMenu>
  );
}
