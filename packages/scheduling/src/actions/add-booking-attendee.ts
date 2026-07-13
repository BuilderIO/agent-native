import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getBookingByUid } from "../server/bookings-repo.js";
import { getSchedulingContext } from "../server/context.js";
import { assertBookingHost } from "./_helpers.js";

export default defineAction({
  description: "Add an attendee (or seat reservation) to a booking",
  schema: z.object({
    uid: z.string(),
    name: z.string(),
    email: z.string(),
    timezone: z.string().optional(),
  }),
  run: async (args) => {
    const booking = await getBookingByUid(args.uid);
    if (!booking) throw new Error(`Booking ${args.uid} not found`);
    assertBookingHost(booking, "add an attendee to this booking");
    const { getDb, schema } = getSchedulingContext();
    await getDb()
      .insert(schema.bookingAttendees)
      .values({
        id: nanoid(),
        bookingId: booking.id,
        email: args.email,
        name: args.name,
        timezone: args.timezone ?? null,
        noShow: false,
        createdAt: new Date().toISOString(),
      });
    return { booking: await getBookingByUid(args.uid) };
  },
});
