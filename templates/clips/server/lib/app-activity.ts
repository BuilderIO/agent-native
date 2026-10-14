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

export async function deleteAppActivityBlob(
  blobJson: string,
  recordingId: string,
): Promise<void> {
  let reason: string | undefined;
  try {
    const result = await deletePrivateBlob(
      JSON.parse(blobJson) as PrivateBlobHandle,
    );
    if (!result.deleted) reason = result.reason ?? "the provider kept it";
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  if (reason) {
    console.warn(
      `[app-activity] could not delete the app activity blob for ${recordingId}: ${reason}`,
    );
  }
}
