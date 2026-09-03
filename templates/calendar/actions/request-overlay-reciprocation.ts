import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requestOverlayReciprocation } from "../server/lib/overlay-nudge.js";

export default defineAction({
  description:
    "Emails a person the owner has added to their calendar overlay, asking them to reciprocally add the owner back so their real working hours can be used on booking links. Limited to one request per peer every 24 hours, and at most 20 requests total per owner per 24 hours. Returns { sent: false, reason } instead of throwing when nothing was sent: 'not-overlaid' (peer isn't in the owner's overlay list), 'already-reciprocal' (peer already added the owner back), 'email-not-configured', 'cooldown' (this peer was asked recently), or 'rate-limited' (the owner-wide daily limit was reached). Pass bookingLinkId when nudging on behalf of an existing link so the request is sent as that link's actual owner rather than the caller — required for a shared editor.",
  schema: z.object({
    peerEmail: z.string().email(),
    bookingLinkId: z
      .string()
      .optional()
      .describe(
        "Existing booking link id. When set, the nudge is sent as that link's owner instead of the caller.",
      ),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const callerEmail = getRequestUserEmail();
    if (!callerEmail) throw new Error("no authenticated user");

    let ownerEmail = callerEmail;
    if (args.bookingLinkId) {
      await assertAccess("booking-link", args.bookingLinkId, "viewer");
      const [link] = await getDb()
        .select({ ownerEmail: schema.bookingLinks.ownerEmail })
        .from(schema.bookingLinks)
        .where(eq(schema.bookingLinks.id, args.bookingLinkId));
      if (!link) throw new Error("Booking link not found");
      ownerEmail = link.ownerEmail;
    }

    return requestOverlayReciprocation({
      ownerEmail,
      peerEmail: args.peerEmail,
    });
  },
});
