import { useState, useCallback } from "react";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";

const MAX_MEDIA_SIZE_BYTES = 50 * 1024 * 1024;
const CHUNKED_UPLOAD_THRESHOLD_BYTES = 25 * 1024 * 1024;
const CHUNK_SIZE_BYTES = 1 * 1024 * 1024;
const CHUNK_UPLOAD_MAX_RETRIES = 3;
const CHUNK_UPLOAD_RETRY_DELAY_MS = 400;
const CHUNKED_UPLOAD_STATUS_POLL_INTERVAL_MS = 1500;
const CHUNKED_UPLOAD_PROCESSING_TIMEOUT_MS = 4 * 60 * 1000;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${bytes}B`;
}

function summarizeErrorText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Upload failed";

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed?.error === "string") return parsed.error;
    if (typeof parsed?.message === "string") return parsed.message;
    if (typeof parsed?.details === "string") return summarizeErrorText(parsed.details);
  } catch {}

  return trimmed.replace(/\s+/g, " ").slice(0, 300);
}

async function readUploadErrorResponse(
  res: Response
): Promise<{ message: string; code?: string; expectedChunkIndex?: number }> {
  const text = await res.text().catch(() => "");
  const fallbackMessage = summarizeErrorText(text) || `Upload failed (${res.status})`;

  try {
    const parsed = JSON.parse(text);
    return {
      message: summarizeErrorText(text) || fallbackMessage,
      code: typeof parsed?.code === "string" ? parsed.code : undefined,
      expectedChunkIndex:
        typeof parsed?.expectedChunkIndex === "number" ? parsed.expectedChunkIndex : undefined,
    };
  } catch {
    return { message: fallbackMessage };
  }
}

async function readUploadError(res: Response): Promise<string> {
  const payload = await readUploadErrorResponse(res);
  return payload.message;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRetryChunkUpload(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Failed to fetch") || message.includes("NetworkError") || message.includes("Load failed");
}

function getUploadErrorMessage(error: unknown, file: File): string {
  const message = error instanceof Error ? error.message : "Upload failed";
  const stageMatch = message.match(/^Upload request failed during (.+):\s*(.+)$/);

  if (stageMatch && stageMatch[2]?.includes("Failed to fetch")) {
    return `${file.name} upload failed during ${stageMatch[1]} before the server responded. Check the network request and try again.`;
  }

  if (message.includes("Failed to fetch")) {
    return `${file.name} upload failed before the server responded. Check the network request and try again.`;
  }

  if (message.includes("Builder rejected the upload")) {
    return `${file.name} could not be uploaded. ${message}`;
  }

  if (message.includes("Builder connection required") || message.includes("authentication")) {
    return `Builder upload is not connected for ${file.name}. Reconnect Builder and try again.`;
  }

  return `${file.name} upload failed. ${message}`;
}

export type UploadProgressStage = "uploading" | "processing";

export interface UploadOptions {
  onStatusChange?: (status: UploadProgressStage) => void;
}

type ChunkedUploadStatus = "uploading" | "processing" | "complete" | "failed";

type ChunkedUploadStatusResponse = {
  uploadId?: string;
  status?: ChunkedUploadStatus;
  pollAfterMs?: number;
  error?: string;
  result?: UploadResult;
  url?: string;
  filename?: string;
  type?: "image" | "video";
  size?: number;
  mimeType?: string;
};

function getUploadResult(payload: ChunkedUploadStatusResponse | UploadResult | null | undefined): UploadResult | null {
  if (!payload) return null;
  if ("result" in payload && payload.result?.url) return payload.result;

  if (
    typeof payload.url === "string" &&
    typeof payload.filename === "string" &&
    (payload.type === "image" || payload.type === "video") &&
    typeof payload.size === "number" &&
    typeof payload.mimeType === "string"
  ) {
    return {
      url: payload.url,
      filename: payload.filename,
      type: payload.type,
      size: payload.size,
      mimeType: payload.mimeType,
    };
  }

  return null;
}

async function pollChunkedUploadStatus(
  projectSlug: string,
  uploadId: string,
  uploadToken: string,
  file: File,
  options?: UploadOptions
): Promise<UploadResult> {
  const startedAt = Date.now();
  options?.onStatusChange?.("processing");

  while (Date.now() - startedAt < CHUNKED_UPLOAD_PROCESSING_TIMEOUT_MS) {
    const statusRes = await authFetch(`/api/projects/${projectSlug}/media/chunked/${uploadId}/status`, {
      method: "GET",
      headers: {
        "x-upload-token": uploadToken,
      },
    });

    if (!statusRes.ok) {
      throw new Error(await readUploadError(statusRes));
    }

    const statusData = (await statusRes.json()) as ChunkedUploadStatusResponse;
    const result = getUploadResult(statusData);

    if (statusData.status === "complete" && result) {
      return result;
    }

    if (statusData.status === "failed") {
      throw new Error(statusData.error || `${file.name} processing failed`);
    }

    await sleep(statusData.pollAfterMs || CHUNKED_UPLOAD_STATUS_POLL_INTERVAL_MS);
  }

  throw new Error(`${file.name} is still processing in Builder. Try again in a moment.`);
}

async function uploadMediaInChunks(
  projectSlug: string,
  file: File,
  builderHeaders: Record<string, string>,
  options?: UploadOptions
): Promise<UploadResult> {
  const requestUploadStep = async (stage: string, run: () => Promise<Response>) => {
    try {
      return await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Upload request failed during ${stage}: ${message}`);
    }
  };

  const initRes = await requestUploadStep("initialization", () => authFetch(`/api/projects/${projectSlug}/media/chunked/init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      originalName: file.name,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
    }),
  }));

  if (!initRes.ok) {
    throw new Error(await readUploadError(initRes));
  }

  const initData = (await initRes.json()) as {
    uploadId?: string;
    uploadToken?: string;
    chunkSize?: number;
  };
  const uploadId = initData.uploadId;
  const uploadToken = initData.uploadToken;
  const chunkSize = initData.chunkSize || CHUNK_SIZE_BYTES;

  if (!uploadId || !uploadToken) {
    throw new Error("Upload initialization failed");
  }

  const totalChunks = Math.ceil(file.size / chunkSize);
  options?.onStatusChange?.("uploading");

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    let uploaded = false;

    for (let attempt = 0; attempt <= CHUNK_UPLOAD_MAX_RETRIES; attempt += 1) {
      try {
        const chunkRes = await requestUploadStep(
          `chunk ${index + 1} of ${totalChunks}`,
          () => authFetch(
            `/api/projects/${projectSlug}/media/chunked/${uploadId}/chunk?index=${index}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/octet-stream",
                "x-upload-token": uploadToken,
              },
              body: chunk,
            }
          )
        );

        if (chunkRes.ok) {
          uploaded = true;
          break;
        }

        const errorPayload = await readUploadErrorResponse(chunkRes);
        const chunkAcceptedOnPreviousAttempt =
          chunkRes.status === 409 && errorPayload.expectedChunkIndex === index + 1;

        if (chunkAcceptedOnPreviousAttempt) {
          console.warn("[upload] Continuing after duplicate chunk acknowledgement", {
            projectSlug,
            uploadId,
            chunkIndex: index,
            expectedChunkIndex: errorPayload.expectedChunkIndex,
          });
          uploaded = true;
          break;
        }

        const canRetry =
          attempt < CHUNK_UPLOAD_MAX_RETRIES &&
          (chunkRes.status >= 500 || errorPayload.code === "invalid_upload_chunk");

        if (!canRetry) {
          throw new Error(errorPayload.message);
        }

        console.warn("[upload] Retrying chunk upload after server error", {
          projectSlug,
          uploadId,
          chunkIndex: index,
          attempt: attempt + 1,
          status: chunkRes.status,
          code: errorPayload.code,
          message: errorPayload.message,
        });
        await sleep(CHUNK_UPLOAD_RETRY_DELAY_MS * (attempt + 1));
      } catch (error) {
        const canRetry = attempt < CHUNK_UPLOAD_MAX_RETRIES && shouldRetryChunkUpload(error);
        if (!canRetry) {
          throw error;
        }

        console.warn("[upload] Retrying chunk upload after network failure", {
          projectSlug,
          uploadId,
          chunkIndex: index,
          attempt: attempt + 1,
          message: error instanceof Error ? error.message : String(error),
        });
        await sleep(CHUNK_UPLOAD_RETRY_DELAY_MS * (attempt + 1));
      }
    }

    if (!uploaded) {
      throw new Error(`Upload failed for chunk ${index + 1} of ${totalChunks}`);
    }
  }

  const completeRes = await requestUploadStep("completion", () => authFetch(`/api/projects/${projectSlug}/media/chunked/${uploadId}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-upload-token": uploadToken,
      ...builderHeaders,
    },
    body: JSON.stringify({}),
  }));

  if (!completeRes.ok) {
    throw new Error(await readUploadError(completeRes));
  }

  const completionData = (await completeRes.json()) as ChunkedUploadStatusResponse;
  const completedResult = getUploadResult(completionData);
  if (completedResult) {
    return completedResult;
  }

  if (completionData.status === "failed") {
    throw new Error(completionData.error || `${file.name} processing failed`);
  }

  if (completionData.status === "processing") {
    return await pollChunkedUploadStatus(projectSlug, uploadId, uploadToken, file, options);
  }

  throw new Error("Upload completion did not return a media URL");
}

export interface UploadResult {
  url: string;
  filename: string;
  type: "image" | "video";
  size: number;
  mimeType: string;
}

export function useMediaUpload(projectSlug: string | null) {
  const [isUploading, setIsUploading] = useState(false);

  const upload = useCallback(
    async (file: File, options?: UploadOptions): Promise<UploadResult | null> => {
      if (!projectSlug) return null;

      if (file.size > MAX_MEDIA_SIZE_BYTES) {
        const message = `${file.name} is ${formatBytes(file.size)}. Max upload size is ${formatBytes(MAX_MEDIA_SIZE_BYTES)}.`;
        toast.error(message);
        return null;
      }

      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const apiKey = localStorage.getItem("builder_api_key");
        const privateKey = localStorage.getItem("builder_private_key");

        const builderHeaders: Record<string, string> = {};
        if (apiKey) builderHeaders["x-builder-api-key"] = apiKey;
        if (privateKey) builderHeaders["x-builder-private-key"] = privateKey;

        if (file.size >= CHUNKED_UPLOAD_THRESHOLD_BYTES) {
          return await uploadMediaInChunks(projectSlug, file, builderHeaders, options);
        }

        const res = await authFetch(`/api/projects/${projectSlug}/media`, {
          method: "POST",
          headers: builderHeaders,
          body: formData,
        });

        if (!res.ok) {
          throw new Error(await readUploadError(res));
        }

        return await res.json();
      } catch (err: any) {
        console.error("Upload failed:", err);
        toast.error(getUploadErrorMessage(err, file));
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [projectSlug]
  );

  return { upload, isUploading };
}

const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export function isMediaFile(file: File): boolean {
  if (IMAGE_TYPES.includes(file.type) || VIDEO_TYPES.includes(file.type)) return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") ||
    name.endsWith(".gif") || name.endsWith(".webp") || name.endsWith(".svg") ||
    name.endsWith(".mp4") || name.endsWith(".webm") || name.endsWith(".mov");
}

export function isImageFile(file: File): boolean {
  if (IMAGE_TYPES.includes(file.type)) return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") ||
    name.endsWith(".gif") || name.endsWith(".webp") || name.endsWith(".svg");
}

export function isVideoFile(file: File): boolean {
  if (VIDEO_TYPES.includes(file.type)) return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".mp4") || name.endsWith(".webm") || name.endsWith(".mov");
}
