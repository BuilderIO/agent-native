import {
  deletePrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import type { DesignDataMutationTransaction } from "./design-data-mutation.js";

const CLEANUP_BATCH_SIZE = 50;

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
  const db = getDb();
  const table = schema.designVisualEditSnapshotBlobCleanup;
  const handles = [...new Set(values.filter((value) => value != null))];
  if (handles.length) {
    await db
      .insert(table)
      .values(handles.map((blobHandle) => ({ blobHandle })))
      .onConflictDoNothing();
  }

  const pending = await db
    .select({ blobHandle: table.blobHandle })
    .from(table)
    .limit(CLEANUP_BATCH_SIZE);
  for (const { blobHandle } of pending) {
    try {
      const result = await deletePrivateBlob(
        parseVisualEditSnapshotBlobHandle(blobHandle),
      );
      if (!result.deleted) {
        throw new Error(
          result.reason ??
            `Provider ${result.provider} did not delete the blob.`,
        );
      }
      await db.delete(table).where(eq(table.blobHandle, blobHandle));
    } catch (error) {
      console.warn(
        "[visual-edit] Snapshot blob cleanup remains queued for retry:",
        error,
      );
    }
  }
}

export async function queueVisualEditSnapshotBlobCleanupInTransaction(
  tx: DesignDataMutationTransaction,
  values: readonly (string | null | undefined)[],
): Promise<void> {
  const handles = [...new Set(values.filter((value) => value != null))];
  if (!handles.length) return;
  await tx
    .insert(schema.designVisualEditSnapshotBlobCleanup)
    .values(handles.map((blobHandle) => ({ blobHandle })))
    .onConflictDoNothing();
}
