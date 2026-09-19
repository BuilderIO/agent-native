import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { deleteBookingLinkById } from "../server/handlers/booking-links.js";

export default defineAction({
  description:
    "Delete a booking link and its stale slug redirects. Requires owner or admin access.",
  schema: z.object({ id: z.string().min(1).describe("Booking link id") }),
  toolCallable: false,
  run: async ({ id }) => deleteBookingLinkById(id),
});
