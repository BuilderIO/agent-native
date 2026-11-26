import { isOutsideAgentCall } from "@agent-native/core";
import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { ensureBookingUsername } from "../server/handlers/booking-usernames.js";
import {
  buildSingleUseLinkUrl,
  revokeSingleUseLink,
  singleUseLinkOutputSchema,
} from "../server/lib/single-use-links.js";

export default defineAction({
  mcpTool: "search",
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  needsApproval: (_args, ctx) => isOutsideAgentCall(ctx),
  searchHints: ["revoke single-use link", "turn off one-time link"],
  description:
    "Turn off a single-use URL that hasn't been used yet, so nobody can book through it. A used URL can't be turned off.",
  schema: z.object({
    bookingLinkId: z
      .string()
      .min(1)
      .describe("Booking link id, from list-booking-links"),
    token: z
      .string()
      .min(1)
      .describe("The single-use link's token, from list-single-use-links"),
  }),
  outputSchema: singleUseLinkOutputSchema,
  run: async ({ bookingLinkId, token }) => {
    await assertAccess("booking-link", bookingLinkId, "editor");
    const rows = await getDb()
      .select({
        id: schema.bookingLinks.id,
        slug: schema.bookingLinks.slug,
        ownerEmail: schema.bookingLinks.ownerEmail,
      })
      .from(schema.bookingLinks)
      .where(eq(schema.bookingLinks.id, bookingLinkId));
    const link = rows.find((row) => row.id === bookingLinkId);
    if (!link) {
      fail("Booking link not found", {
        errorCode: "booking_link_not_found",
        statusCode: 404,
      });
    }

    const username = await ensureBookingUsername(link.ownerEmail);
    const revoked = await revokeSingleUseLink(bookingLinkId, token);
    if (!revoked) {
      fail("This booking link has no single-use link with that token", {
        errorCode: "single_use_link_not_found",
        statusCode: 404,
      });
    }
    if (revoked.status === "used") {
      fail(
        "That single-use link already made its booking, so there's nothing to turn off. Cancel the booking instead.",
        { errorCode: "single_use_link_used", statusCode: 409 },
      );
    }
    if (revoked.status === "available") {
      fail(
        "That single-use link was freed by a booking that didn't go through while it was being turned off. Try again.",
        { errorCode: "single_use_link_changed", statusCode: 409 },
      );
    }

    return {
      ...revoked,
      url: buildSingleUseLinkUrl({
        username,
        slug: link.slug,
        token: revoked.token,
      }),
    };
  },
});
