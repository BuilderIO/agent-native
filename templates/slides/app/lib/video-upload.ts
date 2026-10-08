import { appBasePath } from "@agent-native/core/client/api-path";

const CHUNK_SIZE_BYTES = 4 * 1024 * 1024;

interface VideoUploadResponse {
  url?: unknown;
  error?: unknown;
  sessionId?: unknown;
  maxChunkBytes?: unknown;
  uploadMode?: unknown;
  ok?: unknown;
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

async function uploadVideoMultipart(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${appBasePath()}/api/assets/upload-video`, {
    method: "POST",
    credentials: "include",
    body,
  });
  const data = await readVideoUploadResponse(response);
  if (typeof data.url !== "string") {
    throw uploadError("Video upload response was invalid", response.status);
  }
  return data.url;
}

async function uploadVideoChunked(file: File): Promise<string> {
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
  try {
    for (let index = 0; index < totalChunks; index++) {
      const isFinal = index === totalChunks - 1;
      const chunkResponse = await fetch(
        `${appBasePath()}/api/uploads-chunked/${startData.sessionId}/chunk?index=${index}&isFinal=${isFinal ? "1" : "0"}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/octet-stream" },
          body: file.slice(
            index * chunkSize,
            Math.min((index + 1) * chunkSize, file.size),
          ),
        },
      );
      const chunkData = await readVideoUploadResponse(chunkResponse);
      if (isFinal) {
        if (typeof chunkData.url !== "string") {
          throw uploadError(
            "Video upload response was invalid",
            chunkResponse.status,
          );
        }
        return chunkData.url;
      }
      if (chunkData.ok !== true) {
        throw uploadError(
          "Video upload response was invalid",
          chunkResponse.status,
        );
      }
    }
  } catch (error) {
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
    throw error;
  }

  throw uploadError("Video upload did not complete", startResponse.status);
}

export async function uploadSlideVideo(file: File): Promise<string> {
  return file.size > CHUNK_SIZE_BYTES
    ? uploadVideoChunked(file)
    : uploadVideoMultipart(file);
}
