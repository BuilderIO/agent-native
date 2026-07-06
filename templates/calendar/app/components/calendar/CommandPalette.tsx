import { CommandMenu, useT } from "@agent-native/core/client";
import type { CalendarEvent } from "@shared/api";
import {
  IconCalendar,
  IconClock,
  IconPlus,
  IconBolt,
  IconArrowRight,
  IconUsers,
  IconLink,
  IconExternalLink,
} from "@tabler/icons-react";
import * as chrono from "chrono-node";
import { format, parseISO, parse, isValid } from "date-fns";
import { useState, useMemo, useEffect } from "react";

import { cn } from "@/lib/utils";

type ViewMode = "month" | "week" | "day";

export interface QuickCreateEvent {
  title: string;
  start: Date;
  hasExplicitTime: boolean;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  events: CalendarEvent[];
  onGoToDate: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  onCreateEvent: () => void;
  onCreateEventFromText?: (quickCreate: QuickCreateEvent) => void;
  onViewChange: (view: ViewMode) => void;
  onToday: () => void;
  selectedEvent?: CalendarEvent | null;
  onOpenSelectedEventInGoogleCalendar?: (event: CalendarEvent) => void;
  onAddPeopleCalendar?: () => void;
  onAddUrlCalendar?: () => void;
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

// Trailing connector words chrono-node can leave dangling on the title when
// the matched date phrase doesn't consume them (e.g. "call mom for" if the
// date phrase only matched a single word after "for").
const TRAILING_CONNECTOR_WORDS = /[\s,-]*\b(?:on|at|for|by)$/i;

function parseQuickCreateEvent(query: string): QuickCreateEvent | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const [result] = chrono.parse(trimmed, new Date());
  if (!result) return null;

  const title = (
    trimmed.slice(0, result.index) +
    trimmed.slice(result.index + result.text.length)
  )
    .replace(TRAILING_CONNECTOR_WORDS, "")
    .trim();
  if (!title) return null;

  return {
    title,
    start: result.date(),
    hasExplicitTime: result.start.isCertain("hour"),
  };
}

export function CommandPalette({
  open,
  onClose,
  events,
  onGoToDate,
  onEventClick,
  onCreateEvent,
  onCreateEventFromText,
  onViewChange,
  onToday,
  selectedEvent,
  onOpenSelectedEventInGoogleCalendar,
  onAddPeopleCalendar,
  onAddUrlCalendar,
}: CommandPaletteProps) {
  const t = useT();
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

  // Only offer a natural-language quick-create when the query doesn't
  // already resolve to a plain date jump or match existing events — those
  // take priority since the user is more likely searching, not creating.
  const quickCreate = useMemo(() => {
    if (!onCreateEventFromText || parsedDate || matchingEvents.length > 0) {
      return null;
    }
    return parseQuickCreateEvent(query);
  }, [query, parsedDate, matchingEvents, onCreateEventFromText]);

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      setQuery("");
      onClose();
    }
  }

  const selectedGoogleEvent =
    selectedEvent?.source === "google" && selectedEvent.htmlLink
      ? selectedEvent
      : null;

  return (
    <CommandMenu
      open={open}
      onOpenChange={handleOpenChange}
      placeholder={t("eventForm.commandPlaceholder")}
    >
      {/* Date jump - only show if query parses to a date */}
      {parsedDate && (
        <CommandMenu.Group heading={t("eventForm.jumpTo")}>
          <CommandMenu.Item
            onSelect={() => onGoToDate(parsedDate)}
            keywords={["date", "go", "jump"]}
          >
            <IconCalendar className="h-4 w-4" />
            {t("eventForm.goToDate", {
              date: format(parsedDate, "MMMM d, yyyy"),
            })}
            <CommandMenu.Shortcut>
              <IconArrowRight className="h-3 w-3" />
            </CommandMenu.Shortcut>
          </CommandMenu.Item>
        </CommandMenu.Group>
      )}

      {/* Natural-language quick create - only offered when the query looks
          like "<title> <when>" and doesn't already resolve to a date jump
          or an existing event */}
      {quickCreate && onCreateEventFromText && (
        <CommandMenu.Group heading={t("eventForm.quickCreate")}>
          <CommandMenu.Item
            onSelect={() => onCreateEventFromText(quickCreate)}
            keywords={["create", "new", "add", "event", quickCreate.title]}
          >
            <IconPlus className="h-4 w-4" />
            <span className="min-w-0 flex-1 truncate">
              {t("eventForm.createEventWithTitle", {
                title: quickCreate.title,
              })}
            </span>
            <span className="ml-2 shrink-0 text-xs text-muted-foreground">
              {quickCreate.hasExplicitTime
                ? format(quickCreate.start, "MMM d, h:mm a")
                : format(quickCreate.start, "MMM d")}
            </span>
          </CommandMenu.Item>
        </CommandMenu.Group>
      )}

      {/* Matching events */}
      {matchingEvents.length > 0 && (
        <CommandMenu.Group heading={t("eventForm.events")}>
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

      {selectedGoogleEvent && onOpenSelectedEventInGoogleCalendar && (
        <CommandMenu.Group heading={t("eventForm.selectedEvent")}>
          <CommandMenu.Item
            onSelect={() =>
              onOpenSelectedEventInGoogleCalendar(selectedGoogleEvent)
            }
            keywords={[
              "open",
              "google",
              "calendar",
              "selected",
              "event",
              selectedGoogleEvent.title.toLowerCase(),
            ]}
          >
            <IconExternalLink className="h-4 w-4" />
            <span className="min-w-0 flex-1 truncate">
              {t("eventForm.openInGoogleCalendar")}
            </span>
          </CommandMenu.Item>
        </CommandMenu.Group>
      )}

      {(parsedDate ||
        quickCreate ||
        matchingEvents.length > 0 ||
        selectedGoogleEvent) && <CommandMenu.Separator />}

      <CommandMenu.Group heading={t("root.commandActions")}>
        <CommandMenu.Item
          onSelect={onCreateEvent}
          keywords={["create", "new", "add", "event"]}
        >
          <IconPlus className="h-4 w-4" />
          {t("eventForm.createEvent")}
          <CommandMenu.Shortcut>C</CommandMenu.Shortcut>
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={onToday}
          keywords={["today", "now", "current"]}
        >
          <IconBolt className="h-4 w-4" />
          {t("eventForm.goToToday")}
          <CommandMenu.Shortcut>T</CommandMenu.Shortcut>
        </CommandMenu.Item>
        {onAddPeopleCalendar && (
          <CommandMenu.Item
            onSelect={onAddPeopleCalendar}
            keywords={[
              "people",
              "team",
              "overlay",
              "colleague",
              "add",
              "calendar",
            ]}
          >
            <IconUsers className="h-4 w-4" />
            {t("eventForm.viewTeammateCalendar")}
          </CommandMenu.Item>
        )}
        {onAddUrlCalendar && (
          <CommandMenu.Item
            onSelect={onAddUrlCalendar}
            keywords={[
              "ical",
              "ics",
              "webcal",
              "subscribe",
              "url",
              "feed",
              "external",
              "calendar",
            ]}
          >
            <IconLink className="h-4 w-4" />
            {t("eventForm.addCalendarFromUrl")}
          </CommandMenu.Item>
        )}
      </CommandMenu.Group>

      <CommandMenu.Separator />

      <CommandMenu.Group heading={t("keyboardShortcuts.views")}>
        <CommandMenu.Item
          onSelect={() => onViewChange("month")}
          keywords={["month", "view"]}
        >
          <IconCalendar className="h-4 w-4" />
          {t("keyboardShortcuts.monthView")}
          <CommandMenu.Shortcut>M</CommandMenu.Shortcut>
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => onViewChange("week")}
          keywords={["week", "view"]}
        >
          <IconCalendar className="h-4 w-4" />
          {t("keyboardShortcuts.weekView")}
          <CommandMenu.Shortcut>W</CommandMenu.Shortcut>
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => onViewChange("day")}
          keywords={["day", "view"]}
        >
          <IconClock className="h-4 w-4" />
          {t("keyboardShortcuts.dayView")}
          <CommandMenu.Shortcut>D</CommandMenu.Shortcut>
        </CommandMenu.Item>
      </CommandMenu.Group>
    </CommandMenu>
  );
}
