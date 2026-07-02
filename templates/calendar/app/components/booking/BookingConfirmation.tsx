import { useT } from "@agent-native/core/client";
import type { Booking, CustomField } from "@shared/api";
import { IconCircleCheck, IconVideo } from "@tabler/icons-react";
import { format, parseISO } from "date-fns";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

interface BookingConfirmationProps {
  booking: Booking;
  customFields?: CustomField[];
  onReset: () => void;
}

const BRAND_LINK_CLASS = "font-semibold text-[#00B5FF] hover:text-[#33C4FF]";

export function BookingConfirmation({
  booking,
  customFields = [],
  onReset,
}: BookingConfirmationProps) {
  const t = useT();
  const responses = booking.fieldResponses;
  const fieldsWithResponses = customFields.filter(
    (f) =>
      responses?.[f.id] !== undefined &&
      responses[f.id] !== "" &&
      responses[f.id] !== false,
  );

  return (
    <div className="flex flex-col items-center text-center space-y-6 py-8">
      <IconCircleCheck className="h-16 w-16 text-emerald-600 dark:text-emerald-400" />

      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">
          {t("bookingLinks.bookingConfirmed")}
        </h2>
        <p className="text-muted-foreground">
          {t("bookingLinks.confirmationSent")}
        </p>
      </div>

      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 text-left space-y-2">
        <div>
          <span className="text-xs text-muted-foreground">
            {t("eventForm.event")}
          </span>
          <p className="font-medium">{booking.eventTitle}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">
            {t("bookingLinks.date")}
          </span>
          <p className="font-medium">
            {format(parseISO(booking.start), "EEEE, MMMM d, yyyy")}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">
            {t("bookingLinks.time")}
          </span>
          <p className="font-medium">
            {format(parseISO(booking.start), "h:mm a")} -{" "}
            {format(parseISO(booking.end), "h:mm a")}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">
            {t("bookingLinks.name")}
          </span>
          <p className="font-medium">{booking.name}</p>
        </div>
        {booking.meetingLink && (
          <div>
            <span className="text-xs text-muted-foreground">
              {t("bookingLinks.meetingLink")}
            </span>
            <a
              href={booking.meetingLink}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1.5 hover:underline ${BRAND_LINK_CLASS}`}
            >
              <IconVideo className="h-4 w-4" />
              {t("eventForm.joinMeeting")}
            </a>
          </div>
        )}
        {fieldsWithResponses.map((field) => (
          <div key={field.id}>
            <span className="text-xs text-muted-foreground">{field.label}</span>
            <p className="font-medium">
              {typeof responses![field.id] === "boolean"
                ? responses![field.id]
                  ? t("bookingLinks.yes")
                  : t("bookingLinks.no")
                : String(responses![field.id])}
            </p>
          </div>
        ))}
      </div>

      {booking.cancelToken && (
        <p className="text-xs text-muted-foreground">
          {t("bookingLinks.needToMakeChanges")}{" "}
          <Link
            to={`/booking/manage/${booking.cancelToken}`}
            className={`hover:underline ${BRAND_LINK_CLASS}`}
          >
            {t("bookingLinks.cancelOrReschedule")}
          </Link>
        </p>
      )}

      <Button variant="outline" onClick={onReset}>
        {t("bookingLinks.bookAnother")}
      </Button>
    </div>
  );
}
