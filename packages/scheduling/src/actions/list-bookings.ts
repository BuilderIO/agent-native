import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listBookings } from "../server/bookings-repo.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description:
    "List bookings the current user owns, hosts, has been shared on, or that match the active org's visibility — filtered by status / range",
  schema: z.object({
    status: z
      .enum(["upcoming", "past", "unconfirmed", "cancelled", "confirmed"])
      .optional(),
    eventTypeId: z.string().optional(),
    attendeeEmail: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.number().optional(),
    /**
     * If true, narrow to bookings where you are the host. Defaults to false
     * so org-shared bookings + bookings shared with you appear too.
     */
    onlyMine: z.boolean().optional().default(false),
  }),
  run: async (args) => {
    const email = currentUserEmail();
    const { onlyMine, ...rest } = args;
    return {
      bookings: await listBookings({
        ...rest,
        useAccessFilter: true,
        hostEmail: onlyMine ? email : undefined,
      }),
    };
  },
});
