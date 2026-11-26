import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { ensureBookingUsername } from "../server/handlers/booking-usernames.js";
import {
  buildSingleUseLinkUrl,
  listSingleUseLinks,
  singleUseLinkOutputSchema,
} from "../server/lib/single-use-links.js";

export default defineAction({
  mcpTool: "search",
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  searchHints: ["single-use links", "one-time booking links", "was it used"],
  description:
    "List a booking link's single-use URLs, newest first, with whether each is still available, used (and by which booking) or revoked.",
  schema: z.object({
    bookingLinkId: z
      .string()
      .min(1)
      .describe("Booking link id, from list-booking-links"),
  }),
  outputSchema: z.object({ links: z.array(singleUseLinkOutputSchema) }),
  http: { method: "GET" },
  run: async ({ bookingLinkId }) => {
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

    const [tokens, username] = await Promise.all([
      listSingleUseLinks(bookingLinkId),
      ensureBookingUsername(link.ownerEmail),
    ]);
    return {
      links: tokens.map((token) => ({
        ...token,
        url: buildSingleUseLinkUrl({
          username,
          slug: link.slug,
          token: token.token,
        }),
      })),
    };
  },
});
