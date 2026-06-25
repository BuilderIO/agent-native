import { useT } from "@agent-native/core/client";
import type { Booking, CustomField } from "@shared/api";
import { IconCircleX } from "@tabler/icons-react";
import { format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBookingLinks } from "@/hooks/use-booking-links";
import { useBookings, useDeleteBooking } from "@/hooks/use-bookings";

type FilterStatus = "all" | "confirmed" | "cancelled";

export default function BookingsList() {
  const t = useT();
  const { data: bookings = [] } = useBookings();
  const { data: bookingLinks = [] } = useBookingLinks();
  const deleteBooking = useDeleteBooking();
  const [filter, setFilter] = useState<FilterStatus>("all");

  // Build a map of slug -> custom fields for resolving field labels
  const fieldsBySlug = useMemo(() => {
    const map: Record<string, CustomField[]> = {};
    for (const link of bookingLinks) {
      if (link.customFields) map[link.slug] = link.customFields;
    }
    return map;
  }, [bookingLinks]);

  const filtered = bookings.filter((b) => {
    if (filter === "all") return true;
    return b.status === filter;
  });

  function handleCancel(booking: Booking) {
    deleteBooking.mutate(booking.id, {
      onSuccess: () => toast.success(t("bookingLinks.bookingCancelled")),
      onError: () => toast.error(t("bookingLinks.failedToCancelBooking")),
    });
  }

  return (
    <div className="space-y-6">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterStatus)}>
        <TabsList>
          <TabsTrigger value="all">
            {t("bookingLinks.allCount", { count: bookings.length })}
          </TabsTrigger>
          <TabsTrigger value="confirmed">
            {t("bookingLinks.confirmedCount", {
              count: bookings.filter((b) => b.status === "confirmed").length,
            })}
          </TabsTrigger>
          <TabsTrigger value="cancelled">
            {t("bookingLinks.cancelledCount", {
              count: bookings.filter((b) => b.status === "cancelled").length,
            })}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12">
          <p className="text-sm text-muted-foreground">
            {t("bookingLinks.noBookingsFound")}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("bookingLinks.name")}</TableHead>
                <TableHead>{t("bookingLinks.email")}</TableHead>
                <TableHead>{t("eventForm.event")}</TableHead>
                <TableHead>{t("bookingLinks.dateAndTime")}</TableHead>
                <TableHead>{t("bookingLinks.details")}</TableHead>
                <TableHead>{t("bookingLinks.status")}</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((booking) => (
                <TableRow key={booking.id}>
                  <TableCell className="font-medium">{booking.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {booking.email}
                  </TableCell>
                  <TableCell>{booking.eventTitle}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <div>{format(parseISO(booking.start), "MMM d, yyyy")}</div>
                    <div className="text-xs">
                      {format(parseISO(booking.start), "h:mm a")} -{" "}
                      {format(parseISO(booking.end), "h:mm a")}
                    </div>
                  </TableCell>
                  <TableCell>
                    <BookingDetails
                      booking={booking}
                      customFields={fieldsBySlug[booking.slug]}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        booking.status === "confirmed" ? "default" : "secondary"
                      }
                    >
                      {booking.status === "confirmed"
                        ? t("bookingLinks.confirmed")
                        : t("bookingLinks.cancelled")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {booking.status === "confirmed" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCancel(booking)}
                            disabled={deleteBooking.isPending}
                          >
                            <IconCircleX className="h-4 w-4 text-destructive" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("bookingLinks.cancelBooking")}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function BookingDetails({
  booking,
  customFields,
}: {
  booking: Booking;
  customFields?: CustomField[];
}) {
  const t = useT();
  const responses = booking.fieldResponses;
  const hasResponses = responses && Object.keys(responses).length > 0;
  const hasNotes = !!booking.notes;

  if (!hasNotes && !hasResponses) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  const lines: { label: string; value: string }[] = [];
  if (hasNotes) {
    lines.push({ label: t("bookingLinks.notes"), value: booking.notes! });
  }
  if (hasResponses && customFields) {
    for (const field of customFields) {
      const val = responses[field.id];
      if (val !== undefined && val !== "" && val !== false) {
        lines.push({
          label: field.label,
          value: typeof val === "boolean" ? t("bookingLinks.yes") : String(val),
        });
      }
    }
  }

  if (lines.length === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 py-0 text-xs text-muted-foreground underline decoration-dotted"
        >
          {t("bookingLinks.detailCount", { count: lines.length })}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("bookingLinks.bookingDetails")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto pr-1 text-sm">
          {lines.map((line) => (
            <div key={line.label} className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                {line.label}
              </div>
              <div className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-foreground">
                {line.value}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
