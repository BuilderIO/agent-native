import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@shared/api";

interface EventCardProps {
  event: CalendarEvent;
  onClick?: () => void;
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  dimmed?: boolean;
}

function getEventAccentColor(event: CalendarEvent): string {
  if (event.color) return event.color;
  return event.source === "google" ? "#5085C0" : "hsl(var(--primary))";
}

export function EventCard({
  event,
  onClick,
  compact = false,
  draggable = false,
  onDragStart,
  onDragEnd,
  dimmed = false,
}: EventCardProps) {
  const accentColor = getEventAccentColor(event);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", event.id);
    e.dataTransfer.effectAllowed = "move";
    onDragStart?.(event.id);
  };

  if (compact) {
    return (
      <button
        onClick={onClick}
        draggable={draggable}
        onDragStart={draggable ? handleDragStart : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs text-foreground transition-all hover:brightness-110",
          draggable && "cursor-grab active:cursor-grabbing",
          dimmed && "opacity-40",
        )}
        style={{
          backgroundColor: `${accentColor}25`,
        }}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: accentColor }}
        />
        <span className="truncate font-medium">{event.title}</span>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-all hover:brightness-110",
        draggable && "cursor-grab active:cursor-grabbing",
        dimmed && "opacity-40",
      )}
      style={{
        backgroundColor: `${accentColor}25`,
        borderLeft: `2px solid ${accentColor}`,
      }}
    >
      <span className="truncate font-medium">{event.title}</span>
      {!event.allDay && (
        <span className="text-foreground/70">
          {new Date(event.start).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      )}
    </button>
  );
}
