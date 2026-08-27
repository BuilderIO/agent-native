import { defineAction } from "@agent-native/core/action";
import { isPostgres } from "@agent-native/core/db";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { normalizeOwnerEmail } from "../shared/ownership.js";
import { getDeckAppUrl, getDeckUrl } from "./_app-url.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type DeckCursor = { updatedAt: string; id: string };

function decodeCursor(cursor: string): DeckCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !value ||
      typeof value.updatedAt !== "string" ||
      Number.isNaN(Date.parse(value.updatedAt)) ||
      typeof value.id !== "string" ||
      !value.id
    ) {
      throw new Error("Invalid cursor");
    }
    return value;
  } catch {
    throw new Error("Invalid cursor");
  }
}

function encodeCursor(cursor: DeckCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

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
      .datetime()
      .optional()
      .describe("Return decks updated strictly after this ISO timestamp"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .optional()
      .describe("Page size when using updatedSince or cursor (1-100)"),
    cursor: z
      .string()
      .min(1)
      .optional()
      .describe("Opaque cursor returned by a prior paginated response"),
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
    const paginationRequested =
      args.updatedSince !== undefined ||
      args.limit !== undefined ||
      args.cursor !== undefined;
    const cursor = args.cursor ? decodeCursor(args.cursor) : undefined;
    const pageSize = args.limit ?? DEFAULT_PAGE_SIZE;
    const paginationFilters = [
      ...(args.updatedSince
        ? [gt(schema.decks.updatedAt, args.updatedSince)]
        : []),
      ...(cursor
        ? [
            or(
              lt(schema.decks.updatedAt, cursor.updatedAt),
              and(
                eq(schema.decks.updatedAt, cursor.updatedAt),
                lt(schema.decks.id, cursor.id),
              ),
            ),
          ]
        : []),
    ];
    const where = and(
      visibleDecks,
      ...(args.createdBy === "me" && normalizedOwnerEmail !== null
        ? [
            sql`lower(trim(${schema.decks.ownerEmail})) = ${normalizedOwnerEmail}`,
          ]
        : []),
      ...paginationFilters,
    );
    const orderBy = [
      desc(schema.decks.updatedAt),
      ...(paginationRequested ? [desc(schema.decks.id)] : []),
    ];
    const finalizePage = <T extends { id: string; updatedAt: string | null }>(
      rows: T[],
    ) => {
      const pageRows = paginationRequested ? rows.slice(0, pageSize) : rows;
      const lastRow = pageRows.at(-1);
      const nextCursor =
        paginationRequested &&
        rows.length > pageSize &&
        typeof lastRow?.updatedAt === "string"
          ? encodeCursor({ id: lastRow.id, updatedAt: lastRow.updatedAt })
          : undefined;
      return { pageRows, ...(nextCursor ? { nextCursor } : {}) };
    };

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
        const previewSlideProjection = isPostgres()
          ? sql<
              string | null
            >`(${schema.decks.data}::jsonb -> 'slides' -> 0)::text`
          : sql<
              string | null
            >`json_extract(${schema.decks.data}, '$.slides[0]')`;
        const aspectRatioProjection = isPostgres()
          ? sql<string | null>`(${schema.decks.data}::jsonb ->> 'aspectRatio')`
          : sql<
              string | null
            >`json_extract(${schema.decks.data}, '$.aspectRatio')`;
        const rows = db
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
          .orderBy(...orderBy);
        const fetchedRows = paginationRequested
          ? await rows.limit(pageSize + 1)
          : await rows;
        const { pageRows, nextCursor } = finalizePage(fetchedRows);

        return {
          count: pageRows.length,
          decks: pageRows.map((row) => {
            const previewSlide = parseJsonProjection(
              row.previewSlide,
              "first slide preview",
            );
            return {
              id: row.id,
              title: row.title,
              updatedAt: row.updatedAt,
              visibility: row.visibility,
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
          ...(nextCursor ? { nextCursor } : {}),
        };
      }

      const rows = db
        .select({
          id: schema.decks.id,
          title: schema.decks.title,
          updatedAt: schema.decks.updatedAt,
          visibility: schema.decks.visibility,
          ownerEmail: schema.decks.ownerEmail,
        })
        .from(schema.decks)
        .where(where)
        .orderBy(...orderBy);
      const fetchedRows = paginationRequested
        ? await rows.limit(pageSize + 1)
        : await rows;
      const { pageRows, nextCursor } = finalizePage(fetchedRows);
      return {
        count: pageRows.length,
        decks: pageRows.map((row) => ({
          id: row.id,
          title: row.title,
          updatedAt: row.updatedAt,
          visibility: row.visibility,
          createdByMe:
            normalizedOwnerEmail !== null &&
            normalizeOwnerEmail(row.ownerEmail) === normalizedOwnerEmail,
        })),
        ...(nextCursor ? { nextCursor } : {}),
      };
    }

    if (args.includeSlides !== "true") {
      // The deck body is an opaque JSON blob containing every slide's HTML.
      // Metadata callers must opt into it explicitly; the frontend opens one
      // deck at a time through get-deck instead of downloading every body.
      const rows = db
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
        .orderBy(...orderBy);
      const fetchedRows = paginationRequested
        ? await rows.limit(pageSize + 1)
        : await rows;
      const { pageRows, nextCursor } = finalizePage(fetchedRows);

      return {
        count: pageRows.length,
        decks: pageRows.map((row) => ({
          id: row.id,
          title: row.title,
          url: getDeckUrl(row.id),
          appUrl: getDeckAppUrl(row.id, ctx?.requestHeaders),
          visibility: row.visibility,
          designSystemId: row.designSystemId ?? null,
          createdByMe:
            normalizedOwnerEmail !== null &&
            normalizeOwnerEmail(row.ownerEmail) === normalizedOwnerEmail,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
        ...(nextCursor ? { nextCursor } : {}),
      };
    }

    const rows = db
      .select()
      .from(schema.decks)
      .where(where)
      .orderBy(...orderBy);
    const fetchedRows = paginationRequested
      ? await rows.limit(pageSize + 1)
      : await rows;
    const { pageRows, nextCursor } = finalizePage(fetchedRows);

    if (pageRows.length === 0) {
      return { count: 0, decks: [] };
    }

    const items = pageRows.map((row) => {
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
          appUrl: getDeckAppUrl(row.id, ctx?.requestHeaders),
          slides: Array.isArray(slides) ? slides : [],
        };
      }

      if (args.compact === "true") {
        return {
          id: row.id,
          title: row.title,
          url: getDeckUrl(row.id),
          appUrl: getDeckAppUrl(row.id, ctx?.requestHeaders),
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
        appUrl: getDeckAppUrl(row.id, ctx?.requestHeaders),
        slideCount: slides?.length ?? 0,
        visibility: row.visibility,
        designSystemId: row.designSystemId ?? null,
        starred: data?.starred === true,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return {
      count: items.length,
      decks: items,
      ...(nextCursor ? { nextCursor } : {}),
    };
  },
});
