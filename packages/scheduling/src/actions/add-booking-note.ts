import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getBookingByUid } from "../server/bookings-repo.js";
import { getSchedulingContext } from "../server/context.js";
import { assertBookingHost, currentUserEmail } from "./_helpers.js";

export default defineAction({
  description: "Add an internal (host-only) note to a booking",
  schema: z.object({ uid: z.string(), content: z.string() }),
  run: async (args) => {
    const booking = await getBookingByUid(args.uid);
    if (!booking) throw new Error(`Booking ${args.uid} not found`);
    assertBookingHost(booking, "add a note to this booking");
    const { getDb, schema } = getSchedulingContext();
    const id = nanoid();
    await getDb().insert(schema.bookingNotes).values({
      id,
      bookingId: booking.id,
      authorEmail: currentUserEmail(),
      content: args.content,
      createdAt: new Date().toISOString(),
    });
    return { id };
  },
});
