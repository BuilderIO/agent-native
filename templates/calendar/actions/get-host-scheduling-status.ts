import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getHostSchedulingStatus } from "../server/lib/booking-host-availability.js";

export default defineAction({
  description:
    "For a booking link's required hosts, report whether each host's working hours will actually be enforced: 'active' (two-way calendar overlay plus a saved availability schedule and resolvable time zone), 'awaiting-reciprocal-overlay' (the owner added the host but the host hasn't added the owner back), 'missing-schedule' (overlay is reciprocal but the host never saved working hours), 'missing-timezone' (overlay is reciprocal and a schedule is saved, but no time zone could be resolved), or 'not-overlaid' (host isn't in the owner's calendar overlay at all, so only free/busy is checked). Pass bookingLinkId when checking an existing link's hosts so status is evaluated against that link's actual owner rather than the caller — required for a shared editor to see the same statuses the owner would.",
  schema: z.object({
    hostEmails: z.array(z.string().email()).max(50),
    bookingLinkId: z
      .string()
      .optional()
      .describe(
        "Existing booking link id. When set, status is evaluated against that link's owner instead of the caller.",
      ),
  }),
  http: { method: "GET" },
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

    return getHostSchedulingStatus(ownerEmail, args.hostEmails);
  },
});
