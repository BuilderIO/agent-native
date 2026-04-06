import {
  format,
  parseISO,
  differenceInMinutes,
  differenceInHours,
} from "date-fns";
import {
  IconX,
  IconClock,
  IconMapPin,
  IconTrash,
  IconEdit,
  IconLayoutSidebarRightCollapse,
  IconExternalLink,
} from "@tabler/icons-react";
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
import { ResearchMeetingButton } from "@/components/calendar/ApolloPanel";
import { EventAttendeesSection } from "@/components/calendar/EventAttendeesSection";
import { useCalendarContext } from "@/components/layout/AppLayout";
import { sanitizeHtml, stripGcalInviteHtml } from "@/lib/sanitize-description";

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
                        <IconLayoutSidebarRightCollapse className="h-4 w-4" />
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
                    <IconX className="h-4 w-4" />
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
                  <IconClock className="mt-0.5 h-4 w-4 shrink-0" />
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
                    <IconMapPin className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{event.location}</span>
                  </div>
                )}

                {/* Description — sanitize HTML and strip gcal invitation cruft */}
                {event.description &&
                  (() => {
                    const hasHtml = /<[a-z][\s\S]*>/i.test(event.description);
                    if (hasHtml) {
                      const cleanedHtml = stripGcalInviteHtml(
                        sanitizeHtml(event.description),
                      );
                      const hasContent =
                        cleanedHtml.replace(/<[^>]*>/g, "").trim().length > 0;
                      if (!hasContent) return null;
                      return (
                        <div
                          className="rounded-md bg-muted/50 px-3 py-2.5 text-sm leading-relaxed text-foreground prose prose-sm dark:prose-invert prose-p:my-1 prose-a:text-primary"
                          dangerouslySetInnerHTML={{ __html: cleanedHtml }}
                        />
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
                  <EventAttendeesSection event={event} />
                )}

                {/* Research Meeting */}
                {event.attendees && event.attendees.length > 0 && (
                  <ResearchMeetingButton event={event} />
                )}
              </div>

              {/* Actions */}
              <div className="shrink-0 border-t border-border px-4 py-3 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => onDelete(event.id)}
                >
                  <IconTrash className="mr-1.5 h-3.5 w-3.5" />
                  Delete
                </Button>
                <div className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(event)}
                >
                  <IconEdit className="mr-1.5 h-3.5 w-3.5" />
                  Edit
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
