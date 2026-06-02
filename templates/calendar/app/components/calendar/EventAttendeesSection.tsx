import { useEffect, useId, useMemo, useState } from "react";
import { IconMessageCircle, IconUser } from "@tabler/icons-react";
import type { CalendarEvent } from "@shared/api";
import { AttendeeApolloPopover } from "@/components/calendar/ApolloPanel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useAttendeePhotos } from "@/hooks/use-attendee-photos";
import { useRsvpEvent } from "@/hooks/use-events";
import { cn } from "@/lib/utils";
import {
  getRsvpStatusLabel,
  RsvpStatusIcon,
  type RsvpStatus,
} from "@/lib/rsvp-status";

type RecurringScope = "single" | "all" | "thisAndFollowing";

type Attendee = NonNullable<CalendarEvent["attendees"]>[number];
type EditableRsvpStatus = Exclude<RsvpStatus, "needsAction">;

const ATTENDEE_TRUNCATE_THRESHOLD = 5;
const ATTENDEE_INITIAL_SHOW = 3;

function getAvatarUrl(email: string): string {
  return `https://unavatar.io/${encodeURIComponent(email.trim().toLowerCase())}?fallback=false`;
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
  note,
  onChange,
  isRecurring,
}: {
  eventId: string;
  accountEmail?: string;
  value: RsvpStatus;
  note?: string;
  onChange: (status: RsvpStatus, note: string) => void;
  isRecurring?: boolean;
}) {
  const mutation = useRsvpEvent();
  const noteId = useId();
  const [pendingStatus, setPendingStatus] = useState<EditableRsvpStatus | null>(
    null,
  );
  const [noteDraft, setNoteDraft] = useState("");
  const currentNote = note?.trim() ?? "";

  const options: Array<{
    value: EditableRsvpStatus;
    label: string;
  }> = [
    { value: "accepted", label: "Yes" },
    { value: "declined", label: "No" },
    { value: "tentative", label: "Maybe" },
  ];

  const supportsNote =
    pendingStatus === "declined" || pendingStatus === "tentative";
  const canEditNote = value === "declined" || value === "tentative";

  const closePopover = () => {
    setPendingStatus(null);
    setNoteDraft("");
  };

  const openPopover = (status: EditableRsvpStatus) => {
    setNoteDraft(status === "accepted" ? "" : currentNote);
    setPendingStatus(status);
  };

  const doRsvp = (
    status: EditableRsvpStatus,
    scope?: RecurringScope,
    noteValue = noteDraft,
  ) => {
    const previous = value;
    const previousNote = currentNote;
    const nextNote = status === "accepted" ? "" : noteValue.trim();
    onChange(status, nextNote);
    mutation.mutate(
      { id: eventId, status, accountEmail, scope, note: nextNote },
      { onError: () => onChange(previous, previousNote) },
    );
  };

  const handleRsvp = (status: EditableRsvpStatus) => {
    if (mutation.isPending) return;
    if (isRecurring || status === "declined" || status === "tentative") {
      openPopover(status);
      return;
    }
    if (value === status && !currentNote) return;
    doRsvp(status, undefined, "");
  };

  return (
    <Popover
      open={!!pendingStatus}
      onOpenChange={(open) => !open && closePopover()}
    >
      <div className="mt-2 flex items-center gap-1 rounded-2xl bg-muted/60 p-1">
        {options.map((option) => {
          const active = value === option.value;
          const btn = (
            <button
              key={option.value}
              type="button"
              disabled={mutation.isPending}
              onClick={(e) => {
                e.stopPropagation();
                handleRsvp(option.value);
              }}
              className={cn(
                "min-w-0 flex-1 rounded-xl px-3 py-2 text-sm font-medium",
                active
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                mutation.isPending && "opacity-60",
              )}
            >
              {option.label}
            </button>
          );
          if (pendingStatus === option.value) {
            return (
              <PopoverTrigger key={option.value} asChild>
                {btn}
              </PopoverTrigger>
            );
          }
          return btn;
        })}
      </div>

      {canEditNote && (
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={(e) => {
            e.stopPropagation();
            openPopover(value as EditableRsvpStatus);
          }}
          className="mt-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
        >
          <IconMessageCircle className="h-3 w-3" />
          {currentNote ? "Edit note" : "Add note"}
        </button>
      )}

      <PopoverContent
        side="left"
        align="center"
        sideOffset={8}
        className="w-72"
        onClick={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        {pendingStatus && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">
                {isRecurring ? "This is a recurring event" : "Update response"}
              </p>
              {isRecurring && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Would you like to change your response for just this event,
                  this and all following events, or all events in the series?
                </p>
              )}
            </div>

            {supportsNote && (
              <div className="space-y-1.5">
                <Label htmlFor={noteId} className="text-xs">
                  Optional note
                </Label>
                <Textarea
                  id={noteId}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  maxLength={1000}
                  placeholder="Add a short note..."
                  className="min-h-[76px] resize-none text-sm"
                />
              </div>
            )}

            {isRecurring ? (
              <div className="space-y-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-center"
                  disabled={mutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    doRsvp(pendingStatus, "single");
                    closePopover();
                  }}
                >
                  This event
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-center"
                  disabled={mutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    doRsvp(pendingStatus, "thisAndFollowing");
                    closePopover();
                  }}
                >
                  This and following events
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-center"
                  disabled={mutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    doRsvp(pendingStatus, "all");
                    closePopover();
                  }}
                >
                  All events
                </Button>
              </div>
            ) : (
              <div className="flex justify-end gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    closePopover();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={mutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    doRsvp(pendingStatus);
                    closePopover();
                  }}
                >
                  Save response
                </Button>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function AttendeeRow({
  attendee,
  event,
  photoUrl,
  inlineRsvp,
  currentStatus,
  currentNote,
  onResponseChange,
  isRecurring,
}: {
  attendee: Attendee;
  event: Pick<CalendarEvent, "id" | "accountEmail">;
  photoUrl?: string;
  inlineRsvp?: boolean;
  currentStatus?: RsvpStatus;
  currentNote?: string;
  onResponseChange?: (status: RsvpStatus, note: string) => void;
  isRecurring?: boolean;
}) {
  const displayStatus = inlineRsvp ? currentStatus : attendee.responseStatus;
  const statusLabel = getRsvpStatusLabel(displayStatus) ?? "Awaiting";
  const comment = (inlineRsvp ? currentNote : attendee.comment)?.trim();

  return (
    <div className="rounded-xl px-1 py-1 transition-colors hover:bg-muted/40">
      <AttendeeApolloPopover attendee={attendee}>
        <div className="flex items-center gap-2.5">
          <div className="relative shrink-0">
            <AttendeeAvatar attendee={attendee} resolvedPhotoUrl={photoUrl} />
            <div className="absolute -bottom-0.5 -right-0.5">
              <RsvpStatusIcon status={displayStatus ?? "needsAction"} />
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
            <div className="mt-0.5 text-[11px] text-muted-foreground/70">
              {inlineRsvp ? `Your response: ${statusLabel}` : statusLabel}
            </div>
          </div>
        </div>
        {comment && (
          <div className="ml-10 mt-1 flex items-start gap-1.5 rounded-md bg-muted/40 px-2 py-1 text-[11px] leading-relaxed text-muted-foreground">
            <IconMessageCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="min-w-0 break-words">{comment}</span>
          </div>
        )}
      </AttendeeApolloPopover>
      {inlineRsvp && currentStatus && onResponseChange && (
        <RsvpControls
          eventId={event.id}
          accountEmail={event.accountEmail}
          value={currentStatus}
          note={currentNote}
          onChange={onResponseChange}
          isRecurring={isRecurring}
        />
      )}
    </div>
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
    | "id"
    | "accountEmail"
    | "attendees"
    | "responseStatus"
    | "source"
    | "recurringEventId"
  >;
}) {
  const attendees = event.attendees ?? [];
  const [expanded, setExpanded] = useState(false);
  const [selfStatus, setSelfStatus] = useState<RsvpStatus>(
    event.responseStatus || "needsAction",
  );
  const [selfNote, setSelfNote] = useState(
    attendees.find((attendee) => attendee.self)?.comment?.trim() ?? "",
  );
  const emails = attendees.map((attendee) => attendee.email);
  const { data: photos } = useAttendeePhotos(emails);

  const sorted = useMemo(() => sortAttendees(attendees), [attendees]);
  const selfAttendee = sorted.find((attendee) => attendee.self);
  const others = sorted.filter((attendee) => !attendee.self);

  useEffect(() => {
    setSelfStatus(event.responseStatus || "needsAction");
    setSelfNote(selfAttendee?.comment?.trim() ?? "");
  }, [event.id, event.responseStatus, selfAttendee?.comment]);

  const handleSelfResponseChange = (status: RsvpStatus, note: string) => {
    setSelfStatus(status);
    setSelfNote(note);
  };

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
                  currentNote={selfNote}
                  onResponseChange={handleSelfResponseChange}
                  isRecurring={!!event.recurringEventId}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
