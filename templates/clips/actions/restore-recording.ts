import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { isImageRecording } from "@shared/recording-kind";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { recordingTrackingSource } from "../server/lib/recording-failures.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { hasDeleteClaim } from "../server/lib/screenshot-edits.js";

export default defineAction({
  description: "Restore a recording from archive or trash back to the library.",
  schema: z.object({
    id: z.string().describe("Recording ID"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.id, "editor");

    const db = getDb();

    const [existing] = await db
      .select({
        id: schema.recordings.id,
        kind: schema.recordings.kind,
        editsJson: schema.recordings.editsJson,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.id));
    if (!existing) throw new Error(`Recording not found: ${args.id}`);
    // A permanent delete has claimed this screenshot: it is running, or it
    // stopped part-way and some files — possibly the base still under
    // pending boxes — are gone. Either way it cannot come back whole.
    if (hasDeleteClaim(existing.editsJson)) {
      throw new Error(
        "This screenshot was partly deleted and cannot be restored. Delete it again to finish.",
      );
    }

    const now = new Date().toISOString();
    // Pinned to the unclaimed edits just read: a delete that claims the
    // screenshot in between must win, or a delete that then stops part-way
    // would put it back in the library without its base.
    const thisRow = isImageRecording(existing)
      ? and(
          eq(schema.recordings.id, args.id),
          eq(schema.recordings.editsJson, existing.editsJson),
        )
      : eq(schema.recordings.id, args.id);
    // Only the call that takes the row out of the trash claims it, so a
    // restore is reported once even when requests overlap.
    const untrashed = await db
      .update(schema.recordings)
      .set({ archivedAt: null, trashedAt: null, updatedAt: now })
      .where(and(thisRow, isNotNull(schema.recordings.trashedAt)))
      .returning({
        status: schema.recordings.status,
        recordingPlatform: schema.recordings.recordingPlatform,
      });
    const restored = untrashed.length
      ? untrashed
      : await db
          .update(schema.recordings)
          .set({ archivedAt: null, trashedAt: null, updatedAt: now })
          .where(thisRow)
          .returning({ id: schema.recordings.id });
    if (!restored.length) {
      throw new Error(
        "This screenshot changed while it was being restored. Nothing was restored — try again.",
      );
    }

    // A row still in flight was reported as recording_discarded when it was
    // trashed; this reopens it, so BI does not count it as closed.
    const reopened = untrashed[0];
    if (reopened?.status === "uploading" || reopened?.status === "processing") {
      try {
        track(
          "recording_restored",
          {
            app_name: "clips",
            template_name: "clips",
            output_id: args.id,
            output_type: "clip",
            recording_platform: reopened.recordingPlatform ?? "unknown",
            status_at_restore: reopened.status,
          },
          recordingTrackingSource(getCurrentOwnerEmail()),
        );
      } catch (err) {
        console.warn(
          "[restore-recording] recording_restored track failed:",
          err,
        );
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Restored recording ${args.id}`);
    return { id: args.id };
  },
});
