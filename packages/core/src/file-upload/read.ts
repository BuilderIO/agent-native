import type { FileUploadReadResult } from "./types.js";

export type FileUploadReadFailure =
  | "invalid-reference"
  | "unavailable"
  | "unreadable"
  | "limit"
  | "unsupported";

export class FileUploadReadError extends Error {
  constructor(
    readonly code: FileUploadReadFailure,
    message: string,
  ) {
    super(message);
    this.name = "FileUploadReadError";
  }
}

export async function readBoundedUploadResponse(
  response: Response,
  maxBytes: number,
): Promise<FileUploadReadResult> {
  if (!response.ok)
    throw new FileUploadReadError(
      response.status === 404 ? "unavailable" : "unreadable",
      `Uploaded file read failed (${response.status}).`,
    );
  const mimeType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (!mimeType)
    throw new FileUploadReadError(
      "unreadable",
      "Uploaded file has no content type.",
    );
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0)
      throw new FileUploadReadError(
        "unreadable",
        "Uploaded file has an invalid content length.",
      );
    if (length > maxBytes)
      throw new FileUploadReadError(
        "limit",
        "Uploaded file exceeds the read limit.",
      );
  }
  if (!response.body)
    throw new FileUploadReadError(
      "unreadable",
      "Uploaded file has no readable body.",
    );
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  let completed = false;
  let failed = false;
  let failure: unknown;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        completed = true;
        break;
      }
      total += next.value.byteLength;
      if (total > maxBytes)
        throw new FileUploadReadError(
          "limit",
          "Uploaded file exceeds the read limit.",
        );
      parts.push(next.value);
    }
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    try {
      if (!completed) await reader.cancel();
    } catch (cleanupError) {
      if (failed)
        throw new AggregateError(
          [failure, cleanupError],
          "Uploaded file read and cleanup failed.",
        );
      throw cleanupError;
    } finally {
      reader.releaseLock();
    }
  }
  if (failed) throw failure;
  if (!total)
    throw new FileUploadReadError("unreadable", "Uploaded file is empty.");
  const data = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.byteLength;
  }
  return { data, mimeType };
}
