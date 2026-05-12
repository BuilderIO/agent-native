import { defineAction } from "@agent-native/core";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";
import { z } from "zod";
import { getDeckUrl } from "./_app-url.js";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

export default defineAction({
  description: "List all decks from the database with metadata.",
  schema: z.object({
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe("Set to 'true' for compact output"),
    createdBy: z
      .enum(["all", "me"])
      .optional()
      .describe("Set to 'me' to list only decks created by the current user"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getRequestUserEmail();
    if (args.createdBy === "me" && !ownerEmail) {
      return { count: 0, decks: [] };
    }

    const visibleDecks = accessFilter(schema.decks, schema.deckShares);
    const where =
      args.createdBy === "me" && ownerEmail
        ? and(visibleDecks, eq(schema.decks.ownerEmail, ownerEmail))
        : visibleDecks;
    const rows = await db
      .select()
      .from(schema.decks)
      .where(where)
      .orderBy(desc(schema.decks.updatedAt));

    if (rows.length === 0) {
      return { count: 0, decks: [] };
    }

    const items = rows.map((row) => {
      const data = JSON.parse(row.data);
      const slides = data?.slides;
      if (args.compact === "true") {
        return {
          id: row.id,
          title: row.title,
          url: getDeckUrl(row.id),
          slideCount: slides?.length ?? 0,
          visibility: row.visibility,
          designSystemId: row.designSystemId ?? null,
        };
      }
      return {
        id: row.id,
        title: row.title,
        url: getDeckUrl(row.id),
        slideCount: slides?.length ?? 0,
        visibility: row.visibility,
        designSystemId: row.designSystemId ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return { count: items.length, decks: items };
  },
});
