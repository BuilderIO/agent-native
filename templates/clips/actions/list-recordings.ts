import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getUserProfiles } from "@agent-native/core/user-profile/server";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  isNotNull,
  not,
  notInArray,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { effectiveDuration, parseEdits } from "../app/lib/timestamp-mapping.js";
import { parseRedactions } from "../app/lib/video-redactions.js";
import { getDb, schema } from "../server/db/index.js";
import {
  agentRecordingAccessFilter,
  isAgentRecordingCaller,
} from "../server/lib/agent-recording-access.js";
import { resolvePlayerThumbnailUrl } from "../server/lib/player-thumbnail-url.js";
import { resolvePlayerVideoUrl } from "../server/lib/player-video-url.js";
import {
  countedViewCondition,
  getActiveOrganizationId,
  ownerEmailMatches,
  parseSpaceIds,
} from "../server/lib/recordings.js";
import { profileNameFor } from "../server/lib/user-identities.js";

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

type RecordingMediaFields = {
  id: string;
  sourceAppName?: string | null;
  sourceWindowTitle?: string | null;
  videoUrl?: string | null;
  videoFormat?: string | null;
};

export function resolveListRecordingMedia(
  recording: RecordingMediaFields,
  includeMedia: boolean,
): { videoUrl: string | null; videoFormat: "webm" | "mp4" | null } {
  if (!includeMedia) {
    return { videoUrl: null, videoFormat: null };
  }

  return {
    videoUrl: resolvePlayerVideoUrl(
      {
        id: recording.id,
        sourceAppName: recording.sourceAppName,
        sourceWindowTitle: recording.sourceWindowTitle,
        videoUrl: recording.videoUrl,
      },
      { proxyRemoteMedia: true },
    ),
    videoFormat:
      recording.videoFormat === "webm" || recording.videoFormat === "mp4"
        ? recording.videoFormat
        : null,
  };
}

type ViewCountRow = { recordingId: string; count: number | string | null };

/**
 * `recording_views` only exists from migration v46, so pre-migration clips have
 * no log rows and must fall back to their counted-viewer count instead of
 * dropping to 0. Same floor as `countRecordingViews`, so a library card and the
 * clip page always agree.
 */
export function mergeViewCounts(
  countedViewerRows: ViewCountRow[],
  viewLogRows: ViewCountRow[],
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const row of countedViewerRows) {
    merged[row.recordingId] = Number(row.count ?? 0);
  }
  for (const row of viewLogRows) {
    merged[row.recordingId] = Math.max(
      merged[row.recordingId] ?? 0,
      Number(row.count ?? 0),
    );
  }
  return merged;
}

export default defineAction({
  description:
    "List recordings visible to the current user. Supports filtering by view (library/shared/space/archive/trash/all), folder, space, tag, free-text, and sort. Public/unlisted recordings are discoverable only when owned by or previously viewed by the current user; the shared view returns accessible recordings owned by someone else.",
  schema: z.object({
    view: z
      .enum(["library", "shared", "space", "archive", "trash", "all"])
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
    includeMedia: z
      .preprocess(
        (v) => (typeof v === "string" ? v === "true" : v),
        z.boolean(),
      )
      .default(false)
      .describe("Include playable media fields for editor workflows"),
  }),
  http: { method: "GET" },
  run: async (args, ctx) => {
    const db = getDb();

    const whereClauses = [
      agentRecordingAccessFilter(
        schema.recordings,
        schema.recordingShares,
        schema.recordingViewers,
        {
          agentOnly: isAgentRecordingCaller(ctx?.caller),
          userEmail: ctx?.userEmail,
        },
      ),
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
    }

    if (args.view === "shared") {
      const email = getRequestUserEmail();
      whereClauses.push(
        email
          ? not(ownerEmailMatches(schema.recordings.ownerEmail, email))
          : sql`1 = 0`,
      );
    }

    if (args.view === "library" || args.view === "shared") {
      const resolvedDb = await Promise.resolve(db);
      const meetingRecordingIds = resolvedDb
        .select({ id: schema.meetings.recordingId })
        .from(schema.meetings)
        .where(isNotNull(schema.meetings.recordingId));
      whereClauses.push(notInArray(schema.recordings.id, meetingRecordingIds));
    }

    if (args.view === "trash") {
      whereClauses.push(isNotNull(schema.recordings.trashedAt));
      if (orgId) {
        whereClauses.push(eq(schema.recordings.organizationId, orgId));
      }
    } else {
      whereClauses.push(isNull(schema.recordings.trashedAt));
      if (args.view === "archive") {
        whereClauses.push(isNotNull(schema.recordings.archivedAt));
      } else if (args.view !== "all") {
        whereClauses.push(isNull(schema.recordings.archivedAt));
      }
    }

    if (args.view === "library" || args.view === "space") {
      if (args.folderId !== undefined && args.folderId !== null) {
        whereClauses.push(eq(schema.recordings.folderId, args.folderId));
      } else {
        whereClauses.push(isNull(schema.recordings.folderId));
      }
    }

    if (args.view === "space") {
      if (!args.spaceId) {
        throw new Error("spaceId is required when view='space'");
      }
      if (orgId) {
        whereClauses.push(eq(schema.recordings.organizationId, orgId));
      }
      const needle = `%"${args.spaceId.replace(/%/g, "")}"%`;
      whereClauses.push(sql`${schema.recordings.spaceIds} LIKE ${needle}`);
    }

    if (args.search) {
      const pat = `%${escapeLike(args.search)}%`;
      whereClauses.push(
        sql`(${schema.recordings.title} LIKE ${pat} ESCAPE '\\' OR ${schema.recordings.description} LIKE ${pat} ESCAPE '\\')`,
      );
    }

    if (args.tag) {
      whereClauses.push(
        sql`EXISTS (SELECT 1 FROM ${schema.recordingTags} rt WHERE rt.recording_id = ${schema.recordings.id} AND rt.tag = ${args.tag})`,
      );
    }

    if (args.countOnly) {
      const totalRows = await db
        .select({ count: sql<number>`COUNT(1)` })
        .from(schema.recordings)
        .where(and(...whereClauses));
      return { recordings: [], total: Number(totalRows[0]?.count ?? 0) };
    }

    const countedViewerCount = sql<number>`(
      SELECT COUNT(1)
      FROM ${schema.recordingViewers}
      WHERE ${schema.recordingViewers.recordingId} = ${schema.recordings.id}
        AND ${countedViewCondition()}
    )`;
    const viewLogCount = sql<number>`(
      SELECT COUNT(1)
      FROM ${schema.recordingViews}
      WHERE ${schema.recordingViews.recordingId} = ${schema.recordings.id}
    )`;
    // Same floor as `countRecordingViews`: `recording_views` only exists from
    // migration v46, so pre-migration clips have no log rows and must fall back
    // to the counted-viewer count instead of sorting as zero. CASE keeps the
    // ordering expression explicit about which count wins.
    const viewCountOrder = sql<number>`(
      CASE WHEN ${viewLogCount} > ${countedViewerCount}
        THEN ${viewLogCount}
        ELSE ${countedViewerCount}
      END
    )`;
    const orderBy =
      args.sort === "oldest"
        ? [asc(schema.recordings.createdAt)]
        : args.sort === "views"
          ? [desc(viewCountOrder), desc(schema.recordings.createdAt)]
          : [desc(schema.recordings.createdAt)];

    const rows = await db
      .select({
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
          editsJson: schema.recordings.editsJson,
          status: schema.recordings.status,
          uploadProgress: schema.recordings.uploadProgress,
          failureReason: schema.recordings.failureReason,
          visibility: schema.recordings.visibility,
          hasPassword: sql<number>`(
            CASE WHEN ${schema.recordings.password} IS NOT NULL
              AND ${schema.recordings.password} <> ''
              THEN 1 ELSE 0
            END
          )`,
          expiresAt: schema.recordings.expiresAt,
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
          videoUrl: args.includeMedia
            ? schema.recordings.videoUrl
            : sql<string | null>`NULL`,
          videoFormat: args.includeMedia
            ? schema.recordings.videoFormat
            : sql<string | null>`NULL`,
        },
        transcriptStatus: schema.recordingTranscripts.status,
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
    const ownerProfilesPromise = getUserProfiles(
      rows.map((row) => row.recording.ownerEmail),
    );

    const tagRowsPromise = ids.length
      ? db
          .select()
          .from(schema.recordingTags)
          .where(inArray(schema.recordingTags.recordingId, ids))
      : Promise.resolve([]);
    const viewRowsPromise = ids.length
      ? Promise.all([
          db
            .select({
              recordingId: schema.recordingViewers.recordingId,
              count: sql<number>`COUNT(1)`,
            })
            .from(schema.recordingViewers)
            .where(
              and(
                inArray(schema.recordingViewers.recordingId, ids),
                countedViewCondition(),
              ),
            )
            .groupBy(schema.recordingViewers.recordingId),
          db
            .select({
              recordingId: schema.recordingViews.recordingId,
              count: sql<number>`COUNT(1)`,
            })
            .from(schema.recordingViews)
            .where(inArray(schema.recordingViews.recordingId, ids))
            .groupBy(schema.recordingViews.recordingId),
          db
            .select({
              recordingId: schema.recordingAgentViews.recordingId,
              count: sql<number>`COUNT(1)`,
            })
            .from(schema.recordingAgentViews)
            .where(inArray(schema.recordingAgentViews.recordingId, ids))
            .groupBy(schema.recordingAgentViews.recordingId),
        ])
      : Promise.resolve(null);
    const [ownerProfiles, tagRows, viewRows] = await Promise.all([
      ownerProfilesPromise,
      tagRowsPromise,
      viewRowsPromise,
    ]);

    const tagsByRec: Record<string, string[]> = {};
    for (const t of tagRows) {
      tagsByRec[t.recordingId] ??= [];
      tagsByRec[t.recordingId].push(t.tag);
    }

    let viewsByRec: Record<string, number> = {};
    let agentViewsByRec: Record<string, number> = {};
    if (viewRows) {
      const [countedViewerRows, viewLogRows, agentViewRows] = viewRows;
      viewsByRec = mergeViewCounts(countedViewerRows, viewLogRows);
      agentViewsByRec = Object.fromEntries(
        agentViewRows.map((r) => [r.recordingId, Number(r.count ?? 0)]),
      );
    }

    const recordings = rows.map((row) => {
      const r = row.recording;
      const edits = parseEdits(r.editsJson);
      return {
        id: r.id,
        title: r.title,
        titleSource: r.titleSource,
        sourceAppName: r.sourceAppName,
        sourceWindowTitle: r.sourceWindowTitle,
        description: r.description,
        thumbnailUrl: resolvePlayerThumbnailUrl(r),
        animatedThumbnailUrl: r.animatedThumbnailUrl
          ? resolvePlayerThumbnailUrl(r, { animated: true })
          : null,
        durationMs: r.durationMs,
        effectiveDurationMs: effectiveDuration(r.durationMs, edits),
        status: r.status,
        uploadProgress: r.uploadProgress,
        failureReason: r.failureReason,
        visibility: r.visibility,
        hasPassword: Number(r.hasPassword ?? 0) > 0,
        expiresAt: r.expiresAt,
        ownerEmail: r.ownerEmail,
        ownerName: profileNameFor(r.ownerEmail, null, ownerProfiles),
        folderId: r.folderId,
        spaceIds: parseSpaceIds(r.spaceIds),
        tags: tagsByRec[r.id] ?? [],
        pendingRedactions: parseRedactions(edits.overlays).length,
        viewCount: viewsByRec[r.id] ?? 0,
        agentViewCount: agentViewsByRec[r.id] ?? 0,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        archivedAt: r.archivedAt,
        trashedAt: r.trashedAt,
        hasAudio: Boolean(r.hasAudio),
        hasCamera: Boolean(r.hasCamera),
        width: r.width,
        height: r.height,
        ...resolveListRecordingMedia(r, args.includeMedia),
        transcriptStatus: row.transcriptStatus ?? null,
        transcriptHasText: Number(row.transcriptHasText ?? 0) > 0,
      };
    });

    return { recordings };
  },
});
