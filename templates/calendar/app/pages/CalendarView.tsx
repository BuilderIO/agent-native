import { useState, useMemo, useEffect, useCallback } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  isSameDay,
  parseISO,
} from "date-fns";
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconSearch,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { DayView } from "@/components/calendar/DayView";
import { CreateEventPopover } from "@/components/calendar/CreateEventDialog";
import { CommandPalette } from "@/components/calendar/CommandPalette";
import { KeyboardShortcutsHelp } from "@/components/calendar/KeyboardShortcutsHelp";
import { GoogleConnectBanner } from "@/components/calendar/GoogleConnectBanner";
import { PeopleSearchDialog } from "@/components/calendar/PeopleSearchDialog";
import { EventDetailPanel } from "@/components/calendar/EventDetailPanel";
import { useCalendarContext } from "@/components/layout/AppLayout";
import { useEvents, useUpdateEvent, useDeleteEvent } from "@/hooks/use-events";
import { useOverlayPeople } from "@/hooks/use-overlay-people";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { AgentToggleButton } from "@agent-native/core/client";
import { toast } from "sonner";
import type { CalendarEvent } from "@shared/api";

type ViewMode = "month" | "week" | "day";

const viewModeLabels: Record<ViewMode, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
};

export default function CalendarView() {
  const {
    selectedDate,
    setSelectedDate,
    peopleSearchOpen,
    setPeopleSearchOpen,
    eventDetailSidebar,
    sidebarEvent,
    setSidebarEvent,
  } = useCalendarContext();
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  const googleStatus = useGoogleAuthStatus();
  const { data: overlayPeople = [] } = useOverlayPeople();
  const overlayEmails = useMemo(
    () => overlayPeople.map((p) => p.email),
    [overlayPeople],
  );
  const isGoogleConnected = googleStatus.data?.connected ?? false;
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();

  // Compute date range for query based on view
  const { from, to } = useMemo(() => {
    switch (viewMode) {
      case "month": {
        const ms = startOfMonth(selectedDate);
        const me = endOfMonth(selectedDate);
        return {
          from: startOfWeek(ms).toISOString(),
          to: endOfWeek(me).toISOString(),
        };
      }
      case "week": {
        return {
          from: startOfWeek(selectedDate).toISOString(),
          to: endOfWeek(selectedDate).toISOString(),
        };
      }
      case "day": {
        const dayStart = new Date(selectedDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(selectedDate);
        dayEnd.setHours(23, 59, 59, 999);
        return { from: dayStart.toISOString(), to: dayEnd.toISOString() };
      }
    }
  }, [viewMode, selectedDate]);

  const {
    data: rawEvents = [],
    error: eventsError,
    isLoading: eventsLoading,
  } = useEvents(from, to, overlayEmails);

  // Apply overlay colors to events
  const events = useMemo(() => {
    const colorMap = new Map(overlayPeople.map((p) => [p.email, p.color]));
    return rawEvents.map((e) => {
      if (e.overlayEmail && colorMap.has(e.overlayEmail)) {
        return { ...e, color: colorMap.get(e.overlayEmail) };
      }
      return e;
    });
  }, [rawEvents, overlayPeople]);

  // Filter events for day view
  const dayEvents = useMemo(
    () =>
      viewMode === "day"
        ? events.filter((e) => isSameDay(parseISO(e.start), selectedDate))
        : events,
    [events, viewMode, selectedDate],
  );

  function handleNavigate(direction: "prev" | "next") {
    const fns =
      direction === "next"
        ? { month: addMonths, week: addWeeks, day: addDays }
        : { month: subMonths, week: subWeeks, day: subDays };
    setSelectedDate(fns[viewMode](selectedDate, 1));
  }

  function handleToday() {
    setSelectedDate(new Date());
  }

  function handleDateSelect(date: Date) {
    setSelectedDate(date);
    if (viewMode === "month") {
      setViewMode("day");
    }
  }

  function handleGoToDate(date: Date) {
    setSelectedDate(date);
    setViewMode("day");
  }

  function handleEditEvent(_event: CalendarEvent) {
    setCreateDialogOpen(true);
  }

  function handleDeleteEvent(eventId: string) {
    deleteEvent.mutate(eventId, {
      onSuccess: () => toast.success("Event deleted"),
      onError: () => toast.error("Failed to delete event"),
    });
  }

  // Move event to a new date (drag-and-drop from MonthView)
  function handleEventDrop(eventId: string, newDate: Date) {
    const event = events.find((e) => e.id === eventId);
    if (!event) return;

    const originalStart = parseISO(event.start);
    const originalEnd = parseISO(event.end);
    const newStart = new Date(originalStart);
    const newEnd = new Date(originalEnd);

    newStart.setFullYear(
      newDate.getFullYear(),
      newDate.getMonth(),
      newDate.getDate(),
    );
    newEnd.setFullYear(
      newDate.getFullYear(),
      newDate.getMonth(),
      newDate.getDate(),
    );

    updateEvent.mutate(
      {
        id: eventId,
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
      },
      {
        onSuccess: () => toast.success("Event moved"),
        onError: () => toast.error("Failed to move event"),
      },
    );
  }

  // Move/resize event to new start/end times (drag from Week/Day views)
  function handleEventTimeChange(
    eventId: string,
    newStart: Date,
    newEnd: Date,
  ) {
    // Skip no-op drags (dropped back in same spot)
    const event = events.find((e) => e.id === eventId);
    if (event) {
      const oldStart = parseISO(event.start).getTime();
      const oldEnd = parseISO(event.end).getTime();
      if (oldStart === newStart.getTime() && oldEnd === newEnd.getTime()) {
        return;
      }
    }

    updateEvent.mutate(
      {
        id: eventId,
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
      },
      {
        onSuccess: () => toast.success("Event updated"),
        onError: () => toast.error("Failed to update event"),
      },
    );
  }

  // IconKeyboard shortcuts — don't fire when user is typing in an input
  const isTypingInInput = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    return (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    );
  }, []);

  useEffect(() => {
    const openShortcuts = () => setShortcutsHelpOpen(true);
    window.addEventListener("calendar:open-shortcuts", openShortcuts);
    return () =>
      window.removeEventListener("calendar:open-shortcuts", openShortcuts);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+K / Ctrl+K — always open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      // Skip all other shortcuts when typing or when a dialog is open
      if (isTypingInInput(e)) return;
      if (createDialogOpen || shortcutsHelpOpen) return;

      // Delete/Backspace — delete the selected sidebar event
      if ((e.key === "Delete" || e.key === "Backspace") && sidebarEvent) {
        e.preventDefault();
        handleDeleteEvent(sidebarEvent.id);
        setSidebarEvent(null);
        return;
      }

      // Don't intercept keyboard shortcuts with modifier keys (Cmd+C, Ctrl+V, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "j":
        case "n":
          e.preventDefault();
          handleNavigate("next");
          break;
        case "k":
          e.preventDefault();
          handleNavigate("prev");
          break;
        case "p":
          e.preventDefault();
          setPeopleSearchOpen(true);
          break;
        case "t":
          handleToday();
          break;
        case "m":
          setViewMode("month");
          break;
        case "w":
          setViewMode("week");
          break;
        case "d":
          setViewMode("day");
          break;
        case "c":
          e.preventDefault();
          setCreateDialogOpen(true);
          break;
        case "/":
          e.preventDefault();
          setCommandPaletteOpen(true);
          break;
        case "?":
          setShortcutsHelpOpen(true);
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    createDialogOpen,
    shortcutsHelpOpen,
    isTypingInInput,
    viewMode,
    sidebarEvent,
  ]);

  const headerLabel = (() => {
    switch (viewMode) {
      case "month":
        return format(selectedDate, "MMMM yyyy");
      case "week": {
        const ws = startOfWeek(selectedDate);
        const we = endOfWeek(selectedDate);
        return `${format(ws, "MMM d")} – ${format(we, "d, yyyy")}`;
      }
      case "day":
        return format(selectedDate, "EEEE, MMMM d, yyyy");
    }
  })();

  return (
    <TooltipProvider delayDuration={500}>
      <div className="flex h-full">
        {/* Left: calendar area (header + grid) */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Google Calendar connect banner — show when not connected OR when there's a credentials error */}
          {(!googleStatus.isLoading &&
            googleStatus.data &&
            !isGoogleConnected) ||
          eventsError ? (
            <GoogleConnectBanner />
          ) : null}

          {/* Error detail */}
          {eventsError && (
            <div className="shrink-0 border-b border-destructive/20 bg-destructive/[0.06] px-4 py-1.5 text-xs text-destructive/70">
              {eventsError.message}
            </div>
          )}

          {/* Top bar */}
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
            {/* Left: view mode dropdown */}
            <div className="flex shrink-0 items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 px-2.5 text-sm font-semibold"
                  >
                    {viewModeLabels[viewMode]}
                    <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setViewMode("day")}>
                    Day
                    <kbd className="ml-auto text-[10px] text-muted-foreground">
                      D
                    </kbd>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setViewMode("week")}>
                    Week
                    <kbd className="ml-auto text-[10px] text-muted-foreground">
                      W
                    </kbd>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setViewMode("month")}>
                    Month
                    <kbd className="ml-auto text-[10px] text-muted-foreground">
                      M
                    </kbd>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Center: today, nav arrows, date label */}
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleToday}
                    className="h-7 px-2.5 text-xs font-medium"
                  >
                    Today
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>
                    Go to today{" "}
                    <kbd className="ml-1 rounded border border-border bg-muted px-1 font-mono text-[10px]">
                      T
                    </kbd>
                  </p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleNavigate("prev")}
                    className="h-7 w-7"
                  >
                    <IconChevronLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>
                    Previous{" "}
                    <kbd className="ml-1 rounded border border-border bg-muted px-1 font-mono text-[10px]">
                      K
                    </kbd>
                  </p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleNavigate("next")}
                    className="h-7 w-7"
                  >
                    <IconChevronRight className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>
                    Next{" "}
                    <kbd className="ml-1 rounded border border-border bg-muted px-1 font-mono text-[10px]">
                      J
                    </kbd>
                  </p>
                </TooltipContent>
              </Tooltip>

              <span className="ml-1 min-w-0 flex-1 truncate whitespace-nowrap text-center text-sm font-semibold">
                {headerLabel}
              </span>
            </div>

            {/* Right: search, new event */}
            <div className="flex shrink-0 items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setCommandPaletteOpen(true)}
                  >
                    <IconSearch className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>
                    IconSearch{" "}
                    <kbd className="ml-1 rounded border border-border bg-muted px-1 font-mono text-[10px]">
                      /
                    </kbd>
                  </p>
                </TooltipContent>
              </Tooltip>

              <CreateEventPopover
                open={createDialogOpen}
                onOpenChange={setCreateDialogOpen}
                defaultDate={selectedDate}
              />
              <AgentToggleButton />
            </div>
          </div>

          {/* Calendar grid */}
          <div className="flex-1 overflow-hidden">
            {viewMode === "month" && (
              <MonthView
                events={events}
                selectedDate={selectedDate}
                onDateSelect={handleDateSelect}
                onEditEvent={handleEditEvent}
                onDeleteEvent={handleDeleteEvent}
                onEventDrop={handleEventDrop}
                isLoading={eventsLoading}
              />
            )}
            {viewMode === "week" && (
              <WeekView
                events={events}
                selectedDate={selectedDate}
                onDateSelect={handleDateSelect}
                onEditEvent={handleEditEvent}
                onDeleteEvent={handleDeleteEvent}
                onEventTimeChange={handleEventTimeChange}
                isLoading={eventsLoading}
              />
            )}
            {viewMode === "day" && (
              <DayView
                events={dayEvents}
                date={selectedDate}
                onEditEvent={handleEditEvent}
                onDeleteEvent={handleDeleteEvent}
                onEventTimeChange={handleEventTimeChange}
                isLoading={eventsLoading}
              />
            )}
          </div>
        </div>

        {/* Event detail sidebar — full height, outside the calendar column */}
        {eventDetailSidebar && (
          <EventDetailPanel
            event={sidebarEvent}
            onClose={() => setSidebarEvent(null)}
            onEdit={handleEditEvent}
            onDelete={handleDeleteEvent}
          />
        )}

        {/* Dialogs */}
        <CommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          events={events}
          onGoToDate={handleGoToDate}
          onEventClick={(event) => {
            setCommandPaletteOpen(false);
            handleGoToDate(parseISO(event.start));
          }}
          onCreateEvent={() => {
            setCommandPaletteOpen(false);
            setCreateDialogOpen(true);
          }}
          onViewChange={setViewMode}
          onToday={handleToday}
        />
        <KeyboardShortcutsHelp
          open={shortcutsHelpOpen}
          onClose={() => setShortcutsHelpOpen(false)}
        />
        <PeopleSearchDialog
          open={peopleSearchOpen}
          onOpenChange={setPeopleSearchOpen}
        />
      </div>
    </TooltipProvider>
  );
}
