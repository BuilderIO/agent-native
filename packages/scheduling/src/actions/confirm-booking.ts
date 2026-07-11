import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  updateBookingStatus,
  getBookingByUid,
} from "../server/bookings-repo.js";
import { assertBookingHost } from "./_helpers.js";

export default defineAction({
  description: "Confirm a pending booking (requires-confirmation flow)",
  schema: z.object({ uid: z.string() }),
  run: async (args) => {
    const booking = await getBookingByUid(args.uid);
    if (!booking) throw new Error(`Booking ${args.uid} not found`);
    assertBookingHost(booking, "confirm this booking");
    await updateBookingStatus(args.uid, "confirmed");
    return { booking: await getBookingByUid(args.uid) };
  },
});
