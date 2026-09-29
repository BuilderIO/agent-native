import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink, captureError } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveDeckDesignSystemId } from "../shared/deck-content.js";
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

// Thumbnails render from the first slide only; a slide beyond this size is
// reported as too large instead of inflating every gallery page.
const MAX_PREVIEW_SLIDE_CHARS = 128 * 1024;

const firstSlideText = sql`(${schema.decks.data}::jsonb -> 'slides' -> 0)::text`;
const previewProjection = {
  previewSlide: sql<
    string | null
  >`(case when length(${firstSlideText}) <= ${MAX_PREVIEW_SLIDE_CHARS} then ${firstSlideText} end)`,
  previewTooLarge: sql<
    boolean | null
  >`(length(${firstSlideText}) > ${MAX_PREVIEW_SLIDE_CHARS})`,
  aspectRatio: sql<
    string | null
  >`(${schema.decks.data}::jsonb ->> 'aspectRatio')`,
};

function previewFromRawData(data: string, deckId: string) {
  let previewSlide: string | null = null;
  let previewTooLarge: boolean | null = null;
  let aspectRatio: string | null = null;
  try {
    const parsed = JSON.parse(data);
    const firstSlide = Array.isArray(parsed?.slides)
      ? parsed.slides[0]
      : undefined;
    if (firstSlide !== undefined) {
      const text = JSON.stringify(firstSlide);
      if (text.length <= MAX_PREVIEW_SLIDE_CHARS) previewSlide = text;
      else previewTooLarge = true;
    }
    if (typeof parsed?.aspectRatio === "string") {
      aspectRatio = parsed.aspectRatio;
    }
  } catch (parseError) {
    captureError(parseError, {
      route: "list-decks",
      extra: { deckId },
    });
  }
  return { previewSlide, previewTooLarge, aspectRatio };
}

const INVALID_TEXT_REPRESENTATION = "22P02";
const UNSUPPORTED_UNICODE_ESCAPE = "22P05";

function isInvalidJsonCastError(error: unknown): boolean {
  const err = error as { code?: unknown; cause?: { code?: unknown } };
  return (
    err?.code === INVALID_TEXT_REPRESENTATION ||
    err?.cause?.code === INVALID_TEXT_REPRESENTATION ||
    err?.code === UNSUPPORTED_UNICODE_ESCAPE ||
    err?.cause?.code === UNSUPPORTED_UNICODE_ESCAPE
  );
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
    "List accessible decks with metadata. Use updatedSince, limit, and cursor for bounded incremental sync, includePreview for the first slide, or get-deck for full slide content.",
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
        "Set to 'true' with light mode or a bounded page to include only the first slide preview",
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
    search: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe(
        "Optional case-insensitive substring search against deck titles, before pagination.",
      ),
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
    const where = and(
      visibleDecks,
      args.createdBy === "me" && normalizedOwnerEmail !== null
        ? sql`lower(trim(${schema.decks.ownerEmail})) = ${normalizedOwnerEmail}`
        : undefined,
      args.search
        ? sql`strpos(lower(${schema.decks.title}), ${args.search.toLowerCase()}) > 0`
        : undefined,
    );

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
      const previewRequested = args.includePreview === "true";
      const pagedMeta = {
        id: schema.decks.id,
        title: schema.decks.title,
        ownerEmail: schema.decks.ownerEmail,
        designSystemId: schema.decks.designSystemId,
        createdAt: schema.decks.createdAt,
        updatedAt: schema.decks.updatedAt,
        visibility: schema.decks.visibility,
      };
      const pagedQuery = db
        .select({
          ...pagedMeta,
          previewSlide: previewRequested
            ? previewProjection.previewSlide
            : sql<null>`null`,
          previewTooLarge: previewRequested
            ? previewProjection.previewTooLarge
            : sql<null>`null`,
          aspectRatio: previewRequested
            ? previewProjection.aspectRatio
            : sql<null>`null`,
        })
        .from(schema.decks)
        .where(pagedWhere)
        .orderBy(desc(schema.decks.updatedAt), desc(schema.decks.id))
        .limit(pageSize + 1);
      let rows: Awaited<typeof pagedQuery>;
      try {
        rows = await pagedQuery;
      } catch (error) {
        if (!previewRequested || !isInvalidJsonCastError(error)) throw error;
        captureError(error, {
          route: "list-decks",
          extra: { includePreview: true, paged: true },
        });
        const rawRows = await db
          .select({ ...pagedMeta, data: schema.decks.data })
          .from(schema.decks)
          .where(pagedWhere)
          .orderBy(desc(schema.decks.updatedAt), desc(schema.decks.id))
          .limit(pageSize + 1);
        rows = rawRows.map(({ data, ...meta }) => ({
          ...meta,
          ...previewFromRawData(data, meta.id),
        }));
      }
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
        ...(args.includePreview === "true"
          ? {
              ...(row.previewSlide !== null
                ? {
                    previewSlide: parseJsonProjection(
                      row.previewSlide,
                      "first slide preview",
                    ),
                  }
                : {}),
              ...(row.previewTooLarge ? { previewTooLarge: true } : {}),
              aspectRatio: row.aspectRatio,
            }
          : {}),
      }));
      return {
        count: decks.length,
        decks,
        ...(nextCursor ? { nextCursor } : {}),
      };
    }

    if (args.light === "true") {
      if (args.includePreview === "true") {
        const previewQuery = db
          .select({
            id: schema.decks.id,
            title: schema.decks.title,
            updatedAt: schema.decks.updatedAt,
            visibility: schema.decks.visibility,
            ownerEmail: schema.decks.ownerEmail,
            ...previewProjection,
          })
          .from(schema.decks)
          .where(where)
          .orderBy(desc(schema.decks.updatedAt));

        let rows: Awaited<typeof previewQuery>;
        try {
          rows = await previewQuery;
        } catch (error) {
          if (!isInvalidJsonCastError(error)) throw error;
          captureError(error, {
            route: "list-decks",
            extra: { includePreview: true },
          });
          const rawRows = await db
            .select({
              id: schema.decks.id,
              title: schema.decks.title,
              updatedAt: schema.decks.updatedAt,
              visibility: schema.decks.visibility,
              ownerEmail: schema.decks.ownerEmail,
              data: schema.decks.data,
            })
            .from(schema.decks)
            .where(where)
            .orderBy(desc(schema.decks.updatedAt));
          rows = rawRows.map(({ data, ...meta }) => ({
            ...meta,
            ...previewFromRawData(data, meta.id),
          }));
        }

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
              ...(row.previewTooLarge ? { previewTooLarge: true } : {}),
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
          designSystemId: resolveDeckDesignSystemId(row, data),
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
