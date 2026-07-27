import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getBookingByUid } from "../server/bookings-repo.js";
import { assertBookingHost } from "./_helpers.js";

export default defineAction({
  description: "Get a booking by uid",
  schema: z.object({ uid: z.string() }),
  run: async (args) => {
    const booking = await getBookingByUid(args.uid);
    if (!booking) return { booking: null };
    assertBookingHost(booking, "view this booking");
    return { booking };
  },
});
