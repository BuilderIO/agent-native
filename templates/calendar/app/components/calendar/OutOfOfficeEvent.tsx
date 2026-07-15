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
  if (!segment) return null;

  const top = (segment.topMinutes / 60) * hourHeight;
  const height = (segment.durationMinutes / 60) * hourHeight;
  const title = event.title || label;

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
        className="pointer-events-auto absolute z-40"
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
            className={`flex h-5 max-w-full items-center truncate rounded-sm text-[10px] font-medium text-foreground outline-none transition-[filter,box-shadow] hover:brightness-110 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 ${
              compactMarker
                ? "w-5 justify-center px-0"
                : "gap-1 px-1.5 text-left"
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
    </>
  );
}
