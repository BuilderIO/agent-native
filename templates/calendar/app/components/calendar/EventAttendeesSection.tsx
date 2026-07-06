import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import {
  RadioGroup,
  RadioGroupItem,
} from "@agent-native/toolkit/ui/radio-group";
import { Separator } from "@agent-native/toolkit/ui/separator";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import type { CalendarEvent } from "@shared/api";
import { IconMessageCircle, IconUser } from "@tabler/icons-react";
import { useEffect, useId, useMemo, useState } from "react";

import { AttendeeApolloPopover } from "@/components/calendar/ApolloPanel";
import { useAttendeePhotos } from "@/hooks/use-attendee-photos";
import { useRsvpEvent } from "@/hooks/use-events";
import {
  canInlineRsvp,
  RsvpStatusIcon,
  type RsvpStatus,
} from "@/lib/rsvp-status";
import { cn } from "@/lib/utils";

type RecurringScope = "single" | "all" | "thisAndFollowing";

type Attendee = NonNullable<CalendarEvent["attendees"]>[number];
type EditableRsvpStatus = Exclude<RsvpStatus, "needsAction">;

const ATTENDEE_TRUNCATE_THRESHOLD = 5;
const ATTENDEE_INITIAL_SHOW = 3;

function getLocalizedRsvpStatusLabel(
  t: ReturnType<typeof useT>,
  status: RsvpStatus | undefined,
) {
  switch (status) {
    case "accepted":
      return t("eventForm.rsvpAccepted");
    case "declined":
      return t("eventForm.rsvpDeclined");
    case "tentative":
      return t("eventForm.rsvpTentative");
    case "needsAction":
      return t("eventForm.awaiting");
    default:
      return null;
  }
}

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
  const t = useT();
  const mutation = useRsvpEvent();
  const noteId = useId();
  const scopeId = useId();
  const [pendingStatus, setPendingStatus] = useState<EditableRsvpStatus | null>(
    null,
  );
  const [pendingScope, setPendingScope] = useState<RecurringScope>("single");
  const [noteDraft, setNoteDraft] = useState("");
  const currentNote = note?.trim() ?? "";

  const options: Array<{
    value: EditableRsvpStatus;
    label: string;
  }> = [
    { value: "accepted", label: t("eventForm.rsvpYes") },
    { value: "declined", label: t("eventForm.rsvpNo") },
    { value: "tentative", label: t("eventForm.rsvpMaybe") },
  ];
  const scopeOptions: Array<{
    value: RecurringScope;
    label: string;
  }> = [
    { value: "single", label: t("eventForm.thisEvent") },
    { value: "thisAndFollowing", label: t("deleteEvent.thisAndFollowing") },
    { value: "all", label: t("eventForm.allEvents") },
  ];

  const supportsNote =
    pendingStatus === "declined" || pendingStatus === "tentative";
  const canEditNote = value === "declined" || value === "tentative";

  const closePopover = () => {
    setPendingStatus(null);
    setPendingScope("single");
    setNoteDraft("");
  };

  const openPopover = (status: EditableRsvpStatus) => {
    setPendingScope("single");
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
          {currentNote ? t("eventForm.editNote") : t("eventForm.addNote")}
        </button>
      )}

      <PopoverContent
        side="left"
        align="center"
        sideOffset={8}
        className="w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        {pendingStatus && (
          <div>
            <div className="p-5">
              <p className="text-base font-semibold leading-tight">
                {isRecurring
                  ? t("eventForm.saveRecurringResponseStatus")
                  : t("eventForm.saveResponseStatus")}
              </p>

              {isRecurring && (
                <RadioGroup
                  value={pendingScope}
                  onValueChange={(value) =>
                    setPendingScope(value as RecurringScope)
                  }
                  aria-label={t("eventForm.recurringResponseScope")}
                  className="mt-5 gap-4"
                >
                  {scopeOptions.map((option) => {
                    const id = `${scopeId}-${option.value}`;
                    return (
                      <div
                        key={option.value}
                        className="flex items-center gap-3"
                      >
                        <RadioGroupItem
                          id={id}
                          value={option.value}
                          disabled={mutation.isPending}
                        />
                        <Label
                          htmlFor={id}
                          className="cursor-pointer text-sm font-medium leading-none"
                        >
                          {option.label}
                        </Label>
                      </div>
                    );
                  })}
                </RadioGroup>
              )}
            </div>

            {supportsNote && (
              <>
                <Separator />
                <div className="space-y-2 p-5">
                  <Label htmlFor={noteId} className="text-sm font-medium">
                    {t("eventForm.optionalNote")}
                  </Label>
                  <Textarea
                    id={noteId}
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    maxLength={1000}
                    placeholder={t("eventForm.addShortNote")}
                    className="min-h-[96px] resize-none text-sm"
                  />
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 px-5 pb-5">
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={(e) => {
                  e.stopPropagation();
                  closePopover();
                }}
              >
                {t("eventForm.cancel")}
              </Button>
              <Button
                size="sm"
                className="h-9"
                disabled={mutation.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  doRsvp(pendingStatus, isRecurring ? pendingScope : undefined);
                  closePopover();
                }}
              >
                {t("eventForm.saveResponse")}
              </Button>
            </div>
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
  const t = useT();
  const displayStatus = inlineRsvp ? currentStatus : attendee.responseStatus;
  const statusLabel =
    getLocalizedRsvpStatusLabel(t, displayStatus) ?? t("eventForm.awaiting");
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
                  {t("eventForm.organizer")}
                </span>
              )}
            </div>
            {attendee.displayName && (
              <div className="truncate text-[11px] text-muted-foreground/60">
                {attendee.email}
              </div>
            )}
            <div className="mt-0.5 text-[11px] text-muted-foreground/70">
              {inlineRsvp
                ? t("eventForm.yourResponse", { status: statusLabel })
                : statusLabel}
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
    | "overlayEmail"
    | "responseStatus"
    | "source"
    | "recurringEventId"
  >;
}) {
  const t = useT();
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
  const canRsvpInline = canInlineRsvp(event);
  const selfAttendee = canRsvpInline
    ? sorted.find((attendee) => attendee.self)
    : undefined;
  const others =
    canRsvpInline && selfAttendee
      ? sorted.filter((attendee) => !attendee.self)
      : sorted;

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
                {t("eventForm.participants", { count: attendees.length })}
              </div>
              <div className="text-[11px] text-muted-foreground/60">
                {[
                  t("eventForm.responseYesCount", { count: accepted }),
                  tentative > 0
                    ? t("eventForm.responseMaybeCount", { count: tentative })
                    : null,
                  declined > 0
                    ? t("eventForm.responseNoCount", { count: declined })
                    : null,
                  pending > 0
                    ? t("eventForm.responseAwaitingCount", { count: pending })
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
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
                <span>
                  {t("eventForm.seeAllParticipants", {
                    count: attendees.length,
                  })}
                </span>
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
                  inlineRsvp={canRsvpInline}
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
