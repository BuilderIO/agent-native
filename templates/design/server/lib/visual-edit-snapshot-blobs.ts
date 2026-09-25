import {
  deletePrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";

export function parseVisualEditSnapshotBlobHandle(
  value: string,
): PrivateBlobHandle {
  let handle: unknown;
  try {
    handle = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Stored visual-edit snapshot handle is malformed.");
  }
  if (
    !handle ||
    typeof handle !== "object" ||
    !("id" in handle) ||
    typeof handle.id !== "string" ||
    !handle.id ||
    !("provider" in handle) ||
    typeof handle.provider !== "string" ||
    !handle.provider ||
    !("opaque" in handle) ||
    handle.opaque !== true ||
    !("encrypted" in handle) ||
    typeof handle.encrypted !== "boolean"
  ) {
    throw new Error("Stored visual-edit snapshot handle is invalid.");
  }
  return handle as PrivateBlobHandle;
}

export async function deleteVisualEditSnapshotBlobs(
  values: readonly (string | null | undefined)[],
): Promise<void> {
  for (const value of new Set(values.filter((value) => value != null))) {
    try {
      const result = await deletePrivateBlob(
        parseVisualEditSnapshotBlobHandle(value),
      );
      if (!result.deleted) {
        console.warn(
          "[visual-edit] Could not remove a deleted screen fallback snapshot blob:",
          result.reason ?? result.provider,
        );
      }
    } catch (error) {
      console.warn(
        "[visual-edit] Could not remove a deleted screen fallback snapshot blob:",
        error,
      );
    }
  }
}
