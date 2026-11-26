import { isOutsideAgentCall } from "@agent-native/core";
import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { ensureBookingUsername } from "../server/handlers/booking-usernames.js";
import {
  buildSingleUseLinkUrl,
  createSingleUseLink,
  singleUseLinkOutputSchema,
} from "../server/lib/single-use-links.js";

export default defineAction({
  mcpTool: "search",
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  needsApproval: (_args, ctx) => isOutsideAgentCall(ctx),
  searchHints: [
    "single-use link",
    "one-time booking link",
    "one-off scheduling link",
    "link that works once",
  ],
  description:
    "Make a single-use URL for an active booking link: it takes exactly one booking, then stops working for good. Give the returned url to one person.",
  schema: z.object({
    bookingLinkId: z
      .string()
      .min(1)
      .describe("Booking link id, from list-booking-links"),
  }),
  outputSchema: singleUseLinkOutputSchema,
  run: async ({ bookingLinkId }) => {
    const createdBy = getRequestUserEmail();
    if (!createdBy) {
      fail("You must be signed in to make a single-use link.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    await assertAccess("booking-link", bookingLinkId, "editor");
    const rows = await getDb()
      .select()
      .from(schema.bookingLinks)
      .where(eq(schema.bookingLinks.id, bookingLinkId));
    const link = rows.find((row) => row.id === bookingLinkId);
    if (!link) {
      fail("Booking link not found", {
        errorCode: "booking_link_not_found",
        statusCode: 404,
      });
    }
    if (!link.isActive) {
      fail("Turn the booking link on before making a single-use link for it", {
        errorCode: "booking_link_inactive",
        statusCode: 409,
      });
    }

    const username = await ensureBookingUsername(link.ownerEmail);
    const created = await createSingleUseLink({ bookingLinkId, createdBy });
    return {
      ...created,
      url: buildSingleUseLinkUrl({
        username,
        slug: link.slug,
        token: created.token,
      }),
    };
  },
});
