import { defineAction, fail } from "@agent-native/core/action";
import { eq, max } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getBookingByUid } from "../server/bookings-repo.js";
import { getSchedulingContext } from "../server/context.js";
import type { SchedulingSchema } from "../server/db-types.js";
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
    if (!booking) {
      fail(`Booking ${args.uid} not found`, {
        errorCode: "not_found",
        statusCode: 404,
      });
    }
    assertBookingHost(booking, "add an attendee to this booking");
    const { getDb, schema } = getSchedulingContext();
    const db: PgDatabase<PgQueryResultHKT, SchedulingSchema> = getDb();
    await db.transaction(async (tx) => {
      // guard:allow-unscoped — locks the booking whose host was asserted above; the host is re-checked under the lock
      const locked = await tx
        .select({
          id: schema.bookings.id,
          hostEmail: schema.bookings.hostEmail,
        })
        .from(schema.bookings)
        .where(eq(schema.bookings.id, booking.id))
        .for("update");
      const lockedBooking = locked.at(0);
      if (!lockedBooking) {
        fail(`Booking ${args.uid} not found`, {
          errorCode: "not_found",
          statusCode: 404,
        });
      }
      assertBookingHost(
        { ...booking, hostEmail: lockedBooking.hostEmail },
        "add an attendee to this booking",
      );
      const maxResult = await tx
        .select({ position: max(schema.bookingAttendees.position) })
        .from(schema.bookingAttendees)
        .where(eq(schema.bookingAttendees.bookingId, booking.id));
      const position = Math.max(-1, Number(maxResult[0]?.position ?? -1)) + 1;
      await tx.insert(schema.bookingAttendees).values({
        id: nanoid(),
        bookingId: booking.id,
        email: args.email,
        name: args.name,
        timezone: args.timezone ?? null,
        noShow: false,
        createdAt: new Date().toISOString(),
        position,
      });
    });
    return { booking: await getBookingByUid(args.uid) };
  },
});
