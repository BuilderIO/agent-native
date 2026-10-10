import { fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, ne } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

// The desktop names its private Rewind footage recordings with this source app
// name when it creates them (desktop/src/lib/recorder.ts). Nothing else in the
// app sets it, and ordinary captures carry the captured app's name, so this is
// what tells footage apart from an ordinary Clip. Keep the two literals in step.
export const SCREEN_HISTORY_FOOTAGE_SOURCE_APP_NAME = "Clips Rewind";

// A 'processing' claim is abandoned when its worker quit mid-export. A 5-minute
// window should export well inside 10 minutes, so an older claim is presumed
// dead and another worker may re-claim it.
export const STALE_PROCESSING_MS = 10 * 60 * 1000;

// updated_at is TEXT, so this is a string comparison. Every writer must store
// toISOString(); a database-default timestamp sorts wrongly against this cutoff.
export function staleProcessingCutoff(): string {
  return new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
}

export type RecordingContextItem =
  typeof schema.recordingContextItems.$inferSelect;

export async function findRecordingContextItem(
  id: string,
): Promise<RecordingContextItem | undefined> {
  const [item] = await getDb()
    .select()
    .from(schema.recordingContextItems)
    .where(eq(schema.recordingContextItems.id, id))
    .limit(1);
  return item;
}

export async function findActiveRecordingContextItem(
  recordingId: string,
): Promise<RecordingContextItem | undefined> {
  const [item] = await getDb()
    .select()
    .from(schema.recordingContextItems)
    .where(
      and(
        eq(schema.recordingContextItems.recordingId, recordingId),
        ne(schema.recordingContextItems.status, "removed"),
      ),
    )
    .limit(1);
  return item;
}

export async function loadOwnedRecordingContextItem(
  id: string,
): Promise<RecordingContextItem> {
  const item = await findRecordingContextItem(id);
  if (!item) {
    fail("This screen history context was not found.", {
      errorCode: "recording_context_not_found",
      statusCode: 404,
    });
  }
  await assertAccess("recording", item.recordingId, "owner");
  return item;
}
