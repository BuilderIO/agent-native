import {
  deletePrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";

export const APP_ACTIVITY_BLOB_PURPOSE = "clips-app-activity";

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
