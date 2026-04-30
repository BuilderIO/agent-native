import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { cancelBooking } from "../server/booking-service.js";
import { getBookingByUid } from "../server/bookings-repo.js";
import { currentUserEmailOrNull } from "./_helpers.js";

export default defineAction({
  description: "Cancel a booking",
  schema: z.object({
    uid: z.string(),
    reason: z.string().optional(),
    cancelledBy: z.enum(["attendee", "host"]).optional(),
    token: z.string().optional(),
  }),
  run: async (args) => ({
    booking: await cancelBookingAfterAccessCheck(args),
  }),
});

async function cancelBookingAfterAccessCheck(args: {
  uid: string;
  reason?: string;
  cancelledBy?: "attendee" | "host";
  token?: string;
}) {
  const booking = await getBookingByUid(args.uid);
  if (!booking) throw new Error(`Booking ${args.uid} not found`);
  const userEmail = currentUserEmailOrNull();
  const isHost = !!userEmail && userEmail === booking.hostEmail;
  const hasToken = !!args.token && args.token === booking.cancelToken;
  if (!isHost && !hasToken) {
    throw new Error("Not authorized to cancel this booking");
  }
  return cancelBooking({
    uid: args.uid,
    reason: args.reason,
    cancelledBy: args.cancelledBy,
  });
}
