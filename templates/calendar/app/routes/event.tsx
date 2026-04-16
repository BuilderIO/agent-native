import { useSearchParams } from "react-router";
import { format, parseISO, differenceInMinutes } from "date-fns";
import {
  IconClock,
  IconMapPin,
  IconUsers,
  IconAlignLeft,
  IconArrowUpRight,
  IconCalendar,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useActionQuery } from "@agent-native/core/client";
import { postNavigate, isInAgentEmbed } from "@agent-native/core/client";
import type { CalendarEvent } from "@shared/api";

export function meta() {
  return [{ title: "Event Preview" }];
}

function formatDuration(start: string, end: string): string {
  const totalMinutes = differenceInMinutes(parseISO(end), parseISO(start));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function EventCard({ event }: { event: CalendarEvent }) {
  const inEmbed = isInAgentEmbed();

  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {/* Color bar */}
        <div className="h-1 w-full bg-primary/60" />

        <div className="px-5 py-4 space-y-4">
          {/* Title */}
          <div>
            <h1 className="text-base font-semibold text-foreground leading-snug">
              {event.title}
            </h1>
            {event.status === "cancelled" && (
              <span className="mt-1 inline-block text-xs text-destructive font-medium">
                Cancelled
              </span>
            )}
          </div>

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
                  <span className="text-foreground font-medium">
                    {format(parseISO(event.start), "h:mm a")}
                    {" – "}
                    {format(parseISO(event.end), "h:mm a")}
                  </span>
                  <span className="ml-2 text-muted-foreground/70">
                    {formatDuration(event.start, event.end)}
                  </span>
                  <div className="mt-0.5">
                    {format(parseISO(event.start), "EEEE, MMMM d")}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Location */}
          {event.location && (
            <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <IconMapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">{event.location}</span>
            </div>
          )}

          {/* Description snippet */}
          {event.description && (
            <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <IconAlignLeft className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="line-clamp-3 break-words">{event.description}</p>
            </div>
          )}

          {/* Attendees */}
          {event.attendees && event.attendees.length > 0 && (
            <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <IconUsers className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex flex-col gap-0.5">
                {event.attendees.slice(0, 5).map((a) => (
                  <span key={a.email} className="truncate">
                    {a.displayName ? (
                      <>
                        <span className="text-foreground">{a.displayName}</span>
                        <span className="ml-1 text-muted-foreground/60 text-xs">
                          {a.email}
                        </span>
                      </>
                    ) : (
                      a.email
                    )}
                  </span>
                ))}
                {event.attendees.length > 5 && (
                  <span className="text-muted-foreground/60 text-xs">
                    +{event.attendees.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Open in app */}
          {inEmbed && (
            <div className="pt-1 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-muted-foreground hover:text-foreground text-xs gap-1.5"
                onClick={() => postNavigate("/")}
              >
                <IconCalendar className="h-3.5 w-3.5" />
                Open calendar
                <IconArrowUpRight className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-sm px-5 py-4">
        <p className="text-sm text-destructive font-medium">
          Could not load event
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

export default function EventPreviewRoute() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const calendarId = searchParams.get("calendarId") ?? "primary";

  const { data, isLoading, error } = useActionQuery<CalendarEvent>(
    "get-event",
    id ? { id, calendarId } : undefined,
    { enabled: !!id, retry: false },
  );

  if (!id) {
    return (
      <ErrorCard message="No event id provided. Add ?id=<eventId> to the URL." />
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <ErrorCard
        message={
          error instanceof Error
            ? error.message
            : "Event not found or access denied."
        }
      />
    );
  }

  return <EventCard event={data} />;
}
