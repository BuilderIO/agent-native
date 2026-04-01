import { useEffect, useMemo, useState } from "react";
import {
  IconCheck,
  IconCircleX,
  IconHelpCircle,
  IconUser,
} from "@tabler/icons-react";
import type { CalendarEvent } from "@shared/api";
import { AttendeeApolloPopover } from "@/components/calendar/ApolloPanel";
import { useAttendeePhotos } from "@/hooks/use-attendee-photos";
import { useRsvpEvent } from "@/hooks/use-events";
import { cn } from "@/lib/utils";

type Attendee = NonNullable<CalendarEvent["attendees"]>[number];
type RsvpStatus = "accepted" | "declined" | "tentative" | "needsAction";

const ATTENDEE_TRUNCATE_THRESHOLD = 5;
const ATTENDEE_INITIAL_SHOW = 3;

function getAvatarUrl(email: string): string {
  return `https://unavatar.io/${encodeURIComponent(email.trim().toLowerCase())}?fallback=false`;
}

function ResponseStatusIcon({ status }: { status?: string }) {
  switch (status) {
    case "accepted":
      return <IconCheck className="h-3 w-3 text-green-500" />;
    case "declined":
      return <IconCircleX className="h-3 w-3 text-red-400" />;
    case "tentative":
      return <IconHelpCircle className="h-3 w-3 text-yellow-500" />;
    default:
      return <IconHelpCircle className="h-3 w-3 text-muted-foreground/40" />;
  }
}

function AttendeeAvatar({
  attendee,
  resolvedPhotoUrl,
  sizeClassName = "h-8 w-8",
}: {
  attendee: Attendee;
  resolvedPhotoUrl?: string;
  sizeClassName?: string;
}) {
  const initials = (attendee.displayName || attendee.email)
    .charAt(0)
    .toUpperCase();
  const [imgFailed, setImgFailed] = useState(false);

  const photoSrc =
    attendee.photoUrl || resolvedPhotoUrl || getAvatarUrl(attendee.email);

  if (photoSrc && !imgFailed) {
    return (
      <img
        src={photoSrc}
        alt=""
        referrerPolicy="no-referrer"
        className={cn(sizeClassName, "rounded-full object-cover bg-muted")}
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <div
      className={cn(
        sizeClassName,
        "flex items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground",
      )}
    >
      {initials}
    </div>
  );
}

function RsvpControls({
  eventId,
  accountEmail,
  value,
  onChange,
}: {
  eventId: string;
  accountEmail?: string;
  value: RsvpStatus;
  onChange: (status: RsvpStatus) => void;
}) {
  const mutation = useRsvpEvent();
  const options: Array<{
    value: Exclude<RsvpStatus, "needsAction">;
    label: string;
  }> = [
    { value: "accepted", label: "Yes" },
    { value: "declined", label: "No" },
    { value: "tentative", label: "Maybe" },
  ];

  const handleRsvp = (status: Exclude<RsvpStatus, "needsAction">) => {
    if (mutation.isPending || value === status) return;
    const previous = value;
    onChange(status);
    mutation.mutate(
      {
        id: eventId,
        status,
        accountEmail,
      },
      {
        onError: () => {
          onChange(previous);
        },
      },
    );
  };

  return (
    <div className="mt-2 flex items-center gap-1 rounded-2xl bg-muted/60 p-1">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={mutation.isPending}
            onClick={() => handleRsvp(option.value)}
            className={cn(
              "min-w-0 flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              mutation.isPending && "opacity-60",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function AttendeeRow({
  attendee,
  event,
  photoUrl,
  inlineRsvp,
  currentStatus,
  onStatusChange,
}: {
  attendee: Attendee;
  event: Pick<CalendarEvent, "id" | "accountEmail">;
  photoUrl?: string;
  inlineRsvp?: boolean;
  currentStatus?: RsvpStatus;
  onStatusChange?: (status: Exclude<RsvpStatus, "needsAction">) => void;
}) {
  return (
    <AttendeeApolloPopover attendee={attendee}>
      <div className="rounded-xl px-1 py-1 transition-colors hover:bg-muted/40">
        <div className="flex items-center gap-2.5">
          <div className="relative shrink-0">
            <AttendeeAvatar attendee={attendee} resolvedPhotoUrl={photoUrl} />
            <div className="absolute -bottom-0.5 -right-0.5">
              <ResponseStatusIcon
                status={inlineRsvp ? currentStatus : attendee.responseStatus}
              />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm text-foreground">
                {attendee.displayName || attendee.email}
              </span>
              {attendee.organizer && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Organizer
                </span>
              )}
            </div>
            {attendee.displayName && (
              <div className="truncate text-[11px] text-muted-foreground/60">
                {attendee.email}
              </div>
            )}
          </div>
        </div>
        {inlineRsvp && currentStatus && onStatusChange && (
          <RsvpControls
            eventId={event.id}
            accountEmail={event.accountEmail}
            value={currentStatus}
            onChange={onStatusChange}
          />
        )}
      </div>
    </AttendeeApolloPopover>
  );
}

function sortAttendees(attendees: Attendee[]) {
  return [...attendees].sort((a, b) => {
    if (a.organizer && !b.organizer) return -1;
    if (!a.organizer && b.organizer) return 1;
    if (a.self && !b.self) return 1;
    if (!a.self && b.self) return -1;
    return (a.displayName || a.email).localeCompare(b.displayName || b.email);
  });
}

export function EventAttendeesSection({
  event,
}: {
  event: Pick<
    CalendarEvent,
    "id" | "accountEmail" | "attendees" | "responseStatus" | "source"
  >;
}) {
  const attendees = event.attendees ?? [];
  const [expanded, setExpanded] = useState(false);
  const [selfStatus, setSelfStatus] = useState<RsvpStatus>(
    event.responseStatus || "needsAction",
  );
  const emails = attendees.map((attendee) => attendee.email);
  const { data: photos } = useAttendeePhotos(emails);

  useEffect(() => {
    setSelfStatus(event.responseStatus || "needsAction");
  }, [event.responseStatus]);

  const sorted = useMemo(() => sortAttendees(attendees), [attendees]);
  const selfAttendee = sorted.find((attendee) => attendee.self);
  const others = sorted.filter((attendee) => !attendee.self);
  const shouldTruncate = attendees.length > ATTENDEE_TRUNCATE_THRESHOLD;
  const visibleOthers =
    shouldTruncate && !expanded
      ? others.slice(0, ATTENDEE_INITIAL_SHOW)
      : others;
  const hiddenCount = others.length - visibleOthers.length;

  const accepted = attendees.filter(
    (attendee) => attendee.responseStatus === "accepted",
  ).length;
  const tentative = attendees.filter(
    (attendee) => attendee.responseStatus === "tentative",
  ).length;
  const declined = attendees.filter(
    (attendee) => attendee.responseStatus === "declined",
  ).length;
  const pending = attendees.length - accepted - tentative - declined;

  return (
    <div className="px-4 py-1">
      <div className="flex items-start gap-3">
        <IconUser className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          {shouldTruncate && (
            <div className="mb-2">
              <div className="text-sm font-medium text-foreground">
                {attendees.length} participants
              </div>
              <div className="text-[11px] text-muted-foreground/60">
                {accepted} yes
                {tentative > 0 && `, ${tentative} maybe`}
                {declined > 0 && `, ${declined} no`}
                {pending > 0 && `, ${pending} awaiting`}
              </div>
            </div>
          )}

          <div className="space-y-0.5">
            {visibleOthers.map((attendee, index) => (
              <AttendeeRow
                key={attendee.email + index}
                attendee={attendee}
                event={event}
                photoUrl={photos?.[attendee.email.toLowerCase()]}
              />
            ))}

            {shouldTruncate && !expanded && hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="flex items-center gap-2.5 -mx-1 px-1 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="flex h-8 w-8 items-center justify-center text-lg text-muted-foreground/50">
                  ⋮
                </span>
                <span>See all {attendees.length} participants</span>
              </button>
            )}

            {selfAttendee && (
              <>
                {others.length > 0 && (
                  <div className="my-1 border-t border-border/30" />
                )}
                <AttendeeRow
                  attendee={selfAttendee}
                  event={event}
                  photoUrl={photos?.[selfAttendee.email.toLowerCase()]}
                  inlineRsvp={event.source === "google"}
                  currentStatus={selfStatus}
                  onStatusChange={setSelfStatus}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
