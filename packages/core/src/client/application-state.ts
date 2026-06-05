import { agentNativePath } from "./api-path.js";

const APP_STATE_KEY_PATTERN = /^[a-zA-Z0-9_:-]+$/;

export interface ClientAppStateReadOptions {
  signal?: AbortSignal;
}

export interface ClientAppStateWriteOptions {
  keepalive?: boolean;
  requestSource?: string;
  signal?: AbortSignal;
}

function appStateUrl(key: string): string {
  if (!APP_STATE_KEY_PATTERN.test(key)) {
    throw new TypeError(
      "Application state keys may only contain letters, numbers, underscores, hyphens, and colons.",
    );
  }
  return agentNativePath(`/_agent-native/application-state/${key}`);
}

function buildHeaders(requestSource?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (requestSource) headers["X-Request-Source"] = requestSource;
  return headers;
}

async function parseAppStateResponse<T>(
  response: Response,
  operation: string,
): Promise<T> {
  let raw = "";
  try {
    raw = await response.text();
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    const error = new Error(
      `${operation} failed: response body could not be read: ${cause}`,
    );
    (error as { status?: number }).status = response.status;
    throw error;
  }

  let data: unknown = undefined;
  if (raw.length > 0) {
    try {
      data = JSON.parse(raw);
    } catch {
      if (response.ok) {
        const error = new Error(
          `${operation} returned a non-JSON ${response.status} response: ${raw.slice(
            0,
            200,
          )}`,
        );
        (error as { status?: number }).status = response.status;
        throw error;
      }
    }
  }

  if (!response.ok) {
    const message =
      (data &&
        typeof data === "object" &&
        ("error" in data || "message" in data) &&
        String(
          (data as { error?: unknown; message?: unknown }).error ??
            (data as { error?: unknown; message?: unknown }).message,
        )) ||
      raw.slice(0, 200) ||
      response.statusText ||
      `HTTP ${response.status}`;
    const error = new Error(`${operation} failed: ${message}`);
    (error as { status?: number }).status = response.status;
    throw error;
  }

  return (data ?? null) as T;
}

function jsonBody(value: unknown): string {
  const body = JSON.stringify(value);
  if (body === undefined) {
    throw new TypeError(
      "Application state values must be JSON-serializable. Use deleteClientAppState or setClientAppState with undefined to clear a key.",
    );
  }
  return body;
}

export async function readClientAppState<T = unknown>(
  key: string,
  options: ClientAppStateReadOptions = {},
): Promise<T | null> {
  const response = await fetch(appStateUrl(key), {
    method: "GET",
    cache: "no-store",
    signal: options.signal,
  });
  return parseAppStateResponse<T | null>(
    response,
    `Read application state "${key}"`,
  );
}

export async function writeClientAppState<T = unknown>(
  key: string,
  value: T,
  options: ClientAppStateWriteOptions = {},
): Promise<T> {
  const response = await fetch(appStateUrl(key), {
    method: "PUT",
    headers: buildHeaders(options.requestSource),
    body: jsonBody(value),
    keepalive: options.keepalive,
    signal: options.signal,
  });
  return parseAppStateResponse<T>(response, `Write application state "${key}"`);
}

export async function deleteClientAppState(
  key: string,
  options: ClientAppStateWriteOptions = {},
): Promise<void> {
  const response = await fetch(appStateUrl(key), {
    method: "DELETE",
    headers: options.requestSource
      ? { "X-Request-Source": options.requestSource }
      : undefined,
    keepalive: options.keepalive,
    signal: options.signal,
  });
  await parseAppStateResponse<unknown>(
    response,
    `Delete application state "${key}"`,
  );
}

export async function setClientAppState<T = unknown>(
  key: string,
  value: T | null | undefined,
  options: ClientAppStateWriteOptions = {},
): Promise<T | null> {
  if (value === null || value === undefined) {
    await deleteClientAppState(key, options);
    return null;
  }
  return writeClientAppState(key, value, options);
}
