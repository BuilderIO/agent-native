import {
  deletePrivateBlob,
  isPrivateBlobError,
  type PrivateBlobFailureKind,
  type PrivateBlobHandle,
  readPrivateBlob,
} from "@agent-native/core/private-blob";
import { eq } from "drizzle-orm";

import {
  type AppActivity,
  type AppActivitySummary,
  parseAppActivitySummary,
} from "../../shared/app-activity.js";
import { getDb, schema } from "../db/index.js";

export const APP_ACTIVITY_BLOB_PURPOSE = "clips-app-activity";

export type RecordingAppActivityResult =
  | { status: "none" }
  | { status: "ok"; summary: AppActivitySummary; activity: AppActivity }
  | {
      status: "unavailable";
      summary: AppActivitySummary;
      reason: Exclude<PrivateBlobFailureKind, "corrupt">;
    };

// Callers check access to the recording first.
export async function loadRecordingAppActivity(
  recordingId: string,
): Promise<RecordingAppActivityResult> {
  const [row] = await getDb()
    .select({
      summaryJson: schema.recordingBrowserDiagnostics.appActivitySummaryJson,
      blobJson: schema.recordingBrowserDiagnostics.appActivityBlobJson,
    })
    .from(schema.recordingBrowserDiagnostics)
    .where(eq(schema.recordingBrowserDiagnostics.recordingId, recordingId))
    .limit(1);
  const summary = parseAppActivitySummary(row?.summaryJson);
  if (!summary || !row?.blobJson) return { status: "none" };
  try {
    const { data } = await readPrivateBlob(
      JSON.parse(row.blobJson) as PrivateBlobHandle,
    );
    return {
      status: "ok",
      summary,
      activity: JSON.parse(new TextDecoder().decode(data)) as AppActivity,
    };
  } catch (error) {
    if (!isPrivateBlobError(error) || error.kind === "corrupt") throw error;
    return { status: "unavailable", summary, reason: error.kind };
  }
}

export type AppActivityBlobCleanup =
  | { deleted: true }
  | { deleted: false; error: string };

export async function deleteAppActivityBlob(
  blobJson: string,
  recordingId: string,
): Promise<AppActivityBlobCleanup> {
  let error: string | undefined;
  try {
    const result = await deletePrivateBlob(
      JSON.parse(blobJson) as PrivateBlobHandle,
    );
    if (!result.deleted) error = result.reason ?? "the provider kept it";
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  if (!error) return { deleted: true };
  console.warn(
    `[app-activity] could not delete the app activity blob for ${recordingId}: ${error}`,
  );
  return { deleted: false, error };
}
