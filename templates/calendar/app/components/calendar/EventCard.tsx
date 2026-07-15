import { useT } from "@agent-native/core/client";
import type { CalendarEvent } from "@shared/api";
import { IconAlertTriangleFilled, IconCalendarOff } from "@tabler/icons-react";

import {
  getEventDisplayColor,
  allOtherDeclined,
  type CalendarColorPreferences,
} from "@/lib/event-colors";
import { isOutOfOfficeEvent } from "@/lib/out-of-office";
import { EventStatusIcon } from "@/lib/rsvp-status";
import { cn } from "@/lib/utils";
import {
  createWorkingLocationDisplayLabels,
  getWorkingLocationChipLabel,
  getWorkingLocationTitle,
  isWorkingLocationEvent,
} from "@/lib/working-location";

interface EventCardProps {
  event: CalendarEvent;
  onClick?: () => void;
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  dimmed?: boolean;
  colorPreferences?: CalendarColorPreferences;
}

export function EventCard({
  event,
  onClick,
  compact = false,
  draggable = false,
  onDragStart,
  onDragEnd,
  dimmed = false,
  colorPreferences,
}: EventCardProps) {
  const t = useT();
  const workingLocationLabels = createWorkingLocationDisplayLabels(t);
  const accentColor = getEventDisplayColor(event, colorPreferences);
  const ownerLabel = event.ownerName || event.overlayEmail;
  const title = getWorkingLocationChipLabel(event, workingLocationLabels);
  const ariaTitle = getWorkingLocationTitle(event, workingLocationLabels);
  const isWorkingLocation = isWorkingLocationEvent(event);
  const isOutOfOffice = isOutOfOfficeEvent(event);

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
          "relative flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs text-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98]",
          canDrag && "cursor-grab active:cursor-grabbing",
          dimmed && "opacity-40",
          event.ownerColor && "pr-3.5",
        )}
        aria-label={
          ownerLabel ? `${ariaTitle}, ${ownerLabel}'s calendar` : ariaTitle
        }
        style={{
          backgroundColor: `${accentColor}25`,
        }}
      >
        {isOutOfOffice ? (
          <IconCalendarOff
            aria-hidden="true"
            className="size-3 shrink-0"
            style={{ color: accentColor }}
          />
        ) : allOtherDeclined(event) ? (
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
        <EventStatusIcon event={event} />
        <span className="truncate font-medium">{title}</span>
        {isWorkingLocation && (
          <span className="hidden shrink-0 text-[10px] font-normal text-foreground/65 sm:inline">
            {t("eventForm.workingLocation")}
          </span>
        )}
        {isOutOfOffice && (
          <span className="hidden shrink-0 text-[10px] font-normal text-foreground/65 sm:inline">
            {t("eventForm.outOfOffice")}
          </span>
        )}
        {event.ownerColor && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1/2 size-1.5 -translate-y-1/2 rounded-full ring-1 ring-background/70"
            style={{ backgroundColor: event.ownerColor }}
          />
        )}
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
        "relative flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98]",
        canDrag && "cursor-grab active:cursor-grabbing",
        dimmed && "opacity-40",
        event.ownerColor && "pr-4",
      )}
      aria-label={
        ownerLabel ? `${ariaTitle}, ${ownerLabel}'s calendar` : ariaTitle
      }
      style={{
        backgroundColor: `${accentColor}25`,
        borderLeft: `2px solid ${accentColor}`,
      }}
    >
      <div className="flex items-center gap-1 truncate">
        {isOutOfOffice && (
          <IconCalendarOff
            aria-hidden="true"
            className="size-3 shrink-0"
            style={{ color: accentColor }}
          />
        )}
        {!isOutOfOffice && allOtherDeclined(event) && (
          <IconAlertTriangleFilled
            size={12}
            className="shrink-0 text-current opacity-70"
          />
        )}
        <EventStatusIcon event={event} />
        <span className="truncate font-medium">{title}</span>
      </div>
      {isWorkingLocation && (
        <span className="truncate text-foreground/70">
          {t("eventForm.workingLocation")}
        </span>
      )}
      {isOutOfOffice && (
        <span className="truncate text-foreground/70">
          {t("eventForm.outOfOffice")}
        </span>
      )}
      {!event.allDay && (
        <span className="text-foreground/70">
          {new Date(event.start).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      )}
      {event.ownerColor && (
        <span
          aria-hidden="true"
          className="absolute right-1.5 top-1.5 size-1.5 rounded-full ring-1 ring-background/70"
          style={{ backgroundColor: event.ownerColor }}
        />
      )}
    </button>
  );
}
