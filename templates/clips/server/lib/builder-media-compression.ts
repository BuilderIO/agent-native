import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { getDbExec } from "@agent-native/core/db";
import {
  captureRouteError,
  getRequestOrgId,
  resolveBuilderPrivateKey,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";

import type { MediaWorkerCallback } from "../../shared/media-worker-contract.js";
import { getDb, schema } from "../db/index.js";
import { enabledFlag } from "./env-flags.js";
import {
  enqueueMediaWorkerJob,
  mediaWorkerCompressionJobId,
  mediaWorkerJobRecordingId,
  resolveMediaWorkerConfig,
  type MediaWorkerConfig,
} from "./media-worker.js";
import { ownerEmailMatches } from "./recordings.js";

const BUILDER_CDN_HOST_RE = /^cdn(?:-qa)?\.builder\.io$/i;
const DEFAULT_TRIGGER_TIMEOUT_MS = 45_000;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_TRIGGER_ATTEMPTS = 5;
const TRIGGERED_POLL_DELAY_MS = 5 * 60 * 1000;
const TRIGGERED_RETRY_AFTER_MS = 15 * 60 * 1000;
const MEDIA_WORKER_STUCK_MS = 30 * 60 * 1000;
const MEDIA_WORKER_MAX_ENQUEUE_ATTEMPTS = 2;
export const CLIPS_DISABLE_BUILDER_COMPRESSION =
  "CLIPS_DISABLE_BUILDER_COMPRESSION";

export const BUILDER_MEDIA_COMPRESSION_STATE_PREFIX =
  "recording-builder-compression-";

type BuilderCompressionStatus =
  | "queued"
  | "triggered"
  | "retry"
  | "ready"
  | "failed"
  | "skipped-source-changed"
  | "skipped-too-large"
  | "worker-queued"
  | "worker-processing";

export interface BuilderMediaTarget {
  sourceUrl: string;
  compressedUrl: string;
  origin: string;
  objectPath: string;
  apiKey: string;
  assetId: string;
}

interface BuilderMediaCompressionState extends BuilderMediaTarget {
  recordingId: string;
  ownerEmail: string;
  orgId?: string | null;
  providerId?: string | null;
  assetDbId?: string | null;
  mimeType?: string | null;
  sourceSizeBytes?: number | null;
  status: BuilderCompressionStatus;
  attempts: number;
  queuedAt: string;
  updatedAt: string;
  nextAttemptAt?: string | null;
  lastTriggeredAt?: string | null;
  completedAt?: string | null;
  detail?: string | null;
  mediaWorker?: {
    jobId: string;
    outputUrl: string;
    callbackUrl: string;
    attempts: number;
    enqueuedAt?: string | null;
    lastEnqueueAt?: string | null;
  } | null;
}

export function builderMediaCompressionStateKey(recordingId: string): string {
  return `${BUILDER_MEDIA_COMPRESSION_STATE_PREFIX}${recordingId}`;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function triggerTimeoutMs(): number {
  return envNumber(
    "CLIPS_BUILDER_COMPRESSION_TRIGGER_TIMEOUT_MS",
    DEFAULT_TRIGGER_TIMEOUT_MS,
  );
}

function probeTimeoutMs(): number {
  return envNumber(
    "CLIPS_BUILDER_COMPRESSION_PROBE_TIMEOUT_MS",
    DEFAULT_PROBE_TIMEOUT_MS,
  );
}

function maxSourceBytes(): number {
  return envNumber(
    "CLIPS_BUILDER_BACKGROUND_COMPRESSION_MAX_BYTES",
    DEFAULT_MAX_SOURCE_BYTES,
  );
}

function builderCompressionDisabled(): boolean {
  return enabledFlag(process.env[CLIPS_DISABLE_BUILDER_COMPRESSION]);
}

function retryDelayMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

function isoAfter(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function isDue(state: BuilderMediaCompressionState): boolean {
  if (!state.nextAttemptAt) return true;
  const dueAt = new Date(state.nextAttemptAt).getTime();
  return !Number.isFinite(dueAt) || dueAt <= Date.now();
}

function isFinalStatus(status: BuilderCompressionStatus): boolean {
  return (
    status === "ready" ||
    status === "failed" ||
    status === "skipped-source-changed" ||
    status === "skipped-too-large"
  );
}

function isMediaWorkerStatus(status: BuilderCompressionStatus): boolean {
  return status === "worker-queued" || status === "worker-processing";
}

function isVideoMimeType(mimeType: string | null | undefined): boolean {
  return !mimeType || /^video\//i.test(mimeType.split(";")[0]?.trim() ?? "");
}

function parsePositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return undefined;
}

function headerByteLength(headers: Headers): number | undefined {
  const length = parsePositiveNumber(headers.get("content-length"));
  if (length) return length;
  const range = headers.get("content-range") ?? "";
  const total = range.match(/\/(\d+)$/)?.[1];
  return parsePositiveNumber(total);
}

function timeoutError(label: string, timeoutMs: number): Error {
  const err = new Error(`${label} timed out after ${timeoutMs}ms`);
  err.name = "AbortError";
  return err;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw timeoutError(label, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || /timed out|timeout/i.test(err.message))
  );
}

async function responseSnippet(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return text.slice(0, 500);
}

function parseState(
  value: Record<string, unknown> | null,
): BuilderMediaCompressionState | null {
  if (!value) return null;
  const recordingId =
    typeof value.recordingId === "string" ? value.recordingId : null;
  const ownerEmail =
    typeof value.ownerEmail === "string" ? value.ownerEmail : null;
  const sourceUrl =
    typeof value.sourceUrl === "string" ? value.sourceUrl : null;
  const compressedUrl =
    typeof value.compressedUrl === "string" ? value.compressedUrl : null;
  const objectPath =
    typeof value.objectPath === "string" ? value.objectPath : null;
  const origin = typeof value.origin === "string" ? value.origin : null;
  const apiKey = typeof value.apiKey === "string" ? value.apiKey : null;
  const assetId = typeof value.assetId === "string" ? value.assetId : null;
  const status = typeof value.status === "string" ? value.status : "queued";
  if (
    !recordingId ||
    !ownerEmail ||
    !sourceUrl ||
    !compressedUrl ||
    !objectPath ||
    !origin ||
    !apiKey ||
    !assetId
  ) {
    return null;
  }
  return {
    recordingId,
    ownerEmail,
    sourceUrl,
    compressedUrl,
    objectPath,
    origin,
    apiKey,
    assetId,
    status: status as BuilderCompressionStatus,
    attempts: parsePositiveNumber(value.attempts) ?? 0,
    queuedAt:
      typeof value.queuedAt === "string"
        ? value.queuedAt
        : new Date().toISOString(),
    updatedAt:
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : new Date().toISOString(),
    orgId: typeof value.orgId === "string" ? value.orgId : null,
    providerId: typeof value.providerId === "string" ? value.providerId : null,
    assetDbId: typeof value.assetDbId === "string" ? value.assetDbId : null,
    mimeType: typeof value.mimeType === "string" ? value.mimeType : null,
    sourceSizeBytes: parsePositiveNumber(value.sourceSizeBytes) ?? null,
    nextAttemptAt:
      typeof value.nextAttemptAt === "string" ? value.nextAttemptAt : null,
    lastTriggeredAt:
      typeof value.lastTriggeredAt === "string" ? value.lastTriggeredAt : null,
    completedAt:
      typeof value.completedAt === "string" ? value.completedAt : null,
    detail: typeof value.detail === "string" ? value.detail : null,
    mediaWorker: parseMediaWorkerState(value.mediaWorker),
  };
}

function parseMediaWorkerState(
  value: unknown,
): BuilderMediaCompressionState["mediaWorker"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const jobId = typeof raw.jobId === "string" ? raw.jobId : "";
  const outputUrl = typeof raw.outputUrl === "string" ? raw.outputUrl : "";
  const callbackUrl =
    typeof raw.callbackUrl === "string" ? raw.callbackUrl : "";
  if (!jobId || !outputUrl || !callbackUrl) return null;
  return {
    jobId,
    outputUrl,
    callbackUrl,
    attempts: parsePositiveNumber(raw.attempts) ?? 0,
    enqueuedAt: typeof raw.enqueuedAt === "string" ? raw.enqueuedAt : null,
    lastEnqueueAt:
      typeof raw.lastEnqueueAt === "string" ? raw.lastEnqueueAt : null,
  };
}

function cleanSourceUrl(url: URL): string {
  const copy = new URL(url.toString());
  copy.hash = "";
  return copy.toString();
}

export function extractBuilderMediaTarget(
  sourceUrl: string,
): BuilderMediaTarget | null {
  try {
    const url = new URL(sourceUrl);
    if (!BUILDER_CDN_HOST_RE.test(url.hostname)) return null;
    if (url.searchParams.get("optimized") === "true") return null;

    let objectPath: string | null = null;
    if (url.pathname.startsWith("/o/")) {
      objectPath = decodeURIComponent(url.pathname.slice("/o/".length));
    } else if (url.pathname.startsWith("/api/v1/file/")) {
      objectPath = decodeURIComponent(
        url.pathname.slice("/api/v1/file/".length),
      );
    }
    if (!objectPath || !objectPath.startsWith("assets/")) return null;
    if (objectPath.endsWith("/compressed")) return null;

    const parts = objectPath.split("/");
    const assetId = parts[parts.length - 1];
    const apiKey = url.searchParams.get("apiKey") || parts[1];
    if (!assetId || !apiKey) return null;

    const compressedPath = `${objectPath}/compressed`;
    const compressedUrl = new URL(
      `/o/${encodeURIComponent(compressedPath)}`,
      url.origin,
    );
    compressedUrl.searchParams.set("apiKey", apiKey);
    compressedUrl.searchParams.set(
      "token",
      url.searchParams.get("token") || assetId,
    );
    compressedUrl.searchParams.set("alt", "media");
    compressedUrl.searchParams.set("optimized", "true");

    return {
      sourceUrl: cleanSourceUrl(url),
      compressedUrl: compressedUrl.toString(),
      origin: url.origin,
      objectPath,
      apiKey,
      assetId,
    };
  } catch {
    return null;
  }
}

export function builderCompressedMediaUrl(sourceUrl: string): string | null {
  return extractBuilderMediaTarget(sourceUrl)?.compressedUrl ?? null;
}

async function probeCompressedMedia(
  compressedUrl: string,
): Promise<{ exists: boolean; sizeBytes?: number }> {
  const timeoutMs = probeTimeoutMs();
  let res = await fetchWithTimeout(
    compressedUrl,
    { method: "HEAD" },
    timeoutMs,
    "Builder compressed-media probe",
  );
  if (res.status === 405) {
    res = await fetchWithTimeout(
      compressedUrl,
      { method: "GET", headers: { Range: "bytes=0-0" } },
      timeoutMs,
      "Builder compressed-media probe",
    );
  }
  if (
    (res.status >= 200 && res.status < 300) ||
    res.status === 304 ||
    res.status === 206
  ) {
    return { exists: true, sizeBytes: headerByteLength(res.headers) };
  }
  if ([403, 404, 416].includes(res.status)) return { exists: false };
  throw new Error(`Compressed media probe failed (${res.status})`);
}

async function triggerBuilderCompression(
  state: BuilderMediaCompressionState,
): Promise<string | null> {
  const privateKey = await resolveBuilderPrivateKey();
  if (!privateKey) {
    throw new Error("Builder private key is not configured");
  }

  const url = new URL(
    `/api/v1/compress-media/${encodeURIComponent(state.objectPath)}`,
    state.origin,
  );
  url.searchParams.set("apiKey", state.apiKey);
  if (state.assetDbId) url.searchParams.set("assetDbId", state.assetDbId);

  const res = await fetchWithTimeout(
    url.toString(),
    { headers: { authorization: `Bearer ${privateKey}` } },
    triggerTimeoutMs(),
    "Builder media compression trigger",
  );
  if (!res.ok) {
    const body = await responseSnippet(res);
    throw new Error(
      `Builder media compression trigger failed (${res.status}): ${body || res.statusText}`,
    );
  }
  const json = (await res.json().catch(() => null)) as { url?: string } | null;
  return typeof json?.url === "string" ? json.url : null;
}

async function enqueueWorkerCompression(
  state: BuilderMediaCompressionState,
  config: Extract<MediaWorkerConfig, { ready: true }>,
  attempts: number,
): Promise<BuilderMediaCompressionState> {
  const jobId =
    state.mediaWorker?.jobId ?? mediaWorkerCompressionJobId(state.recordingId);
  const outputUrl = state.mediaWorker?.outputUrl ?? state.compressedUrl;
  const callbackUrl = config.callbackUrl;
  await enqueueMediaWorkerJob(config, {
    jobId,
    kind: "compress",
    inputs: [state.sourceUrl],
    output: { url: outputUrl },
    transcode: { format: "mp4" },
    callback: { url: callbackUrl },
  });

  const now = new Date().toISOString();
  return writeCompressionState(state, {
    status: "worker-queued",
    attempts,
    nextAttemptAt: isoAfter(MEDIA_WORKER_STUCK_MS),
    detail: null,
    mediaWorker: {
      jobId,
      outputUrl,
      callbackUrl,
      attempts,
      enqueuedAt: state.mediaWorker?.enqueuedAt ?? now,
      lastEnqueueAt: now,
    },
  });
}

async function writeCompressionState(
  state: BuilderMediaCompressionState,
  patch: Partial<BuilderMediaCompressionState>,
): Promise<BuilderMediaCompressionState> {
  const next = {
    ...state,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeAppState(
    builderMediaCompressionStateKey(state.recordingId),
    next as unknown as Record<string, unknown>,
  );
  return next;
}

async function markCompressionFailed(
  state: BuilderMediaCompressionState,
  detail: string,
): Promise<BuilderMediaCompressionState> {
  const next = await writeCompressionState(state, {
    status: "failed",
    detail,
    nextAttemptAt: null,
  });
  try {
    captureRouteError(new Error(detail), {
      route: "builder-media-compression",
      tags: { stage: "failed" },
      extra: {
        recordingId: state.recordingId,
        sourceUrl: state.sourceUrl,
        compressedUrl: state.compressedUrl,
        attempts: state.attempts,
      },
    });
  } catch {
    // Best-effort telemetry must never mask the durable failure state.
  }
  return next;
}

async function swapRecordingToCompressed(
  state: BuilderMediaCompressionState,
  compressedUrl: string,
  sizeBytes?: number,
): Promise<BuilderMediaCompressionState> {
  const db = getDb();
  const [row] = await db
    .select({ videoUrl: schema.recordings.videoUrl })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, state.recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, state.ownerEmail),
      ),
    )
    .limit(1);

  if (!row) {
    return markCompressionFailed(state, "Recording row no longer exists");
  }

  if (row.videoUrl === compressedUrl) {
    return writeCompressionState(state, {
      status: "ready",
      compressedUrl,
      completedAt: new Date().toISOString(),
      nextAttemptAt: null,
      detail: null,
    });
  }

  if (row.videoUrl !== state.sourceUrl) {
    return writeCompressionState(state, {
      status: "skipped-source-changed",
      detail: "Recording media URL changed before compression finished",
      nextAttemptAt: null,
    });
  }

  await db
    .update(schema.recordings)
    .set({
      videoUrl: compressedUrl,
      ...(sizeBytes ? { videoSizeBytes: sizeBytes } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.recordings.id, state.recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, state.ownerEmail),
        eq(schema.recordings.videoUrl, state.sourceUrl),
      ),
    );

  const [afterUpdate] = await db
    .select({ videoUrl: schema.recordings.videoUrl })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, state.recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, state.ownerEmail),
      ),
    )
    .limit(1);
  if (!afterUpdate) {
    return markCompressionFailed(state, "Recording row no longer exists");
  }
  if (afterUpdate.videoUrl !== compressedUrl) {
    return writeCompressionState(state, {
      status: "skipped-source-changed",
      detail: "Recording media URL changed before compression finished",
      nextAttemptAt: null,
    });
  }

  await writeAppState("refresh-signal", { ts: Date.now() });
  return writeCompressionState(state, {
    status: "ready",
    compressedUrl,
    completedAt: new Date().toISOString(),
    nextAttemptAt: null,
    detail: null,
  });
}

async function processMediaWorkerState(
  state: BuilderMediaCompressionState,
): Promise<BuilderMediaCompressionState> {
  const worker = state.mediaWorker;
  if (!worker) return state;
  if (!isDue(state)) return state;

  const probe = await probeCompressedMedia(worker.outputUrl).catch(() => null);
  if (probe?.exists) {
    return swapRecordingToCompressed(state, worker.outputUrl, probe.sizeBytes);
  }

  if (worker.attempts >= MEDIA_WORKER_MAX_ENQUEUE_ATTEMPTS) {
    return markCompressionFailed(
      state,
      `Media worker job ${worker.jobId} did not complete before the retry limit`,
    );
  }

  const config = await resolveMediaWorkerConfig();
  if (!config.enabled) {
    return markCompressionFailed(
      state,
      "Media worker was disabled before the compression job completed",
    );
  }
  if (!config.ready) {
    return writeCompressionState(state, {
      status: "retry",
      nextAttemptAt: isoAfter(retryDelayMs(worker.attempts + 1)),
      detail: config.reason,
    });
  }

  try {
    return await enqueueWorkerCompression(state, config, worker.attempts + 1);
  } catch (err) {
    const attempts = worker.attempts + 1;
    if (attempts >= MEDIA_WORKER_MAX_ENQUEUE_ATTEMPTS) {
      return markCompressionFailed(
        state,
        `Media worker re-enqueue failed: ${errorMessage(err)}`,
      );
    }
    return writeCompressionState(state, {
      status: "retry",
      attempts,
      nextAttemptAt: isoAfter(retryDelayMs(attempts)),
      detail: errorMessage(err),
      mediaWorker: { ...worker, attempts },
    });
  }
}

async function processCompressionState(
  state: BuilderMediaCompressionState,
): Promise<BuilderMediaCompressionState> {
  if (isFinalStatus(state.status) || !isDue(state)) return state;
  if (state.mediaWorker || isMediaWorkerStatus(state.status)) {
    return processMediaWorkerState(state);
  }

  const sourceSizeBytes = state.sourceSizeBytes ?? undefined;
  const compressionMaxBytes = maxSourceBytes();
  if (sourceSizeBytes && sourceSizeBytes > compressionMaxBytes) {
    return writeCompressionState(state, {
      status: "skipped-too-large",
      detail: `Source media is larger than the background compression limit (${sourceSizeBytes} > ${compressionMaxBytes})`,
      nextAttemptAt: null,
    });
  }

  const probe = await probeCompressedMedia(state.compressedUrl);
  if (probe.exists) {
    return swapRecordingToCompressed(
      state,
      state.compressedUrl,
      probe.sizeBytes,
    );
  }

  if (state.status === "triggered" && state.lastTriggeredAt) {
    const lastTriggeredAt = new Date(state.lastTriggeredAt).getTime();
    if (
      Number.isFinite(lastTriggeredAt) &&
      Date.now() - lastTriggeredAt < TRIGGERED_RETRY_AFTER_MS
    ) {
      return writeCompressionState(state, {
        nextAttemptAt: isoAfter(TRIGGERED_POLL_DELAY_MS),
      });
    }
  }

  const attempts = state.attempts + 1;
  try {
    const compressedUrl = await triggerBuilderCompression(state);
    if (compressedUrl) {
      return swapRecordingToCompressed(state, compressedUrl);
    }
    return writeCompressionState(state, {
      status: "triggered",
      attempts,
      lastTriggeredAt: new Date().toISOString(),
      nextAttemptAt: isoAfter(TRIGGERED_POLL_DELAY_MS),
      detail: null,
    });
  } catch (err) {
    const detail = errorMessage(err);
    if (attempts >= MAX_TRIGGER_ATTEMPTS) {
      return markCompressionFailed(
        { ...state, attempts },
        `Builder media compression did not finish after ${attempts} attempts: ${detail}`,
      );
    }
    if (isTimeoutError(err)) {
      return writeCompressionState(state, {
        status: "triggered",
        attempts,
        lastTriggeredAt: new Date().toISOString(),
        nextAttemptAt: isoAfter(TRIGGERED_POLL_DELAY_MS),
        detail,
      });
    }
    return writeCompressionState(state, {
      status: "retry",
      attempts,
      nextAttemptAt: isoAfter(retryDelayMs(attempts)),
      detail,
    });
  }
}

export async function runBuilderMediaCompressionForRecording(args: {
  recordingId: string;
  ownerEmail: string;
  orgId?: string | null;
}): Promise<BuilderMediaCompressionState | null> {
  return runWithRequestContext(
    { userEmail: args.ownerEmail, orgId: args.orgId ?? undefined },
    async () => {
      const raw = await readAppState(
        builderMediaCompressionStateKey(args.recordingId),
      );
      const state = parseState(raw);
      if (!state) return null;
      return processCompressionState(state);
    },
  );
}

export async function queueBuilderMediaCompression(args: {
  recordingId: string;
  ownerEmail: string;
  videoUrl: string | null | undefined;
  mimeType?: string | null;
  providerId?: string | null;
  assetDbId?: string | null;
  sourceSizeBytes?: number | null;
  locallyTranscoded?: boolean;
}): Promise<
  | { queued: true; compressedUrl: string }
  | { queued: false; reason: string; compressedUrl?: string }
> {
  if (builderCompressionDisabled()) {
    return { queued: false, reason: "disabled" };
  }
  if (args.locallyTranscoded) {
    return { queued: false, reason: "locally-transcoded" };
  }
  if (args.providerId && args.providerId !== "builder") {
    return { queued: false, reason: "non-builder-provider" };
  }
  if (!isVideoMimeType(args.mimeType)) {
    return { queued: false, reason: "non-video" };
  }
  const target = extractBuilderMediaTarget(args.videoUrl ?? "");
  if (!target) {
    return { queued: false, reason: "non-builder-media" };
  }

  const sourceSizeBytes = args.sourceSizeBytes ?? null;
  const now = new Date().toISOString();
  const state: BuilderMediaCompressionState = {
    ...target,
    recordingId: args.recordingId,
    ownerEmail: args.ownerEmail,
    orgId: getRequestOrgId() ?? null,
    providerId: args.providerId ?? null,
    assetDbId: args.assetDbId ?? null,
    mimeType: args.mimeType ?? null,
    sourceSizeBytes,
    status: "queued",
    attempts: 0,
    queuedAt: now,
    updatedAt: now,
    nextAttemptAt: now,
  };

  const mediaWorkerConfig = await resolveMediaWorkerConfig();
  if (mediaWorkerConfig.enabled) {
    if (!mediaWorkerConfig.ready) {
      await writeAppState(builderMediaCompressionStateKey(args.recordingId), {
        ...state,
        status: "failed",
        detail: mediaWorkerConfig.reason,
        nextAttemptAt: null,
      } as unknown as Record<string, unknown>);
      return { queued: false, reason: "media-worker-not-configured" };
    }
    try {
      await enqueueWorkerCompression(state, mediaWorkerConfig, 1);
      return { queued: true, compressedUrl: target.compressedUrl };
    } catch (err) {
      await writeAppState(builderMediaCompressionStateKey(args.recordingId), {
        ...state,
        status: "retry",
        attempts: 1,
        detail: errorMessage(err),
        nextAttemptAt: isoAfter(retryDelayMs(1)),
        mediaWorker: {
          jobId: mediaWorkerCompressionJobId(args.recordingId),
          outputUrl: target.compressedUrl,
          callbackUrl: mediaWorkerConfig.callbackUrl,
          attempts: 1,
        },
      } as unknown as Record<string, unknown>);
      return { queued: true, compressedUrl: target.compressedUrl };
    }
  }

  const sourceBytes = sourceSizeBytes ?? undefined;
  const compressionMaxBytes = maxSourceBytes();
  if (sourceBytes && sourceBytes > compressionMaxBytes) {
    await writeAppState(builderMediaCompressionStateKey(args.recordingId), {
      ...state,
      status: "skipped-too-large",
      detail: `Source media is larger than the background compression limit (${sourceBytes} > ${compressionMaxBytes})`,
      nextAttemptAt: null,
    } as unknown as Record<string, unknown>);
    return {
      queued: false,
      reason: "too-large",
      compressedUrl: target.compressedUrl,
    };
  }

  await writeAppState(
    builderMediaCompressionStateKey(args.recordingId),
    state as unknown as Record<string, unknown>,
  );

  void runBuilderMediaCompressionForRecording({
    recordingId: args.recordingId,
    ownerEmail: args.ownerEmail,
    orgId: state.orgId,
  }).catch((err) => {
    console.warn("[builder-media-compression] background run failed", {
      recordingId: args.recordingId,
      error: errorMessage(err),
    });
  });

  return { queued: true, compressedUrl: target.compressedUrl };
}

export async function applyMediaWorkerCallback(
  callback: MediaWorkerCallback,
): Promise<
  | { ok: true; status: number; recordingId: string }
  | { ok: false; status: number; error: string; recordingId?: string }
> {
  const recordingId = mediaWorkerJobRecordingId(callback.jobId, "compress");
  if (!recordingId) {
    return { ok: false, status: 400, error: "Invalid media worker jobId" };
  }

  const db = getDb();
  const [recording] = await db
    .select({
      ownerEmail: schema.recordings.ownerEmail,
      orgId: schema.recordings.orgId,
      videoUrl: schema.recordings.videoUrl,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId))
    .limit(1);
  if (!recording) {
    return {
      ok: false,
      status: 404,
      error: "Recording not found",
      recordingId,
    };
  }

  return runWithRequestContext(
    {
      userEmail: recording.ownerEmail,
      orgId: recording.orgId ?? undefined,
    },
    async () => {
      const raw = await readAppState(
        builderMediaCompressionStateKey(recordingId),
      );
      const state = parseState(raw);
      if (!state?.mediaWorker || state.mediaWorker.jobId !== callback.jobId) {
        return {
          ok: false,
          status: 404,
          error: "Media worker job not found",
          recordingId,
        };
      }

      if (callback.status === "failed") {
        await markCompressionFailed(
          state,
          callback.error || "Media worker reported failure",
        );
        return { ok: true, status: 200, recordingId };
      }

      const outputUrl = callback.outputUrl;
      if (!outputUrl) {
        return {
          ok: false,
          status: 400,
          error: "Media worker callback missing outputUrl",
          recordingId,
        };
      }
      if (outputUrl !== state.mediaWorker.outputUrl) {
        return {
          ok: false,
          status: 400,
          error: "Media worker outputUrl does not match the expected output",
          recordingId,
        };
      }

      const next = await swapRecordingToCompressed(state, outputUrl);
      if (next.status !== "ready") {
        return {
          ok: false,
          status: 409,
          error: "Recording media URL changed before worker completion",
          recordingId,
        };
      }
      return { ok: true, status: 200, recordingId };
    },
  );
}

export async function runBuilderMediaCompressionSweepOnce(): Promise<void> {
  const exec = getDbExec();
  const { rows } = await exec.execute({
    sql: `SELECT session_id, key, value FROM application_state WHERE key LIKE ?`,
    args: [`${BUILDER_MEDIA_COMPRESSION_STATE_PREFIX}%`],
  });

  for (const row of rows as Array<{
    session_id?: unknown;
    key?: unknown;
    value?: unknown;
  }>) {
    const sessionId = typeof row.session_id === "string" ? row.session_id : "";
    const rawValue = typeof row.value === "string" ? row.value : "";
    let value: Record<string, unknown> | null = null;
    try {
      value = JSON.parse(rawValue) as Record<string, unknown>;
    } catch {
      continue;
    }
    const state = parseState(value);
    if (!state || isFinalStatus(state.status) || !isDue(state)) continue;
    const ownerEmail = state.ownerEmail || sessionId;
    if (!ownerEmail) continue;
    try {
      await runWithRequestContext(
        { userEmail: ownerEmail, orgId: state.orgId ?? undefined },
        async () => {
          await processCompressionState({ ...state, ownerEmail });
        },
      );
    } catch (err) {
      console.warn("[builder-media-compression] sweep item failed", {
        key: String(row.key ?? ""),
        recordingId: state.recordingId,
        error: errorMessage(err),
      });
    }
  }
}
