import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { markNoShow } from "../server/booking-service.js";
import { getBookingByUid } from "../server/bookings-repo.js";
import { assertBookingHost } from "./_helpers.js";

export default defineAction({
  description: "Mark an attendee as no-show on a booking",
  schema: z.object({
    uid: z.string(),
    attendeeEmail: z.string(),
  }),
  run: async (args) => {
    const booking = await getBookingByUid(args.uid);
    if (!booking) throw new Error(`Booking ${args.uid} not found`);
    assertBookingHost(booking, "mark no-show on this booking");
    await markNoShow(args.uid, args.attendeeEmail);
    return { ok: true };
  },
});
