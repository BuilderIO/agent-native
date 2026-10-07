import { appBasePath } from "@agent-native/core/client/api-path";

export async function uploadSlideVideo(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${appBasePath()}/api/assets/upload-video`, {
    method: "POST",
    body,
  });
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    const error = new Error("Video upload response was unreadable") as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error = new Error("Video upload response was invalid") as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  const data = parsed as { url?: unknown; error?: unknown };

  if (!response.ok || typeof data?.url !== "string") {
    const error = new Error(
      typeof data?.error === "string" ? data.error : "Video upload failed",
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return data.url;
}
