import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  BookingLifecycleError,
  cancelBooking,
} from "../server/booking-service.js";
import { getBookingByUid } from "../server/bookings-repo.js";
import { currentUserEmailOrNull } from "./_helpers.js";

export default defineAction({
  description:
    "Cancel a booking and its linked video meetings. If a Zoom booking has no recorded meeting, the host must review and resolve it first.",
  schema: z.object({
    uid: z.string().describe("Booking uid"),
    reason: z.string().optional().describe("Reason for canceling the booking"),
    cancelledBy: z
      .enum(["attendee", "host"])
      .optional()
      .describe('Who canceled the booking: "attendee" or "host"'),
    zoomMeetingResolved: z
      .boolean()
      .optional()
      .describe("Host confirms the Zoom meeting was checked and resolved"),
    token: z.string().optional().describe("Booking cancellation token"),
  }),
  run: async (args) => {
    try {
      return { booking: await cancelBookingAfterAccessCheck(args) };
    } catch (error) {
      if (error instanceof BookingLifecycleError) {
        fail(error.message, {
          statusCode: error.statusCode,
          errorCode: error.errorCode,
        });
      }
      throw error;
    }
  },
});

async function cancelBookingAfterAccessCheck(args: {
  uid: string;
  reason?: string;
  cancelledBy?: "attendee" | "host";
  zoomMeetingResolved?: boolean;
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
    zoomMeetingResolved: isHost && args.zoomMeetingResolved,
  });
}
