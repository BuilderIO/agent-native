import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@shared/api";

interface EventCardProps {
  event: CalendarEvent;
  onClick?: () => void;
  compact?: boolean;
}

export function EventCard({ event, onClick, compact = false }: EventCardProps) {
  const colorClass = event.source === "google" ? "bg-green-500" : "bg-primary";

  if (compact) {
    return (
      <button
        onClick={onClick}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs hover:bg-accent transition-colors truncate"
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", colorClass)} />
        <span className="truncate">{event.title}</span>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-md border-l-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
        event.source === "google" ? "border-l-green-500" : "border-l-primary"
      )}
    >
      <span className="font-medium truncate">{event.title}</span>
      {!event.allDay && (
        <span className="text-muted-foreground">
          {format(parseISO(event.start), "h:mm a")}
        </span>
      )}
    </button>
  );
}
