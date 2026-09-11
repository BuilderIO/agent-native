import { resolveSecret } from "@agent-native/core/server";

import {
  MEDIA_WORKER_SIGNATURE_HEADER,
  MEDIA_WORKER_TIMESTAMP_HEADER,
  type MediaWorkerJob,
  signMediaWorkerPayload,
} from "../../shared/media-worker-contract.js";
import { enabledFlag } from "./env-flags.js";

export const CLIPS_MEDIA_WORKER_ENABLED = "CLIPS_MEDIA_WORKER_ENABLED";
export const CLIPS_MEDIA_WORKER_URL = "CLIPS_MEDIA_WORKER_URL";
export const CLIPS_MEDIA_WORKER_SECRET = "CLIPS_MEDIA_WORKER_SECRET";

const ENQUEUE_TIMEOUT_MS = 15_000;

export type MediaWorkerConfig =
  | { enabled: false }
  | {
      enabled: true;
      ready: false;
      reason: string;
    }
  | {
      enabled: true;
      ready: true;
      url: string;
      secret: string;
      callbackUrl: string;
    };

async function resolveWorkerValue(key: string): Promise<string | null> {
  return (await resolveSecret(key).catch(() => null)) ?? null;
}

function appBaseUrl(): string | null {
  const raw =
    process.env.APP_URL ||
    process.env.BETTER_AUTH_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function appPath(path: string): string {
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return base ? `/${base}${path}` : path;
}

function callbackUrl(): string | null {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}${appPath("/api/media-worker/callback")}`;
}

export async function resolveMediaWorkerConfig(): Promise<MediaWorkerConfig> {
  const enabledRaw = await resolveWorkerValue(CLIPS_MEDIA_WORKER_ENABLED);
  if (!enabledFlag(enabledRaw)) return { enabled: false };

  const [urlRaw, secretRaw] = await Promise.all([
    resolveWorkerValue(CLIPS_MEDIA_WORKER_URL),
    resolveWorkerValue(CLIPS_MEDIA_WORKER_SECRET),
  ]);
  const url = urlRaw?.trim() ?? "";
  const secret = secretRaw?.trim() ?? "";
  if (!url || !secret) {
    return {
      enabled: true,
      ready: false,
      reason:
        "CLIPS_MEDIA_WORKER_URL and CLIPS_MEDIA_WORKER_SECRET are required",
    };
  }
  try {
    new URL(url);
  } catch {
    return {
      enabled: true,
      ready: false,
      reason: "CLIPS_MEDIA_WORKER_URL must be an absolute URL",
    };
  }

  const cb = callbackUrl();
  if (!cb) {
    return {
      enabled: true,
      ready: false,
      reason:
        "APP_URL or BETTER_AUTH_URL is required to build the media worker callback URL",
    };
  }

  return { enabled: true, ready: true, url, secret, callbackUrl: cb };
}

export function mediaWorkerCompressionJobId(recordingId: string): string {
  return `${recordingId}:compress`;
}

export function mediaWorkerJobRecordingId(
  jobId: string,
  kind: MediaWorkerJob["kind"] = "compress",
): string | null {
  const suffix = `:${kind}`;
  if (!jobId.endsWith(suffix)) return null;
  const recordingId = jobId.slice(0, -suffix.length);
  return recordingId || null;
}

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENQUEUE_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

export async function enqueueMediaWorkerJob(
  config: Extract<MediaWorkerConfig, { ready: true }>,
  job: MediaWorkerJob,
): Promise<void> {
  const rawBody = JSON.stringify(job);
  const signatureHeaders = signMediaWorkerPayload({
    rawBody,
    secret: config.secret,
  });
  const res = await fetchWithTimeout(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [MEDIA_WORKER_TIMESTAMP_HEADER]:
        signatureHeaders[MEDIA_WORKER_TIMESTAMP_HEADER],
      [MEDIA_WORKER_SIGNATURE_HEADER]:
        signatureHeaders[MEDIA_WORKER_SIGNATURE_HEADER],
    },
    body: rawBody,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Media worker enqueue failed (${res.status}): ${body.slice(0, 500) || res.statusText}`,
    );
  }
}
