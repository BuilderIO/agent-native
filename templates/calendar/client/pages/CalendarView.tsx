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
  ChevronLeft,
  ChevronRight,
  Plus,
  Keyboard,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { DayView } from "@/components/calendar/DayView";
import { EventDialog } from "@/components/calendar/EventDialog";
import { CreateEventDialog } from "@/components/calendar/CreateEventDialog";
import { GoogleSyncButton } from "@/components/calendar/GoogleSyncButton";
import { CommandPalette } from "@/components/calendar/CommandPalette";
import { KeyboardShortcutsHelp } from "@/components/calendar/KeyboardShortcutsHelp";
import { GoogleConnectBanner } from "@/components/calendar/GoogleConnectBanner";
import { useEvents, useUpdateEvent } from "@/hooks/use-events";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { toast } from "sonner";
import type { CalendarEvent } from "@shared/api";

type ViewMode = "month" | "week" | "day";

export default function CalendarView() {
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  const googleStatus = useGoogleAuthStatus();
  const isGoogleConnected = googleStatus.data?.connected ?? false;
  const updateEvent = useUpdateEvent();

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

  const { data: events = [] } = useEvents(from, to);

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
    setSelectedDate((d) => fns[viewMode](d, 1));
  }

  function handleToday() {
    setSelectedDate(new Date());
  }

  function handleEventClick(event: CalendarEvent) {
    setSelectedEvent(event);
    setEventDialogOpen(true);
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

  // Keyboard shortcuts — don't fire when user is typing in an input
  const isTypingInInput = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    return (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    );
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // ⌘K / Ctrl+K — always open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      // Skip all other shortcuts when typing or when a dialog is open
      if (isTypingInInput(e)) return;
      if (eventDialogOpen || createDialogOpen || shortcutsHelpOpen) return;

      switch (e.key) {
        case "j":
        case "n":
          e.preventDefault();
          handleNavigate("next");
          break;
        case "k":
        case "p":
          e.preventDefault();
          handleNavigate("prev");
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
    eventDialogOpen,
    createDialogOpen,
    shortcutsHelpOpen,
    isTypingInInput,
    viewMode,
  ]);

  const headerLabel = (() => {
    switch (viewMode) {
      case "month":
        return format(selectedDate, "MMMM yyyy");
      case "week": {
        const ws = startOfWeek(selectedDate);
        const we = endOfWeek(selectedDate);
        return `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`;
      }
      case "day":
        return format(selectedDate, "EEEE, MMMM d, yyyy");
    }
  })();

  return (
    <TooltipProvider delayDuration={500}>
      <div className="dark flex h-full flex-col gap-3">
        {/* Google Calendar primary CTA — shown when not connected */}
        {!googleStatus.isLoading && googleStatus.data && !isGoogleConnected && (
          <GoogleConnectBanner />
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToday}
                  className="h-8 font-medium"
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

            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleNavigate("prev")}
                    className="h-8 w-8"
                  >
                    <ChevronLeft className="h-4 w-4" />
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
                    className="h-8 w-8"
                  >
                    <ChevronRight className="h-4 w-4" />
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
            </div>

            <h2 className="text-base font-semibold">{headerLabel}</h2>
          </div>

          <div className="flex items-center gap-2">
            {isGoogleConnected && <GoogleSyncButton />}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCommandPaletteOpen(true)}
                >
                  <Search className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>
                  Search{" "}
                  <kbd className="ml-1 rounded border border-border bg-muted px-1 font-mono text-[10px]">
                    ⌘K
                  </kbd>
                </p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setShortcutsHelpOpen(true)}
                >
                  <Keyboard className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>
                  Keyboard shortcuts{" "}
                  <kbd className="ml-1 rounded border border-border bg-muted px-1 font-mono text-[10px]">
                    ?
                  </kbd>
                </p>
              </TooltipContent>
            </Tooltip>

            <Tabs
              value={viewMode}
              onValueChange={(v) => setViewMode(v as ViewMode)}
            >
              <TabsList className="h-8">
                <TabsTrigger value="month" className="h-6 px-3 text-xs">
                  Month
                </TabsTrigger>
                <TabsTrigger value="week" className="h-6 px-3 text-xs">
                  Week
                </TabsTrigger>
                <TabsTrigger value="day" className="h-6 px-3 text-xs">
                  Day
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={() => setCreateDialogOpen(true)}
                  className="h-8 gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  New Event
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>
                  Create event{" "}
                  <kbd className="ml-1 rounded border border-border bg-muted px-1 font-mono text-[10px]">
                    C
                  </kbd>
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Calendar view */}
        <div className="flex-1 overflow-hidden rounded-xl border border-border bg-card">
          {viewMode === "month" && (
            <MonthView
              events={events}
              selectedDate={selectedDate}
              onDateSelect={handleDateSelect}
              onEventClick={handleEventClick}
              onEventDrop={handleEventDrop}
            />
          )}
          {viewMode === "week" && (
            <WeekView
              events={events}
              selectedDate={selectedDate}
              onDateSelect={handleDateSelect}
              onEventClick={handleEventClick}
            />
          )}
          {viewMode === "day" && (
            <DayView
              events={dayEvents}
              date={selectedDate}
              onEventClick={handleEventClick}
            />
          )}
        </div>

        {/* Dialogs */}
        <EventDialog
          event={selectedEvent}
          open={eventDialogOpen}
          onClose={() => {
            setEventDialogOpen(false);
            setSelectedEvent(null);
          }}
        />
        <CreateEventDialog
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
          defaultDate={selectedDate}
        />
        <CommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          events={events}
          onGoToDate={handleGoToDate}
          onEventClick={(event) => {
            setCommandPaletteOpen(false);
            handleEventClick(event);
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
      </div>
    </TooltipProvider>
  );
}
