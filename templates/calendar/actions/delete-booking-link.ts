import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { deleteBookingLinkById } from "../server/handlers/booking-links.js";

export default defineAction({
  description:
    "Delete a booking link and its stale slug redirects. Requires owner or admin access.",
  schema: z.object({ id: z.string().min(1).describe("Booking link id") }),
  toolCallable: false,
  run: async ({ id }) => {
    const result = await deleteBookingLinkById(id);
    return {
      ok: result.ok,
      change: {
        verb: "deleted",
        kind: "booking-link",
        title: result.title?.trim().slice(0, 180) || "Booking link",
        ...(typeof result.duration === "number"
          ? { detail: String(result.duration) }
          : {}),
        url: buildDeepLink({ app: "calendar", view: "booking-links" }),
      },
    };
  },
});
