import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Check database connection status",
  schema: z.object({}),
  http: false,
  run: async () => {
    try {
      const db = getDb();
      await db
        .select({ id: schema.bookingLinks.id })
        .from(schema.bookingLinks)
        .limit(1);

      return {
        status: "connected",
        mode: "postgres",
        tables: [
          "bookings",
          "booking_links",
          "booking_slug_redirects",
          "booking_usernames",
          "booking_username_changes",
          "booking_link_shares",
        ],
      };
    } catch (err: any) {
      return {
        status: "disconnected",
        mode: "postgres",
        error: err.message,
      };
    }
  },
});
