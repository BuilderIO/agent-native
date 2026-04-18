import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getBookingByUid } from "../server/bookings-repo.js";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description: "Remove an attendee from a booking",
  schema: z.object({ uid: z.string(), email: z.string() }),
  run: async (args) => {
    const booking = await getBookingByUid(args.uid);
    if (!booking) throw new Error(`Booking ${args.uid} not found`);
    const { getDb, schema } = getSchedulingContext();
    await getDb()
      .delete(schema.bookingAttendees)
      .where(
        and(
          eq(schema.bookingAttendees.bookingId, booking.id),
          eq(schema.bookingAttendees.email, args.email),
        ),
      );
    return { booking: await getBookingByUid(args.uid) };
  },
});
