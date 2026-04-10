import { useState, useMemo } from "react";
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
import { EventDetailPopover } from "./EventDetailPopover";
import { useIsMobile } from "@/hooks/use-mobile";
import type { CalendarEvent } from "@shared/api";

interface MonthViewProps {
  events: CalendarEvent[];
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  onDeleteEvent?: (eventId: string) => void;
  onEventDrop?: (eventId: string, newDate: Date) => void;
  isLoading?: boolean;
}

// Skeleton pill widths per day-of-week (Sun–Sat), empty = no skeletons
const MONTH_SKELETON_WIDTHS = [
  ["75%"],
  ["85%", "60%"],
  ["70%"],
  ["90%", "55%"],
  ["80%"],
  ["65%"],
  [],
];

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_HEADERS_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

export function MonthView({
  events,
  selectedDate,
  onDateSelect,
  onDeleteEvent,
  onEventDrop,
  isLoading = false,
}: MonthViewProps) {
  const isMobile = useIsMobile();
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  // Pre-group events by date key once so each cell does O(1) lookup
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = format(parseISO(e.start), "yyyy-MM-dd");
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    return map;
  }, [events]);

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
        {(isMobile ? WEEKDAY_HEADERS_SHORT : WEEKDAY_HEADERS).map((day, i) => (
          <div
            key={`${day}-${i}`}
            className="py-2 text-center text-[10px] font-medium text-muted-foreground tracking-wide sm:py-2.5 sm:text-xs"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid flex-1 auto-rows-fr grid-cols-7">
        {days.map((day) => {
          const dayEvents = eventsByDay.get(format(day, "yyyy-MM-dd")) ?? [];
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
                "group relative min-h-[60px] cursor-pointer border-b border-r border-border p-1 sm:min-h-[90px] sm:p-1.5",
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
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium sm:h-7 sm:w-7 sm:text-sm",
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

              {/* Events / Skeleton */}
              <div className="mt-1 space-y-0.5 overflow-hidden">
                {isLoading &&
                  MONTH_SKELETON_WIDTHS[day.getDay()].map((w, i) => (
                    <div
                      key={i}
                      className="h-4 animate-pulse rounded bg-muted"
                      style={{ width: w }}
                    />
                  ))}
                {!isLoading &&
                  dayEvents.slice(0, isMobile ? 2 : 3).map((event) => (
                    <EventDetailPopover
                      key={event.id}
                      event={event}
                      onDelete={onDeleteEvent ?? (() => {})}
                    >
                      <div onClick={(e) => e.stopPropagation()}>
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
                    </EventDetailPopover>
                  ))}
                {!isLoading && dayEvents.length > (isMobile ? 2 : 3) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDateSelect(day);
                    }}
                    className="block w-full rounded px-1 py-0.5 text-left text-[10px] text-muted-foreground hover:bg-accent/50 sm:px-1.5 sm:text-xs"
                  >
                    +{dayEvents.length - (isMobile ? 2 : 3)} more
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
