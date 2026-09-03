import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { resolveUserProfileName } from "@agent-native/core/user-profile";
import { getUserProfiles } from "@agent-native/core/user-profile/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

const DESIGN_LIST_DEFAULT_PAGE_SIZE = 12;
const DESIGN_LIST_MAX_PAGE_SIZE = 50;

// Truncate preview HTML so the listing payload stays reasonable. The home
// screen only needs enough HTML to render a recognizable thumbnail; full
// content loads on demand when the user opens an editor.
const PREVIEW_MAX_BYTES = 50_000;

function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

export default defineAction({
  description:
    "List design projects accessible to the current user. Pass page and " +
    "pageSize for pagination; omitted values use the first bounded page. " +
    "Returns optional HTML previews.",
  schema: z.object({
    page: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe("One-based page number"),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(DESIGN_LIST_MAX_PAGE_SIZE)
      .optional()
      .describe("Maximum designs returned in this page"),
    createdBy: z
      .enum(["all", "me"])
      .optional()
      .describe("Set to 'me' to list only designs created by the current user"),
    search: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe("Case-insensitive substring search against design titles"),
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "Set to 'true' for compact output (id, title, projectType only)",
      ),
    includePreview: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "Set to 'true' to include a truncated `previewHtml` field per design (the index.html content). Used by the homepage to render thumbnails.",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async (args) => {
    const page = args.page ?? 1;
    const pageSize = args.pageSize ?? DESIGN_LIST_DEFAULT_PAGE_SIZE;
    const ownerEmail = getRequestUserEmail()?.trim().toLowerCase() || null;
    if (args.createdBy === "me" && !ownerEmail) {
      return {
        count: 0,
        totalCount: 0,
        hasMore: false,
        page,
        pageSize,
        totalPages: 0,
        designs: [],
      };
    }

    const db = getDb();
    const search = args.search ? args.search.toLowerCase() : null;
    const where = and(
      accessFilter(schema.designs, schema.designShares),
      args.createdBy === "me"
        ? sql`lower(trim(${schema.designs.ownerEmail})) = ${ownerEmail}`
        : undefined,
      search
        ? sql`lower(${schema.designs.title}) LIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'`
        : undefined,
    );
    const offset = (page - 1) * pageSize;

    // Project only the columns the list path uses. The `data` TEXT column holds
    // the full design JSON (tweaks, selections, etc.) which can be large and is
    // never read on the listing — detail/editor views load it via get-design.
    const designsQuery = db
      .select({
        id: schema.designs.id,
        title: schema.designs.title,
        description: schema.designs.description,
        projectType: schema.designs.projectType,
        designSystemId: schema.designs.designSystemId,
        visibility: schema.designs.visibility,
        ownerEmail: schema.designs.ownerEmail,
        createdAt: schema.designs.createdAt,
        updatedAt: schema.designs.updatedAt,
      })
      .from(schema.designs)
      .where(where)
      .orderBy(desc(schema.designs.updatedAt), desc(schema.designs.id));
    const rowsPromise = designsQuery.limit(pageSize).offset(offset);
    const [countRows, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.designs)
        .where(where),
      rowsPromise,
    ]);
    const totalCount = Number(countRows[0]?.count ?? 0);

    // Look up one preview per design when requested. Prefer the entry point
    // (`index.html`) and fall back to the first HTML file we find.
    const previews = new Map<string, string>();
    if (
      args.includePreview === "true" &&
      args.compact !== "true" &&
      rows.length > 0
    ) {
      const ids = rows.map((r) => r.id);
      const fileRows = await db
        .select({
          designId: schema.designFiles.designId,
          filename: schema.designFiles.filename,
          content: sql<string>`substr(${schema.designFiles.content}, 1, ${PREVIEW_MAX_BYTES})`,
          fileType: schema.designFiles.fileType,
        })
        .from(schema.designFiles)
        .where(
          and(
            inArray(schema.designFiles.designId, ids),
            eq(schema.designFiles.fileType, "html"),
          ),
        );

      const byDesign = new Map<string, typeof fileRows>();
      for (const f of fileRows) {
        if (f.fileType !== "html") continue;
        const list = byDesign.get(f.designId);
        if (list) list.push(f);
        else byDesign.set(f.designId, [f]);
      }

      for (const [designId, files] of byDesign) {
        const indexFile =
          files.find((f) => f.filename === "index.html") ?? files[0];
        if (!indexFile?.content) continue;
        const trimmed =
          indexFile.content.length > PREVIEW_MAX_BYTES
            ? indexFile.content.slice(0, PREVIEW_MAX_BYTES)
            : indexFile.content;
        previews.set(designId, trimmed);
      }
    }

    const profiles =
      args.compact === "true"
        ? new Map()
        : await getUserProfiles(rows.map((row) => row.ownerEmail));

    const items = rows.map((row) => {
      if (args.compact === "true") {
        return {
          id: row.id,
          title: row.title,
          projectType: row.projectType,
        };
      }
      const base = {
        id: row.id,
        title: row.title,
        description: row.description,
        projectType: row.projectType,
        designSystemId: row.designSystemId,
        visibility: row.visibility,
        ownerEmail: row.ownerEmail,
        ownerName: resolveUserProfileName(
          row.ownerEmail,
          null,
          profiles.get(row.ownerEmail.toLowerCase())?.name,
        ),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      if (args.includePreview === "true") {
        return { ...base, previewHtml: previews.get(row.id) ?? null };
      }
      return base;
    });

    const hasMore = offset + rows.length < totalCount;
    const totalPages = Math.ceil(totalCount / pageSize);
    return {
      count: totalCount,
      totalCount,
      hasMore,
      page,
      pageSize,
      totalPages,
      designs: items,
    };
  },
});
