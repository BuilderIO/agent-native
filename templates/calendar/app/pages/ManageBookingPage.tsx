import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  CalendarDays,
  Clock,
  XCircle,
  CalendarPlus,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface BookingInfo {
  eventTitle: string;
  name: string;
  start: string;
  end: string;
  slug: string;
  meetingLink?: string;
  status: "confirmed" | "cancelled";
}

export function ManageBookingPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [justCancelled, setJustCancelled] = useState(false);

  const {
    data: booking,
    isLoading,
    error,
  } = useQuery<BookingInfo>({
    queryKey: ["manage-booking", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/bookings/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Booking not found");
      }
      return res.json();
    },
    enabled: !!token,
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/public/bookings/${token}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to cancel");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setJustCancelled(true);
    },
  });

  const isCancelled = booking?.status === "cancelled" || justCancelled;
  const isPast = booking ? new Date(booking.end) < new Date() : false;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 text-center">
        <XCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <h1 className="text-xl font-semibold">Booking not found</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">
          This link may have expired or the booking may have been removed.
        </p>
      </div>
    );
  }

  if (isCancelled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 text-center">
        <CheckCircle2 className="h-16 w-16 text-emerald-600 dark:text-emerald-400 mb-4" />
        <h1 className="text-2xl font-semibold">Booking Cancelled</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">
          Your booking for{" "}
          <span className="font-medium text-foreground">
            {booking.eventTitle}
          </span>{" "}
          on{" "}
          <span className="font-medium text-foreground">
            {format(parseISO(booking.start), "MMMM d, yyyy")}
          </span>{" "}
          has been cancelled.
        </p>
        {booking.slug && (
          <Button
            variant="outline"
            className="mt-6 gap-2"
            onClick={() => navigate(`/book/${booking.slug}`)}
          >
            <CalendarPlus className="h-4 w-4" />
            Reschedule
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold">Manage Booking</h1>
          <p className="text-sm text-muted-foreground">
            Cancel or reschedule your meeting.
          </p>
        </div>

        {/* Booking details */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-3">
          <div>
            <p className="text-lg font-semibold">{booking.eventTitle}</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="h-4 w-4 shrink-0" />
            {format(parseISO(booking.start), "EEEE, MMMM d, yyyy")}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" />
            {format(parseISO(booking.start), "h:mm a")} -{" "}
            {format(parseISO(booking.end), "h:mm a")}
          </div>
          <div className="text-sm text-muted-foreground">
            Booked by {booking.name}
          </div>
        </div>

        {isPast ? (
          <p className="text-center text-sm text-muted-foreground">
            This meeting has already passed.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {booking.slug && (
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => {
                  // Cancel first, then redirect to rebook
                  cancelMutation.mutate(undefined, {
                    onSuccess: () => navigate(`/book/${booking.slug}`),
                  });
                }}
                disabled={cancelMutation.isPending}
              >
                <CalendarPlus className="h-4 w-4" />
                Reschedule
              </Button>
            )}

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  className="w-full gap-2"
                  disabled={cancelMutation.isPending}
                >
                  <XCircle className="h-4 w-4" />
                  Cancel Booking
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will cancel your{" "}
                    <span className="font-medium text-foreground">
                      {booking.eventTitle}
                    </span>{" "}
                    on{" "}
                    <span className="font-medium text-foreground">
                      {format(parseISO(booking.start), "MMMM d, yyyy")}
                    </span>
                    . This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep Booking</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => cancelMutation.mutate()}
                    disabled={cancelMutation.isPending}
                  >
                    {cancelMutation.isPending ? "Cancelling..." : "Yes, Cancel"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </div>
  );
}
