/**
 * Permanently delete a recording and all related rows.
 *
 * Usage:
 *   pnpm action delete-recording-permanent --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import {
  writeAppState,
  deleteAppState,
  deleteAppStateByPrefix,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Permanently delete a recording and every related row (comments, reactions, viewers, events, transcript, tags, CTAs, shares). This cannot be undone.",
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
          eq(schema.recordings.ownerEmail, ownerEmail),
        ),
      );
    if (!existing) throw new Error(`Recording not found: ${args.id}`);

    // Cascade delete every related row.
    await db
      .delete(schema.recordingComments)
      .where(eq(schema.recordingComments.recordingId, args.id));
    await db
      .delete(schema.recordingReactions)
      .where(eq(schema.recordingReactions.recordingId, args.id));
    await db
      .delete(schema.recordingViewers)
      .where(eq(schema.recordingViewers.recordingId, args.id));
    await db
      .delete(schema.recordingEvents)
      .where(eq(schema.recordingEvents.recordingId, args.id));
    await db
      .delete(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.id));
    await db
      .delete(schema.recordingTags)
      .where(eq(schema.recordingTags.recordingId, args.id));
    await db
      .delete(schema.recordingCtas)
      .where(eq(schema.recordingCtas.recordingId, args.id));
    await db
      .delete(schema.recordingShares)
      .where(eq(schema.recordingShares.resourceId, args.id));
    await db.delete(schema.recordings).where(eq(schema.recordings.id, args.id));

    // Clean up any lingering application state for this recording.
    await deleteAppStateByPrefix(`recording-chunks-${args.id}-`);
    await deleteAppState(`recording-upload-${args.id}`);
    await deleteAppState(`recording-blob-${args.id}`);
    await deleteAppState(`agent-task-recording-${args.id}`);

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Permanently deleted recording "${existing.title}" (${args.id})`,
    );
    return { success: true, id: args.id };
  },
});
