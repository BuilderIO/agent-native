import { agentNativePath } from "@agent-native/core/client/api-path";

export async function uploadDesignVideoFile(file: File): Promise<string> {
  if (!file.type.toLowerCase().startsWith("video/")) {
    throw new Error("Only video files can be uploaded.");
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
      `Video upload returned invalid JSON (${response.status}).${detail}`,
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Video upload returned an invalid response.");
  }
  const result = payload as { url?: unknown; error?: unknown };

  if (!response.ok) {
    throw new Error(
      typeof result?.error === "string"
        ? result.error
        : `Video upload failed (${response.status}).`,
    );
  }

  if (typeof result?.url !== "string") {
    throw new Error("Video upload returned no URL.");
  }
  const url = new URL(result.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Video upload returned an invalid URL.");
  }
  return url.href;
}
