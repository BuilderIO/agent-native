import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { getOverlayReciprocity } from "../server/lib/booking-host-availability.js";
import type { OverlayReciprocity } from "../server/lib/booking-host-availability.js";
import { normalizeBookingHostEmail } from "../server/lib/booking-link-utils.js";

export default defineAction({
  description:
    "Check which of the caller's overlaid peers have added the caller back to their own calendar. A two-way relationship is what lets a peer's real working hours apply to the caller's booking links. Reports reciprocity only — use get-host-overlay-status when you also need to know whether the peer saved a working-hours schedule.",
  schema: z.object({
    emails: z
      .array(z.string())
      .max(50)
      .describe("Peer emails to check, from the caller's own overlay list."),
  }),
  http: { method: "GET" },
  run: async (args): Promise<OverlayReciprocity[]> => {
    const callerEmail = getRequestUserEmail();
    if (!callerEmail) throw new Error("no authenticated user");

    const requested = Array.from(
      new Set(
        args.emails
          .map((email) => normalizeBookingHostEmail(email))
          .filter((email): email is string => Boolean(email)),
      ),
    );
    return getOverlayReciprocity(callerEmail, requested);
  },
});
