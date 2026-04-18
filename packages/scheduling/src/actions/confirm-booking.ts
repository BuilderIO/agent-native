import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  updateBookingStatus,
  getBookingByUid,
} from "../server/bookings-repo.js";

export default defineAction({
  description: "Confirm a pending booking (requires-confirmation flow)",
  schema: z.object({ uid: z.string() }),
  run: async (args) => {
    await updateBookingStatus(args.uid, "confirmed");
    return { booking: await getBookingByUid(args.uid) };
  },
});
