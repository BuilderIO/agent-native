import { useState } from "react";
import { useParams } from "react-router";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { PoweredByBadge } from "@agent-native/core/client";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DatePicker } from "@/components/booking/DatePicker";
import { TimeSlotPicker } from "@/components/booking/TimeSlotPicker";
import { BookingForm } from "@/components/booking/BookingForm";
import { BookingConfirmation } from "@/components/booking/BookingConfirmation";
import {
  usePublicSettings,
  usePublicAvailability,
} from "@/hooks/use-public-data";
import { useAvailableSlots, useCreateBooking } from "@/hooks/use-bookings";
import { toast } from "sonner";
import type { Booking } from "@shared/api";

type Step = "date" | "time" | "info" | "confirmed";

export default function BookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: settings } = usePublicSettings();
  const { data: availability } = usePublicAvailability();

  const [step, setStep] = useState<Step>("date");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(
    null,
  );

  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
  const duration =
    availability?.slotDurationMinutes ?? settings?.defaultEventDuration ?? 30;
  const { data: slots = [], isLoading: slotsLoading } = useAvailableSlots(
    dateStr,
    duration,
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
    setStep("date");
    setSelectedDate(null);
    setSelectedSlot(null);
    setConfirmedBooking(null);
  }

  const title = settings?.bookingPageTitle || "Book a Meeting";
  const description =
    settings?.bookingPageDescription || "Pick a time that works for you.";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <CalendarDays className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>

        {/* Steps */}
        <div className="rounded-xl border border-border bg-card p-6">
          {/* Step indicators */}
          {step !== "confirmed" && (
            <div className="mb-6 flex items-center justify-center gap-2">
              {(["date", "time", "info"] as const).map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                      step === s
                        ? "bg-primary text-primary-foreground"
                        : ["date", "time", "info"].indexOf(step) > i
                          ? "bg-primary/20 text-primary"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {i + 1}
                  </div>
                  {i < 2 && <div className="h-px w-8 bg-border" />}
                </div>
              ))}
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
                />
              </div>
            </div>
          )}

          {step === "time" && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium">Select a Time</h3>
                <button
                  onClick={() => setStep("date")}
                  className="text-xs text-primary hover:underline"
                >
                  Change date
                </button>
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
                <button
                  onClick={() => setStep("time")}
                  className="text-xs text-primary hover:underline"
                >
                  Change time
                </button>
              </div>
              <BookingForm
                onSubmit={handleBookingSubmit}
                loading={createBooking.isPending}
              />
            </div>
          )}

          {step === "confirmed" && confirmedBooking && (
            <BookingConfirmation
              booking={confirmedBooking}
              onReset={handleReset}
            />
          )}
        </div>
      </div>
      <PoweredByBadge />
    </div>
  );
}
