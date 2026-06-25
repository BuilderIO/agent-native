import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  isNotNull,
  notInArray,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getActiveOrganizationId,
  ownerEmailMatches,
  parseSpaceIds,
} from "../server/lib/recordings.js";

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

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
      .describe(
        "Folder id. Omit/null for the unified library or space view; pass a folder id to show only that folder.",
      ),
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
    countOnly: z
      // Robust coercion: a GET query param arrives as the string "true"/"false",
      // and z.coerce.boolean would treat "false" as true. Map strings explicitly.
      .preprocess(
        (v) => (typeof v === "string" ? v === "true" : v),
        z.boolean(),
      )
      .default(false)
      .describe("Return only the total count, skipping the row payload"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();

    const whereClauses = [
      accessFilter(schema.recordings, schema.recordingShares),
    ];

    const orgId = await getActiveOrganizationId();

    // Library = "Your personal recordings in the active org". `accessFilter`
    // admits all owner rows regardless of org, so library must add both the
    // owner-email and current-org predicates to scope correctly.
    if (args.view === "library") {
      const email = getRequestUserEmail();
      if (email) {
        whereClauses.push(
          ownerEmailMatches(schema.recordings.ownerEmail, email),
        );
      }
      if (orgId) {
        whereClauses.push(eq(schema.recordings.organizationId, orgId));
      }
      // Meeting recordings are transcript-only (no playable media) and live on
      // the /meetings surface, so keep them out of the Library list. The link
      // is meetings.recordingId (no meetingId column on recordings), so exclude
      // any recording referenced by a meeting. The subquery filters out NULLs
      // so NOT IN doesn't collapse to an empty result under SQL NULL semantics.
      const meetingRecordingIds = db
        .select({ id: schema.meetings.recordingId })
        .from(schema.meetings)
        .where(isNotNull(schema.meetings.recordingId));
      whereClauses.push(notInArray(schema.recordings.id, meetingRecordingIds));
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
      }
    }

    if (args.view === "space") {
      if (!args.spaceId) {
        throw new Error("spaceId is required when view='space'");
      }
      if (orgId) {
        whereClauses.push(eq(schema.recordings.organizationId, orgId));
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

    // Count-only callers (e.g. the sidebar badge) need just the total for the
    // same filters, ignoring limit/offset. Run the COUNT and short-circuit
    // before the row select, joins, and tag/view subqueries. Keeping it inside
    // this branch means the normal list path doesn't pay for an extra query.
    if (args.countOnly) {
      const totalRows = await db
        .select({ count: sql<number>`COUNT(1)` })
        .from(schema.recordings)
        .where(and(...whereClauses));
      return { recordings: [], total: Number(totalRows[0]?.count ?? 0) };
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
      .select({
        // Project only the columns the list grid renders. Bare
        // `.select({ recording: schema.recordings })` would pull the whole row
        // — including the potentially large `edits_json` / `chapters_json`
        // blobs, `password`, and `video_url` — over the wire for every card,
        // even though the mapper below drops them. The detail/editor/player
        // paths (`get-recording-player-data`, `view-screen`) still read the
        // full row.
        recording: {
          id: schema.recordings.id,
          title: schema.recordings.title,
          titleSource: schema.recordings.titleSource,
          sourceAppName: schema.recordings.sourceAppName,
          sourceWindowTitle: schema.recordings.sourceWindowTitle,
          description: schema.recordings.description,
          thumbnailUrl: schema.recordings.thumbnailUrl,
          animatedThumbnailUrl: schema.recordings.animatedThumbnailUrl,
          durationMs: schema.recordings.durationMs,
          status: schema.recordings.status,
          uploadProgress: schema.recordings.uploadProgress,
          failureReason: schema.recordings.failureReason,
          visibility: schema.recordings.visibility,
          ownerEmail: schema.recordings.ownerEmail,
          folderId: schema.recordings.folderId,
          spaceIds: schema.recordings.spaceIds,
          createdAt: schema.recordings.createdAt,
          updatedAt: schema.recordings.updatedAt,
          archivedAt: schema.recordings.archivedAt,
          trashedAt: schema.recordings.trashedAt,
          hasAudio: schema.recordings.hasAudio,
          hasCamera: schema.recordings.hasCamera,
          width: schema.recordings.width,
          height: schema.recordings.height,
        },
        transcriptStatus: schema.recordingTranscripts.status,
        // Compute the has-text signal in SQL instead of shipping the full
        // transcript text + segments JSON per card just to derive a boolean.
        // Mirrors the old `transcriptHasText()` helper: non-empty trimmed
        // `full_text`, or a segment carrying a non-empty `"text"` value.
        transcriptHasText: sql<number>`(
          CASE WHEN (
            TRIM(COALESCE(${schema.recordingTranscripts.fullText}, '')) <> ''
            OR COALESCE(${schema.recordingTranscripts.segmentsJson}, '') LIKE '%"text":"_%'
          ) THEN 1 ELSE 0 END
        )`,
      })
      .from(schema.recordings)
      .leftJoin(
        schema.recordingTranscripts,
        eq(schema.recordingTranscripts.recordingId, schema.recordings.id),
      )
      .where(and(...whereClauses))
      .orderBy(...orderBy)
      .limit(args.limit)
      .offset(args.offset);

    const ids = rows.map((r) => r.recording.id);

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

    const recordings = rows.map((row) => {
      const r = row.recording;
      return {
        id: r.id,
        title: r.title,
        titleSource: r.titleSource,
        sourceAppName: r.sourceAppName,
        sourceWindowTitle: r.sourceWindowTitle,
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
        transcriptStatus: row.transcriptStatus ?? null,
        transcriptHasText: Number(row.transcriptHasText ?? 0) > 0,
      };
    });

    return { recordings };
  },
});
