import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { normalizeOwnerEmail } from "../shared/ownership.js";
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
      .describe(
        "Set to 'true' for full frontend deck payloads; omitted returns metadata only",
      ),
    light: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "Set to 'true' for a minimal id/title/updatedAt/visibility listing " +
          "used for cheap add/remove diffing (e.g. background polling). " +
          "Never reads the deck body — no slides, no slideCount.",
      ),
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
    const normalizedOwnerEmail = normalizeOwnerEmail(ownerEmail);
    if (
      args.includeSlides === "true" &&
      ctx?.caller === "frontend" &&
      normalizedOwnerEmail === null
    ) {
      const err = new Error("Unauthorized") as Error & { statusCode?: number };
      err.statusCode = 401;
      throw err;
    }

    if (args.createdBy === "me" && normalizedOwnerEmail === null) {
      return { count: 0, decks: [] };
    }

    const visibleDecks = accessFilter(schema.decks, schema.deckShares);
    const where =
      args.createdBy === "me" && normalizedOwnerEmail !== null
        ? and(
            visibleDecks,
            sql`lower(trim(${schema.decks.ownerEmail})) = ${normalizedOwnerEmail}`,
          )
        : visibleDecks;

    if (args.light === "true") {
      // Column-projected listing for cheap add/remove diffing (the client's
      // background poll and SSE-reconnect resync). The `data` column holds
      // each deck's entire slide JSON and can be large — never select it
      // here. Callers that need slide content use `includeSlides: "true"` or
      // fetch the specific deck via `get-deck`.
      const rows = await db
        .select({
          id: schema.decks.id,
          title: schema.decks.title,
          updatedAt: schema.decks.updatedAt,
          visibility: schema.decks.visibility,
          ownerEmail: schema.decks.ownerEmail,
        })
        .from(schema.decks)
        .where(where)
        .orderBy(desc(schema.decks.updatedAt));
      return {
        count: rows.length,
        decks: rows.map((row) => ({
          id: row.id,
          title: row.title,
          updatedAt: row.updatedAt,
          visibility: row.visibility,
          createdByMe:
            normalizedOwnerEmail !== null &&
            normalizeOwnerEmail(row.ownerEmail) === normalizedOwnerEmail,
        })),
      };
    }

    if (args.includeSlides !== "true") {
      // The deck body is an opaque JSON blob containing every slide's HTML.
      // Metadata callers must opt into it explicitly; the frontend opens one
      // deck at a time through get-deck instead of downloading every body.
      const rows = await db
        .select({
          id: schema.decks.id,
          title: schema.decks.title,
          ownerEmail: schema.decks.ownerEmail,
          designSystemId: schema.decks.designSystemId,
          createdAt: schema.decks.createdAt,
          updatedAt: schema.decks.updatedAt,
          visibility: schema.decks.visibility,
        })
        .from(schema.decks)
        .where(where)
        .orderBy(desc(schema.decks.updatedAt));

      return {
        count: rows.length,
        decks: rows.map((row) => ({
          id: row.id,
          title: row.title,
          url: getDeckUrl(row.id),
          visibility: row.visibility,
          designSystemId: row.designSystemId ?? null,
          createdByMe:
            normalizedOwnerEmail !== null &&
            normalizeOwnerEmail(row.ownerEmail) === normalizedOwnerEmail,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
      };
    }

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
          createdByMe:
            normalizedOwnerEmail !== null &&
            normalizeOwnerEmail(row.ownerEmail) === normalizedOwnerEmail,
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
          starred: data?.starred === true,
        };
      }
      return {
        id: row.id,
        title: row.title,
        url: getDeckUrl(row.id),
        slideCount: slides?.length ?? 0,
        visibility: row.visibility,
        designSystemId: row.designSystemId ?? null,
        starred: data?.starred === true,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return { count: items.length, decks: items };
  },
});
