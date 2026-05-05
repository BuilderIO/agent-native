import { defineAction } from "@agent-native/core";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  isNotNull,
  sql,
} from "drizzle-orm";

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  getActiveOrganizationId,
  parseSpaceIds,
} from "../server/lib/recordings.js";

export default defineAction({
  description:
    "List recordings visible to the current user. Supports filtering by view (library/space/archive/trash/all), folder, space, tag, free-text, and sort.",
  schema: z.object({
    view: z
      .enum(["library", "space", "archive", "trash", "all"])
      .default("library")
      .describe("Which list to show"),
    folderId: z
      .string()
      .nullish()
      .describe("Folder id (null = root). Only applies to library/space view."),
    spaceId: z
      .string()
      .nullish()
      .describe("Space id — required when view is 'space'"),
    tag: z
      .string()
      .nullish()
      .describe("Filter to recordings carrying this tag"),
    search: z
      .string()
      .nullish()
      .describe("Title / description substring match"),
    sort: z
      .enum(["recent", "views", "oldest"])
      .default("recent")
      .describe("Sort order"),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();

    const whereClauses = [
      accessFilter(schema.recordings, schema.recordingShares),
    ];

    // Org isolation — all list views are scoped to the user's active org so
    // public recordings from other orgs don't leak across tenants.
    const orgId = await getActiveOrganizationId();
    if (orgId) {
      whereClauses.push(eq(schema.recordings.organizationId, orgId));
    }

    // Library = "Your personal recordings" — further scope to the current
    // user's own clips so org-visible recordings from teammates don't appear.
    if (args.view === "library") {
      const email = getRequestUserEmail();
      if (email) {
        whereClauses.push(eq(schema.recordings.ownerEmail, email));
      }
    }

    // Lifecycle view filters
    if (args.view === "trash") {
      whereClauses.push(isNotNull(schema.recordings.trashedAt));
    } else {
      whereClauses.push(isNull(schema.recordings.trashedAt));
      if (args.view === "archive") {
        whereClauses.push(isNotNull(schema.recordings.archivedAt));
      } else if (args.view !== "all") {
        whereClauses.push(isNull(schema.recordings.archivedAt));
      }
    }

    // Folder scoping
    if (args.view === "library" || args.view === "space") {
      if (args.folderId !== undefined && args.folderId !== null) {
        whereClauses.push(eq(schema.recordings.folderId, args.folderId));
      } else {
        // Root of this view
        whereClauses.push(isNull(schema.recordings.folderId));
      }
    }

    if (args.view === "space") {
      if (!args.spaceId) {
        throw new Error("spaceId is required when view='space'");
      }
      // Match recordings where spaceIds JSON array contains spaceId.
      // Use a LIKE check — works across SQLite/Postgres without JSON ops.
      const needle = `%"${args.spaceId.replace(/%/g, "")}"%`;
      whereClauses.push(sql`${schema.recordings.spaceIds} LIKE ${needle}`);
    }

    if (args.search) {
      const pat = `%${escapeLike(args.search)}%`;
      whereClauses.push(
        sql`(${schema.recordings.title} LIKE ${pat} ESCAPE '\\' OR ${schema.recordings.description} LIKE ${pat} ESCAPE '\\')`,
      );
    }

    // Tag filter — join-ish via subquery
    if (args.tag) {
      whereClauses.push(
        sql`EXISTS (SELECT 1 FROM ${schema.recordingTags} rt WHERE rt.recording_id = ${schema.recordings.id} AND rt.tag = ${args.tag})`,
      );
    }

    // Sort
    const viewCountOrder = sql<number>`(
      SELECT COUNT(1)
      FROM ${schema.recordingViewers}
      WHERE ${schema.recordingViewers.recordingId} = ${schema.recordings.id}
        AND ${eq(schema.recordingViewers.countedView, true)}
    )`;
    const orderBy =
      args.sort === "oldest"
        ? [asc(schema.recordings.createdAt)]
        : args.sort === "views"
          ? // views are not on recordings row — use subquery count
            [desc(viewCountOrder), desc(schema.recordings.createdAt)]
          : [desc(schema.recordings.createdAt)];

    const rows = await db
      .select()
      .from(schema.recordings)
      .where(and(...whereClauses))
      .orderBy(...orderBy)
      .limit(args.limit)
      .offset(args.offset);

    const ids = rows.map((r) => r.id);

    // Gather tags for the result set in one query
    let tagsByRec: Record<string, string[]> = {};
    if (ids.length) {
      const tagRows = await db
        .select()
        .from(schema.recordingTags)
        .where(inArray(schema.recordingTags.recordingId, ids));
      for (const t of tagRows) {
        tagsByRec[t.recordingId] ??= [];
        tagsByRec[t.recordingId].push(t.tag);
      }
    }

    // Count views per recording
    let viewsByRec: Record<string, number> = {};
    if (ids.length) {
      const viewRows = await db
        .select({
          recordingId: schema.recordingViewers.recordingId,
          count: sql<number>`COUNT(1)`,
        })
        .from(schema.recordingViewers)
        .where(
          and(
            inArray(schema.recordingViewers.recordingId, ids),
            eq(schema.recordingViewers.countedView, true),
          ),
        )
        .groupBy(schema.recordingViewers.recordingId);
      for (const v of viewRows) {
        viewsByRec[v.recordingId] = Number(v.count ?? 0);
      }
    }

    const recordings = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      thumbnailUrl: r.thumbnailUrl,
      animatedThumbnailUrl: r.animatedThumbnailUrl,
      durationMs: r.durationMs,
      status: r.status,
      uploadProgress: r.uploadProgress,
      failureReason: r.failureReason,
      visibility: r.visibility,
      ownerEmail: r.ownerEmail,
      folderId: r.folderId,
      spaceIds: parseSpaceIds(r.spaceIds),
      tags: tagsByRec[r.id] ?? [],
      viewCount: viewsByRec[r.id] ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      archivedAt: r.archivedAt,
      trashedAt: r.trashedAt,
      hasAudio: Boolean(r.hasAudio),
      hasCamera: Boolean(r.hasCamera),
      width: r.width,
      height: r.height,
    }));

    return { recordings };
  },
});
