import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  recordingIdsField,
  requestedRecordingIds,
} from "../server/lib/recording-batch.js";
import { mediaCleanupSummary } from "../server/lib/recording-media-cleanup-worker.js";
import { recordingMediaUrls } from "../server/lib/recording-media-cleanup.js";
import { captureRecordingMediaCleanup } from "../server/lib/recording-media-lifecycle.js";
import { captureMediaCleanupScope } from "../server/lib/recording-media-provider.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
import {
  mediaCleanupSummarySchema,
  type MediaCleanupSummary,
} from "../shared/media-cleanup.js";

const deletedSchema = z.object({
  success: z.boolean(),
  id: z.string(),
  recordingRemoved: z.literal(true),
  mediaCleanup: mediaCleanupSummarySchema,
});

const batchSchema = z.object({
  results: z.array(
    z.union([
      deletedSchema.extend({ status: z.enum(["changed", "unchanged"]) }),
      // Deleted, but the cleanup state written with it couldn't be read back.
      z.object({
        id: z.string(),
        status: z.enum(["changed", "unchanged"]),
        recordingRemoved: z.literal(true),
        mediaCleanup: z.null(),
        reason: z.string(),
      }),
      z.object({
        id: z.string(),
        status: z.literal("skipped"),
        reason: z.string(),
      }),
    ]),
  ),
  changed: z.number(),
  unchanged: z.number(),
  skipped: z.number(),
});

/**
 * Throws, naming each one, unless every recording is the caller's own or was
 * already deleted, so a batch never deletes some and then stops on one it
 * can't.
 */
async function assertRecordingsDeletable(ids: string[], ownerEmail: string) {
  const owned = await getDb()
    .select({ id: schema.recordings.id })
    .from(schema.recordings)
    .where(
      and(
        inArray(schema.recordings.id, ids),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );
  const ownedIds = new Set(owned.map((row) => row.id));
  const missing: string[] = [];
  for (const id of ids) {
    if (ownedIds.has(id)) continue;
    if (!(await mediaCleanupSummary(id, ownerEmail))) missing.push(id);
  }
  if (missing.length) {
    fail(
      `Nothing was deleted: ${missing.length} of ${ids.length} recordings don't exist or aren't yours: ${missing.join(", ")}`,
      { errorCode: "recording_not_found", statusCode: 404 },
    );
  }
}

function deletedResult(
  id: string,
  mediaCleanup: MediaCleanupSummary,
): z.infer<typeof deletedSchema> {
  return {
    success: mediaCleanup.status === "complete",
    id,
    recordingRemoved: true as const,
    mediaCleanup,
  };
}

/**
 * Deletes one owned recording. `alreadyDeleted` means another call did,
 * earlier or while this one waited.
 * A null `mediaCleanup` means the recording is gone but its cleanup state
 * couldn't be read back after the delete committed.
 */
async function deleteOne(
  id: string,
  ownerEmail: string,
): Promise<{
  mediaCleanup: MediaCleanupSummary | null;
  alreadyDeleted: boolean;
}> {
  const db = getDb();
  const previous = await mediaCleanupSummary(id, ownerEmail);
  if (previous) return { alreadyDeleted: true, mediaCleanup: previous };
  const initialRows = await db
    .select()
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, id),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    )
    .limit(1);
  const initial = initialRows.length ? initialRows[0] : null;
  const scope = initial
    ? await captureMediaCleanupScope({
        ownerEmail,
        orgId: initial.orgId ?? initial.organizationId,
        storageMode: initial.storageMode,
        urls: recordingMediaUrls(initial),
      })
    : {};
  // False when another call deleted it first, while this one waited.
  const deletedHere = await db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, id),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        ),
      )
      .for("update")
      .limit(1);
    const recording = locked.length ? locked[0] : null;
    if (!recording) {
      const existingIntent = await tx
        .select({ id: schema.recordingMediaCleanups.id })
        .from(schema.recordingMediaCleanups)
        .where(
          and(
            eq(schema.recordingMediaCleanups.id, id),
            eq(schema.recordingMediaCleanups.ownerEmail, ownerEmail),
          ),
        )
        .limit(1);
      if (existingIntent.length) return false;
      fail("Recording not found", {
        errorCode: "recording_not_found",
        statusCode: 404,
      });
    }
    const context = await tx
      .select({
        mediaId: schema.recordingContextItems.mediaRecordingId,
        pendingMediaId: schema.recordingContextItems.pendingMediaRecordingId,
      })
      .from(schema.recordingContextItems)
      .where(eq(schema.recordingContextItems.recordingId, id));
    const footageIds = [
      ...new Set(
        context
          .flatMap((item) => [item.mediaId, item.pendingMediaId])
          .filter((value): value is string => Boolean(value) && value !== id),
      ),
    ];
    await captureRecordingMediaCleanup(tx, recording, footageIds, scope);
    if (footageIds.length)
      await tx
        .update(schema.recordings)
        .set({
          trashedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            inArray(schema.recordings.id, footageIds),
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          ),
        );
    await tx
      .delete(schema.recordingComments)
      .where(eq(schema.recordingComments.recordingId, id));
    await tx
      .delete(schema.recordingReactions)
      .where(eq(schema.recordingReactions.recordingId, id));
    await tx
      .delete(schema.recordingViews)
      .where(eq(schema.recordingViews.recordingId, id));
    await tx
      .delete(schema.recordingAgentViews)
      .where(eq(schema.recordingAgentViews.recordingId, id));
    await tx
      .delete(schema.recordingPlaybackPositions)
      .where(eq(schema.recordingPlaybackPositions.recordingId, id));
    await tx
      .delete(schema.recordingViewers)
      .where(eq(schema.recordingViewers.recordingId, id));
    await tx
      .delete(schema.recordingEvents)
      .where(eq(schema.recordingEvents.recordingId, id));
    await tx
      .delete(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, id));
    await tx
      .delete(schema.recordingTranscriptVersions)
      .where(eq(schema.recordingTranscriptVersions.recordingId, id));
    await tx
      .delete(schema.recordingBrowserDiagnostics)
      .where(eq(schema.recordingBrowserDiagnostics.recordingId, id));
    await tx
      .delete(schema.recordingBugReports)
      .where(eq(schema.recordingBugReports.recordingId, id));
    await tx
      .delete(schema.recordingTags)
      .where(eq(schema.recordingTags.recordingId, id));
    await tx
      .delete(schema.recordingCtas)
      .where(eq(schema.recordingCtas.recordingId, id));
    await tx
      .delete(schema.recordingShares)
      .where(eq(schema.recordingShares.resourceId, id));
    await tx
      .delete(schema.recordingContextItems)
      .where(eq(schema.recordingContextItems.recordingId, id));
    await tx
      .delete(schema.recordingContentBindings)
      .where(eq(schema.recordingContentBindings.recordingId, id));
    await tx.delete(schema.recordings).where(eq(schema.recordings.id, id));
    return true;
  });
  return {
    alreadyDeleted: !deletedHere,
    mediaCleanup: await mediaCleanupSummary(id, ownerEmail),
  };
}

export default defineAction({
  description:
    "Permanently remove one or more owned recordings and their access rows, atomically retaining a durable media cleanup intent for each. Returns recordingRemoved separately from mediaCleanup: pending or blocked does not mean stored media is gone. Context footage moves to Trash. Repeating the call returns the retained cleanup state. With ids, every recording must be yours (or already deleted) before any is deleted.",
  schema: z
    .object({
      id: z.string().min(1).optional().describe("Recording ID"),
      ids: recordingIdsField("delete permanently").optional(),
    })
    .refine((args) => Boolean(args.id) || Boolean(args.ids), {
      message: "Provide id or ids.",
    }),
  outputSchema: z.union([deletedSchema, batchSchema]),
  run: async (args) => {
    const ownerEmail = getCurrentOwnerEmail();
    const ids = requestedRecordingIds(args.id, args.ids);
    if (!args.ids) {
      const id = ids[0];
      const { mediaCleanup, alreadyDeleted } = await deleteOne(id, ownerEmail);
      if (!alreadyDeleted) {
        await writeAppState("refresh-signal", { ts: Date.now() });
      }
      if (!mediaCleanup)
        fail("Recording cleanup could not be read", {
          errorCode: "media_cleanup_unavailable",
          statusCode: 503,
        });
      return deletedResult(id, mediaCleanup);
    }

    await assertRecordingsDeletable(ids, ownerEmail);
    const results: z.infer<typeof batchSchema>["results"] = [];
    for (const id of ids) {
      try {
        const { mediaCleanup, alreadyDeleted } = await deleteOne(
          id,
          ownerEmail,
        );
        results.push(
          mediaCleanup
            ? {
                ...deletedResult(id, mediaCleanup),
                status: alreadyDeleted ? "unchanged" : "changed",
              }
            : {
                id,
                status: alreadyDeleted ? "unchanged" : "changed",
                recordingRemoved: true,
                mediaCleanup: null,
                reason: `${alreadyDeleted ? "Already deleted" : "Deleted"}, but its media cleanup state couldn't be read. Call again with this id to read it.`,
              },
        );
      } catch (error) {
        results.push({
          id,
          status: "skipped",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const changed = results.filter((r) => r.status === "changed").length;
    if (changed) await writeAppState("refresh-signal", { ts: Date.now() });
    return {
      results,
      changed,
      unchanged: results.filter((r) => r.status === "unchanged").length,
      skipped: results.filter((r) => r.status === "skipped").length,
    };
  },
});
