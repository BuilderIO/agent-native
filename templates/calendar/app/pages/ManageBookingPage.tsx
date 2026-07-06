import { useT } from "@agent-native/core/client";
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
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import {
  IconCalendar,
  IconClock,
  IconCircleX,
  IconCalendarPlus,
  IconCircleCheck,
} from "@tabler/icons-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { toast } from "sonner";

import { appApiPath } from "@/lib/api-path";

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
  const t = useT();
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
      const res = await fetch(appApiPath(`/api/public/bookings/${token}`));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || t("manageBooking.notFound"));
      }
      return res.json();
    },
    enabled: !!token,
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(appApiPath(`/api/public/bookings/${token}`), {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || t("manageBooking.cancelFailed"));
      }
      return res.json();
    },
    onSuccess: () => {
      setJustCancelled(true);
    },
  });

  const isCancelled = booking?.status === "cancelled" || justCancelled;
  const isPast = booking ? new Date(booking.end) < new Date() : false;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner className="size-8 text-foreground" />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 text-center">
        <IconCircleX className="h-12 w-12 text-muted-foreground mb-4" />
        <h1 className="text-xl font-semibold">{t("manageBooking.notFound")}</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">
          {t("manageBooking.notFoundDescription")}
        </p>
      </div>
    );
  }

  if (isCancelled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 text-center">
        <IconCircleCheck className="h-16 w-16 text-emerald-600 dark:text-emerald-400 mb-4" />
        <h1 className="text-2xl font-semibold">
          {t("manageBooking.cancelled")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">
          {t("manageBooking.cancelledPrefix")}{" "}
          <span className="font-medium text-foreground">
            {booking.eventTitle}
          </span>{" "}
          {t("manageBooking.cancelledDateConnector")}{" "}
          <span className="font-medium text-foreground">
            {format(parseISO(booking.start), "MMMM d, yyyy")}
          </span>{" "}
          {t("manageBooking.cancelledSuffix")}
        </p>
        {booking.slug && (
          <Button
            variant="outline"
            className="mt-6 gap-2"
            onClick={() => navigate(`/book/${booking.slug}`)}
          >
            <IconCalendarPlus className="h-4 w-4" />
            {t("manageBooking.reschedule")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold">{t("manageBooking.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("manageBooking.description")}
          </p>
        </div>

        {/* Booking details */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-3">
          <div>
            <p className="text-lg font-semibold">{booking.eventTitle}</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconCalendar className="h-4 w-4 shrink-0" />
            {format(parseISO(booking.start), "EEEE, MMMM d, yyyy")}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconClock className="h-4 w-4 shrink-0" />
            {format(parseISO(booking.start), "h:mm a")} -{" "}
            {format(parseISO(booking.end), "h:mm a")}
          </div>
          <div className="text-sm text-muted-foreground">
            {t("manageBooking.bookedBy", { name: booking.name })}
          </div>
        </div>

        {isPast ? (
          <p className="text-center text-sm text-muted-foreground">
            {t("manageBooking.pastMeeting")}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {booking.slug && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    disabled={cancelMutation.isPending}
                  >
                    <IconCalendarPlus className="h-4 w-4" />
                    {t("manageBooking.reschedule")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("manageBooking.rescheduleTitle")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("manageBooking.rescheduleDescription")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      {t("manageBooking.keepCurrentTime")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        cancelMutation.mutate(undefined, {
                          onSuccess: () => navigate(`/book/${booking.slug}`),
                          onError: () =>
                            toast.error(t("manageBooking.cancelFailed")),
                        });
                      }}
                      disabled={cancelMutation.isPending}
                    >
                      {cancelMutation.isPending
                        ? t("manageBooking.cancelling")
                        : t("manageBooking.reschedule")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  className="w-full gap-2"
                  disabled={cancelMutation.isPending}
                >
                  <IconCircleX className="h-4 w-4" />
                  {t("manageBooking.cancelBooking")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("manageBooking.cancelTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("manageBooking.cancelDescriptionPrefix")}{" "}
                    <span className="font-medium text-foreground">
                      {booking.eventTitle}
                    </span>{" "}
                    {t("manageBooking.cancelDescriptionDateConnector")}{" "}
                    <span className="font-medium text-foreground">
                      {format(parseISO(booking.start), "MMMM d, yyyy")}
                    </span>
                    {t("manageBooking.cancelDescriptionSuffix")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {t("manageBooking.keepBooking")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      cancelMutation.mutate(undefined, {
                        onError: () =>
                          toast.error(t("manageBooking.cancelFailed")),
                      });
                    }}
                    disabled={cancelMutation.isPending}
                  >
                    {cancelMutation.isPending
                      ? t("manageBooking.cancelling")
                      : t("manageBooking.yesCancel")}
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
