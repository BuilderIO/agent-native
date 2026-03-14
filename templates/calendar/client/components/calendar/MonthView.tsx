import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  format,
  parseISO,
} from "date-fns";
import { cn } from "@/lib/utils";
import { EventCard } from "./EventCard";
import type { CalendarEvent } from "@shared/api";

interface MonthViewProps {
  events: CalendarEvent[];
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  onEventClick?: (event: CalendarEvent) => void;
}

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthView({ events, selectedDate, onDateSelect, onEventClick }: MonthViewProps) {
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  function getEventsForDay(day: Date) {
    return events.filter((e) => {
      const eventDate = parseISO(e.start);
      return isSameDay(eventDate, day);
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAY_HEADERS.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-xs font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid flex-1 grid-cols-7 auto-rows-fr">
        {days.map((day) => {
          const dayEvents = getEventsForDay(day);
          const inMonth = isSameMonth(day, selectedDate);
          const today = isToday(day);
          const selected = isSameDay(day, selectedDate);

          return (
            <div
              key={day.toISOString()}
              onClick={() => onDateSelect(day)}
              className={cn(
                "min-h-[80px] cursor-pointer border-b border-r border-border p-1 transition-colors hover:bg-accent/50",
                !inMonth && "opacity-40"
              )}
            >
              <div className="flex items-center justify-center">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-sm",
                    today && "bg-primary text-primary-foreground font-semibold",
                    selected && !today && "bg-accent text-accent-foreground font-medium"
                  )}
                >
                  {format(day, "d")}
                </span>
              </div>
              <div className="mt-1 space-y-0.5 overflow-hidden">
                {dayEvents.slice(0, 3).map((event) => (
                  <div
                    key={event.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick?.(event);
                    }}
                  >
                    <EventCard event={event} compact />
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <span className="block px-1.5 text-xs text-muted-foreground">
                    +{dayEvents.length - 3} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
