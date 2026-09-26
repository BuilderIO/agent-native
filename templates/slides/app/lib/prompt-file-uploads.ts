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
  dataUrl?: string;
  originalName: string;
  filename: string;
  type: string;
  size: number;
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
  const response = await fetch(`${appBasePath()}/api/uploads/status`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Storage status unavailable (${response.status})`);
  }
  const status: unknown = await response.json();
  if (
    !status ||
    typeof status !== "object" ||
    typeof (status as { referenceStorageReady?: unknown })
      .referenceStorageReady !== "boolean"
  ) {
    throw new Error("Storage status response is invalid");
  }
  return (status as { referenceStorageReady: boolean }).referenceStorageReady;
}

async function readUploadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`Upload returned invalid JSON (${response.status})`, {
      cause: error,
    });
  }
}

function extractErrorMessage(data: unknown): string | null {
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    typeof (data as { error: unknown }).error === "string" &&
    (data as { error: string }).error.trim()
  ) {
    return (data as { error: string }).error;
  }
  return null;
}

async function uploadFilesMultipart(files: File[]): Promise<UploadedFile[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  const response = await fetch(`${appBasePath()}/api/uploads`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  const data = await readUploadJson(response);
  if (!response.ok) {
    throw new Error(
      extractErrorMessage(data) || `Upload failed (${response.status})`,
    );
  }
  if (!Array.isArray(data)) {
    throw new Error("Upload failed: invalid response");
  }
  return data as UploadedFile[];
}

export async function deleteUploadedPromptFile(
  file: UploadedFile,
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

async function cleanupUploadedPromptFiles(files: UploadedFile[]) {
  const results = await Promise.allSettled(
    files.map((file) => deleteUploadedPromptFile(file)),
  );
  results.forEach((result) => {
    if (result.status === "rejected") {
      console.error("Eager upload cleanup failed", result.reason);
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
  const startData = await readUploadJson(startResponse);
  if (!startResponse.ok) {
    throw new Error(
      extractErrorMessage(startData) ||
        `Upload failed (${startResponse.status})`,
    );
  }
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
    throw new Error("Upload failed: session ID missing");
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
    const chunkData = await readUploadJson(chunkResponse);
    if (!chunkResponse.ok) {
      throw new Error(
        extractErrorMessage(chunkData) ||
          `Upload failed (${chunkResponse.status})`,
      );
    }
    if (isFinal) {
      const result = Array.isArray(chunkData)
        ? (chunkData[0] as UploadedFile)
        : undefined;
      if (!result) throw new Error("Upload failed: no file returned");
      return result;
    }
  }
  throw new Error("Upload failed: no final chunk response");
}

export async function uploadPromptFiles(
  files: File[],
): Promise<UploadedFile[]> {
  if (files.length === 0) return [];
  if (files.length > MAX_REFERENCE_FILES) {
    throw new Error(`Too many files (max ${MAX_REFERENCE_FILES})`);
  }
  ensureEmbedAuthFetchInterceptor();
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
  const failedLargeResult = largeResults.find(
    (result) => result.status === "rejected",
  );
  if (smallResult.status === "rejected") {
    await cleanupUploadedPromptFiles([...successfulLargeUploads]);
    throw smallResult.reason;
  }
  if (failedLargeResult) {
    await cleanupUploadedPromptFiles([
      ...smallResult.value,
      ...successfulLargeUploads,
    ]);
    throw failedLargeResult.reason;
  }
  const smallUploads = smallResult.value;
  const largeUploads = successfulLargeUploads;
  if (smallUploads.length !== smallIndices.length) {
    throw new Error("Upload failed: response file count did not match request");
  }
  const uploads = new Array<UploadedFile>(files.length);
  smallIndices.forEach((fileIndex, resultIndex) => {
    uploads[fileIndex] = smallUploads[resultIndex];
  });
  largeIndices.forEach((fileIndex, resultIndex) => {
    uploads[fileIndex] = largeUploads[resultIndex];
  });
  return addInlineImageFallbacks(files, uploads);
}
