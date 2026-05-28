import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  differenceInMinutes,
  eachDayOfInterval,
  format,
  parseISO,
  startOfWeek,
} from "date-fns";
import { useActionQuery } from "@agent-native/core/client";
import {
  IconAlertCircle,
  IconCalendarTime,
  IconChevronLeft,
  IconChevronRight,
  IconLoader2,
  IconUsers,
} from "@tabler/icons-react";
import type {
  FindTimeBusyBlock,
  FindTimeResult,
  FindTimeSlot,
} from "@shared/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { dateTimeInTimezoneToIso } from "@/lib/event-form-utils";
import {
  AttendeeAutocomplete,
  type AttendeeRecipient,
} from "@/components/calendar/AttendeeAutocomplete";

const START_HOUR = 7;
const END_HOUR = 19;
const HOUR_HEIGHT = 44;
const PARTICIPANT_COLORS = [
  "hsl(var(--primary))",
  "#0f9f6e",
  "#b45309",
  "#7c3aed",
  "#0e7490",
  "#be123c",
];

function parseDateOnly(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function dateTimePartsInTimezone(value: string, timezone: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(parsed);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const year = values.get("year");
    const month = values.get("month");
    const day = values.get("day");
    const hour = values.get("hour");
    const minute = values.get("minute");
    if (!year || !month || !day || !hour || !minute) return null;
    return {
      date: `${year}-${month}-${day}`,
      time: `${hour}:${minute}`,
    };
  } catch {
    return {
      date: format(parsed, "yyyy-MM-dd"),
      time: format(parsed, "HH:mm"),
    };
  }
}

function timeLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function sameMinute(a?: string, b?: string) {
  if (!a || !b) return false;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 60_000;
}

function attendeeLabel(
  email: string,
  attendees: AttendeeRecipient[],
  role?: string,
) {
  const match = attendees.find(
    (attendee) => attendee.email.toLowerCase() === email.toLowerCase(),
  );
  if (match?.displayName) return match.displayName;
  if (role === "organizer") return "You";
  return email;
}

function hourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function gridBoundary(day: Date, hour: number, timezone: string) {
  return new Date(
    dateTimeInTimezoneToIso(
      format(day, "yyyy-MM-dd"),
      hourLabel(hour),
      timezone,
    ),
  );
}

function blockPosition(block: FindTimeBusyBlock, day: Date, timezone: string) {
  const rangeStart = gridBoundary(day, START_HOUR, timezone);
  const rangeEnd = gridBoundary(day, END_HOUR, timezone);
  const start = parseISO(block.start);
  const end = parseISO(block.end);
  const clippedStart = start > rangeStart ? start : rangeStart;
  const clippedEnd = end < rangeEnd ? end : rangeEnd;
  if (clippedEnd <= rangeStart || clippedStart >= rangeEnd) return null;

  const top =
    (differenceInMinutes(clippedStart, rangeStart) / 60) * HOUR_HEIGHT;
  const height = Math.max(
    16,
    (differenceInMinutes(clippedEnd, clippedStart) / 60) * HOUR_HEIGHT,
  );
  return { top, height };
}

function isTextEntryTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

interface FindTimePanelProps {
  date: string;
  timezone: string;
  durationMinutes: number;
  attendees: AttendeeRecipient[];
  accountEmail?: string;
  selectedStart?: string;
  selectedEnd?: string;
  ignoreStart?: string;
  ignoreEnd?: string;
  onSelectSlot: (slot: FindTimeSlot) => void;
  onAddAttendee?: (attendee: AttendeeRecipient) => void;
  onRemoveAttendee?: (email: string) => void;
  className?: string;
  isTakeover?: boolean;
}

export function FindTimePanel({
  date,
  timezone,
  durationMinutes,
  attendees,
  accountEmail,
  selectedStart,
  selectedEnd,
  ignoreStart,
  ignoreEnd,
  onSelectSlot,
  onAddAttendee,
  onRemoveAttendee,
  className,
  isTakeover = false,
}: FindTimePanelProps) {
  const [anchorDate, setAnchorDate] = useState(() => parseDateOnly(date));

  useEffect(() => {
    setAnchorDate(parseDateOnly(date));
  }, [date]);

  useEffect(() => {
    if (!isTakeover) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTextEntryTarget(event.target)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key !== "j" && key !== "k") return;

      event.preventDefault();
      event.stopPropagation();
      setAnchorDate((current) => addDays(current, key === "j" ? 7 : -7));
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isTakeover]);

  const weekStart = useMemo(() => startOfWeek(anchorDate), [anchorDate]);
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: weekStart,
        end: addDays(weekStart, 6),
      }),
    [weekStart],
  );
  const attendeeEmails = useMemo(
    () =>
      attendees
        .map((attendee) => attendee.email.trim().toLowerCase())
        .filter(Boolean)
        .join(","),
    [attendees],
  );
  const params = useMemo(
    () => ({
      date: format(weekStart, "yyyy-MM-dd"),
      timezone,
      durationMinutes,
      attendees: attendeeEmails,
      accountEmail,
      ignoreStart,
      ignoreEnd,
    }),
    [
      accountEmail,
      attendeeEmails,
      durationMinutes,
      ignoreEnd,
      ignoreStart,
      timezone,
      weekStart,
    ],
  );
  const findTime = useActionQuery("find-a-time", params, {
    placeholderData: (previous: FindTimeResult | undefined) => previous,
    staleTime: 30_000,
  });
  const result = findTime.data as FindTimeResult | undefined;
  const resultWeekStart = result?.range.from
    ? dateTimePartsInTimezone(result.range.from, timezone)?.date
    : undefined;
  const isWeekLoading =
    findTime.isLoading ||
    (findTime.isFetching && resultWeekStart !== params.date);
  const displayResult = isWeekLoading ? undefined : result;
  const participants = displayResult?.participants ?? [];
  const visibleSlots = displayResult?.slots.slice(0, 10) ?? [];
  const participantColor = useMemo(() => {
    const map = new Map<string, string>();
    participants.forEach((participant, index) => {
      map.set(
        participant.email.toLowerCase(),
        PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length],
      );
    });
    return map;
  }, [participants]);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IconCalendarTime className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {format(weekStart, "MMM d")} -{" "}
            {format(addDays(weekStart, 6), "MMM d")}
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {durationMinutes} min
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setAnchorDate((current) => addDays(current, -7))}
          >
            <IconChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setAnchorDate(new Date())}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setAnchorDate((current) => addDays(current, 7))}
          >
            <IconChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {onAddAttendee && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <IconUsers className="h-3.5 w-3.5" />
            Guests
          </div>
          <AttendeeAutocomplete
            attendees={attendees}
            onAdd={onAddAttendee}
            onRemove={onRemoveAttendee}
            placeholder="Search contacts or type an email"
          />
        </div>
      )}

      {displayResult?.message && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <IconAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{displayResult.message}</span>
        </div>
      )}

      {displayResult?.errors && displayResult.errors.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <IconAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {displayResult.errors
              .slice(0, 2)
              .map((error) => `${error.email}: ${error.error}`)
              .join("; ")}
          </span>
        </div>
      )}

      <div
        className={cn(
          "grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]",
          isTakeover && "xl:grid-cols-[minmax(0,1fr)_280px]",
        )}
      >
        <div className="min-w-0 overflow-x-auto rounded-md border border-border">
          <div className="min-w-[548px]">
            <div className="grid grid-cols-[44px_repeat(7,minmax(72px,1fr))] border-b border-border bg-muted/30">
              <div />
              {days.map((day) => (
                <div
                  key={day.toISOString()}
                  className="border-l border-border px-2 py-2 text-center"
                >
                  <div className="text-[10px] font-medium uppercase text-muted-foreground">
                    {format(day, "EEE")}
                  </div>
                  <div className="text-sm font-semibold text-foreground">
                    {format(day, "d")}
                  </div>
                </div>
              ))}
            </div>
            <div
              className={cn(
                "grid max-h-[430px] grid-cols-[44px_repeat(7,minmax(72px,1fr))] overflow-y-auto",
                isTakeover && "max-h-[calc(100dvh-250px)]",
              )}
              style={{
                minHeight: `${(END_HOUR - START_HOUR) * HOUR_HEIGHT}px`,
              }}
            >
              <div className="relative border-r border-border bg-muted/20">
                {Array.from({ length: END_HOUR - START_HOUR + 1 }).map(
                  (_, i) => (
                    <div
                      key={i}
                      className="relative border-b border-border/40"
                      style={{
                        height: i === END_HOUR - START_HOUR ? 0 : HOUR_HEIGHT,
                      }}
                    >
                      {i > 0 && (
                        <span className="absolute -top-2 right-1 text-[10px] text-muted-foreground">
                          {format(
                            new Date(2026, 0, 1, START_HOUR + i, 0),
                            "ha",
                          ).toLowerCase()}
                        </span>
                      )}
                    </div>
                  ),
                )}
              </div>
              {days.map((day) => {
                const dayStart = gridBoundary(day, 0, timezone);
                const dayEnd = gridBoundary(addDays(day, 1), 0, timezone);
                const dayBusy =
                  displayResult?.busy.filter((block) => {
                    const start = parseISO(block.start);
                    const end = parseISO(block.end);
                    return start < dayEnd && end > dayStart;
                  }) ?? [];
                const daySlots =
                  displayResult?.slots.filter((slot) => {
                    const parts = dateTimePartsInTimezone(slot.start, timezone);
                    return parts?.date === format(day, "yyyy-MM-dd");
                  }) ?? [];

                return (
                  <div
                    key={day.toISOString()}
                    className="relative border-l border-border bg-background"
                    style={{
                      height: `${(END_HOUR - START_HOUR) * HOUR_HEIGHT}px`,
                    }}
                  >
                    {Array.from({ length: END_HOUR - START_HOUR }).map(
                      (_, i) => (
                        <div
                          key={i}
                          className="border-b border-border/40"
                          style={{ height: HOUR_HEIGHT }}
                        />
                      ),
                    )}

                    {isWeekLoading &&
                      Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton
                          key={i}
                          className="absolute left-2 right-2 h-5 rounded"
                          style={{ top: 32 + i * 92 }}
                        />
                      ))}

                    {!isWeekLoading &&
                      daySlots.slice(0, 16).map((slot) => {
                        const parts = dateTimePartsInTimezone(
                          slot.start,
                          timezone,
                        );
                        if (!parts) return null;
                        const [hour, minute] = parts.time
                          .split(":")
                          .map(Number);
                        const top =
                          (((hour - START_HOUR) * 60 + minute) / 60) *
                          HOUR_HEIGHT;
                        const height = Math.max(
                          18,
                          (slot.durationMinutes / 60) * HOUR_HEIGHT,
                        );
                        const selected =
                          sameMinute(slot.start, selectedStart) &&
                          sameMinute(slot.end, selectedEnd);
                        return (
                          <button
                            key={`${slot.start}-${slot.end}`}
                            type="button"
                            className={cn(
                              "absolute left-1 right-1 rounded border px-1 text-left text-[10px] font-medium transition-colors",
                              selected
                                ? "border-primary bg-primary/20 text-foreground"
                                : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20",
                            )}
                            style={{ top, height }}
                            onClick={() => onSelectSlot(slot)}
                          >
                            {timeLabel(slot.start, timezone)}
                          </button>
                        );
                      })}

                    {!isWeekLoading &&
                      dayBusy.map((block, index) => {
                        const position = blockPosition(block, day, timezone);
                        if (!position) return null;
                        const participantIndex = Math.max(
                          0,
                          participants.findIndex(
                            (participant) =>
                              participant.email.toLowerCase() ===
                              block.participantEmail.toLowerCase(),
                          ),
                        );
                        const color =
                          participantColor.get(
                            block.participantEmail.toLowerCase(),
                          ) ?? "hsl(var(--muted-foreground))";
                        return (
                          <div
                            key={`${block.participantEmail}-${block.start}-${block.end}-${index}`}
                            className="absolute overflow-hidden rounded-sm border bg-background/95 px-1 py-0.5 text-[10px] leading-tight shadow-sm"
                            style={{
                              top: position.top,
                              height: position.height,
                              left: `${4 + (participantIndex % 3) * 8}px`,
                              right: "4px",
                              borderLeft: `3px solid ${color}`,
                            }}
                            title={`${attendeeLabel(
                              block.participantEmail,
                              attendees,
                            )}: ${block.title || "Busy"}`}
                          >
                            <div className="truncate font-medium text-foreground">
                              {block.title || "Busy"}
                            </div>
                            <div className="truncate text-muted-foreground">
                              {attendeeLabel(block.participantEmail, attendees)}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              Suggested Times
            </div>
            {isWeekLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : visibleSlots.length > 0 ? (
              <div className="space-y-1.5">
                {visibleSlots.map((slot) => {
                  const selected =
                    sameMinute(slot.start, selectedStart) &&
                    sameMinute(slot.end, selectedEnd);
                  return (
                    <Button
                      key={`${slot.start}-${slot.end}`}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      size="sm"
                      className="h-auto w-full justify-start px-2 py-2 text-left text-xs"
                      onClick={() => onSelectSlot(slot)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {format(parseISO(slot.start), "EEE, MMM d")}
                        </span>
                        <span className="block text-muted-foreground">
                          {timeLabel(slot.start, timezone)} -{" "}
                          {timeLabel(slot.end, timezone)}
                        </span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-md border border-border px-3 py-6 text-center text-xs text-muted-foreground">
                No matching slots
              </div>
            )}
          </div>

          {participants.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                Guests
              </div>
              <div className="space-y-1">
                {participants.map((participant) => (
                  <div
                    key={participant.email}
                    className="flex min-w-0 items-center gap-2 text-xs"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          participantColor.get(
                            participant.email.toLowerCase(),
                          ) ?? "hsl(var(--muted-foreground))",
                      }}
                    />
                    <span className="truncate">
                      {attendeeLabel(
                        participant.email,
                        attendees,
                        participant.role,
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {findTime.isFetching && !isWeekLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              Refreshing
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FindTimeTakeoverProps extends FindTimePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  subtitle?: string;
}

export function FindTimeTakeover({
  open,
  onOpenChange,
  title = "Find a time",
  subtitle,
  className,
  ...panelProps
}: FindTimeTakeoverProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-find-time-takeover
        className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-[-50%] translate-y-[-50%] flex-col gap-0 overflow-hidden border-0 p-0 shadow-xl sm:rounded-none"
      >
        <header className="flex h-14 shrink-0 items-center border-b border-border px-4 pr-12 md:px-6">
          <div className="min-w-0">
            <DialogTitle className="truncate text-base">{title}</DialogTitle>
            <DialogDescription
              className={cn(
                "mt-1 truncate text-xs text-muted-foreground",
                !subtitle && "sr-only",
              )}
            >
              {subtitle ||
                "Review shared availability and choose a meeting time."}
            </DialogDescription>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
          <FindTimePanel
            {...panelProps}
            isTakeover
            className={cn("mx-auto max-w-7xl", className)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
