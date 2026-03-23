import { useState } from "react";
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
  onEventDrop?: (eventId: string, newDate: Date) => void;
}

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthView({
  events,
  selectedDate,
  onDateSelect,
  onEventClick,
  onEventDrop,
}: MonthViewProps) {
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  function getEventsForDay(day: Date) {
    return events.filter((e) => isSameDay(parseISO(e.start), day));
  }

  function handleDragOver(e: React.DragEvent, dayKey: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverDay(dayKey);
  }

  function handleDrop(e: React.DragEvent, day: Date) {
    e.preventDefault();
    const eventId = e.dataTransfer.getData("text/plain");
    if (eventId && onEventDrop) {
      onEventDrop(eventId, day);
    }
    setDragOverDay(null);
    setDraggingId(null);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-border bg-card">
        {WEEKDAY_HEADERS.map((day) => (
          <div
            key={day}
            className="py-2.5 text-center text-xs font-medium text-muted-foreground tracking-wide"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid flex-1 auto-rows-fr grid-cols-7">
        {days.map((day) => {
          const dayEvents = getEventsForDay(day);
          const inMonth = isSameMonth(day, selectedDate);
          const today = isToday(day);
          const selected = isSameDay(day, selectedDate);
          const dayKey = day.toISOString();
          const isDragTarget = dragOverDay === dayKey;

          return (
            <div
              key={dayKey}
              onClick={() => onDateSelect(day)}
              onDragOver={(e) => handleDragOver(e, dayKey)}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragOverDay(dayKey);
              }}
              onDragLeave={(e) => {
                // Only clear if leaving to outside this cell
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverDay(null);
                }
              }}
              onDrop={(e) => handleDrop(e, day)}
              className={cn(
                "group relative min-h-[90px] cursor-pointer border-b border-r border-border p-1.5 transition-colors",
                !inMonth && "opacity-35",
                isDragTarget
                  ? "bg-primary/10 ring-1 ring-inset ring-primary/30"
                  : "hover:bg-accent/40",
              )}
            >
              {/* Date number */}
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium transition-colors",
                    today && "bg-primary text-primary-foreground font-semibold",
                    selected && !today && "bg-accent text-accent-foreground",
                    !today && !selected && "text-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>

                {/* Subtle "+" on hover */}
                {inMonth && (
                  <span className="mr-0.5 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60">
                    +
                  </span>
                )}
              </div>

              {/* Events */}
              <div className="mt-1 space-y-0.5 overflow-hidden">
                {dayEvents.slice(0, 3).map((event) => (
                  <div
                    key={event.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick?.(event);
                    }}
                  >
                    <EventCard
                      event={event}
                      compact
                      draggable
                      onDragStart={(id) => setDraggingId(id)}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverDay(null);
                      }}
                      dimmed={draggingId === event.id}
                    />
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDateSelect(day);
                    }}
                    className="block w-full rounded px-1.5 py-0.5 text-left text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
                  >
                    +{dayEvents.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
