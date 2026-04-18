/**
 * Booker — the public booking flow orchestrator.
 *
 * Stages (pick-date → pick-slot → fill-form → success) flow with
 * framer-motion width+fade animations.
 */
import { useCallback, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TZDate } from "@date-fns/tz";
import { format, startOfMonth, endOfMonth, addMonths } from "date-fns";
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
import { Button } from "@/components/ui/button";
import { IconChevronLeft } from "@tabler/icons-react";

export interface BookerProps {
  eventType: EventType;
  ownerEmail?: string;
  teamSlug?: string;
  /** If set, this is a reschedule — old booking UID is replaced. */
  rescheduleUid?: string;
  mode?: "page" | "embed";
}

const stage = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -16 },
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

  // Mirror state to application-state so the agent can see it.
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

  return (
    <div
      className="mx-auto max-w-5xl p-4"
      style={{
        // Brand color CSS vars power calendar day hover + active slot bg.
        ...((props.eventType.color
          ? { "--brand-accent": props.eventType.color }
          : {}) as React.CSSProperties),
      }}
    >
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {props.eventType.title}
          </h1>
          {props.eventType.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {props.eventType.description}
            </p>
          )}
          <div className="mt-2 flex gap-3 text-sm text-muted-foreground">
            <span>{props.eventType.length} min</span>
            <span>•</span>
            <span>{props.eventType.locations?.[0]?.kind ?? "Cal Video"}</span>
          </div>
        </div>
        <TimezoneSelect value={tz} onChange={setTz} />
      </header>

      <div className="relative min-h-[480px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={flow.state.stage}
            {...stage}
            transition={{ duration: 0.18 }}
          >
            {flow.state.stage === "pick-date" && (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <DatePicker
                  slots={slots}
                  timezone={tz}
                  month={viewMonth}
                  onSelectDate={flow.selectDate}
                  isLoading={isLoading}
                />
              </div>
            )}
            {flow.state.stage === "pick-slot" && flow.state.selectedDate && (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_360px]">
                <DatePicker
                  slots={slots}
                  timezone={tz}
                  month={viewMonth}
                  selectedDate={flow.state.selectedDate}
                  onSelectDate={flow.selectDate}
                  isLoading={isLoading}
                />
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={flow.backToDate}
                    >
                      <IconChevronLeft className="h-4 w-4" />
                    </Button>
                    <h2 className="text-sm font-medium">
                      {format(
                        new TZDate(`${flow.state.selectedDate}T12:00:00Z`, tz),
                        "EEEE, MMMM d",
                      )}
                    </h2>
                  </div>
                  <SlotPicker
                    slots={slots.filter((s: Slot) =>
                      s.start.startsWith(flow.state.selectedDate!),
                    )}
                    timezone={tz}
                    onSelect={flow.selectSlot}
                  />
                </div>
              </div>
            )}
            {flow.state.stage === "fill-form" && flow.state.selectedSlot && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={flow.backToSlot}
                  className="mb-2"
                >
                  <IconChevronLeft className="mr-1 h-4 w-4" />
                  Pick a different time
                </Button>
                <BookingForm
                  eventType={props.eventType}
                  slot={flow.state.selectedSlot}
                  timezone={tz}
                  onSubmit={onSubmit}
                />
              </div>
            )}
            {flow.state.stage === "submitting" && (
              <p className="p-6 text-sm text-muted-foreground">
                {props.rescheduleUid ? "Rescheduling…" : "Creating booking…"}
              </p>
            )}
            {flow.state.stage === "success" && flow.state.resultBookingUid && (
              <SuccessCard
                bookingUid={flow.state.resultBookingUid}
                eventType={props.eventType}
                slot={flow.state.selectedSlot!}
                timezone={tz}
              />
            )}
            {flow.state.stage === "error" && (
              <div className="p-6">
                <p className="text-sm text-destructive">
                  Something went wrong: {flow.state.error}
                </p>
                <Button onClick={flow.backToSlot} className="mt-4">
                  Try again
                </Button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
