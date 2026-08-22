import { defineAction } from "@agent-native/core";
import {
  accessFilter,
  resolveAccess,
  type ShareRole,
} from "@agent-native/core/sharing";
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
    const accessById = new Map<string, "owner" | ShareRole>();
    await Promise.all(
      rows.map(async (row) => {
        const access = await resolveAccess("booking-link", row.id);
        if (access) accessById.set(row.id, access.role);
      }),
    );

    return rows.map((row) => ({
      ...rowToBookingLink(row),
      accessRole: accessById.get(row.id) ?? "viewer",
    }));
  },
});
