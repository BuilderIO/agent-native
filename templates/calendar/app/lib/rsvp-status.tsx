import type { CalendarEvent } from "@shared/api";
import {
  IconCheck,
  IconCircleX,
  IconClock,
  IconHelpCircle,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";

export type RsvpStatus = "accepted" | "declined" | "tentative" | "needsAction";

const TIME_PROPOSAL_COMMENT_RE =
  /\b(proposal|propos(?:e|ed|ing)|new time|different time|another time|reschedul|move (?:it|this)|can we (?:do|move)|could we (?:do|move))\b/i;

export function getRsvpStatusLabel(status?: string) {
  switch (status) {
    case "accepted":
      return "Yes";
    case "declined":
      return "No";
    case "tentative":
      return "Maybe";
    case "needsAction":
      return "Awaiting";
    default:
      return undefined;
  }
}

export function canInlineRsvp(
  event: Pick<CalendarEvent, "source" | "overlayEmail">,
): boolean {
  return event.source === "google" && !event.overlayEmail;
}

export function RsvpStatusIcon({
  status,
  className,
}: {
  status?: string;
  className?: string;
}) {
  const label = getRsvpStatusLabel(status);
  if (!label) return null;

  const iconClassName = cn("h-3 w-3", className);
  if (status === "accepted") {
    return (
      <IconCheck
        className={cn(iconClassName, "text-emerald-500")}
        aria-label={`RSVP: ${label}`}
      />
    );
  }
  if (status === "declined") {
    return (
      <IconCircleX
        className={cn(iconClassName, "text-red-400")}
        aria-label={`RSVP: ${label}`}
      />
    );
  }
  return (
    <IconHelpCircle
      className={cn(
        iconClassName,
        status === "tentative" ? "text-yellow-500" : "text-muted-foreground/60",
      )}
      aria-label={`RSVP: ${label}`}
    />
  );
}

export function hasTimeProposal(
  event: Pick<CalendarEvent, "attendees">,
): boolean {
  const attendees = event.attendees ?? [];
  return attendees
    .filter((attendee) => !attendee.self)
    .some((attendee) => {
      const comment = attendee.comment?.trim();
      return !!comment && TIME_PROPOSAL_COMMENT_RE.test(comment);
    });
}

export function EventStatusIcon({
  event,
  className,
}: {
  event: CalendarEvent;
  className?: string;
}) {
  const iconClassName = cn("h-3 w-3", className);

  if (hasTimeProposal(event)) {
    return (
      <IconClock
        className={cn(iconClassName, "text-yellow-500")}
        aria-label="Time change proposed"
      />
    );
  }

  if (event.responseStatus === "accepted") return null;

  return <RsvpStatusIcon status={event.responseStatus} className={className} />;
}
