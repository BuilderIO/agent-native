import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getDeckUrl } from "./_app-url.js";

function slidesDeepLink(): string {
  return buildDeepLink({ app: "slides", view: "list" });
}

export default defineAction({
  description: "List all decks from the database with metadata.",
  schema: z.object({
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe("Set to 'true' for compact output"),
    includeSlides: z
      .enum(["true", "false"])
      .optional()
      .describe("Set to 'true' for full frontend deck payloads"),
    createdBy: z
      .enum(["all", "me"])
      .optional()
      .describe("Set to 'me' to list only decks created by the current user"),
  }),
  http: { method: "GET" },
  link: () => ({
    url: slidesDeepLink(),
    label: "Open decks in Slides",
    view: "list",
  }),
  run: async (args, ctx) => {
    const db = getDb();
    const ownerEmail = getRequestUserEmail();
    if (
      args.includeSlides === "true" &&
      ctx?.caller === "frontend" &&
      !ownerEmail
    ) {
      const err = new Error("Unauthorized") as Error & { statusCode?: number };
      err.statusCode = 401;
      throw err;
    }

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
      if (args.includeSlides === "true") {
        return {
          ...data,
          id: row.id,
          title: row.title,
          visibility: row.visibility,
          createdByMe: ownerEmail ? row.ownerEmail === ownerEmail : false,
          designSystemId: row.designSystemId ?? data.designSystemId ?? null,
          createdAt:
            typeof data.createdAt === "string" ? data.createdAt : row.createdAt,
          updatedAt: row.updatedAt,
          slides: Array.isArray(slides) ? slides : [],
        };
      }

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
