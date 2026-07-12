/**
 * Permanently delete a recording and all related rows.
 *
 * Usage:
 *   pnpm action delete-recording-permanent --id=<id>
 */

import { defineAction } from "@agent-native/core";
import {
  writeAppState,
  deleteAppState,
  deleteAppStateByPrefix,
} from "@agent-native/core/application-state";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  deleteRecordingMediaObjects,
  recordingMediaUrls,
} from "../server/lib/recording-media-cleanup.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";

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
        })
        .from(schema.recordings)
        .where(
          and(
            ne(schema.recordings.id, args.id),
            or(
              inArray(schema.recordings.videoUrl, mediaUrls),
              inArray(schema.recordings.thumbnailUrl, mediaUrls),
              inArray(schema.recordings.animatedThumbnailUrl, mediaUrls),
            ),
          ),
        );
      for (const reference of mediaReferences) {
        for (const url of recordingMediaUrls(reference)) {
          if (mediaUrls.includes(url)) protectedUrls.add(url);
        }
      }
    }

    await db.transaction(async (tx) => {
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
      protectedUrls,
    });

    // Clean up any lingering application state for this recording.
    await deleteAppStateByPrefix(`recording-chunks-${args.id}-`);
    await deleteAppState(`recording-upload-${args.id}`);
    await deleteAppState(`recording-compression-${args.id}`);
    await deleteAppState(`recording-blob-${args.id}`);
    await deleteAppState(`agent-task-recording-${args.id}`);

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Permanently deleted recording "${existing.title}" (${args.id})`,
    );
    return { success: true, id: args.id, mediaCleanup };
  },
});
