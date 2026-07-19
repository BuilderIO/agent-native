import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export const DIRECT_SHARE_REWIND_ERROR =
  "This Clip is still shared directly with other people. Remove their access in Share before adding local Rewind history.";

export async function assertNoDirectRecordingShares(
  recordingId: string,
): Promise<void> {
  const [share] = await getDb()
    .select({ id: schema.recordingShares.id })
    .from(schema.recordingShares)
    .where(eq(schema.recordingShares.resourceId, recordingId))
    .limit(1);
  if (share) throw new Error(DIRECT_SHARE_REWIND_ERROR);
}

export default defineAction({
  description:
    "Make an owned recording private for a Rewind extension, refusing to continue while anyone still has direct access.",
  schema: z.object({ recordingId: z.string() }),
  run: async ({ recordingId }) => {
    await assertAccess("recording", recordingId, "owner");
    await assertNoDirectRecordingShares(recordingId);

    const now = new Date().toISOString();
    const [recording] = await getDb()
      .update(schema.recordings)
      .set({ visibility: "private", updatedAt: now })
      .where(eq(schema.recordings.id, recordingId))
      .returning({ id: schema.recordings.id });
    if (!recording) throw new Error("This Clip is unavailable.");

    return { recordingId, visibility: "private" as const };
  },
});
