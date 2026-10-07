import { appBasePath } from "@agent-native/core/client/api-path";

export async function uploadSlideVideo(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${appBasePath()}/api/assets/upload-video`, {
    method: "POST",
    body,
  });
  const data = (await response.json().catch(() => null)) as {
    url?: unknown;
    error?: unknown;
  } | null;

  if (!response.ok || typeof data?.url !== "string") {
    const error = new Error(
      typeof data?.error === "string" ? data.error : "Video upload failed",
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return data.url;
}
