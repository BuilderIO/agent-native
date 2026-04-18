import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getBookingByUid } from "../server/bookings-repo.js";

export default defineAction({
  description: "Get a booking by uid",
  schema: z.object({ uid: z.string() }),
  run: async (args) => ({ booking: await getBookingByUid(args.uid) }),
});
