/**
 * Booker — the public booking flow orchestrator.
 *
 * Layout: three-column split:
 *   [host info] [month calendar] [time slots (when date picked)]
 * Stages advance via motion width+fade for a polished, animated
 * feel that's the core product touch of the booker flow.
 */
import { useCallback, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { TZDate } from "@date-fns/tz";
import {
  format,
  startOfMonth,
  endOfMonth,
  addMonths,
  isBefore,
  startOfDay,
} from "date-fns";
import {
  useTimezone,
  useBookingFlow,
  useSlots,
} from "@agent-native/scheduling/react";
import type { EventType, Slot } from "@agent-native/scheduling/shared";
import { callAction, writeAppState } from "@/lib/api";
import { DatePicker } from "./DatePicker";
import { SlotPicker } from "./SlotPicker";
import { BookingForm } from "./BookingForm";
import { SuccessCard } from "./SuccessCard";
import { TimezoneSelect } from "./TimezoneSelect";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  IconArrowLeft,
  IconCalendarTime,
  IconClock,
  IconGlobe,
  IconVideo,
  IconMapPin,
} from "@tabler/icons-react";

export interface BookerProps {
  eventType: EventType;
  ownerEmail?: string;
  teamSlug?: string;
  /** If set, this is a reschedule — old booking UID is replaced. */
  rescheduleUid?: string;
  /** Public magic token used when an attendee reschedules without signing in. */
  rescheduleToken?: string;
  mode?: "page" | "embed";
}

const stage = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -8 },
};

export function Booker(props: BookerProps) {
  const [tz, setTz] = useTimezone();
  const flow = useBookingFlow();

  const viewMonth = useMemo(() => {
    const base = flow.state.selectedDate
      ? new Date(`${flow.state.selectedDate}T12:00:00Z`)
      : new Date();
    return startOfMonth(new TZDate(base.getTime(), tz));
  }, [flow.state.selectedDate, tz]);

  const fetchSlots = useCallback(
    (params: Parameters<typeof callAction>[1]) =>
      callAction("check-availability", params) as Promise<{ slots: Slot[] }>,
    [],
  );

  const { slots, isLoading } = useSlots({
    eventTypeId: props.eventType.id,
    from: viewMonth.toISOString(),
    to: endOfMonth(addMonths(viewMonth, 0)).toISOString(),
    timezone: tz,
    enabled: flow.state.stage !== "success",
    fetchSlots,
  });

  useEffect(() => {
    writeAppState("booker-state", {
      eventTypeId: props.eventType.id,
      eventSlug: props.eventType.slug,
      ownerEmail: props.ownerEmail,
      teamSlug: props.teamSlug,
      selectedDate: flow.state.selectedDate,
      selectedSlot: flow.state.selectedSlot?.start ?? null,
      stage: flow.state.stage,
      timezone: tz,
      durationChoice: flow.state.durationChoice,
      rescheduleUid: props.rescheduleUid,
    });
  }, [
    flow.state,
    tz,
    props.eventType.id,
    props.eventType.slug,
    props.ownerEmail,
    props.teamSlug,
    props.rescheduleUid,
  ]);

  const onSubmit = async (form: {
    name: string;
    email: string;
    notes: string;
  }) => {
    flow.submitStart();
    const slot = flow.state.selectedSlot;
    if (!slot) return flow.submitError("No slot selected");
    try {
      if (props.rescheduleUid) {
        const { booking } = await callAction("reschedule-booking", {
          uid: props.rescheduleUid,
          newStartTime: slot.start,
          newEndTime: slot.end,
          reason: form.notes || undefined,
          rescheduledBy: "attendee",
          token: props.rescheduleToken,
        });
        flow.submitSuccess(booking.uid);
      } else {
        const { booking } = await callAction("create-booking", {
          eventTypeId: props.eventType.id,
          ownerEmail: props.ownerEmail,
          startTime: slot.start,
          endTime: slot.end,
          timezone: tz,
          attendeeName: form.name,
          attendeeEmail: form.email,
          attendeeTimezone: tz,
          description: form.notes || undefined,
        });
        flow.submitSuccess(booking.uid);
      }
    } catch (err: any) {
      flow.submitError(err.message);
    }
  };

  const hostName = hostDisplayName(props.ownerEmail, props.teamSlug);
  const initials = hostInitials(hostName);

  const nextAvailable = useMemo(() => {
    if (!slots?.length) return null;
    const today = startOfDay(new TZDate(Date.now(), tz));
    const upcoming = slots
      .map((s) => new Date(s.start))
      .filter((d) => !isBefore(d, today))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (!upcoming) return null;
    return format(new TZDate(upcoming.getTime(), tz), "yyyy-MM-dd");
  }, [slots, tz]);

  const showSlots =
    flow.state.stage === "pick-slot" && !!flow.state.selectedDate;
  const onForm =
    flow.state.stage === "fill-form" || flow.state.stage === "submitting";
  const onSuccess = flow.state.stage === "success";

  // Apply per-event-type accent if set
  const rootStyle = props.eventType.color
    ? ({
        "--brand-accent": hexToHslValues(props.eventType.color),
      } as React.CSSProperties)
    : undefined;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6" style={rootStyle}>
      {/* Card shell */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <AnimatePresence mode="wait" initial={false}>
          {onSuccess ? (
            <motion.div
              key="success"
              {...stage}
              transition={{ duration: 0.18 }}
              className="p-8"
            >
              <SuccessCard
                bookingUid={flow.state.resultBookingUid!}
                eventType={props.eventType}
                slot={flow.state.selectedSlot!}
                timezone={tz}
              />
            </motion.div>
          ) : onForm ? (
            <motion.div
              key="form"
              {...stage}
              transition={{ duration: 0.18 }}
              className="grid gap-0 md:grid-cols-[320px_1fr]"
            >
              <HostColumn
                eventType={props.eventType}
                hostName={hostName}
                initials={initials}
                timezone={tz}
                selectedSlot={flow.state.selectedSlot!}
              />
              <div className="border-l border-border p-5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={flow.backToSlot}
                  className="-ml-2 mb-2"
                >
                  <IconArrowLeft className="mr-1.5 h-4 w-4" />
                  Pick a different time
                </Button>
                {flow.state.stage === "submitting" ? (
                  <div className="flex flex-col items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                    <IconCalendarTime className="h-8 w-8 animate-pulse" />
                    <span>
                      {props.rescheduleUid
                        ? "Rescheduling…"
                        : "Creating booking…"}
                    </span>
                  </div>
                ) : (
                  <BookingForm
                    eventType={props.eventType}
                    slot={flow.state.selectedSlot!}
                    timezone={tz}
                    onSubmit={onSubmit}
                  />
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="pick"
              {...stage}
              transition={{ duration: 0.18 }}
              className={
                "grid gap-0 " +
                (showSlots
                  ? "md:grid-cols-[260px_1fr_280px]"
                  : "md:grid-cols-[320px_1fr]")
              }
            >
              <HostColumn
                eventType={props.eventType}
                hostName={hostName}
                initials={initials}
                timezone={tz}
                compact={showSlots}
              />
              <div className="border-t border-border p-5 md:border-l md:border-t-0">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">
                    {format(viewMonth, "MMMM yyyy")}
                  </h2>
                  <TimezoneSelect value={tz} onChange={setTz} />
                </div>
                <DatePicker
                  slots={slots}
                  timezone={tz}
                  month={viewMonth}
                  selectedDate={flow.state.selectedDate ?? undefined}
                  onSelectDate={flow.selectDate}
                  isLoading={isLoading}
                />
                {!flow.state.selectedDate && nextAvailable && (
                  <div className="mt-4 flex justify-center">
                    <button
                      type="button"
                      onClick={() => flow.selectDate(nextAvailable)}
                      className="text-xs font-medium booker-accent hover:underline"
                    >
                      Next available:{" "}
                      {format(
                        new TZDate(`${nextAvailable}T12:00:00Z`, tz),
                        "EEE, MMM d",
                      )}
                    </button>
                  </div>
                )}
              </div>
              {showSlots && (
                <motion.div
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  transition={{ duration: 0.18 }}
                  className="max-h-[520px] overflow-y-auto border-t border-border p-5 md:border-l md:border-t-0"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <h2 className="text-sm font-semibold">
                      {format(
                        new TZDate(`${flow.state.selectedDate}T12:00:00Z`, tz),
                        "EEE d",
                      )}
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      {format(
                        new TZDate(`${flow.state.selectedDate}T12:00:00Z`, tz),
                        "MMM yyyy",
                      )}
                    </span>
                  </div>
                  <SlotPicker
                    slots={slots.filter(
                      (s: Slot) =>
                        slotLocalDate(s, tz) === flow.state.selectedDate,
                    )}
                    timezone={tz}
                    onSelect={flow.selectSlot}
                  />
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <footer className="mt-4 flex items-center justify-center text-xs text-muted-foreground">
        Powered by Scheduling
      </footer>
    </div>
  );
}

function slotLocalDate(slot: Slot, timezone: string): string {
  return format(
    new TZDate(new Date(slot.start).getTime(), timezone),
    "yyyy-MM-dd",
  );
}

function HostColumn({
  eventType,
  hostName,
  initials,
  timezone,
  selectedSlot,
  compact,
}: {
  eventType: EventType;
  hostName: string;
  initials: string;
  timezone: string;
  selectedSlot?: Slot;
  compact?: boolean;
}) {
  const locationKind = eventType.locations?.[0]?.kind ?? "builtin-video";
  const LocationIcon = locationKind === "in-person" ? IconMapPin : IconVideo;
  return (
    <div className={"p-5 " + (compact ? "md:border-r md:border-border" : "")}>
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-muted-foreground">
            {hostName}
          </div>
        </div>
      </div>
      <h1 className="mt-3 text-xl font-semibold leading-snug tracking-tight">
        {eventType.title}
      </h1>
      {eventType.description && (
        <p className="mt-1.5 line-clamp-4 text-sm text-muted-foreground">
          {eventType.description}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <IconClock className="h-3.5 w-3.5" />
          <span>{eventType.length} min</span>
        </div>
        <div className="flex items-center gap-1.5">
          <LocationIcon className="h-3.5 w-3.5" />
          <span>{locationLabel(locationKind)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <IconGlobe className="h-3.5 w-3.5" />
          <span>{timezone}</span>
        </div>
      </div>
      {selectedSlot && (
        <div className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-xs">
          <div className="font-semibold">
            {format(
              new TZDate(new Date(selectedSlot.start).getTime(), timezone),
              "EEEE, MMMM d",
            )}
          </div>
          <div className="text-muted-foreground">
            {format(
              new TZDate(new Date(selectedSlot.start).getTime(), timezone),
              "h:mm a",
            )}
            {" – "}
            {format(
              new TZDate(new Date(selectedSlot.end).getTime(), timezone),
              "h:mm a",
            )}
          </div>
        </div>
      )}
      {!compact && (
        <Badge variant="secondary" className="mt-3 text-[10px]">
          {eventType.length} min meeting
        </Badge>
      )}
    </div>
  );
}

function hostDisplayName(ownerEmail?: string, teamSlug?: string): string {
  if (teamSlug) return teamSlug;
  if (!ownerEmail) return "Host";
  return ownerEmail.split("@")[0];
}

function hostInitials(name: string): string {
  return (
    name
      .split(/[.\s_-]/)
      .filter(Boolean)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .slice(0, 2)
      .join("") || "?"
  );
}

function locationLabel(kind: string): string {
  if (kind === "builtin-video") return "Video call";
  if (kind === "google-meet") return "Google Meet";
  if (kind === "zoom") return "Zoom";
  if (kind === "teams") return "Microsoft Teams";
  if (kind === "phone") return "Phone";
  if (kind === "in-person") return "In person";
  if (kind === "attendee-phone") return "Attendee phone";
  return "Web conference";
}

function hexToHslValues(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 3 && clean.length !== 6) return "209 100% 45%";
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
