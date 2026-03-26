import { useState } from "react";
import { format, parseISO, differenceInMinutes } from "date-fns";
import {
  X,
  Clock,
  MapPin,
  Trash2,
  Edit2,
  ExternalLink,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import type { CalendarEvent } from "@shared/api";

function formatDuration(start: string, end: string): string {
  const totalMinutes = differenceInMinutes(parseISO(end), parseISO(start));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

interface EventDetailPopoverProps {
  event: CalendarEvent;
  children: React.ReactNode;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (eventId: string) => void;
}

export function EventDetailPopover({
  event,
  children,
  onEdit,
  onDelete,
}: EventDetailPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-80 p-0 overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Event
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="max-h-80 overflow-y-auto px-4 py-4 space-y-4">
          {/* Title */}
          <h2 className="text-lg font-semibold text-foreground leading-tight">
            {event.title}
          </h2>

          {/* Time */}
          <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              {event.allDay ? (
                <span>
                  All day &middot;{" "}
                  {format(parseISO(event.start), "MMMM d, yyyy")}
                </span>
              ) : (
                <>
                  <span className="text-foreground">
                    {format(parseISO(event.start), "h:mm a")}
                    {" → "}
                    {format(parseISO(event.end), "h:mm a")}
                  </span>
                  <span className="ml-2 text-muted-foreground/70">
                    {formatDuration(event.start, event.end)}
                  </span>
                  <div className="mt-0.5 text-muted-foreground">
                    {format(parseISO(event.start), "EEE MMM d")}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Location */}
          {event.location && (
            <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{event.location}</span>
            </div>
          )}

          {/* Description */}
          {event.description && (
            <p className="rounded-md bg-muted/50 px-3 py-2.5 text-sm leading-relaxed text-foreground">
              {event.description}
            </p>
          )}

          {/* Google Calendar badge */}
          {event.source === "google" && !event.overlayEmail && (
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Synced from Google Calendar</span>
            </div>
          )}

          {/* Overlay person badge */}
          {event.overlayEmail && (
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              <span>{event.overlayEmail}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        {event.source !== "google" && !event.overlayEmail && (
          <div className="shrink-0 border-t border-border px-4 py-3 flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => {
                onDelete(event.id);
                setOpen(false);
              }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onEdit(event);
                setOpen(false);
              }}
            >
              <Edit2 className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
