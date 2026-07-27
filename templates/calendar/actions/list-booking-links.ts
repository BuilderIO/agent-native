import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { rowToBookingLink } from "../server/lib/booking-link-utils.js";

export default defineAction({
  description: "List all booking links",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const rows = await getDb()
      .select()
      .from(schema.bookingLinks)
      .where(accessFilter(schema.bookingLinks, schema.bookingLinkShares))
      .orderBy(desc(schema.bookingLinks.updatedAt));
    return rows.map(rowToBookingLink);
  },
});
