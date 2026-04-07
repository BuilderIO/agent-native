import { cn } from "@/lib/utils";
import { getEventAutoColor, allOtherDeclined } from "@/lib/event-colors";
import { IconAlertTriangleFilled } from "@tabler/icons-react";
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
  return getEventAutoColor(event);
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

  const canDrag = draggable && !event.overlayEmail;

  if (compact) {
    return (
      <button
        onClick={onClick}
        draggable={canDrag}
        onDragStart={canDrag ? handleDragStart : undefined}
        onDragEnd={canDrag ? onDragEnd : undefined}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs text-foreground transition-all hover:brightness-110",
          canDrag && "cursor-grab active:cursor-grabbing",
          dimmed && "opacity-40",
        )}
        style={{
          backgroundColor: `${accentColor}25`,
        }}
      >
        {allOtherDeclined(event) ? (
          <IconAlertTriangleFilled
            size={10}
            className="shrink-0 text-current opacity-70"
          />
        ) : (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
        )}
        <span className="truncate font-medium">{event.title}</span>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      draggable={canDrag}
      onDragStart={canDrag ? handleDragStart : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-all hover:brightness-110",
        canDrag && "cursor-grab active:cursor-grabbing",
        dimmed && "opacity-40",
      )}
      style={{
        backgroundColor: `${accentColor}25`,
        borderLeft: `2px solid ${accentColor}`,
      }}
    >
      <div className="flex items-center gap-1 truncate">
        {allOtherDeclined(event) && (
          <IconAlertTriangleFilled
            size={12}
            className="shrink-0 text-current opacity-70"
          />
        )}
        <span className="truncate font-medium">{event.title}</span>
      </div>
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
