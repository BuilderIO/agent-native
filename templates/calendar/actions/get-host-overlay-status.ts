import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getHostOverlayStatuses } from "../server/lib/booking-host-availability.js";
import {
  getBookingLinkCoHostEmails,
  normalizeBookingHostEmail,
} from "../server/lib/booking-link-utils.js";
import {
  normalizeOverlayRequestState,
  OVERLAY_REQUESTS_SETTING_KEY,
  parseOverlayRequestEntry,
} from "../server/lib/overlay-request-reservation.js";
import type { HostOverlayStatusResult } from "../shared/api.js";

export default defineAction({
  description:
    "Check whether each booking-link host's real working hours are being used for that link, or only their free/busy. Reports, per host, whether they have added the link owner back to their own calendar and whether they have saved a working-hours schedule.",
  schema: z.object({
    emails: z
      .array(z.string())
      .max(50)
      .describe("Host emails to check, from the link's own host list."),
    bookingLinkId: z
      .string()
      .optional()
      .describe(
        "The booking link being edited. Omit only for a brand-new, unsaved draft that has no id yet.",
      ),
  }),
  http: { method: "GET" },
  run: async (args): Promise<HostOverlayStatusResult[]> => {
    const callerEmail = getRequestUserEmail();
    if (!callerEmail) throw new Error("no authenticated user");

    let ownerEmail = callerEmail;
    let linkHostEmails: string[] | null = null;

    if (args.bookingLinkId) {
      await assertAccess("booking-link", args.bookingLinkId, "editor");

      const [row] = await getDb()
        .select({
          ownerEmail: schema.bookingLinks.ownerEmail,
          hosts: schema.bookingLinks.hosts,
        })
        .from(schema.bookingLinks)
        .where(eq(schema.bookingLinks.id, args.bookingLinkId));
      if (!row) throw new Error("Booking link not found");

      ownerEmail = row.ownerEmail;
      if (row.ownerEmail.toLowerCase() !== callerEmail.toLowerCase()) {
        linkHostEmails = getBookingLinkCoHostEmails(row);
      }
    }

    const requested = Array.from(
      new Set(
        args.emails
          .map((email) => normalizeBookingHostEmail(email))
          .filter((email): email is string => Boolean(email)),
      ),
    );
    const scoped = linkHostEmails
      ? requested.filter((email) => linkHostEmails.includes(email))
      : requested;

    const statuses = await getHostOverlayStatuses(ownerEmail, scoped);
    const requests = normalizeOverlayRequestState(
      await getUserSetting(ownerEmail, OVERLAY_REQUESTS_SETTING_KEY),
    ).perPeer;

    return statuses.map(
      ({ isOverlaidByOwner: _isOverlaidByOwner, ...rest }) => {
        const stored = requests[rest.email];
        const parsed = stored ? parseOverlayRequestEntry(stored) : null;
        return {
          ...rest,
          requestSentAt:
            parsed && !parsed.pending && parsed.sentAt !== null
              ? stored
              : undefined,
        };
      },
    );
  },
});
