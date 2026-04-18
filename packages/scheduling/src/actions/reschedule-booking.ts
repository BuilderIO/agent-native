import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { rescheduleBooking } from "../server/booking-service.js";

export default defineAction({
  description: "Reschedule a booking to a new start/end time",
  schema: z.object({
    uid: z.string(),
    newStartTime: z.string(),
    newEndTime: z.string(),
    reason: z.string().optional(),
    rescheduledBy: z.enum(["attendee", "host"]).optional(),
  }),
  run: async (args) => ({
    booking: await rescheduleBooking({
      uid: args.uid,
      newStartTime: args.newStartTime,
      newEndTime: args.newEndTime,
      reason: args.reason,
      rescheduledBy: args.rescheduledBy,
    }),
  }),
});
