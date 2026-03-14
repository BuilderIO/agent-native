import { useState, useMemo } from "react";
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
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { DayView } from "@/components/calendar/DayView";
import { EventDialog } from "@/components/calendar/EventDialog";
import { CreateEventDialog } from "@/components/calendar/CreateEventDialog";
import { GoogleSyncButton } from "@/components/calendar/GoogleSyncButton";
import { useEvents } from "@/hooks/use-events";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
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

  const googleStatus = useGoogleAuthStatus();

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
    const fn =
      direction === "next"
        ? { month: addMonths, week: addWeeks, day: addDays }
        : { month: subMonths, week: subWeeks, day: subDays };
    setSelectedDate((d) => fn[viewMode](d, 1));
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

  const headerLabel = (() => {
    switch (viewMode) {
      case "month":
        return format(selectedDate, "MMMM yyyy");
      case "week": {
        const ws = startOfWeek(selectedDate);
        const we = endOfWeek(selectedDate);
        return `${format(ws, "MMM d")} - ${format(we, "MMM d, yyyy")}`;
      }
      case "day":
        return format(selectedDate, "EEEE, MMMM d, yyyy");
    }
  })();

  return (
    <div className="dark flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleToday}>
            Today
          </Button>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleNavigate("prev")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleNavigate("next")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <h2 className="text-lg font-semibold">{headerLabel}</h2>
        </div>

        <div className="flex items-center gap-3">
          {googleStatus.data?.connected && <GoogleSyncButton />}

          <Tabs
            value={viewMode}
            onValueChange={(v) => setViewMode(v as ViewMode)}
          >
            <TabsList>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="day">Day</TabsTrigger>
            </TabsList>
          </Tabs>

          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Event
          </Button>
        </div>
      </div>

      {/* Calendar View */}
      <div className="flex-1 overflow-hidden rounded-lg border border-border bg-card">
        {viewMode === "month" && (
          <MonthView
            events={events}
            selectedDate={selectedDate}
            onDateSelect={handleDateSelect}
            onEventClick={handleEventClick}
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
    </div>
  );
}
