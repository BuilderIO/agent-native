import type { CalendarEvent } from "@shared/api";
import { IconCalendarOff } from "@tabler/icons-react";

import { getOutOfOfficeSegment } from "@/lib/out-of-office";

import { EventDetailPopover } from "./EventDetailPopover";

interface OutOfOfficeEventProps {
  event: CalendarEvent;
  day: Date;
  hourHeight: number;
  color: string;
  label: string;
  markerIndex?: number;
  compactMarker?: boolean;
  canDrag?: boolean;
  isBeingDragged?: boolean;
  isDragging?: boolean;
  isDragTargetDay?: boolean;
  overrideTop?: number | null;
  overrideHeight?: number | null;
  onMovePointerDown?: (event: React.PointerEvent, startsOnDay: boolean) => void;
  onResizeTopPointerDown?: (event: React.PointerEvent) => void;
  onResizeBottomPointerDown?: (event: React.PointerEvent) => void;
  shouldSuppressClick?: () => boolean;
  onDelete: (eventId: string) => void;
  isDraft: boolean;
  defaultOpen: boolean;
  onTitleSave?: (eventId: string, title: string, accountEmail?: string) => void;
  onDismissNew?: (eventId: string, accountEmail?: string) => void;
  onDraftUpdate?: (
    eventId: string,
    updates: Partial<CalendarEvent> & {
      addGoogleMeet?: boolean;
      addZoom?: boolean;
      workingLocationType?: "homeOffice" | "officeLocation" | "customLocation";
      workingLocationLabel?: string;
    },
  ) => void;
  onDraftCreate?: (
    eventId: string,
    updates?: Partial<CalendarEvent> & {
      addGoogleMeet?: boolean;
      addZoom?: boolean;
    },
  ) => void;
  onDraftDiscard?: (eventId: string) => void;
  onOpenChange?: (open: boolean) => void;
}

export function OutOfOfficeEvent({
  event,
  day,
  hourHeight,
  color,
  label,
  markerIndex = 0,
  compactMarker = false,
  canDrag = false,
  isBeingDragged = false,
  isDragging = false,
  isDragTargetDay = false,
  overrideTop = null,
  overrideHeight = null,
  onMovePointerDown,
  onResizeTopPointerDown,
  onResizeBottomPointerDown,
  shouldSuppressClick,
  onDelete,
  isDraft,
  defaultOpen,
  onTitleSave,
  onDismissNew,
  onDraftUpdate,
  onDraftCreate,
  onDraftDiscard,
  onOpenChange,
}: OutOfOfficeEventProps) {
  const segment = getOutOfOfficeSegment(event, day);
  const hasDragOverride =
    isBeingDragged &&
    isDragTargetDay &&
    overrideTop !== null &&
    overrideHeight !== null;
  if (isBeingDragged && !isDragTargetDay) return null;
  if (!segment && !hasDragOverride) return null;

  const top = hasDragOverride
    ? overrideTop
    : ((segment?.topMinutes ?? 0) / 60) * hourHeight;
  const height = hasDragOverride
    ? overrideHeight
    : ((segment?.durationMinutes ?? 1) / 60) * hourHeight;
  const title = event.title || label;
  const startsOnDay = hasDragOverride || segment?.startsOnDay === true;
  const endsOnDay = hasDragOverride || segment?.endsOnDay === true;
  const canManipulate = canDrag && startsOnDay;

  return (
    <>
      <div
        data-out-of-office-event={event.id}
        className="pointer-events-none absolute inset-x-0 z-0"
        style={{ top: `${top}px`, height: `${height}px` }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundColor: `color-mix(in srgb, ${color} 7%, transparent)`,
            boxShadow: `inset 2px 0 0 color-mix(in srgb, ${color} 28%, transparent)`,
          }}
        />
      </div>
      <div
        data-out-of-office-trigger={event.id}
        className={`pointer-events-auto absolute ${
          isBeingDragged && isDragging ? "z-[100]" : "z-40"
        }`}
        style={{
          top: `${top + 4}px`,
          right: `${4 + (compactMarker ? markerIndex * 24 : 0)}px`,
          left: compactMarker ? undefined : `${4 + markerIndex * 12}px`,
        }}
      >
        <EventDetailPopover
          event={event}
          onDelete={onDelete}
          isDraft={isDraft}
          defaultOpen={defaultOpen}
          onTitleSave={onTitleSave}
          onDismissNew={onDismissNew}
          onDraftUpdate={onDraftUpdate}
          onDraftCreate={onDraftCreate}
          onDraftDiscard={onDraftDiscard}
          onOpenChange={onOpenChange}
        >
          <button
            onPointerDown={(pointerEvent) =>
              onMovePointerDown?.(pointerEvent, startsOnDay)
            }
            onClick={(clickEvent) => {
              if (shouldSuppressClick?.()) {
                clickEvent.preventDefault();
                clickEvent.stopPropagation();
              }
            }}
            className={`flex h-5 max-w-full items-center truncate rounded-sm text-[10px] font-medium text-foreground outline-none transition-[filter,box-shadow] hover:brightness-110 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 ${
              compactMarker
                ? "w-5 justify-center px-0"
                : "gap-1 px-1.5 text-left"
            } ${canManipulate ? "cursor-grab" : ""} ${
              isBeingDragged && isDragging ? "cursor-grabbing shadow-lg" : ""
            }`}
            aria-label={`${label}: ${title}`}
            style={{
              backgroundColor: `color-mix(in srgb, ${color} 20%, hsl(var(--background)))`,
              boxShadow: `0 0 0 1px color-mix(in srgb, ${color} 34%, transparent)`,
            }}
          >
            <IconCalendarOff
              aria-hidden="true"
              className="size-3 shrink-0"
              style={{ color }}
            />
            {!compactMarker && <span className="truncate">{title}</span>}
          </button>
        </EventDetailPopover>
      </div>
      {canManipulate && (
        <div
          data-resize-handle="true"
          data-out-of-office-resize="top"
          onPointerDown={(pointerEvent) => {
            pointerEvent.stopPropagation();
            onResizeTopPointerDown?.(pointerEvent);
          }}
          className="pointer-events-auto absolute right-1 z-40 h-1.5 w-5 cursor-n-resize"
          style={{ top: `${top}px`, touchAction: "none" }}
        />
      )}
      {canManipulate && endsOnDay && (
        <div
          data-resize-handle="true"
          data-out-of-office-resize="bottom"
          onPointerDown={(pointerEvent) => {
            pointerEvent.stopPropagation();
            onResizeBottomPointerDown?.(pointerEvent);
          }}
          className="pointer-events-auto absolute right-1 z-40 h-1.5 w-5 cursor-s-resize"
          style={{ top: `${top + height - 6}px`, touchAction: "none" }}
        />
      )}
    </>
  );
}
