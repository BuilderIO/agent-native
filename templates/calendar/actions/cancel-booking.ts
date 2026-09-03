import { defineAction } from "@agent-native/core/action";
import { getAppProductionUrl } from "@agent-native/core/server";
import { z } from "zod";

import { cancelBookingById } from "../server/handlers/bookings.js";
import { requireActionUserEmail } from "./event-action-helpers.js";

export default defineAction({
  description:
    "Cancel a booking and its linked calendar event. Use this instead of delete-event or delete-events for booking-backed events so the booking cannot be republished as confirmed.",
  schema: z.object({ id: z.string().min(1).describe("Booking id") }),
  toolCallable: false,
  run: async ({ id }) => {
    requireActionUserEmail();
    return cancelBookingById(id, getAppProductionUrl());
  },
});
