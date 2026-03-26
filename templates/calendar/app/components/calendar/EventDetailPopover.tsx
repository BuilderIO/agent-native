import { useState, useEffect, useCallback } from "react";
import { format, parseISO, differenceInMinutes } from "date-fns";
import {
  X,
  Clock,
  MapPin,
  Trash2,
  Edit2,
  ExternalLink,
  User,
  Video,
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
  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

/** Extract a Zoom/Meet/Teams link from location or description */
function extractMeetingLink(
  event: CalendarEvent,
): { url: string; type: "zoom" | "meet" | "teams" | "link" } | null {
  const text = `${event.location || ""} ${event.description || ""}`;
  // Zoom
  const zoom = text.match(/https?:\/\/[^\s]*zoom\.us\/j\/[^\s)"]*/i);
  if (zoom) return { url: zoom[0], type: "zoom" };
  // Google Meet
  const meet = text.match(/https?:\/\/meet\.google\.com\/[^\s)"]*/i);
  if (meet) return { url: meet[0], type: "meet" };
  // Teams
  const teams = text.match(/https?:\/\/teams\.microsoft\.com\/[^\s)"]*/i);
  if (teams) return { url: teams[0], type: "teams" };
  return null;
}

function getMeetingLabel(type: "zoom" | "meet" | "teams" | "link"): string {
  switch (type) {
    case "zoom":
      return "Join Zoom";
    case "meet":
      return "Join Meet";
    case "teams":
      return "Join Teams";
    default:
      return "Join Meeting";
  }
}

/** Check if a string looks like a URL */
function isUrl(str: string): boolean {
  return /^https?:\/\//i.test(str.trim());
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

  const meetingLink = extractMeetingLink(event);

  // Keyboard shortcut: Cmd+J to join meeting when popover is open
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open || !meetingLink) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        window.open(meetingLink.url, "_blank");
      }
    },
    [open, meetingLink],
  );

  useEffect(() => {
    if (open) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  const locationIsUrl = event.location ? isUrl(event.location) : false;
  const locationIsMeetingLink =
    meetingLink && event.location?.includes(meetingLink.url);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-[400px] p-0 overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
        <div className="max-h-[450px] overflow-y-auto px-5 py-5 space-y-4">
          {/* Title */}
          <h2 className="text-xl font-semibold text-foreground leading-tight">
            {event.title}
          </h2>

          {/* Time */}
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              {event.allDay ? (
                <span>
                  All day &middot;{" "}
                  {format(parseISO(event.start), "MMMM d, yyyy")}
                </span>
              ) : (
                <>
                  <div>
                    <span className="text-foreground font-medium">
                      {format(parseISO(event.start), "h:mm a")}
                    </span>
                    <span className="mx-2 text-muted-foreground/50">→</span>
                    <span className="text-foreground font-medium">
                      {format(parseISO(event.end), "h:mm a")}
                    </span>
                    <span className="ml-2 text-muted-foreground/60 text-xs">
                      {formatDuration(event.start, event.end)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-muted-foreground text-xs">
                    {format(parseISO(event.start), "EEE MMM d")}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Location — skip if it's just the meeting link */}
          {event.location && !locationIsMeetingLink && (
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              {locationIsUrl ? (
                <a
                  href={event.location}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline truncate block max-w-full"
                  title={event.location}
                >
                  {event.location}
                </a>
              ) : (
                <span>{event.location}</span>
              )}
            </div>
          )}

          {/* Description */}
          {event.description && (
            <p className="rounded-lg bg-muted/40 px-3.5 py-3 text-sm leading-relaxed text-foreground/80 max-h-32 overflow-y-auto">
              {event.description}
            </p>
          )}

          {/* Google Calendar badge */}
          {event.source === "google" && !event.overlayEmail && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
              <ExternalLink className="h-3 w-3" />
              <span>Google Calendar</span>
              {event.accountEmail && (
                <span className="text-muted-foreground/40">
                  · {event.accountEmail}
                </span>
              )}
            </div>
          )}

          {/* Overlay person badge */}
          {event.overlayEmail && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              <span>{event.overlayEmail}</span>
            </div>
          )}
        </div>

        {/* Meeting link / Join button */}
        {meetingLink && (
          <div className="border-t border-border px-5 py-3">
            <a
              href={meetingLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium py-2.5 text-sm transition-colors"
            >
              <Video className="h-4 w-4" />
              {getMeetingLabel(meetingLink.type)}
              <span className="ml-auto text-xs text-white/50 flex items-center gap-0.5">
                <kbd className="text-[10px]">⌘</kbd>
                <kbd className="text-[10px]">J</kbd>
              </span>
            </a>
          </div>
        )}

        {/* Actions */}
        {event.source !== "google" && !event.overlayEmail && (
          <div className="shrink-0 border-t border-border px-5 py-3 flex items-center gap-2">
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
