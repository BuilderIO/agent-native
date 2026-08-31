import { agentNativePath } from "@agent-native/core/client/api-path";

interface UploadChunkRequestOptions {
  url: string;
  body: ArrayBuffer;
  contentType: string;
  signal?: AbortSignal;
}

/** Retry one chunk after refreshing a browser session that returned 401. */
export async function uploadChunkRequest({
  url,
  body,
  contentType,
  signal,
}: UploadChunkRequestOptions): Promise<Response> {
  const request = (authorization?: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
      },
      credentials: "include",
      body,
      signal,
    });

  const response = await request();
  if (response.status !== 401) return response;

  let sessionResponse: Response;
  try {
    sessionResponse = await fetch(
      agentNativePath("/_agent-native/auth/session"),
      { cache: "no-store", credentials: "include", signal },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    return response;
  }
  if (!sessionResponse.ok) return response;

  const session = (await sessionResponse.json().catch(() => null)) as {
    token?: unknown;
  } | null;
  if (typeof session?.token !== "string" || !session.token) return response;

  return request(session.token);
}
