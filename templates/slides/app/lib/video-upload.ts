import { appBasePath } from "@agent-native/core/client/api-path";

const CHUNK_SIZE_BYTES = 4 * 1024 * 1024;
const MAX_FINAL_CHUNK_RETRIES = 15;

interface VideoUploadResponse {
  id?: unknown;
  url?: unknown;
  success?: unknown;
  error?: unknown;
  sessionId?: unknown;
  maxChunkBytes?: unknown;
  uploadMode?: unknown;
  ok?: unknown;
}

export interface UploadedSlideVideo {
  id: string;
  url: string;
}

function uploadError(
  message: string,
  status: number,
): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

async function readVideoUploadResponse(
  response: Response,
): Promise<VideoUploadResponse> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw uploadError("Video upload response was unreadable", response.status);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw uploadError("Video upload response was invalid", response.status);
  }
  const data = parsed as VideoUploadResponse;
  if (!response.ok) {
    throw uploadError(
      typeof data.error === "string" ? data.error : "Video upload failed",
      response.status,
    );
  }
  return data;
}

function readUploadedSlideVideo(
  data: VideoUploadResponse,
  response: Response,
): UploadedSlideVideo {
  if (typeof data.id !== "string" || typeof data.url !== "string") {
    throw uploadError("Video upload response was invalid", response.status);
  }
  return { id: data.id, url: data.url };
}

function canRetryFinalChunk(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return true;
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500 ||
    (status >= 200 && status < 300)
  );
}

function waitForFinalChunkRetry(attempt: number): Promise<void> {
  const delay = Math.min(250 * 2 ** (attempt - 1), 1500);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function uploadVideoMultipart(file: File): Promise<UploadedSlideVideo> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${appBasePath()}/api/assets/upload-video`, {
    method: "POST",
    credentials: "include",
    body,
  });
  const data = await readVideoUploadResponse(response);
  return readUploadedSlideVideo(data, response);
}

async function uploadVideoChunked(file: File): Promise<UploadedSlideVideo> {
  const startResponse = await fetch(
    `${appBasePath()}/api/uploads-chunked/start`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        mimetype: file.type || "application/octet-stream",
        declaredSize: file.size,
        uploadType: "video",
      }),
    },
  );
  const startData = await readVideoUploadResponse(startResponse);
  if (startData.uploadMode === "multipart") {
    return uploadVideoMultipart(file);
  }
  if (typeof startData.sessionId !== "string" || !startData.sessionId) {
    throw uploadError("Video upload session was invalid", startResponse.status);
  }

  const chunkSize =
    typeof startData.maxChunkBytes === "number" &&
    Number.isSafeInteger(startData.maxChunkBytes) &&
    startData.maxChunkBytes > 0
      ? Math.min(startData.maxChunkBytes, CHUNK_SIZE_BYTES)
      : CHUNK_SIZE_BYTES;
  const totalChunks = Math.ceil(file.size / chunkSize);
  let finalChunkAttempted = false;
  try {
    for (let index = 0; index < totalChunks; index++) {
      const isFinal = index === totalChunks - 1;
      const chunkUrl = `${appBasePath()}/api/uploads-chunked/${startData.sessionId}/chunk?index=${index}&isFinal=${isFinal ? "1" : "0"}`;
      const body = file.slice(
        index * chunkSize,
        Math.min((index + 1) * chunkSize, file.size),
      );
      const sendChunk = async () => {
        const response = await fetch(chunkUrl, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/octet-stream" },
          body,
        });
        const data = await readVideoUploadResponse(response);
        return { data, response };
      };

      if (isFinal) {
        finalChunkAttempted = true;
        for (let attempt = 0; ; attempt++) {
          try {
            const { data, response } = await sendChunk();
            return readUploadedSlideVideo(data, response);
          } catch (error) {
            if (
              attempt >= MAX_FINAL_CHUNK_RETRIES ||
              !canRetryFinalChunk(error)
            ) {
              throw error;
            }
            await waitForFinalChunkRetry(attempt + 1);
          }
        }
      }

      const { data: chunkData, response: chunkResponse } = await sendChunk();
      if (chunkData.ok !== true) {
        throw uploadError(
          "Video upload response was invalid",
          chunkResponse.status,
        );
      }
    }
  } catch (error) {
    if (!finalChunkAttempted) {
      try {
        const cleanupResponse = await fetch(
          `${appBasePath()}/api/uploads-chunked/${startData.sessionId}`,
          { method: "DELETE", credentials: "include" },
        );
        if (!cleanupResponse.ok) {
          console.warn("Failed to clean up incomplete video upload session", {
            status: cleanupResponse.status,
          });
        }
      } catch (cleanupError) {
        console.warn("Failed to clean up incomplete video upload session", {
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      }
    }
    throw error;
  }

  throw uploadError("Video upload did not complete", startResponse.status);
}

export async function uploadSlideVideo(
  file: File,
): Promise<UploadedSlideVideo> {
  return file.size > CHUNK_SIZE_BYTES
    ? uploadVideoChunked(file)
    : uploadVideoMultipart(file);
}

export async function discardUploadedSlideVideo(id: string): Promise<void> {
  const response = await fetch(
    `${appBasePath()}/api/assets/video-uploads?id=${encodeURIComponent(id)}`,
    { method: "DELETE", credentials: "include" },
  );
  const data = await readVideoUploadResponse(response);
  if (data.success !== true) {
    throw uploadError("Could not discard uploaded video", response.status);
  }
}
