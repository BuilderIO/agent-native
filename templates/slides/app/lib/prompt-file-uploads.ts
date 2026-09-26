import { appBasePath } from "@agent-native/core/client/api-path";
import { ensureEmbedAuthFetchInterceptor } from "@agent-native/core/client/host";

import {
  canAddInlineImageToPayload,
  canInlineImageFile,
  readFileAsDataUrl,
} from "@/lib/image-drop-to-agent";

import { MAX_REFERENCE_FILES } from "../../shared/upload-types";

export interface UploadedFile {
  path: string;
  url?: string;
  /** Browser-only fallback when the upload provider did not return a public URL. */
  dataUrl?: string;
  originalName: string;
  filename: string;
  type: string;
  size: number;
}

export function isPromptUploadNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      (error.name === "AbortError" ||
        ("code" in error &&
          (error.code === "reference_storage_network_failed" ||
            error.code === "reference_upload_network_failed"))))
  );
}

export function isPromptUploadAuthRequiredError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "reference_storage_auth_required"
  );
}

export function isPromptUploadLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "reference_storage_limit_exceeded"
  );
}

export function isPromptUploadStorageStatusError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "reference_storage_http_failed" ||
      error.code === "reference_storage_contract_failed")
  );
}

function referenceStorageStatusError(code: string, cause?: unknown): Error {
  return Object.assign(
    new Error(
      "Reference file storage status could not be verified",
      cause === undefined ? undefined : { cause },
    ),
    { code },
  );
}

export async function addInlineImageFallbacks(
  files: File[],
  uploaded: UploadedFile[],
): Promise<UploadedFile[]> {
  const inlineDataUrls: string[] = [];
  const result: UploadedFile[] = [];
  for (let index = 0; index < uploaded.length; index++) {
    const uploadedFile = uploaded[index];
    const file = files[index];
    const isImage =
      uploadedFile.type.startsWith("image/") ||
      Boolean(file?.type.startsWith("image/"));
    if (!isImage || !file) {
      result.push(uploadedFile);
      continue;
    }
    if (uploadedFile.url) {
      const { dataUrl: _dataUrl, ...withoutDataUrl } = uploadedFile;
      result.push(withoutDataUrl);
      continue;
    }
    if (uploadedFile.dataUrl) {
      if (canAddInlineImageToPayload(inlineDataUrls, uploadedFile.dataUrl)) {
        inlineDataUrls.push(uploadedFile.dataUrl);
        result.push(uploadedFile);
      } else {
        const { dataUrl: _dataUrl, ...withoutDataUrl } = uploadedFile;
        result.push(withoutDataUrl);
      }
      continue;
    }
    if (!canInlineImageFile(file)) {
      result.push(uploadedFile);
      continue;
    }
    const dataUrl = await readFileAsDataUrl(file);
    if (canAddInlineImageToPayload(inlineDataUrls, dataUrl)) {
      inlineDataUrls.push(dataUrl);
      result.push({ ...uploadedFile, dataUrl });
    } else {
      result.push(uploadedFile);
    }
  }
  return result;
}

const CHUNK_UPLOAD_THRESHOLD_BYTES = 4 * 1024 * 1024;
const CHUNK_SIZE_BYTES = 4 * 1024 * 1024;

export async function isReferenceStorageReady(): Promise<boolean> {
  ensureEmbedAuthFetchInterceptor();
  let response: Response;
  try {
    response = await fetch(`${appBasePath()}/api/uploads/status`, {
      credentials: "include",
    });
  } catch (cause) {
    throw referenceStorageStatusError(
      "reference_storage_network_failed",
      cause,
    );
  }
  if (response.status === 401) {
    throw referenceStorageStatusError("reference_storage_auth_required");
  }
  if (!response.ok) {
    throw referenceStorageStatusError("reference_storage_http_failed");
  }

  let status: unknown;
  try {
    status = await response.json();
  } catch (cause) {
    if (
      cause instanceof TypeError ||
      (cause instanceof Error && cause.name === "AbortError")
    ) {
      throw referenceStorageStatusError(
        "reference_storage_network_failed",
        cause,
      );
    }
    throw referenceStorageStatusError(
      "reference_storage_contract_failed",
      cause,
    );
  }
  if (
    !status ||
    typeof status !== "object" ||
    typeof (status as { referenceStorageReady?: unknown })
      .referenceStorageReady !== "boolean"
  ) {
    throw referenceStorageStatusError("reference_storage_contract_failed");
  }
  return (status as { referenceStorageReady: boolean }).referenceStorageReady;
}

async function readUploadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw promptUploadContractError(error);
  }
}

function promptUploadContractError(cause?: unknown): Error {
  return Object.assign(
    new Error(
      "Reference file upload returned an invalid response",
      cause === undefined ? undefined : { cause },
    ),
    { code: "reference_storage_contract_failed" },
  );
}

function isUploadedFile(value: unknown): value is UploadedFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file.path === "string" &&
    file.path.length > 0 &&
    typeof file.originalName === "string" &&
    file.originalName.length > 0 &&
    typeof file.filename === "string" &&
    file.filename.length > 0 &&
    typeof file.type === "string" &&
    typeof file.size === "number" &&
    Number.isFinite(file.size) &&
    file.size >= 0 &&
    (file.url === undefined || typeof file.url === "string") &&
    (file.dataUrl === undefined || typeof file.dataUrl === "string")
  );
}

async function parseUploadedFiles(
  data: unknown,
  expectedCount: number,
): Promise<UploadedFile[]> {
  const records = Array.isArray(data) ? data : [data];
  const uploaded = records.filter(isUploadedFile);
  if (
    !Array.isArray(data) ||
    uploaded.length !== records.length ||
    uploaded.length !== expectedCount
  ) {
    const completed = records.flatMap((record) =>
      record &&
      typeof record === "object" &&
      typeof (record as { path?: unknown }).path === "string" &&
      (record as { path: string }).path
        ? [{ path: (record as { path: string }).path }]
        : [],
    );
    await cleanupUploadedPromptFiles(completed);
    throw promptUploadContractError();
  }
  return uploaded;
}

export function promptUploadHttpError(status: number): Error {
  return Object.assign(new Error("Reference file upload failed"), {
    code:
      status === 401 || status === 403
        ? "reference_storage_auth_required"
        : status === 413
          ? "reference_storage_limit_exceeded"
          : "reference_storage_http_failed",
    status,
  });
}

async function uploadFilesMultipart(files: File[]): Promise<UploadedFile[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  const response = await fetch(`${appBasePath()}/api/uploads`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!response.ok) throw promptUploadHttpError(response.status);
  const data = await readUploadJson(response);
  return parseUploadedFiles(data, files.length);
}

export async function deleteUploadedPromptFile(
  file: Pick<UploadedFile, "path">,
): Promise<void> {
  const response = await fetch(`${appBasePath()}/api/uploads`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ path: file.path }),
  });
  if (!response.ok) {
    throw new Error(`Upload cleanup failed (${response.status})`);
  }
}

export async function cleanupUploadedPromptFiles(
  files: Pick<UploadedFile, "path">[],
) {
  const results = await Promise.allSettled(
    files.map((file) => deleteUploadedPromptFile(file)),
  );
  results.forEach((result) => {
    if (result.status === "rejected") {
      console.error("Uploaded file cleanup failed", result.reason);
    }
  });
}

async function uploadFileChunked(file: File): Promise<UploadedFile> {
  const startResponse = await fetch(
    `${appBasePath()}/api/uploads-chunked/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        filename: file.name,
        mimetype: file.type || "application/octet-stream",
        declaredSize: file.size,
      }),
    },
  );
  if (!startResponse.ok) throw promptUploadHttpError(startResponse.status);
  const startData = await readUploadJson(startResponse);
  if (
    startData &&
    typeof startData === "object" &&
    (startData as { uploadMode?: unknown }).uploadMode === "multipart"
  ) {
    const [uploaded] = await uploadFilesMultipart([file]);
    if (!uploaded) throw new Error("Upload failed: no file returned");
    return uploaded;
  }
  const sessionId =
    startData && typeof startData === "object"
      ? (startData as { sessionId?: unknown }).sessionId
      : undefined;
  if (typeof sessionId !== "string" || !sessionId) {
    throw promptUploadContractError();
  }

  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE_BYTES));
  for (let index = 0; index < totalChunks; index++) {
    const start = index * CHUNK_SIZE_BYTES;
    const end = Math.min(start + CHUNK_SIZE_BYTES, file.size);
    const isFinal = index === totalChunks - 1;
    const chunkResponse = await fetch(
      `${appBasePath()}/api/uploads-chunked/${sessionId}/chunk?index=${index}&isFinal=${
        isFinal ? "1" : "0"
      }`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/octet-stream" },
        body: file.slice(start, end),
      },
    );
    if (!chunkResponse.ok) throw promptUploadHttpError(chunkResponse.status);
    const chunkData = await readUploadJson(chunkResponse);
    if (isFinal) {
      const [result] = await parseUploadedFiles(chunkData, 1);
      return result;
    }
    if (
      !chunkData ||
      typeof chunkData !== "object" ||
      (chunkData as { ok?: unknown }).ok !== true
    ) {
      throw promptUploadContractError();
    }
  }
  throw promptUploadContractError();
}

export async function uploadPromptFiles(
  files: File[],
  storageUnavailableMessage: string,
): Promise<UploadedFile[]> {
  if (files.length === 0) return [];
  if (files.length > MAX_REFERENCE_FILES) {
    throw new Error(`Too many files (max ${MAX_REFERENCE_FILES})`);
  }
  if (!(await isReferenceStorageReady())) {
    throw Object.assign(new Error(storageUnavailableMessage), {
      code: "reference_storage_unavailable",
    });
  }
  const smallIndices = files.flatMap((file, index) =>
    file.size <= CHUNK_UPLOAD_THRESHOLD_BYTES ? [index] : [],
  );
  const largeIndices = files.flatMap((file, index) =>
    file.size > CHUNK_UPLOAD_THRESHOLD_BYTES ? [index] : [],
  );
  const smallPromise =
    smallIndices.length > 0
      ? uploadFilesMultipart(smallIndices.map((index) => files[index]))
      : Promise.resolve([] as UploadedFile[]);
  const [smallResult, largeResults] = await Promise.all([
    smallPromise.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason) => ({ status: "rejected" as const, reason }),
    ),
    Promise.allSettled(
      largeIndices.map((index) => uploadFileChunked(files[index])),
    ),
  ]);
  const successfulLargeUploads = largeResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failedLargeIndex = largeResults.findIndex(
    (result) => result.status === "rejected",
  );
  if (smallResult.status === "rejected") {
    await cleanupUploadedPromptFiles([...successfulLargeUploads]);
    throw smallResult.reason;
  }
  if (failedLargeIndex !== -1) {
    await cleanupUploadedPromptFiles([
      ...smallResult.value,
      ...successfulLargeUploads,
    ]);
    const failure = largeResults[failedLargeIndex];
    const cause = failure?.status === "rejected" ? failure.reason : undefined;
    if (isPromptUploadNetworkError(cause)) {
      const error = new Error("Reference file upload failed", { cause });
      Object.assign(error, { code: "reference_upload_network_failed" });
      throw error;
    }
    if (
      isPromptUploadAuthRequiredError(cause) ||
      isPromptUploadLimitError(cause) ||
      isPromptUploadStorageStatusError(cause)
    ) {
      throw cause;
    }
    throw promptUploadHttpError(500);
  }
  const smallUploads = smallResult.value;
  const largeUploads = successfulLargeUploads;
  const uploads = new Array<UploadedFile>(files.length);
  smallIndices.forEach((fileIndex, resultIndex) => {
    uploads[fileIndex] = smallUploads[resultIndex];
  });
  largeIndices.forEach((fileIndex, resultIndex) => {
    uploads[fileIndex] = largeUploads[resultIndex];
  });
  return addInlineImageFallbacks(files, uploads);
}
