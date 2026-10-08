import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  BookingLifecycleError,
  rescheduleBooking,
} from "../server/booking-service.js";
import { getBookingByUid } from "../server/bookings-repo.js";
import { currentUserEmailOrNull } from "./_helpers.js";

export default defineAction({
  description:
    "Reschedule a booking, deleting its existing video meeting after the replacement is ready. If a Zoom booking has no recorded meeting, the host must review and resolve it first.",
  schema: z.object({
    uid: z.string().describe("Booking uid"),
    newStartTime: z.string().describe("New start time in ISO 8601 format"),
    newEndTime: z.string().describe("New end time in ISO 8601 format"),
    reason: z.string().optional().describe("Reason for rescheduling"),
    rescheduledBy: z
      .enum(["attendee", "host"])
      .optional()
      .describe('Who requested the reschedule: "attendee" or "host"'),
    zoomMeetingResolved: z
      .boolean()
      .optional()
      .describe("Host confirms the Zoom meeting was checked and resolved"),
    token: z.string().optional().describe("Booking reschedule token"),
  }),
  run: async (args) => {
    try {
      return { booking: await rescheduleBookingAfterAccessCheck(args) };
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

async function rescheduleBookingAfterAccessCheck(args: {
  uid: string;
  newStartTime: string;
  newEndTime: string;
  reason?: string;
  rescheduledBy?: "attendee" | "host";
  zoomMeetingResolved?: boolean;
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
    zoomMeetingResolved: isHost && args.zoomMeetingResolved,
  });
}
