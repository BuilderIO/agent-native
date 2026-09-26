/**
 * Permanently delete a recording and all related rows.
 *
 * Usage:
 *   pnpm action delete-recording-permanent --id=<id>
 */

import { defineAction } from "@agent-native/core/action";
import {
  writeAppState,
  deleteAppState,
  deleteAppStateByPrefix,
} from "@agent-native/core/application-state";
import { isImageRecording } from "@shared/recording-kind";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { countPendingRedactions } from "../server/lib/pending-redactions.js";
import {
  deleteRecordingMediaObjects,
  deleteStoredMediaUrl,
  recordingMediaUrls,
} from "../server/lib/recording-media-cleanup.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
import {
  screenshotLeftoverUrls,
  withDeleteClaim,
} from "../server/lib/screenshot-edits.js";

export default defineAction({
  description:
    "Permanently delete a recording and every related row (comments, reactions, viewers, events, transcript, tags, CTAs, shares, diagnostics, bug reports). This cannot be undone.",
  schema: z.object({
    id: z.string().describe("Recording ID"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const [existing] = await db
      .select()
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, args.id),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        ),
      );
    if (!existing) throw new Error(`Recording not found: ${args.id}`);

    const mediaUrls = recordingMediaUrls(existing);
    const protectedUrls = new Set<string>();
    if (mediaUrls.length > 0) {
      const mediaReferences = await db
        .select({
          videoUrl: schema.recordings.videoUrl,
          thumbnailUrl: schema.recordings.thumbnailUrl,
          animatedThumbnailUrl: schema.recordings.animatedThumbnailUrl,
          imageUrl: schema.recordings.imageUrl,
          baseImageUrl: schema.recordings.baseImageUrl,
        })
        .from(schema.recordings)
        .where(
          and(
            ne(schema.recordings.id, args.id),
            or(
              inArray(schema.recordings.videoUrl, mediaUrls),
              inArray(schema.recordings.thumbnailUrl, mediaUrls),
              inArray(schema.recordings.animatedThumbnailUrl, mediaUrls),
              inArray(schema.recordings.imageUrl, mediaUrls),
              inArray(schema.recordings.baseImageUrl, mediaUrls),
            ),
          ),
        );
      for (const reference of mediaReferences) {
        for (const url of recordingMediaUrls(reference)) {
          if (mediaUrls.includes(url)) protectedUrls.add(url);
        }
      }
    }

    // Some of a screenshot's files are unredacted: its leftovers, and its
    // base while boxes are still pending. The row is the only record of them,
    // so they go first, and the row stays — with its hold and a way to retry
    // — if any is still in storage. Everything else is already redacted and
    // is cleaned up best-effort, as for a video.
    //
    // Before any of that, the row is claimed: a save compares against the
    // row it read, so changing it here makes every save in flight fail
    // rather than land between these deletes and the row's removal.
    const alreadyDeleted = new Set<string>();
    let claimedEditsJson: string | null = null;
    if (isImageRecording(existing)) {
      claimedEditsJson = withDeleteClaim(
        existing.editsJson,
        new Date().toISOString(),
      );
      if (!claimedEditsJson) {
        throw new Error(
          "This screenshot's saved edits could not be read, so the files it replaced cannot be found to delete. Nothing was deleted.",
        );
      }
      const claimed = await db
        .update(schema.recordings)
        .set({
          editsJson: claimedEditsJson,
          mediaUpdatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.recordings.id, args.id),
            existing.editsJson == null
              ? isNull(schema.recordings.editsJson)
              : eq(schema.recordings.editsJson, existing.editsJson),
            eq(schema.recordings.mediaUpdatedAt, existing.mediaUpdatedAt),
          ),
        )
        .returning({ id: schema.recordings.id });
      if (!claimed.length) {
        throw new Error(
          "This screenshot changed while it was being deleted. Nothing was deleted — try again.",
        );
      }

      const unredacted = [
        ...(screenshotLeftoverUrls(existing.editsJson) ?? []),
        ...(existing.baseImageUrl && countPendingRedactions(existing.editsJson)
          ? [existing.baseImageUrl]
          : []),
      ];
      for (const url of new Set(unredacted)) {
        if (protectedUrls.has(url)) continue;
        let gone = false;
        try {
          gone = await deleteStoredMediaUrl(url);
        } catch (err) {
          console.warn(
            `[delete-recording-permanent] could not delete an unredacted file for ${args.id}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
        if (!gone) {
          // Give the row back so it can be edited or deleted again. What is
          // already gone was a leftover nothing points at, or the base of
          // boxes the next delete will retry.
          await db
            .update(schema.recordings)
            .set({ editsJson: existing.editsJson })
            .where(
              and(
                eq(schema.recordings.id, args.id),
                eq(schema.recordings.editsJson, claimedEditsJson),
              ),
            );
          throw new Error(
            "An unredacted copy of this screenshot could not be deleted from storage, so the screenshot was kept. Try again later.",
          );
        }
        alreadyDeleted.add(url);
      }
    }

    await db.transaction(async (tx) => {
      // The claim is what keeps saves out; a row without it was changed by
      // something that does not honour it, and is left for the next try.
      if (claimedEditsJson) {
        const [current] = await tx
          .select({ editsJson: schema.recordings.editsJson })
          .from(schema.recordings)
          .where(eq(schema.recordings.id, args.id));
        if (!current || current.editsJson !== claimedEditsJson) {
          throw new Error(
            "This screenshot changed while it was being deleted. Nothing more was deleted — try again.",
          );
        }
      }
      // Cascade delete every related row before deleting remote objects. If any
      // DB delete fails, the transaction rolls back and provider media stays put.
      await tx
        .delete(schema.recordingComments)
        .where(eq(schema.recordingComments.recordingId, args.id));
      await tx
        .delete(schema.recordingReactions)
        .where(eq(schema.recordingReactions.recordingId, args.id));
      await tx
        .delete(schema.recordingViews)
        .where(eq(schema.recordingViews.recordingId, args.id));
      await tx
        .delete(schema.recordingPlaybackPositions)
        .where(eq(schema.recordingPlaybackPositions.recordingId, args.id));
      await tx
        .delete(schema.recordingViewers)
        .where(eq(schema.recordingViewers.recordingId, args.id));
      await tx
        .delete(schema.recordingEvents)
        .where(eq(schema.recordingEvents.recordingId, args.id));
      await tx
        .delete(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, args.id));
      await tx
        .delete(schema.recordingBrowserDiagnostics)
        .where(eq(schema.recordingBrowserDiagnostics.recordingId, args.id));
      await tx
        .delete(schema.recordingBugReports)
        .where(eq(schema.recordingBugReports.recordingId, args.id));
      await tx
        .delete(schema.recordingTags)
        .where(eq(schema.recordingTags.recordingId, args.id));
      await tx
        .delete(schema.recordingCtas)
        .where(eq(schema.recordingCtas.recordingId, args.id));
      await tx
        .delete(schema.recordingShares)
        .where(eq(schema.recordingShares.resourceId, args.id));
      await tx
        .delete(schema.recordings)
        .where(eq(schema.recordings.id, args.id));
    });

    const mediaCleanup = await deleteRecordingMediaObjects(existing, {
      protectedUrls: new Set([...protectedUrls, ...alreadyDeleted]),
    });

    // Clean up any lingering application state for this recording.
    await deleteAppStateByPrefix(`recording-chunks-${args.id}-`);
    await deleteAppState(`recording-upload-${args.id}`);
    await deleteAppState(`recording-compression-${args.id}`);
    await deleteAppState(`recording-blob-${args.id}`);
    await deleteAppState(`recording-thumbnail-asset-${args.id}`);
    await deleteAppState(`recording-thumbnail-lease-${args.id}`);
    await deleteAppState(`agent-task-recording-${args.id}`);

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Permanently deleted recording "${existing.title}" (${args.id})`,
    );
    return { success: true, id: args.id, mediaCleanup };
  },
});
