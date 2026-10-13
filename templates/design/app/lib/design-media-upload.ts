import { agentNativePath } from "@agent-native/core/client/api-path";

export async function uploadDesignVideoFile(file: File): Promise<string> {
  return uploadDesignMediaFile(file, "video", "Video");
}

export async function uploadDesignAudioFile(file: File): Promise<string> {
  return uploadDesignMediaFile(file, "audio", "Audio");
}

async function uploadDesignMediaFile(
  file: File,
  mediaType: "audio" | "video",
  mediaLabel: "Audio" | "Video",
): Promise<string> {
  if (!file.type.toLowerCase().startsWith(`${mediaType}/`)) {
    throw new Error(`Only ${mediaType} files can be uploaded.`);
  }

  const body = new FormData();
  body.append("file", file, file.name);
  const response = await fetch(agentNativePath("/_agent-native/file-upload"), {
    method: "POST",
    credentials: "include",
    body,
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(
      `${mediaLabel} upload returned invalid JSON (${response.status}).${detail}`,
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${mediaLabel} upload returned an invalid response.`);
  }
  const result = payload as { url?: unknown; error?: unknown };

  if (!response.ok) {
    throw new Error(
      typeof result?.error === "string"
        ? result.error
        : `${mediaLabel} upload failed (${response.status}).`,
    );
  }

  if (typeof result?.url !== "string") {
    throw new Error(`${mediaLabel} upload returned no URL.`);
  }
  let url: URL;
  try {
    url = new URL(result.url);
  } catch {
    throw new Error(`${mediaLabel} upload returned an invalid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${mediaLabel} upload returned an invalid URL.`);
  }
  return url.href;
}
