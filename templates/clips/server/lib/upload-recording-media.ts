import {
  uploadFile,
  type FileUploadInput,
  type FileUploadResult,
} from "@agent-native/core/file-upload";
import { getAppConfig } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { ownerEmailMatches } from "./recordings.js";
import {
  deleteS3ObjectByUrl,
  clipsHostedFileUploadProvider,
} from "./s3-upload-provider.js";
import {
  accountHostedClipAdditionalRecordingBytes,
  addHostedClipRecordingBytes,
} from "./video-storage.js";

type UploadRecordingMediaInput = Omit<FileUploadInput, "ownerEmail"> & {
  recordingId: string;
  ownerEmail: string;
};

export class HostedDerivativeTooLargeError extends Error {
  constructor(
    readonly sizeBytes: number,
    readonly maxBytes: number,
  ) {
    super(
      `Hosted recording derivative is ${sizeBytes} bytes, over the ${maxBytes} byte per-clip limit.`,
    );
    this.name = "HostedDerivativeTooLargeError";
  }
}

function recordingScopedFilename(
  recordingId: string,
  filename: string | undefined,
): string {
  const extension = filename?.match(/\.([a-zA-Z0-9_-]+)$/)?.[1] ?? "bin";
  return `${recordingId}.${extension}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function deleteRejectedHostedUpload(input: {
  recordingId: string;
  ownerEmail: string;
  url: string;
  additionalBytes: number;
  failure: Error;
}): Promise<never> {
  let deleted = false;
  let cleanupError: unknown;
  try {
    deleted = await deleteS3ObjectByUrl(input.url, {
      storageMode: "hosted",
      recordingId: input.recordingId,
    });
  } catch (error) {
    cleanupError = error;
  }

  if (!deleted) {
    try {
      const accounting = await accountHostedClipAdditionalRecordingBytes({
        recordingId: input.recordingId,
        ownerEmail: input.ownerEmail,
        additionalBytes: input.additionalBytes,
      });
      if (!accounting.ok) {
        throw new Error("Hosted recording bytes were not accounted.");
      }
    } catch (error) {
      throw new Error(
        `${input.failure.message} The uploaded derivative could not be deleted (${cleanupError ? errorMessage(cleanupError) : "the provider did not confirm deletion"}) and its bytes could not be recorded conservatively (${errorMessage(error)}).`,
      );
    }

    throw new Error(
      `${input.failure.message} The uploaded derivative could not be deleted (${cleanupError ? errorMessage(cleanupError) : "the provider did not confirm deletion"}); its bytes were recorded conservatively.`,
    );
  }

  throw input.failure;
}

/** Upload a recording derivative using the storage mode already pinned to it. */
export async function uploadRecordingMedia(
  input: UploadRecordingMediaInput,
): Promise<FileUploadResult | null> {
  const [recording] = await getDb()
    .select({ storageMode: schema.recordings.storageMode })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, input.recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, input.ownerEmail),
      ),
    )
    .limit(1);

  if (!recording) {
    throw new Error(`Recording not found: ${input.recordingId}`);
  }

  const { recordingId, ownerEmail, ...upload } = input;
  if (recording.storageMode === "hosted") {
    const uploadedBytes = upload.data.byteLength;
    if (!Number.isSafeInteger(uploadedBytes) || uploadedBytes < 0) {
      throw new Error("Hosted recording derivative has an invalid byte size.");
    }
    // Checked before upload: the allowance only enforces the optional global
    // cap, so without this a single derivative could exceed the clip budget.
    const maxBytes = getAppConfig().clips.hostedStorage.maxClipBytes;
    if (uploadedBytes > maxBytes) {
      throw new HostedDerivativeTooLargeError(uploadedBytes, maxBytes);
    }

    const uploaded = await clipsHostedFileUploadProvider.upload({
      ...upload,
      filename: recordingScopedFilename(recordingId, upload.filename),
      ownerEmail,
    });

    const accounting = await addHostedClipRecordingBytes({
      recordingId,
      ownerEmail,
      additionalBytes: uploadedBytes,
    }).catch((error: unknown) =>
      deleteRejectedHostedUpload({
        recordingId,
        ownerEmail,
        url: uploaded.url,
        additionalBytes: uploadedBytes,
        failure: new Error(
          `Hosted recording derivative accounting failed: ${errorMessage(error)}`,
        ),
      }),
    );

    if (!accounting.ok) {
      await deleteRejectedHostedUpload({
        recordingId,
        ownerEmail,
        url: uploaded.url,
        additionalBytes: uploadedBytes,
        failure: new Error(
          "Hosted Clips storage is full. The uploaded derivative was removed.",
        ),
      });
    }

    return uploaded;
  }

  return uploadFile({ ...upload, ownerEmail });
}
