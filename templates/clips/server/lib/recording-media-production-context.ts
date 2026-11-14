import { AsyncLocalStorage } from "node:async_hooks";

import type { FileUploadResult } from "@agent-native/core/file-upload";

export interface ProducedMediaReference extends FileUploadResult {
  builderUpload?: BuilderUploadProvenance;
  storageFingerprint?: string;
  uploadConfirmed?: boolean;
}

export interface BuilderUploadProvenance {
  recordingId: string;
  ownerEmail: string;
  producerId: string;
  objectKey: string;
}

const checkpoints = new AsyncLocalStorage<
  (output: ProducedMediaReference) => Promise<void>
>();

export function withMediaUploadCheckpoint<T>(
  checkpoint: (output: ProducedMediaReference) => Promise<void>,
  produce: () => Promise<T>,
): Promise<T> {
  return checkpoints.run(checkpoint, produce);
}

export async function checkpointMediaUpload(
  output: ProducedMediaReference,
): Promise<void> {
  const checkpoint = checkpoints.getStore();
  if (checkpoint) await checkpoint(output);
}
