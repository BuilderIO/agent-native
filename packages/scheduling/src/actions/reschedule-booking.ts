import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { rescheduleBooking } from "../server/booking-service.js";
import { getBookingByUid } from "../server/bookings-repo.js";
import { currentUserEmailOrNull } from "./_helpers.js";

export default defineAction({
  description: "Reschedule a booking to a new start/end time",
  schema: z.object({
    uid: z.string(),
    newStartTime: z.string(),
    newEndTime: z.string(),
    reason: z.string().optional(),
    rescheduledBy: z.enum(["attendee", "host"]).optional(),
    token: z.string().optional(),
  }),
  run: async (args) => ({
    booking: await rescheduleBookingAfterAccessCheck(args),
  }),
});

async function rescheduleBookingAfterAccessCheck(args: {
  uid: string;
  newStartTime: string;
  newEndTime: string;
  reason?: string;
  rescheduledBy?: "attendee" | "host";
  token?: string;
}) {
  const booking = await getBookingByUid(args.uid);
  if (!booking) throw new Error(`Booking ${args.uid} not found`);
  const userEmail = currentUserEmailOrNull();
  const isHost = !!userEmail && userEmail === booking.hostEmail;
  const hasToken = !!args.token && args.token === booking.rescheduleToken;
  if (!isHost && !hasToken) {
    throw new Error("Not authorized to reschedule this booking");
  }
  return rescheduleBooking({
    uid: args.uid,
    newStartTime: args.newStartTime,
    newEndTime: args.newEndTime,
    reason: args.reason,
    rescheduledBy: args.rescheduledBy,
  });
}
