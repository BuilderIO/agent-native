import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { recordingTrackingSource } from "../server/lib/recording-failures.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Move a recording to trash. Soft-delete — use restore-recording to undo, or delete-recording-permanent to remove forever.",
  schema: z.object({
    id: z.string().describe("Recording ID"),
    skipIfReady: z
      .boolean()
      .optional()
      .describe(
        "When true, don't trash a recording whose upload already finished (status is 'ready') — used to close a cancel-vs-finalize race atomically.",
      ),
  }),
  run: async (args) => {
    await assertAccess("recording", args.id, "editor");

    const db = getDb();

    const [existing] = await db
      .select({
        id: schema.recordings.id,
        recordingPlatform: schema.recordings.recordingPlatform,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.id));
    if (!existing) throw new Error(`Recording not found: ${args.id}`);

    const now = new Date().toISOString();
    const notReady = ne(schema.recordings.status, "ready");
    // Only the call that moves the row into the trash claims it, so two
    // overlapping requests cannot both report the same discard.
    const claimed = await db
      .update(schema.recordings)
      .set({ trashedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.recordings.id, args.id),
          isNull(schema.recordings.trashedAt),
          ...(args.skipIfReady ? [notReady] : []),
        ),
      )
      .returning({ status: schema.recordings.status });
    if (claimed.length === 0) {
      // Re-trashing an already-trashed row refreshes its timestamp, as before.
      await db
        .update(schema.recordings)
        .set({ trashedAt: now, updatedAt: now })
        .where(
          args.skipIfReady
            ? and(eq(schema.recordings.id, args.id), notReady)
            : eq(schema.recordings.id, args.id),
        );
    }

    const [after] = await db
      .select({
        status: schema.recordings.status,
        trashedAt: schema.recordings.trashedAt,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.id));

    const trashedAt = after?.trashedAt ?? null;
    const skipped = Boolean(args.skipIfReady) && !trashedAt;

    // Closes the funnel for a row still in flight (a recorder dropping a row
    // it opened, or a user trashing a stuck upload). Ready and failed rows
    // already closed with recording_ready / recording_failed.
    const discardedStatus = claimed[0]?.status;
    if (discardedStatus === "uploading" || discardedStatus === "processing") {
      try {
        track(
          "recording_discarded",
          {
            app_name: "clips",
            template_name: "clips",
            output_id: args.id,
            output_type: "clip",
            recording_platform: existing.recordingPlatform ?? "unknown",
            status_at_discard: discardedStatus,
          },
          recordingTrackingSource(getCurrentOwnerEmail()),
        );
      } catch (err) {
        console.warn(
          "[trash-recording] recording_discarded track failed:",
          err,
        );
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(
      skipped
        ? `Skipped trashing recording ${args.id} — already ready`
        : `Trashed recording ${args.id}`,
    );
    return { id: args.id, trashedAt, skipped };
  },
});
