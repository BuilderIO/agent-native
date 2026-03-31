import {
  format,
  parseISO,
  differenceInMinutes,
  differenceInHours,
} from "date-fns";
import {
  X,
  Clock,
  MapPin,
  Trash2,
  Edit2,
  ExternalLink,
  User,
  PanelRightClose,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getEventAutoColor } from "@/lib/event-colors";
import type { CalendarEvent } from "@shared/api";
import {
  AttendeeApolloPopover,
  ResearchMeetingButton,
} from "@/components/calendar/ApolloPanel";
import { useCalendarContext } from "@/components/layout/AppLayout";

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

function getEventColor(event: CalendarEvent): string {
  return getEventAutoColor(event);
}

export function EventDetailPanel({
  event,
  onClose,
  onEdit,
  onDelete,
}: EventDetailPanelProps) {
  const { setEventDetailSidebar } = useCalendarContext();
  const isOpen = event !== null;
  const color = event ? getEventColor(event) : null;

  const handleUnpin = () => {
    setEventDetailSidebar(false);
    onClose();
  };

  return (
    <TooltipProvider>
      <div className={cn("shrink-0 overflow-hidden", isOpen ? "w-80" : "w-0")}>
        <div className="h-full w-80 border-l border-border bg-card flex flex-col">
          {event && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Event
                </span>
                <div className="flex items-center gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={handleUnpin}
                      >
                        <PanelRightClose className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>Use popover instead</p>
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={onClose}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
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

                {/* Description — strip HTML and gcal invitation cruft */}
                {event.description &&
                  (() => {
                    const hasHtml = /<[a-z][\s\S]*>/i.test(event.description);
                    if (hasHtml) {
                      // Strip gcal invitation HTML and extract text
                      const text = event.description
                        .replace(/<style[\s\S]*?<\/style>/gi, "")
                        .replace(/<[^>]+>/g, " ")
                        .replace(/&nbsp;/g, " ")
                        .replace(/&amp;/g, "&")
                        .replace(/&lt;/g, "<")
                        .replace(/&gt;/g, ">")
                        .replace(/\s+/g, " ")
                        .trim();
                      // Skip if it's just Google Calendar boilerplate
                      if (
                        !text ||
                        /^(Invitation from Google Calendar|Reply for|View all guest info)/i.test(
                          text,
                        )
                      )
                        return null;
                      return (
                        <p className="rounded-md bg-muted/50 px-3 py-2.5 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                          {text}
                        </p>
                      );
                    }
                    return (
                      <p className="rounded-md bg-muted/50 px-3 py-2.5 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                        {event.description}
                      </p>
                    );
                  })()}

                {/* Attendees */}
                {event.attendees && event.attendees.length > 0 && (
                  <div className="flex items-start gap-2.5">
                    <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 space-y-1.5">
                      {event.attendees.map((attendee, i) => (
                        <AttendeeApolloPopover
                          key={attendee.email + i}
                          attendee={attendee}
                        >
                          <div className="flex items-center gap-2 rounded-md hover:bg-muted/40 transition-colors -mx-1 px-1 py-0.5 cursor-pointer">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground shrink-0">
                              {(attendee.displayName || attendee.email)
                                .charAt(0)
                                .toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-foreground truncate">
                                {attendee.displayName || attendee.email}
                              </p>
                              {attendee.displayName && (
                                <p className="text-[11px] text-muted-foreground/60 truncate">
                                  {attendee.email}
                                </p>
                              )}
                            </div>
                            {attendee.organizer && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium shrink-0">
                                Org
                              </span>
                            )}
                          </div>
                        </AttendeeApolloPopover>
                      ))}
                    </div>
                  </div>
                )}

                {/* Research Meeting */}
                {event.attendees && event.attendees.length > 0 && (
                  <ResearchMeetingButton event={event} />
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
    </TooltipProvider>
  );
}
