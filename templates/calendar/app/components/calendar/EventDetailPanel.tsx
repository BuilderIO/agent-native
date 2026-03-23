import {
  format,
  parseISO,
  differenceInMinutes,
  differenceInHours,
} from "date-fns";
import { X, Clock, MapPin, Trash2, Edit2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@shared/api";

interface EventDetailPanelProps {
  event: CalendarEvent | null;
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (eventId: string) => void;
}

function formatDuration(start: string, end: string): string {
  const totalMinutes = differenceInMinutes(parseISO(end), parseISO(start));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function getEventColor(event: CalendarEvent): string | null {
  if (event.color) return event.color;
  return event.source === "google" ? "#5085C0" : null;
}

export function EventDetailPanel({
  event,
  onClose,
  onEdit,
  onDelete,
}: EventDetailPanelProps) {
  const isOpen = event !== null;
  const color = event ? getEventColor(event) : null;

  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out",
        isOpen ? "w-80" : "w-0",
      )}
    >
      <div className="h-full w-80 border-l border-border bg-card flex flex-col">
        {event && (
          <>
            {/* Color accent strip */}
            {color && (
              <div
                className="h-1 w-full shrink-0"
                style={{ backgroundColor: color }}
              />
            )}

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Event
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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
              {event.source === "google" && (
                <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Synced from Google Calendar</span>
                </div>
              )}
            </div>

            {/* Actions */}
            {event.source !== "google" && (
              <div className="shrink-0 border-t border-border px-4 py-3 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => onDelete(event.id)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Delete
                </Button>
                <div className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(event)}
                >
                  <Edit2 className="mr-1.5 h-3.5 w-3.5" />
                  Edit
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
