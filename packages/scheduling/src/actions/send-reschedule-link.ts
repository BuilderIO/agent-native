import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getBookingByUid } from "../server/bookings-repo.js";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description:
    "Return the public reschedule URL for a booking (send it to an attendee)",
  schema: z.object({ uid: z.string() }),
  run: async (args) => {
    const booking = await getBookingByUid(args.uid);
    if (!booking) throw new Error(`Booking ${args.uid} not found`);
    const baseUrl = getSchedulingContext().publicBaseUrl ?? "";
    return {
      url: `${baseUrl}/reschedule/${booking.uid}?token=${booking.rescheduleToken}`,
    };
  },
});
