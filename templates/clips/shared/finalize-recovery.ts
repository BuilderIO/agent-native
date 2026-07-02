type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type RecoveredReadyRecording = {
  ok: true;
  finalized: true;
  recoveredAfterFinalizeError: true;
  id: string;
  recordingId: string;
  status: "ready";
  videoUrl: string;
  durationMs?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  hasCamera?: boolean;
};

type ProbeResult =
  | { ready: true; result: RecoveredReadyRecording }
  | { ready: false; terminal: boolean; status?: string };

const DEFAULT_READY_RECOVERY_TIMEOUT_MS = 90_000;
const DEFAULT_READY_RECOVERY_INTERVAL_MS = 3_000;
const DEFAULT_READY_RECOVERY_FETCH_TIMEOUT_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function absoluteUploadUrl(uploadUrl: string): URL {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uploadUrl)) return new URL(uploadUrl);
  const origin =
    typeof globalThis.location?.origin === "string"
      ? globalThis.location.origin
      : "http://localhost";
  return new URL(uploadUrl, origin);
}

function maybeRelativeUrl(url: URL, original: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(original)) return url.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

export function publicRecordingStatusUrl(
  uploadUrl: string,
  recordingId: string,
): string {
  const url = absoluteUploadUrl(uploadUrl);
  const match = url.pathname.match(/^(.*)\/api\/uploads\/[^/]+\/chunk$/);
  const basePath = match?.[1] ?? "";
  url.pathname = `${basePath}/api/public-recording`;
  url.search = "";
  url.searchParams.set("id", recordingId);
  return maybeRelativeUrl(url, uploadUrl);
}

export function authenticatedRecordingStatusUrl(
  uploadUrl: string,
  recordingId: string,
): string {
  const url = absoluteUploadUrl(uploadUrl);
  const match = url.pathname.match(/^(.*)\/api\/uploads\/[^/]+\/chunk$/);
  const basePath = match?.[1] ?? "";
  url.pathname = `${basePath}/api/uploads/${encodeURIComponent(
    recordingId,
  )}/status`;
  url.search = "";
  return maybeRelativeUrl(url, uploadUrl);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function readyRecordingFromPublicPayload(
  payload: unknown,
  fallbackRecordingId: string,
): ProbeResult {
  const root =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  const recording =
    root?.recording && typeof root.recording === "object"
      ? (root.recording as Record<string, unknown>)
      : null;
  const status =
    typeof recording?.status === "string" ? recording.status : undefined;

  if (!recording) return { ready: false, terminal: false };
  if (status === "failed") return { ready: false, terminal: true, status };

  const videoUrl =
    typeof recording.videoUrl === "string" ? recording.videoUrl : "";
  if (status !== "ready" || !videoUrl) {
    return { ready: false, terminal: false, status };
  }

  const id =
    typeof recording.id === "string" && recording.id
      ? recording.id
      : fallbackRecordingId;
  return {
    ready: true,
    result: {
      ok: true,
      finalized: true,
      recoveredAfterFinalizeError: true,
      id,
      recordingId: id,
      status: "ready",
      videoUrl,
      durationMs: optionalNumber(recording.durationMs),
      width: optionalNumber(recording.width),
      height: optionalNumber(recording.height),
      hasAudio: optionalBoolean(recording.hasAudio),
      hasCamera: optionalBoolean(recording.hasCamera),
    },
  };
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (timeoutMs <= 0 || typeof AbortController === "undefined") {
    return fetchImpl(url, init);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForReadyRecordingAfterFinalizeError(args: {
  uploadUrl: string;
  recordingId: string;
  authToken?: string | null;
  preferAuthenticated?: boolean;
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  intervalMs?: number;
  fetchTimeoutMs?: number;
}): Promise<RecoveredReadyRecording | null> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const sleepImpl = args.sleepImpl ?? sleep;
  const timeoutMs = Math.max(
    1,
    args.timeoutMs ?? DEFAULT_READY_RECOVERY_TIMEOUT_MS,
  );
  const intervalMs = Math.max(
    1,
    args.intervalMs ?? DEFAULT_READY_RECOVERY_INTERVAL_MS,
  );
  const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  let url: string;
  let authenticatedUrl: string | null = null;
  try {
    url = publicRecordingStatusUrl(args.uploadUrl, args.recordingId);
    authenticatedUrl =
      args.authToken || args.preferAuthenticated
        ? authenticatedRecordingStatusUrl(args.uploadUrl, args.recordingId)
        : null;
  } catch {
    return null;
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const urls = authenticatedUrl
      ? [
          { url: authenticatedUrl, authenticated: true },
          { url, authenticated: false },
        ]
      : [{ url, authenticated: false }];

    for (const endpoint of urls) {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Agent-Native-Frontend": "1",
      };
      if (endpoint.authenticated && args.authToken) {
        headers.Authorization = `Bearer ${args.authToken}`;
      }

      try {
        const response = await fetchWithTimeout(
          fetchImpl,
          endpoint.url,
          {
            method: "GET",
            headers,
            credentials: "include",
            cache: "no-store",
          },
          args.fetchTimeoutMs ?? DEFAULT_READY_RECOVERY_FETCH_TIMEOUT_MS,
        );

        if (response.ok) {
          const payload = await response.json().catch(() => null);
          const probe = readyRecordingFromPublicPayload(
            payload,
            args.recordingId,
          );
          if (probe.ready) return probe.result;
          if (probe.terminal) return null;
          break;
        }

        if (
          response.status >= 400 &&
          response.status < 500 &&
          !endpoint.authenticated &&
          !authenticatedUrl
        ) {
          return null;
        }
      } catch {
        // Try the public endpoint fallback below, then keep polling.
      }
    }

    if (attempt < attempts - 1) await sleepImpl(intervalMs);
  }

  return null;
}
