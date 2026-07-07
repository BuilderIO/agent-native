import crypto from "node:crypto";

export const MEDIA_WORKER_TIMESTAMP_HEADER = "x-clips-media-worker-timestamp";
export const MEDIA_WORKER_SIGNATURE_HEADER = "x-clips-media-worker-signature";
export const MEDIA_WORKER_SIGNATURE_VERSION = "v1";
export const MEDIA_WORKER_MAX_SKEW_MS = 5 * 60 * 1000;

export interface MediaWorkerJob {
  jobId: string;
  kind: "compress" | "assemble";
  inputs: string[];
  output: { url: string };
  transcode?: {
    maxWidth?: number;
    targetBitrateKbps?: number;
    format: "mp4";
  };
  callback: { url: string };
}

export interface MediaWorkerCallback {
  jobId: string;
  status: "done" | "failed";
  outputUrl?: string;
  error?: string;
  durationMs?: number;
}

export interface MediaWorkerSignatureHeaders {
  [MEDIA_WORKER_TIMESTAMP_HEADER]: string;
  [MEDIA_WORKER_SIGNATURE_HEADER]: string;
}

export type MediaWorkerSignatureFailure =
  | "missing-secret"
  | "missing-headers"
  | "stale-timestamp"
  | "bad-signature";

export type MediaWorkerSignatureResult =
  | { ok: true }
  | { ok: false; reason: MediaWorkerSignatureFailure };

function rawBodyString(rawBody: string | Uint8Array): string {
  return typeof rawBody === "string"
    ? rawBody
    : Buffer.from(rawBody).toString("utf8");
}

function signaturePayload(rawBody: string | Uint8Array, timestamp: string) {
  return `${MEDIA_WORKER_SIGNATURE_VERSION}:${timestamp}:${rawBodyString(rawBody)}`;
}

export function signMediaWorkerPayload(args: {
  rawBody: string | Uint8Array;
  secret: string;
  timestamp?: string;
}): MediaWorkerSignatureHeaders {
  const timestamp = args.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const digest = crypto
    .createHmac("sha256", args.secret)
    .update(signaturePayload(args.rawBody, timestamp))
    .digest("hex");
  return {
    [MEDIA_WORKER_TIMESTAMP_HEADER]: timestamp,
    [MEDIA_WORKER_SIGNATURE_HEADER]: `${MEDIA_WORKER_SIGNATURE_VERSION}=${digest}`,
  };
}

export function verifyMediaWorkerSignature(args: {
  rawBody: string | Uint8Array;
  secret: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  nowMs?: number;
  maxSkewMs?: number;
}): MediaWorkerSignatureResult {
  const {
    rawBody,
    secret,
    timestamp,
    signature,
    nowMs = Date.now(),
    maxSkewMs = MEDIA_WORKER_MAX_SKEW_MS,
  } = args;
  if (!secret) return { ok: false, reason: "missing-secret" };
  if (!timestamp || !signature) return { ok: false, reason: "missing-headers" };

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: "stale-timestamp" };
  if (Math.abs(nowMs - ts * 1000) > maxSkewMs) {
    return { ok: false, reason: "stale-timestamp" };
  }

  const expected = signMediaWorkerPayload({
    rawBody,
    secret,
    timestamp,
  })[MEDIA_WORKER_SIGNATURE_HEADER];
  try {
    const supplied = Buffer.from(signature);
    const actual = Buffer.from(expected);
    if (supplied.length !== actual.length) {
      return { ok: false, reason: "bad-signature" };
    }
    return crypto.timingSafeEqual(supplied, actual)
      ? { ok: true }
      : { ok: false, reason: "bad-signature" };
  } catch {
    return { ok: false, reason: "bad-signature" };
  }
}

export function parseMediaWorkerCallback(
  value: unknown,
): MediaWorkerCallback | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.jobId !== "string" || !body.jobId) return null;
  if (body.status !== "done" && body.status !== "failed") return null;
  if (
    body.outputUrl !== undefined &&
    (typeof body.outputUrl !== "string" || !body.outputUrl)
  ) {
    return null;
  }
  if (body.error !== undefined && typeof body.error !== "string") return null;
  if (
    body.durationMs !== undefined &&
    (typeof body.durationMs !== "number" ||
      !Number.isFinite(body.durationMs) ||
      body.durationMs < 0)
  ) {
    return null;
  }
  return {
    jobId: body.jobId,
    status: body.status,
    outputUrl: body.outputUrl,
    error: body.error,
    durationMs:
      typeof body.durationMs === "number"
        ? Math.round(body.durationMs)
        : undefined,
  };
}
