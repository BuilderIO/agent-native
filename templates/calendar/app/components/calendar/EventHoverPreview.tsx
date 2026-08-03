import { useT } from "@agent-native/core/client/i18n";
import type { CalendarEvent } from "@shared/api";
import {
  IconClock,
  IconExternalLink,
  IconMapPin,
  IconUsers,
  IconVideo,
} from "@tabler/icons-react";
import { format, isSameDay, parseISO } from "date-fns";
import {
  cloneElement,
  forwardRef,
  useEffect,
  useMemo,
  useState,
  type ElementRef,
  type HTMLAttributes,
  type ReactElement,
} from "react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardPortal,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { extractMeetingLink } from "@/lib/event-meeting";
import { cn } from "@/lib/utils";

interface EventHoverPreviewProps extends HTMLAttributes<HTMLElement> {
  event: CalendarEvent;
  children: ReactElement<{ className?: string }>;
  disabled?: boolean;
}

function formatPreviewTime(event: CalendarEvent, allDayLabel: string): string {
  const start = parseISO(event.start);
  const end = parseISO(event.end);

  if (event.allDay) {
    return `${format(start, "EEE, MMM d")} · ${allDayLabel}`;
  }
  if (isSameDay(start, end)) {
    return `${format(start, "EEE, MMM d")} · ${format(start, "h:mm a")}–${format(end, "h:mm a")}`;
  }
  return `${format(start, "EEE, MMM d · h:mm a")}–${format(end, "EEE, MMM d · h:mm a")}`;
}

export const EventHoverPreview = forwardRef<
  ElementRef<typeof HoverCardTrigger>,
  EventHoverPreviewProps
>(function EventHoverPreview(
  {
    event,
    children,
    disabled = false,
    onPointerDown,
    onPointerUp,
    ...triggerProps
  },
  forwardedRef,
) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pointerDown, setPointerDown] = useState(false);
  const meetingLink = useMemo(() => extractMeetingLink(event), [event]);
  const attendees = event.attendees ?? [];
  const visibleAttendees = attendees.slice(0, 3);
  const attendeeRemainder = attendees.length - visibleAttendees.length;

  useEffect(() => {
    if (disabled || pointerDown) setOpen(false);
  }, [disabled, pointerDown]);

  useEffect(() => {
    if (!pointerDown) return;
    const releasePointer = () => setPointerDown(false);
    window.addEventListener("pointerup", releasePointer, { once: true });
    window.addEventListener("pointercancel", releasePointer, { once: true });
    return () => {
      window.removeEventListener("pointerup", releasePointer);
      window.removeEventListener("pointercancel", releasePointer);
    };
  }, [pointerDown]);

  const meetingLabel = meetingLink
    ? meetingLink.type === "zoom"
      ? t("eventForm.joinZoom")
      : meetingLink.type === "meet"
        ? t("eventForm.joinMeet")
        : meetingLink.type === "teams"
          ? t("eventForm.joinTeams")
          : t("eventForm.joinMeeting")
    : null;
  const previewOpen = open && !disabled && !pointerDown;
  const trigger = cloneElement(children, {
    className: cn(
      children.props.className,
      previewOpen && "ring-2 ring-ring/50 ring-offset-1 ring-offset-background",
    ),
  });

  return (
    <HoverCard
      open={disabled || pointerDown ? false : open}
      onOpenChange={(nextOpen) => {
        if (!disabled && !pointerDown) setOpen(nextOpen);
      }}
      openDelay={150}
      closeDelay={150}
    >
      <HoverCardTrigger
        asChild
        ref={forwardedRef}
        onPointerDown={(pointerEvent) => {
          setPointerDown(true);
          setOpen(false);
          onPointerDown?.(pointerEvent);
        }}
        onPointerUp={(pointerEvent) => {
          setPointerDown(false);
          onPointerUp?.(pointerEvent);
        }}
        {...triggerProps}
      >
        {trigger}
      </HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent
          side="right"
          align="center"
          sideOffset={8}
          collisionPadding={12}
          className="w-72 space-y-3 rounded-xl p-3.5 shadow-xl motion-reduce:animate-none"
          data-event-hover-preview={event.id}
          onClick={(clickEvent) => clickEvent.stopPropagation()}
        >
          <p className="break-words text-sm font-semibold leading-snug text-foreground">
            {event.title}
          </p>

          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <IconClock
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0"
              />
              <span>{formatPreviewTime(event, t("eventForm.allDay"))}</span>
            </div>

            {event.location &&
              (!meetingLink || !event.location.includes(meetingLink.url)) && (
                <div className="flex items-start gap-2">
                  <IconMapPin
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0"
                  />
                  <span className="break-words">{event.location}</span>
                </div>
              )}

            {attendees.length > 0 && (
              <div className="flex items-start gap-2">
                <IconUsers
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0"
                />
                <span className="break-words">
                  {visibleAttendees
                    .map((attendee) => attendee.displayName || attendee.email)
                    .join(", ")}
                  {attendeeRemainder > 0 ? ` +${attendeeRemainder}` : ""}
                </span>
              </div>
            )}
          </div>

          {meetingLink && meetingLabel && (
            <a
              href={meetingLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
              onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
              onClick={(clickEvent) => clickEvent.stopPropagation()}
            >
              <span className="flex min-w-0 items-center gap-2">
                <IconVideo aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{meetingLabel}</span>
              </span>
              <IconExternalLink
                aria-hidden="true"
                className="size-3.5 shrink-0"
              />
            </a>
          )}
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
});
