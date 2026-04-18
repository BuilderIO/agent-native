import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listBookings } from "../server/bookings-repo.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description: "List bookings for the current user, filtered by status / range",
  schema: z.object({
    status: z
      .enum(["upcoming", "past", "unconfirmed", "cancelled", "confirmed"])
      .optional(),
    eventTypeId: z.string().optional(),
    attendeeEmail: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.number().optional(),
  }),
  run: async (args) => ({
    bookings: await listBookings({
      hostEmail: currentUserEmail(),
      ...args,
    }),
  }),
});
