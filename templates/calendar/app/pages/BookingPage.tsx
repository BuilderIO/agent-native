import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { IconCalendar } from "@tabler/icons-react";
import { PoweredByBadge } from "@agent-native/core/client";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DatePicker } from "@/components/booking/DatePicker";
import { TimeSlotPicker } from "@/components/booking/TimeSlotPicker";
import { BookingForm } from "@/components/booking/BookingForm";
import { BookingConfirmation } from "@/components/booking/BookingConfirmation";
import {
  usePublicSettings,
  usePublicAvailability,
  usePublicBookingLink,
} from "@/hooks/use-public-data";
import {
  useAvailableDays,
  useAvailableSlots,
  useCreateBooking,
} from "@/hooks/use-bookings";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import type { Booking } from "@shared/api";
import { cn } from "@/lib/utils";

type Step = "duration" | "date" | "time" | "info" | "confirmed";

export default function BookingPage() {
  const { slug, username } = useParams<{ slug: string; username?: string }>();
  const navigate = useNavigate();
  const { data: settings, isLoading: settingsLoading } = usePublicSettings();
  const { data: availability, isLoading: availabilityLoading } =
    usePublicAvailability(slug);
  const {
    data: bookingLink,
    isLoading: bookingLinkLoading,
    isError: bookingLinkError,
  } = usePublicBookingLink(slug);

  // Handle slug redirects (old URL → new URL)
  useEffect(() => {
    if (!bookingLink?.redirect) return;
    const newSlug = bookingLink.redirect;
    const path = username ? `/meet/${username}/${newSlug}` : `/book/${newSlug}`;
    navigate(path, { replace: true });
  }, [bookingLink?.redirect, username, navigate]);

  const [step, setStep] = useState<Step>("date");
  const hasDurationChoice =
    bookingLink?.durations && bookingLink.durations.length > 1;
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(
    null,
  );
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [viewMonth, setViewMonth] = useState(() => new Date());

  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
  const durationOptions =
    bookingLink?.durations && bookingLink.durations.length > 0
      ? bookingLink.durations
      : null;
  const duration =
    selectedDuration ??
    bookingLink?.duration ??
    availability?.slotDurationMinutes ??
    settings?.defaultEventDuration ??
    30;
  const { data: slots = [], isLoading: slotsLoading } = useAvailableSlots(
    dateStr,
    duration,
    slug,
  );
  const monthStart = format(startOfMonth(viewMonth), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(viewMonth), "yyyy-MM-dd");
  const { data: availableDates = [], isLoading: availableDatesLoading } =
    useAvailableDays(
      monthStart,
      monthEnd,
      duration,
      slug,
      step === "date" && !!availability,
    );
  const createBooking = useCreateBooking();

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
        onError: () => toast.error("Failed to create booking"),
      },
    );
  }

  function handleReset() {
    setStep(hasDurationChoice ? "duration" : "date");
    setSelectedDate(null);
    setSelectedSlot(null);
    setSelectedDuration(null);
    setConfirmedBooking(null);
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

  const title = settings?.bookingPageTitle || "Book a Meeting";
  const description =
    settings?.bookingPageDescription || "Pick a time that works for you.";
  const isLegacyBookingPage = !!slug && availability?.bookingPageSlug === slug;
  const pageTitle = bookingLink?.title || title;
  const pageDescription = bookingLink?.description || description;

  if (bookingLinkLoading || settingsLoading || availabilityLoading) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="mx-auto mt-[7.5vh] flex w-full max-w-lg justify-center">
          <Spinner className="size-8 text-foreground" />
        </div>
      </div>
    );
  }

  if ((bookingLinkError || !bookingLink) && !isLegacyBookingPage) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="mx-auto mt-[7.5vh] w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold">Booking link not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This meeting type may have been removed or is no longer active.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background p-4 pb-20">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
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
          {!hasDurationChoice && (
            <p className="mt-3 inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
              {duration} minute meeting
            </p>
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
                duration: "duration selection",
                date: "date selection",
                time: "time selection",
                info: "your information",
                confirmed: "confirmation",
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
                            aria-label={`Go to ${stepLabels[s]}`}
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
                Choose a Duration
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
                    <p className="text-sm font-medium">{mins} minutes</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "date" && availability && (
            <div>
              <h3 className="mb-4 text-sm font-medium text-center">
                Select a Date
              </h3>
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
            </div>
          )}

          {step === "time" && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium">Select a Time</h3>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setStep("date")}
                >
                  Change date
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
              />
            </div>
          )}

          {step === "info" && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium">Your Information</h3>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setStep("time")}
                >
                  Change time
                </Button>
              </div>
              <BookingForm
                onSubmit={handleBookingSubmit}
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
      <PoweredByBadge />
    </div>
  );
}
