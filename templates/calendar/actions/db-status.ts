import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Check database connection status",
  schema: z.object({}),
  http: false,
  run: async () => {
    const url = process.env.DATABASE_URL || "file:./data/app.db";
    const isLocal = url.startsWith("file:");

    try {
      const db = getDb();
      await db
        .select({ id: schema.bookingLinks.id })
        .from(schema.bookingLinks)
        .limit(1);

      return {
        status: "connected",
        mode: isLocal ? "local" : "remote",
        url: isLocal ? url : url.replace(/\/\/.*@/, "//***@"),
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
        mode: isLocal ? "local" : "remote",
        error: err.message,
      };
    }
  },
});
