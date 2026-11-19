import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";

import { getBookingByUid } from "../server/bookings-repo.js";
import { getSchedulingContext } from "../server/context.js";
import type { SchedulingSchema } from "../server/db-types.js";
import { assertBookingHost } from "./_helpers.js";

export default defineAction({
  description: "Remove an attendee from a booking",
  schema: z.object({ uid: z.string(), email: z.string() }),
  run: async (args) => {
    const booking = await getBookingByUid(args.uid);
    if (!booking) {
      fail(`Booking ${args.uid} not found`, {
        errorCode: "not_found",
        statusCode: 404,
      });
    }
    assertBookingHost(booking, "remove an attendee from this booking");
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
        "remove an attendee from this booking",
      );
      await tx
        .delete(schema.bookingAttendees)
        .where(
          and(
            eq(schema.bookingAttendees.bookingId, booking.id),
            eq(schema.bookingAttendees.email, args.email),
          ),
        );
    });
    return { booking: await getBookingByUid(args.uid) };
  },
});
