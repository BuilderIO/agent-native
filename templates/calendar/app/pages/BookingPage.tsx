import {
  OpenSourceBadge,
  PoweredByBadge,
  LanguagePicker,
  StarfieldBackground,
  useT,
} from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import type { Booking } from "@shared/api";
import { IconAlertTriangle, IconCalendar } from "@tabler/icons-react";
import {
  addMinutes,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
} from "date-fns";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { BookingConfirmation } from "@/components/booking/BookingConfirmation";
import {
  BookingForm,
  type BookingFormValue,
} from "@/components/booking/BookingForm";
import { DatePicker } from "@/components/booking/DatePicker";
import { TimeSlotPicker } from "@/components/booking/TimeSlotPicker";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  useAvailableDays,
  useAvailableSlots,
  useCreateBooking,
} from "@/hooks/use-bookings";
import {
  usePublicSettings,
  usePublicAvailability,
  usePublicBookingLink,
} from "@/hooks/use-public-data";
import { cn } from "@/lib/utils";

type Step = "duration" | "date" | "time" | "info" | "confirmed";

const BRAND_LINK_CLASS = "font-semibold text-[#00B5FF] hover:text-[#33C4FF]";

function BookingPageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative min-h-screen bg-background dark:bg-black",
        className,
      )}
    >
      <StarfieldBackground className="fixed inset-0 opacity-25 dark:opacity-60" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--background)/0.35)_0%,hsl(var(--background)/0.88)_72%)] dark:bg-[radial-gradient(ellipse_at_center,hsl(var(--background)/0.35)_0%,#000000_100%)]" />
      <div className="fixed top-4 right-4 z-50 flex items-center gap-1">
        <LanguagePicker variant="ghost-icon" />
        <ThemeToggle />
      </div>
      <div className="fixed bottom-[21px] left-4 z-50 flex flex-col items-start gap-2 max-sm:static max-sm:mx-auto max-sm:mt-8">
        <PoweredByBadge variant="plain" embedded />
        <OpenSourceBadge embedded />
      </div>
      <div className="relative z-10 min-h-screen overflow-x-hidden p-4">
        {children}
      </div>
    </div>
  );
}

export default function BookingPage() {
  const t = useT();
  const { slug, username } = useParams<{ slug: string; username?: string }>();
  const navigate = useNavigate();
  const { data: settings, isLoading: settingsLoading } = usePublicSettings();
  const { data: availability, isLoading: availabilityLoading } =
    usePublicAvailability(slug);
  const {
    data: bookingLink,
    isLoading: bookingLinkLoading,
    isError: bookingLinkError,
  } = usePublicBookingLink(slug, username);
  const isRedirecting =
    !!bookingLink && (!!bookingLink.redirectPath || !!bookingLink.redirect);

  // Handle slug redirects (old URL → new URL)
  useEffect(() => {
    if (bookingLink?.redirectPath) {
      navigate(bookingLink.redirectPath, { replace: true });
      return;
    }
    if (!bookingLink?.redirect) return;
    const newSlug = bookingLink.redirect;
    const path = username ? `/book/${username}/${newSlug}` : `/book/${newSlug}`;
    navigate(path, { replace: true });
  }, [bookingLink?.redirect, bookingLink?.redirectPath, username, navigate]);

  const [step, setStep] = useState<Step>("date");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(
    null,
  );
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [viewMonth, setViewMonth] = useState(() => new Date());
  const [bookingForm, setBookingForm] = useState<BookingFormValue>({
    name: "",
    email: "",
    notes: "",
    fieldResponses: {},
  });

  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
  const durationOptions =
    bookingLink?.durations && bookingLink.durations.length > 0
      ? bookingLink.durations
      : null;
  const hasDurationChoice = !!durationOptions && durationOptions.length > 1;
  const bookingLinkDuration =
    durationOptions && durationOptions.length === 1
      ? durationOptions[0]
      : bookingLink?.duration;
  const duration =
    selectedDuration ??
    bookingLinkDuration ??
    availability?.slotDurationMinutes ??
    settings?.defaultEventDuration ??
    30;
  const {
    data: slots = [],
    isLoading: slotsLoading,
    error: slotsError,
  } = useAvailableSlots(dateStr, duration, slug);
  const monthStart = format(startOfMonth(viewMonth), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(viewMonth), "yyyy-MM-dd");
  const {
    data: availableDates = [],
    isLoading: availableDatesLoading,
    error: availableDatesError,
  } = useAvailableDays(
    monthStart,
    monthEnd,
    duration,
    slug,
    step === "date" &&
      !!availability &&
      (!hasDurationChoice || selectedDuration !== null),
  );
  const createBooking = useCreateBooking();
  const selectedSlotRange = selectedSlot
    ? {
        start: selectedSlot,
        end:
          slots.find((slot) => slot.start === selectedSlot)?.end ??
          addMinutes(parseISO(selectedSlot), duration).toISOString(),
      }
    : null;

  function handleDateSelect(date: Date) {
    setSelectedDate(date);
    setSelectedSlot(null);
    setStep("time");
  }

  function handleSlotSelect(start: string) {
    setSelectedSlot(start);
    setStep("info");
  }

  function handleBookingSubmit(data: {
    name: string;
    email: string;
    notes?: string;
    captchaToken?: string;
    fieldResponses?: Record<string, string | boolean>;
  }) {
    if (!selectedSlot || !slug) return;

    const slot = slots.find((s) => s.start === selectedSlot);
    if (!slot) return;

    createBooking.mutate(
      {
        name: data.name,
        email: data.email,
        notes: data.notes,
        captchaToken: data.captchaToken,
        fieldResponses: data.fieldResponses,
        start: slot.start,
        end: slot.end,
        slug,
      },
      {
        onSuccess: (booking: Booking) => {
          setConfirmedBooking(booking);
          setStep("confirmed");
        },
        onError: (error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : t("bookingLinks.failedToCreateBooking"),
          ),
      },
    );
  }

  function handleReset() {
    setStep(hasDurationChoice ? "duration" : "date");
    setSelectedDate(null);
    setSelectedSlot(null);
    setSelectedDuration(null);
    setConfirmedBooking(null);
    setBookingForm({ name: "", email: "", notes: "", fieldResponses: {} });
  }

  function handleStepNavigation(target: Step) {
    if (target === step) return;

    if (target === "duration") {
      setSelectedDate(null);
      setSelectedSlot(null);
      setStep("duration");
      return;
    }

    if (target === "date") {
      setSelectedSlot(null);
      setStep("date");
      return;
    }

    if (target === "time" && selectedDate) {
      setSelectedSlot(null);
      setStep("time");
    }
  }

  const title = settings?.bookingPageTitle || t("bookingLinks.bookAMeeting");
  const description =
    settings?.bookingPageDescription || t("bookingLinks.defaultDescription");
  const isLegacyBookingPage = !!slug && availability?.bookingPageSlug === slug;
  const pageTitle = bookingLink?.title || title;
  const pageDescription = bookingLink?.description || description;
  const requiredHostCount = (bookingLink?.hosts?.length ?? 0) + 1;
  const availabilityErrorMessage = t("bookingLinks.availabilityUnavailable");

  useEffect(() => {
    if (hasDurationChoice && step === "date" && selectedDuration === null) {
      setStep("duration");
    } else if (!hasDurationChoice && step === "duration") {
      setStep("date");
    }
  }, [hasDurationChoice, selectedDuration, step]);

  if (
    bookingLinkLoading ||
    settingsLoading ||
    availabilityLoading ||
    isRedirecting
  ) {
    return (
      <BookingPageShell>
        <div className="mx-auto mt-[7.5vh] flex w-full max-w-lg justify-center">
          <Spinner className="size-8 text-foreground" />
        </div>
      </BookingPageShell>
    );
  }

  if ((bookingLinkError || !bookingLink) && !isLegacyBookingPage) {
    return (
      <BookingPageShell>
        <div className="mx-auto mt-[7.5vh] w-full max-w-md rounded-2xl border border-border bg-card/95 p-8 text-center shadow-xl shadow-background/20 backdrop-blur">
          <h1 className="text-xl font-semibold">
            {t("bookingLinks.bookingLinkNotFound")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("bookingLinks.meetingTypeUnavailable")}
          </p>
        </div>
      </BookingPageShell>
    );
  }

  return (
    <BookingPageShell className="pb-20">
      <div className="mx-auto mt-[7.5vh] w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <IconCalendar className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold">{pageTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pageDescription}
          </p>
          {(!hasDurationChoice || requiredHostCount > 1) && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {!hasDurationChoice && (
                <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
                  {t("bookingLinks.minuteMeeting", { count: duration })}
                </span>
              )}
              {requiredHostCount > 1 && (
                <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
                  {t("bookingLinks.requiredHostsCount", {
                    count: requiredHostCount,
                  })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Steps */}
        <div className="rounded-xl border border-border bg-card p-6">
          {/* Step indicators */}
          {step !== "confirmed" &&
            (() => {
              const steps = hasDurationChoice
                ? (["duration", "date", "time", "info"] as const)
                : (["date", "time", "info"] as const);
              const currentStepIndex = (steps as readonly string[]).indexOf(
                step,
              );
              const stepLabels: Record<Step, string> = {
                duration: t("bookingLinks.durationSelection"),
                date: t("bookingLinks.dateSelection"),
                time: t("bookingLinks.timeSelection"),
                info: t("bookingLinks.yourInformation"),
                confirmed: t("bookingLinks.confirmation"),
              };
              return (
                <div className="mb-6 flex items-center justify-center gap-2">
                  {steps.map((s, i) => {
                    const isCurrent = step === s;
                    const isPrevious = currentStepIndex > i;
                    const isReachable =
                      !isCurrent &&
                      (isPrevious ||
                        (s === "date" && !!selectedDuration) ||
                        (s === "time" && !!selectedDate) ||
                        (s === "info" && !!selectedSlot));
                    const circleClass = cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors",
                      isCurrent
                        ? "bg-primary text-primary-foreground"
                        : isPrevious
                          ? "bg-primary/20 text-primary"
                          : "bg-muted text-muted-foreground",
                      isReachable &&
                        "cursor-pointer hover:bg-primary/30 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    );

                    return (
                      <div key={s} className="flex items-center gap-2">
                        {isReachable ? (
                          <button
                            type="button"
                            onClick={() => handleStepNavigation(s)}
                            className={circleClass}
                            aria-label={t("bookingLinks.goToStep", {
                              step: stepLabels[s],
                            })}
                          >
                            {i + 1}
                          </button>
                        ) : (
                          <div className={circleClass}>{i + 1}</div>
                        )}
                        {i < steps.length - 1 && (
                          <div className="h-px w-8 bg-border" />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

          {step === "duration" && durationOptions && (
            <div>
              <h3 className="mb-4 text-sm font-medium text-center">
                {t("bookingLinks.chooseDuration")}
              </h3>
              <div className="grid gap-3">
                {durationOptions.map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => {
                      setSelectedDuration(mins);
                      setStep("date");
                    }}
                    className="rounded-xl border border-border px-4 py-3 text-left hover:bg-accent/60 hover:border-primary/30"
                  >
                    <p className="text-sm font-medium">
                      {t("bookingLinks.minutesLong", { count: mins })}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "date" && availability && (
            <div>
              <h3 className="mb-4 text-sm font-medium text-center">
                {t("bookingLinks.selectDate")}
              </h3>
              {availableDatesError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-3 text-sm text-destructive">
                  <div className="flex items-start gap-2">
                    <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{availabilityErrorMessage}</p>
                  </div>
                </div>
              ) : (
                <div className="flex justify-center">
                  <DatePicker
                    selectedDate={selectedDate}
                    onSelect={handleDateSelect}
                    availability={availability}
                    availableDates={availableDates}
                    availabilityLoading={availableDatesLoading}
                    viewMonth={viewMonth}
                    onViewMonthChange={setViewMonth}
                  />
                </div>
              )}
            </div>
          )}

          {step === "time" && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  {t("bookingLinks.selectTime")}
                </h3>
                <Button
                  variant="link"
                  size="sm"
                  className={BRAND_LINK_CLASS}
                  onClick={() => setStep("date")}
                >
                  {t("bookingLinks.changeDate")}
                </Button>
              </div>
              {selectedDate && (
                <p className="mb-4 text-sm text-muted-foreground">
                  {format(selectedDate, "EEEE, MMMM d, yyyy")}
                </p>
              )}
              <TimeSlotPicker
                slots={slots}
                selectedSlot={selectedSlot}
                onSelect={handleSlotSelect}
                loading={slotsLoading}
                errorMessage={slotsError ? availabilityErrorMessage : undefined}
              />
            </div>
          )}

          {step === "info" && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  {t("bookingLinks.yourInformation")}
                </h3>
                <Button
                  variant="link"
                  size="sm"
                  className={BRAND_LINK_CLASS}
                  onClick={() => setStep("time")}
                >
                  {t("bookingLinks.changeTime")}
                </Button>
              </div>
              {selectedSlotRange && (
                <div className="mb-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("bookingLinks.confirming")}
                  </div>
                  <div className="mt-1 font-medium text-foreground">
                    {format(parseISO(selectedSlotRange.start), "EEEE, MMMM d")}
                  </div>
                  <div className="text-muted-foreground">
                    {format(parseISO(selectedSlotRange.start), "h:mm a")} -{" "}
                    {format(parseISO(selectedSlotRange.end), "h:mm a")}
                  </div>
                </div>
              )}
              <BookingForm
                onSubmit={handleBookingSubmit}
                value={bookingForm}
                onChange={setBookingForm}
                loading={createBooking.isPending}
                customFields={bookingLink?.customFields}
              />
            </div>
          )}

          {step === "confirmed" && confirmedBooking && (
            <BookingConfirmation
              booking={confirmedBooking}
              customFields={bookingLink?.customFields}
              onReset={handleReset}
            />
          )}
        </div>
      </div>
    </BookingPageShell>
  );
}
