import { defineAction, fail } from "@agent-native/core/action";
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

function parseJsonProjection(value: unknown, label: string): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid ${label} JSON projection`, { cause: error });
  }
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function encodeDeckCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt, id })).toString("base64url");
}

function decodeDeckCursor(value: string): { updatedAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.updatedAt !== "string" ||
      !parsed.updatedAt ||
      typeof parsed.id !== "string" ||
      !parsed.id
    ) {
      throw new Error("invalid cursor shape");
    }
    return parsed;
  } catch {
    fail("Invalid deck list cursor.", {
      errorCode: "invalid_deck_list_cursor",
      statusCode: 400,
    });
  }
}

export default defineAction({
  description:
    "List decks from the database with metadata. Use updatedSince, limit, and cursor for bounded incremental sync; paged responses are metadata-only, so use get-deck for slide content.",
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
    includePreview: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "Set to 'true' with light mode to include only the first slide preview",
      ),
    light: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "Set to 'true' for a minimal id/title/updatedAt/visibility listing " +
          "used for cheap add/remove diffing (e.g. background polling). " +
          "By default never reads the deck body — no slides, no slideCount. " +
          "Use includePreview for the first slide only.",
      ),
    createdBy: z
      .enum(["all", "me"])
      .optional()
      .describe("Set to 'me' to list only decks created by the current user"),
    updatedSince: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe("Only return decks updated after this timestamp"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .optional()
      .describe("Maximum number of decks to return in a bounded page"),
    cursor: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .optional()
      .describe("Opaque cursor returned by the previous page"),
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
      (args.includeSlides === "true" || args.includePreview === "true") &&
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

    const paged =
      args.updatedSince !== undefined ||
      args.limit !== undefined ||
      args.cursor !== undefined;
    if (paged) {
      const cursor = args.cursor ? decodeDeckCursor(args.cursor) : undefined;
      const updatedSince = args.updatedSince
        ? new Date(args.updatedSince).toISOString()
        : undefined;
      const pageConditions = [
        ...(updatedSince
          ? [sql`${schema.decks.updatedAt} > ${updatedSince}`]
          : []),
        ...(cursor
          ? [
              sql`(${schema.decks.updatedAt} < ${cursor.updatedAt} OR (${schema.decks.updatedAt} = ${cursor.updatedAt} AND ${schema.decks.id} < ${cursor.id}))`,
            ]
          : []),
      ];
      const pagedWhere = pageConditions.length
        ? and(where, ...pageConditions)
        : where;
      const pageSize = args.limit ?? DEFAULT_PAGE_SIZE;
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
        .where(pagedWhere)
        .orderBy(desc(schema.decks.updatedAt), desc(schema.decks.id))
        .limit(pageSize + 1);
      const hasNextPage = rows.length > pageSize;
      const visibleRows = hasNextPage ? rows.slice(0, pageSize) : rows;
      const lastRow = visibleRows[visibleRows.length - 1];
      if (hasNextPage && !lastRow?.updatedAt) {
        fail("Cannot paginate a deck without an updated timestamp.", {
          errorCode: "deck_pagination_unavailable",
          statusCode: 409,
        });
      }
      const nextCursor =
        hasNextPage && lastRow?.updatedAt
          ? encodeDeckCursor(lastRow.updatedAt, lastRow.id)
          : undefined;
      const decks = visibleRows.map((row) => ({
        id: row.id,
        title: row.title,
        url: getDeckUrl(row.id),
        appUrl: getDeckUrl(row.id),
        visibility: row.visibility,
        designSystemId: row.designSystemId ?? null,
        createdByMe:
          normalizedOwnerEmail !== null &&
          normalizeOwnerEmail(row.ownerEmail) === normalizedOwnerEmail,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
      return {
        count: decks.length,
        decks,
        ...(nextCursor ? { nextCursor } : {}),
      };
    }

    if (args.light === "true") {
      // Column-projected listing for cheap add/remove diffing (the client's
      // background poll and SSE-reconnect resync). The `data` column holds
      // each deck's entire slide JSON and can be large. The home grid opts
      // into the separate preview projection; polling keeps the metadata-only
      // path below.
      if (args.includePreview === "true") {
        // Keep the list bounded at the database boundary. `data` is an opaque
        // full-deck blob, so selecting it and parsing it here scales with every
        // slide even though the caller only needs the first one.
        const previewSlideProjection = sql<
          string | null
        >`(${schema.decks.data}::jsonb -> 'slides' -> 0)::text`;
        const aspectRatioProjection = sql<
          string | null
        >`(${schema.decks.data}::jsonb ->> 'aspectRatio')`;
        const rows = await db
          .select({
            id: schema.decks.id,
            title: schema.decks.title,
            updatedAt: schema.decks.updatedAt,
            visibility: schema.decks.visibility,
            ownerEmail: schema.decks.ownerEmail,
            previewSlide: previewSlideProjection,
            aspectRatio: aspectRatioProjection,
          })
          .from(schema.decks)
          .where(where)
          .orderBy(desc(schema.decks.updatedAt));

        return {
          count: rows.length,
          decks: rows.map((row) => {
            const previewSlide = parseJsonProjection(
              row.previewSlide,
              "first slide preview",
            );
            return {
              id: row.id,
              title: row.title,
              updatedAt: row.updatedAt,
              visibility: row.visibility,
              appUrl: getDeckUrl(row.id),
              createdByMe:
                normalizedOwnerEmail !== null &&
                normalizeOwnerEmail(row.ownerEmail) === normalizedOwnerEmail,
              ...(previewSlide && typeof previewSlide === "object"
                ? { previewSlide }
                : {}),
              ...(typeof row.aspectRatio === "string"
                ? { aspectRatio: row.aspectRatio }
                : {}),
            };
          }),
        };
      }

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
          appUrl: getDeckUrl(row.id),
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
          appUrl: getDeckUrl(row.id),
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
          appUrl: getDeckUrl(row.id),
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
          appUrl: getDeckUrl(row.id),
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
        appUrl: getDeckUrl(row.id),
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
