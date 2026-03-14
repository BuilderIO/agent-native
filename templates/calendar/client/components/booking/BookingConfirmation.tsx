import { format, parseISO } from "date-fns";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Booking } from "@shared/api";

interface BookingConfirmationProps {
  booking: Booking;
  onReset: () => void;
}

export function BookingConfirmation({ booking, onReset }: BookingConfirmationProps) {
  return (
    <div className="flex flex-col items-center text-center space-y-6 py-8">
      <CheckCircle2 className="h-16 w-16 text-green-500" />

      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Booking Confirmed</h2>
        <p className="text-muted-foreground">
          You're all set! A confirmation has been sent to your email.
        </p>
      </div>

      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 text-left space-y-2">
        <div>
          <span className="text-xs text-muted-foreground">Event</span>
          <p className="font-medium">{booking.eventTitle}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Date</span>
          <p className="font-medium">
            {format(parseISO(booking.start), "EEEE, MMMM d, yyyy")}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Time</span>
          <p className="font-medium">
            {format(parseISO(booking.start), "h:mm a")} -{" "}
            {format(parseISO(booking.end), "h:mm a")}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Name</span>
          <p className="font-medium">{booking.name}</p>
        </div>
      </div>

      <Button variant="outline" onClick={onReset}>
        Book Another
      </Button>
    </div>
  );
}
