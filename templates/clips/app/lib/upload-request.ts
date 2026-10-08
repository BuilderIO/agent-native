import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";

interface UploadChunkRequestOptions {
  url: string;
  body: ArrayBuffer;
  contentType: string;
  signal?: AbortSignal;
}

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

  let session: { token?: unknown } | null;
  try {
    session = (await sessionResponse.json()) as {
      token?: unknown;
    } | null;
  } catch {
    return response;
  }
  if (typeof session?.token !== "string" || !session.token) return response;

  return request(session.token);
}

/** The owner-scoped upload status route; 404 means this account has no row. */
export function fetchUploadStatus(
  recordingId: string,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(
    `${appBasePath()}/api/uploads/${encodeURIComponent(recordingId)}/status`,
    { cache: "no-store", credentials: "include", signal },
  );
}

/**
 * Mark an upload attempt failed with its classified code. `keepalive` lets
 * it outlive a closing page.
 */
export function postUploadAbort(
  abortUrl: string,
  body: { reason: string; failureCode: string; httpStatus?: number },
): Promise<Response> {
  return fetch(abortUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    keepalive: true,
    body: JSON.stringify(body),
  });
}
