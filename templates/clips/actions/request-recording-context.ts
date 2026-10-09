import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { isPrivateClip } from "../app/lib/rewind-visibility.js";
import { getDb, schema } from "../server/db/index.js";
import { findActiveRecordingContextItem } from "../server/lib/recording-context.js";
import { nanoid } from "../server/lib/recordings.js";
import {
  SCREEN_HISTORY_KIND,
  SCREEN_HISTORY_MAX_SECONDS,
  SCREEN_HISTORY_MIN_SECONDS,
  screenHistoryWindowBefore,
} from "../shared/screen-history-context.js";
import makeRecordingPrivateForRewind, {
  assertNoDirectRecordingShares,
} from "./make-recording-private-for-rewind.js";

export default defineAction({
  description:
    "Ask for the last N seconds of screen history before an owned Clip started. The Clip becomes private, and the context is saved as passive metadata that never changes the Clip's video. Returns the existing active item when there is one.",
  schema: z.object({
    recordingId: z.string(),
    seconds: z
      .number()
      .int()
      .min(SCREEN_HISTORY_MIN_SECONDS)
      .max(SCREEN_HISTORY_MAX_SECONDS),
    endedAt: z
      .string()
      .datetime({ offset: true })
      .describe("When the recording started, as an ISO timestamp."),
  }),
  run: async ({ recordingId, seconds, endedAt }) => {
    await assertAccess("recording", recordingId, "owner");

    const [recording] = await getDb()
      .select({ visibility: schema.recordings.visibility })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, recordingId));
    if (!recording) {
      fail("This Clip is unavailable.", {
        errorCode: "recording_unavailable",
        statusCode: 404,
      });
    }
    if (isPrivateClip(recording.visibility)) {
      await assertNoDirectRecordingShares(recordingId);
    } else {
      await makeRecordingPrivateForRewind.run({ recordingId });
    }

    const active = await findActiveRecordingContextItem(recordingId);
    if (active) return active;

    // The original window is the widest allowed, so a later trim can reach any
    // part of the last 5 minutes. The current window is what was requested.
    const original = screenHistoryWindowBefore(
      endedAt,
      SCREEN_HISTORY_MAX_SECONDS,
    );
    const window = screenHistoryWindowBefore(endedAt, seconds);
    const now = new Date().toISOString();
    const [inserted] = await getDb()
      .insert(schema.recordingContextItems)
      .values({
        id: nanoid(),
        recordingId,
        kind: SCREEN_HISTORY_KIND,
        requestedSeconds: seconds,
        originalStartedAt: original.startedAt,
        originalEndedAt: original.endedAt,
        startedAt: window.startedAt,
        endedAt: window.endedAt,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted;

    // A conflict here can only come from the partial unique index, so the
    // winner is already committed and visible to this read.
    const winner = await findActiveRecordingContextItem(recordingId);
    if (!winner) {
      // guard:allow-bare-error — invariant: the insert conflicted only with a committed active item.
      throw new Error("Screen history request lost its active item.");
    }
    return winner;
  },
});
