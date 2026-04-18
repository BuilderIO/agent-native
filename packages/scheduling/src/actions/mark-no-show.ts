import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { markNoShow } from "../server/booking-service.js";

export default defineAction({
  description: "Mark an attendee as no-show on a booking",
  schema: z.object({
    uid: z.string(),
    attendeeEmail: z.string(),
  }),
  run: async (args) => {
    await markNoShow(args.uid, args.attendeeEmail);
    return { ok: true };
  },
});
