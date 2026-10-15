import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { findActiveRecordingContextItem } from "../server/lib/recording-context.js";
import { nanoid } from "../server/lib/recordings.js";
import {
  SCREEN_HISTORY_KIND,
  SCREEN_HISTORY_MAX_SECONDS,
  SCREEN_HISTORY_MIN_SECONDS,
  screenHistoryWindowBefore,
} from "../shared/screen-history-context.js";

// The Clip row is created before native setup and the recording countdown.
const MAX_STARTUP_DELAY_MS = 10 * 60 * 1000;
const CLIENT_CLOCK_SKEW_TOLERANCE_MS = 120 * 1000;

export default defineAction({
  description:
    "Ask for the last N seconds of screen history before an owned Clip started. The context is saved as passive metadata that never changes the Clip's video, and it is shared with the Clip under the Clip's own share rules. Returns the existing active item when there is one.",
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
      .describe(
        "When capture started, as an ISO timestamp. May be up to 10 minutes after the Clip row is created for native setup, or 120 seconds before it for client clock skew.",
      ),
    deviceId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "The desktop device that captured the Clip. Only that device's queue will export the footage.",
      ),
  }),
  run: async ({ recordingId, seconds, endedAt, deviceId }) => {
    await assertAccess("recording", recordingId, "owner");

    const [recording] = await getDb()
      .select({ createdAt: schema.recordings.createdAt })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, recordingId));
    if (!recording) {
      fail("This Clip is unavailable.", {
        errorCode: "recording_unavailable",
        statusCode: 404,
      });
    }
    const startOffsetMs = Date.parse(endedAt) - Date.parse(recording.createdAt);
    if (
      !Number.isFinite(startOffsetMs) ||
      startOffsetMs < -CLIENT_CLOCK_SKEW_TOLERANCE_MS ||
      startOffsetMs > MAX_STARTUP_DELAY_MS
    ) {
      fail(
        "The requested screen history must end between 2 minutes before and 10 minutes after this Clip was created.",
        {
          errorCode: "recording_context_invalid_window",
          statusCode: 400,
        },
      );
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
        capturedDeviceId: deviceId ?? null,
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
