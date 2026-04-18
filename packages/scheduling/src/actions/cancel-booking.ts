import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { cancelBooking } from "../server/booking-service.js";

export default defineAction({
  description: "Cancel a booking",
  schema: z.object({
    uid: z.string(),
    reason: z.string().optional(),
    cancelledBy: z.enum(["attendee", "host"]).optional(),
  }),
  run: async (args) => ({
    booking: await cancelBooking({
      uid: args.uid!,
      reason: args.reason,
      cancelledBy: args.cancelledBy,
    }),
  }),
});
