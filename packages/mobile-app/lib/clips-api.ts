import { TEMPLATE_APPS } from "@agent-native/shared-app-config";
import { File, FileMode } from "expo-file-system";

import {
  type CaptureJob,
  type CaptureUploadMode,
  bindCaptureJobOwner,
  CaptureQueueOwnerMismatchError,
  getCaptureJob,
  listCaptureJobs,
  listPendingCaptureJobs,
  markCaptureJobFailed,
  startCaptureUploadAttempt,
  transitionCaptureJob,
  updateCaptureJobResume,
} from "./capture-queue";
import {
  type ClipsSession,
  clearClipsSession,
  getClipsSession,
} from "./clips-session";
import { removePersistedCaptureFile } from "./persist-capture";

const clipsApp = TEMPLATE_APPS.find((app) => app.id === "clips");
export const DEFAULT_CLIPS_BASE_URL =
  clipsApp?.url || "https://clips.agent-native.com";

const DEFAULT_CHUNK_SIZE_BYTES = 3 * 1024 * 1024;
const MAX_CHUNK_SIZE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_SYNC_JOBS = 3;
const DEFAULT_MAX_ATTEMPTS = 5;

export type ClipsApiErrorCode =
  | "auth_required"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "rate_limited"
  | "unsupported_media_type"
  | "network"
  | "server"
  | "invalid_response"
  | "unknown";

export class ClipsApiError extends Error {
  readonly status: number;
  readonly code: ClipsApiErrorCode;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: ClipsApiErrorCode;
      retryable?: boolean;
      details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "ClipsApiError";
    this.status = options.status ?? 0;
    this.code = options.code ?? "unknown";
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export interface CreateClipsCaptureResult {
  id: string;
  status: string;
  uploadChunkUrl: string;
  abortUrl: string;
  uploadMode: CaptureUploadMode;
}

export interface ClipsUploadStatus {
  id: string;
  status: string;
  verificationPending: boolean;
  videoUrl?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  hasCamera?: boolean;
  uploadProgress?: number;
  failureReason?: string;
  updatedAt?: string;
}

export interface UploadClipsCaptureChunkInput {
  recordingId: string;
  uploadChunkUrl: string;
  index: number;
  total: number;
  isFinal: boolean;
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: string;
  durationMs: number;
  hasAudio: boolean;
  hasCamera: boolean;
}

export interface UploadClipsCaptureChunkResult {
  ok: boolean;
  finalized: boolean;
  index: number;
  bytes: number;
  status?: string;
  videoUrl?: string;
  verificationPending?: boolean;
  retryAfterMs?: number;
}

export interface ResetClipsCaptureUploadResult {
  uploadMode: CaptureUploadMode;
}

export type SyncCaptureJobStatus =
  | "completed"
  | "processing"
  | "failed"
  | "skipped";

export interface SyncCaptureJobResult {
  jobId: string;
  status: SyncCaptureJobStatus;
  job: CaptureJob;
  error?: string;
  retryable?: boolean;
}

export interface SyncCaptureQueueResult {
  attempted: number;
  completed: number;
  processing: number;
  failed: number;
  skipped: number;
  results: SyncCaptureJobResult[];
}

interface ClipsRequestOptions {
  method?: "GET" | "POST";
  body?: BodyInit;
  headers?: Record<string, string>;
  session?: ClipsSession;
}

export interface SyncCaptureJobOptions {
  force?: boolean;
  chunkSizeBytes?: number;
}

export interface SyncPendingCaptureJobsOptions extends SyncCaptureJobOptions {
  maxJobs?: number;
  maxAttempts?: number;
}

const activeSyncs = new Map<string, Promise<SyncCaptureJobResult>>();

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function unwrapResult(payload: unknown): unknown {
  const record = asRecord(payload);
  return record?.result ?? payload;
}

function messageFromPayload(payload: unknown, fallback: string): string {
  const record = asRecord(payload);
  const nested = asRecord(record?.data) ?? asRecord(record?.result);
  return (
    asString(record?.error) ??
    asString(record?.message) ??
    asString(nested?.error) ??
    asString(nested?.message) ??
    fallback
  );
}

function errorCodeForStatus(status: number): ClipsApiErrorCode {
  if (status === 401) return "auth_required";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 413) return "payload_too_large";
  if (status === 415) return "unsupported_media_type";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "unknown";
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function normalizeClipsApiError(
  error: unknown,
  fallback = "Clips request failed",
): ClipsApiError {
  if (error instanceof ClipsApiError) return error;
  if (error instanceof Error) {
    return new ClipsApiError(error.message || fallback, {
      code: "network",
      retryable: true,
      details: error,
    });
  }
  return new ClipsApiError(fallback, {
    code: "unknown",
    retryable: false,
    details: error,
  });
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function getClipsBaseUrl(): string {
  return normalizeBaseUrl(DEFAULT_CLIPS_BASE_URL);
}

function resolveClipsUrl(path: string): string {
  const baseUrl = new URL(getClipsBaseUrl());
  const resolved = new URL(path, `${baseUrl.toString().replace(/\/+$/, "")}/`);
  if (resolved.origin !== baseUrl.origin) {
    throw new ClipsApiError("Clips returned an unsafe upload URL", {
      code: "invalid_response",
    });
  }
  return resolved.toString();
}

export async function hasClipsSessionToken(): Promise<boolean> {
  return Boolean(await getClipsSession());
}

export async function clearClipsSessionToken(): Promise<void> {
  await clearClipsSession();
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function clipsRequest<T>(
  path: string,
  options: ClipsRequestOptions = {},
): Promise<T> {
  const session = options.session ?? (await getClipsSession());
  if (!session) {
    throw new ClipsApiError("Connect to Clips before syncing captures.", {
      status: 401,
      code: "auth_required",
    });
  }

  let response: Response;
  try {
    response = await fetch(resolveClipsUrl(path), {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.token}`,
        "X-Agent-Native-Client": "mobile",
        ...options.headers,
      },
      body: options.body,
    });
  } catch (error) {
    throw normalizeClipsApiError(error);
  }

  const payload = await parseResponse(response);
  if (!response.ok) {
    if (response.status === 401) {
      const currentSession = await getClipsSession();
      if (currentSession?.token === session.token) await clearClipsSession();
    }
    throw new ClipsApiError(
      messageFromPayload(
        payload,
        `Clips request failed with status ${response.status}`,
      ),
      {
        status: response.status,
        code: errorCodeForStatus(response.status),
        retryable: isRetryableStatus(response.status),
        details: payload,
      },
    );
  }
  return payload as T;
}

export async function callClipsAction<T>(
  actionName: string,
  params: Record<string, unknown>,
  options: { idempotencyKey?: string; session?: ClipsSession } = {},
): Promise<T> {
  if (!/^[a-z0-9-]+$/.test(actionName)) {
    throw new ClipsApiError("Invalid Clips action name", {
      code: "invalid_response",
    });
  }
  const payload = await clipsRequest<unknown>(
    `/_agent-native/actions/${actionName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.idempotencyKey
          ? { "X-Idempotency-Key": options.idempotencyKey }
          : {}),
      },
      body: JSON.stringify(params),
      session: options.session,
    },
  );
  return unwrapResult(payload) as T;
}

function uploadMimeTypeForCapture(mimeType: string): string {
  const baseType = mimeType.split(";")[0]?.trim().toLowerCase();
  if (
    baseType === "video/mp4" ||
    baseType === "video/quicktime" ||
    baseType === "video/webm"
  ) {
    return mimeType;
  }
  if (
    baseType === "audio/mp4" ||
    baseType === "audio/m4a" ||
    baseType === "audio/x-m4a"
  ) {
    return "video/mp4";
  }
  if (baseType === "audio/webm") return "video/webm";
  throw new ClipsApiError(
    `Clips cannot upload ${mimeType}; capture MP4, QuickTime, or WebM media instead.`,
    { code: "unsupported_media_type", retryable: false },
  );
}

function createResultFromRecord(
  value: unknown,
  fallbackId: string,
): CreateClipsCaptureResult {
  const record = asRecord(value);
  const id = asString(record?.id) ?? fallbackId;
  const uploadMode: CaptureUploadMode =
    record?.uploadMode === "streaming" ? "streaming" : "buffered";
  return {
    id,
    status: asString(record?.status) ?? "uploading",
    uploadChunkUrl:
      asString(record?.uploadChunkUrl) ?? `/api/uploads/${id}/chunk`,
    abortUrl: asString(record?.abortUrl) ?? `/api/uploads/${id}/abort`,
    uploadMode,
  };
}

export async function createClipsCapture(
  job: CaptureJob,
  session?: ClipsSession,
): Promise<CreateClipsCaptureResult> {
  const recordingId = job.resume.recordingId ?? job.id;
  const mimeType =
    job.resume.uploadMimeType ?? uploadMimeTypeForCapture(job.mimeType);
  try {
    const created = await callClipsAction<unknown>(
      "create-recording",
      {
        id: recordingId,
        title: job.title,
        titleSource: "upload",
        sourceAppName: "Agent Native Mobile",
        hasCamera: job.kind === "video",
        hasAudio: true,
        mimeType,
        requestStreaming: true,
        visibility: "private",
      },
      { idempotencyKey: `capture:${recordingId}:create`, session },
    );
    return createResultFromRecord(created, recordingId);
  } catch (error) {
    const normalized = normalizeClipsApiError(error);
    if (!normalized.retryable && normalized.code !== "conflict") {
      throw normalized;
    }
    try {
      await getClipsUploadStatus(recordingId, session);
      return createResultFromRecord(undefined, recordingId);
    } catch {
      throw normalized;
    }
  }
}

function uploadStatusFromPayload(payload: unknown): ClipsUploadStatus {
  const outer = asRecord(payload);
  const record = asRecord(outer?.recording) ?? asRecord(unwrapResult(payload));
  const id = asString(record?.id);
  const status = asString(record?.status);
  if (!record || !id || !status) {
    throw new ClipsApiError("Clips returned an invalid upload status", {
      code: "invalid_response",
      details: payload,
    });
  }
  return {
    id,
    status,
    verificationPending: asBoolean(record.verificationPending) ?? false,
    videoUrl: asString(record.videoUrl),
    durationMs: asNumber(record.durationMs),
    width: asNumber(record.width),
    height: asNumber(record.height),
    hasAudio: asBoolean(record.hasAudio),
    hasCamera: asBoolean(record.hasCamera),
    uploadProgress: asNumber(record.uploadProgress),
    failureReason: asString(record.failureReason),
    updatedAt: asString(record.updatedAt),
  };
}

export async function getClipsUploadStatus(
  recordingId: string,
  session?: ClipsSession,
): Promise<ClipsUploadStatus> {
  const payload = await clipsRequest<unknown>(
    `/api/uploads/${encodeURIComponent(recordingId)}/status`,
    { session },
  );
  return uploadStatusFromPayload(payload);
}

export async function resetClipsCaptureUpload(
  recordingId: string,
  mimeType: string,
  session?: ClipsSession,
): Promise<ResetClipsCaptureUploadResult> {
  const payload = await clipsRequest<unknown>(
    `/api/uploads/${encodeURIComponent(recordingId)}/reset-chunks`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestStreaming: true, mimeType }),
      session,
    },
  );
  const record = asRecord(payload);
  if (asBoolean(record?.ok) !== true) {
    throw new ClipsApiError("Clips returned an invalid upload reset response", {
      code: "invalid_response",
      details: payload,
    });
  }
  return {
    uploadMode:
      asString(record?.uploadMode) === "streaming" ? "streaming" : "buffered",
  };
}

function uploadResultFromPayload(
  payload: unknown,
  input: UploadClipsCaptureChunkInput,
): UploadClipsCaptureChunkResult {
  const record = asRecord(payload);
  if (!record || record.ok === false) {
    throw new ClipsApiError(
      messageFromPayload(payload, "Clips rejected the upload chunk"),
      { code: "invalid_response", details: payload },
    );
  }
  return {
    ok: true,
    finalized: asBoolean(record.finalized) ?? false,
    index: asNumber(record.index) ?? input.index,
    bytes: asNumber(record.bytes) ?? input.bytes.byteLength,
    status: asString(record.status),
    videoUrl: asString(record.videoUrl),
    verificationPending: asBoolean(record.verificationPending),
    retryAfterMs: asNumber(record.retryAfterMs),
  };
}

export async function uploadClipsCaptureChunk(
  input: UploadClipsCaptureChunkInput,
  session?: ClipsSession,
): Promise<UploadClipsCaptureChunkResult> {
  if (
    !Number.isInteger(input.index) ||
    input.index < 0 ||
    !Number.isInteger(input.total) ||
    input.total <= input.index
  ) {
    throw new ClipsApiError("Invalid Clips upload chunk position", {
      code: "invalid_response",
    });
  }
  const url = new URL(resolveClipsUrl(input.uploadChunkUrl));
  url.searchParams.set("index", String(input.index));
  url.searchParams.set("total", String(input.total));
  url.searchParams.set("isFinal", input.isFinal ? "1" : "0");
  url.searchParams.set("mimeType", input.mimeType);
  url.searchParams.set("durationMs", String(Math.round(input.durationMs)));
  url.searchParams.set("hasAudio", input.hasAudio ? "1" : "0");
  url.searchParams.set("hasCamera", input.hasCamera ? "1" : "0");

  const payload = await clipsRequest<unknown>(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Idempotency-Key": `capture:${input.recordingId}:chunk:${input.index}:${input.isFinal ? "final" : "data"}`,
    },
    body: input.bytes.buffer,
    session,
  });
  return uploadResultFromPayload(payload, input);
}

export async function finalizeClipsCaptureUpload(
  input: Omit<UploadClipsCaptureChunkInput, "isFinal">,
  session?: ClipsSession,
): Promise<UploadClipsCaptureChunkResult> {
  return uploadClipsCaptureChunk({ ...input, isFinal: true }, session);
}

function normalizedChunkSize(value: number | undefined): number {
  const chunkSize = value ?? DEFAULT_CHUNK_SIZE_BYTES;
  if (
    !Number.isInteger(chunkSize) ||
    chunkSize <= 0 ||
    chunkSize > MAX_CHUNK_SIZE_BYTES
  ) {
    throw new ClipsApiError(
      `Capture chunk size must be between 1 and ${MAX_CHUNK_SIZE_BYTES} bytes`,
      { code: "payload_too_large" },
    );
  }
  return chunkSize;
}

function retryAt(attempts: number): string {
  const delayMs = Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMs).toISOString();
}

function isDue(job: CaptureJob): boolean {
  if (!job.resume.nextAttemptAt) return true;
  const scheduledAt = Date.parse(job.resume.nextAttemptAt);
  return !Number.isFinite(scheduledAt) || scheduledAt <= Date.now();
}

async function completedResult(
  job: CaptureJob,
  status: ClipsUploadStatus,
): Promise<SyncCaptureJobResult> {
  const updated = await transitionCaptureJob(job.id, {
    state: "completed",
    remoteRecordingUrl: status.videoUrl,
    resume: {
      retryable: undefined,
      nextAttemptAt: undefined,
      lastError: undefined,
    },
  });
  if (!updated.retainLocalFile) {
    try {
      removePersistedCaptureFile(updated.localUri);
    } catch {
      // The remote recording is durable; stale local cleanup can retry later.
    }
  }
  return { jobId: job.id, status: "completed", job: updated };
}

async function reconcileProcessingJob(
  job: CaptureJob,
  session: ClipsSession,
): Promise<SyncCaptureJobResult> {
  const recordingId = job.resume.recordingId ?? job.id;
  const status = await getClipsUploadStatus(recordingId, session);
  if (status.status === "ready") return completedResult(job, status);
  if (status.status === "failed") {
    const message =
      status.failureReason ?? "Clips failed to process the capture";
    const failed = await markCaptureJobFailed(job.id, message, {
      retryable: false,
    });
    return {
      jobId: job.id,
      status: "failed",
      job: failed,
      error: message,
      retryable: false,
    };
  }
  const updated = await transitionCaptureJob(job.id, {
    state: "processing",
    resume: {
      nextAttemptAt: new Date(Date.now() + 3_000).toISOString(),
      lastError: undefined,
      retryable: true,
    },
  });
  return { jobId: job.id, status: "processing", job: updated };
}

async function runCaptureSync(
  initialJob: CaptureJob,
  options: SyncCaptureJobOptions,
): Promise<SyncCaptureJobResult> {
  if (initialJob.state === "completed") {
    return { jobId: initialJob.id, status: "skipped", job: initialJob };
  }
  if (
    !options.force &&
    (initialJob.resume.retryable === false || !isDue(initialJob))
  ) {
    return { jobId: initialJob.id, status: "skipped", job: initialJob };
  }

  let workingJob = initialJob;
  try {
    const session = await getClipsSession();
    if (!session) {
      throw new ClipsApiError("Connect to Clips before syncing captures.", {
        status: 401,
        code: "auth_required",
      });
    }
    try {
      workingJob = await bindCaptureJobOwner(workingJob.id, session.ownerKey);
    } catch (error) {
      if (error instanceof CaptureQueueOwnerMismatchError) {
        return {
          jobId: workingJob.id,
          status: "skipped",
          job: workingJob,
          error: error.message,
          retryable: true,
        };
      }
      throw error;
    }
    if (workingJob.state === "processing") {
      return await reconcileProcessingJob(workingJob, session);
    }

    const uploadMimeType = uploadMimeTypeForCapture(workingJob.mimeType);
    const file = new File(workingJob.localUri);
    if (!file.exists || file.size <= 0) {
      throw new ClipsApiError(
        "The local capture is missing, so it cannot be uploaded.",
        { code: "not_found", retryable: false },
      );
    }

    const fileSizeBytes = file.size;
    const chunkSizeBytes = normalizedChunkSize(
      workingJob.resume.chunkSizeBytes ?? options.chunkSizeBytes,
    );
    const totalChunks = Math.ceil(fileSizeBytes / chunkSizeBytes);
    if (
      workingJob.resume.fileSizeBytes !== undefined &&
      workingJob.resume.fileSizeBytes !== fileSizeBytes
    ) {
      throw new ClipsApiError(
        "The local capture changed after upload began; refusing to combine mismatched chunks.",
        { code: "conflict", retryable: false },
      );
    }
    if (
      workingJob.resume.totalChunks !== undefined &&
      workingJob.resume.totalChunks !== totalChunks
    ) {
      throw new ClipsApiError(
        "The capture chunk plan changed after upload began.",
        { code: "conflict", retryable: false },
      );
    }

    const existingRecordingId = workingJob.resume.recordingId;
    if (
      workingJob.state === "failed" &&
      existingRecordingId &&
      workingJob.resume.uploadChunkUrl
    ) {
      const remoteStatus = await getClipsUploadStatus(
        existingRecordingId,
        session,
      );
      if (remoteStatus.status === "failed") {
        const reset = await resetClipsCaptureUpload(
          existingRecordingId,
          uploadMimeType,
          session,
        );
        workingJob = await updateCaptureJobResume(workingJob.id, {
          uploadMode: reset.uploadMode,
          nextChunkIndex: 0,
          uploadedBytes: 0,
        });
      }
    }

    workingJob = await startCaptureUploadAttempt(workingJob.id);
    let uploadChunkUrl = workingJob.resume.uploadChunkUrl;
    if (!workingJob.resume.recordingId || !uploadChunkUrl) {
      const created = await createClipsCapture(
        {
          ...workingJob,
          resume: { ...workingJob.resume, uploadMimeType },
        },
        session,
      );
      uploadChunkUrl = created.uploadChunkUrl;
      workingJob = await updateCaptureJobResume(workingJob.id, {
        recordingId: created.id,
        uploadChunkUrl: created.uploadChunkUrl,
        abortUrl: created.abortUrl,
        uploadMode: created.uploadMode,
        uploadMimeType,
        fileSizeBytes,
        chunkSizeBytes,
        totalChunks,
      });
    } else {
      workingJob = await updateCaptureJobResume(workingJob.id, {
        uploadMimeType,
        fileSizeBytes,
        chunkSizeBytes,
        totalChunks,
      });
    }

    const recordingId = workingJob.resume.recordingId ?? workingJob.id;
    const nextChunkIndex = Math.min(
      workingJob.resume.nextChunkIndex,
      totalChunks - 1,
    );
    const handle = file.open(FileMode.ReadOnly);
    try {
      handle.offset = nextChunkIndex * chunkSizeBytes;
      for (let index = nextChunkIndex; index < totalChunks; index += 1) {
        const remainingBytes = fileSizeBytes - index * chunkSizeBytes;
        const bytes = handle.readBytes(
          Math.min(chunkSizeBytes, remainingBytes),
        );
        if (bytes.byteLength <= 0) {
          throw new ClipsApiError(
            `Could not read capture chunk ${index + 1} of ${totalChunks}`,
            { code: "not_found", retryable: false },
          );
        }
        const input: UploadClipsCaptureChunkInput = {
          recordingId,
          uploadChunkUrl,
          index,
          total: totalChunks,
          isFinal: index === totalChunks - 1,
          bytes,
          mimeType: uploadMimeType,
          durationMs: workingJob.durationMs,
          hasAudio: true,
          hasCamera: workingJob.kind === "video",
        };
        const result = input.isFinal
          ? await finalizeClipsCaptureUpload(input, session)
          : await uploadClipsCaptureChunk(input, session);
        workingJob = await updateCaptureJobResume(workingJob.id, {
          nextChunkIndex: index + 1,
          uploadedBytes: Math.min(
            fileSizeBytes,
            workingJob.resume.uploadedBytes + bytes.byteLength,
          ),
          lastError: undefined,
          retryable: undefined,
        });

        if (input.isFinal) {
          if (
            result.status === "ready" ||
            (result.finalized && result.videoUrl)
          ) {
            return completedResult(workingJob, {
              id: recordingId,
              status: "ready",
              verificationPending: false,
              videoUrl: result.videoUrl,
            });
          }
          const processing = await transitionCaptureJob(workingJob.id, {
            state: "processing",
            resume: {
              nextAttemptAt: new Date(
                Date.now() + (result.retryAfterMs ?? 3_000),
              ).toISOString(),
              retryable: true,
            },
          });
          return {
            jobId: workingJob.id,
            status: "processing",
            job: processing,
          };
        }
      }
    } finally {
      handle.close();
    }

    throw new ClipsApiError("Capture upload ended before finalization", {
      code: "invalid_response",
      retryable: true,
    });
  } catch (error) {
    const normalized = normalizeClipsApiError(error);
    const retryable =
      normalized.retryable || normalized.code === "auth_required";
    const latest = (await getCaptureJob(workingJob.id)) ?? workingJob;
    if (latest.state === "processing" && retryable) {
      const processing = await transitionCaptureJob(latest.id, {
        state: "processing",
        resume: {
          lastError: normalized.message,
          retryable: true,
          nextAttemptAt: retryAt(latest.attempts),
        },
      });
      return {
        jobId: latest.id,
        status: "processing",
        job: processing,
        error: normalized.message,
        retryable: true,
      };
    }
    const failed = await markCaptureJobFailed(latest.id, normalized.message, {
      retryable,
      nextAttemptAt: retryable ? retryAt(latest.attempts) : undefined,
    });
    return {
      jobId: latest.id,
      status: "failed",
      job: failed,
      error: normalized.message,
      retryable,
    };
  }
}

export async function syncCaptureJob(
  jobId: string,
  options: SyncCaptureJobOptions = {},
): Promise<SyncCaptureJobResult> {
  const active = activeSyncs.get(jobId);
  if (active) return active;

  const sync = (async () => {
    const job = await getCaptureJob(jobId);
    if (!job) {
      throw new ClipsApiError(`Capture job ${jobId} was not found`, {
        code: "not_found",
      });
    }
    return runCaptureSync(job, options);
  })();
  activeSyncs.set(jobId, sync);
  try {
    return await sync;
  } finally {
    activeSyncs.delete(jobId);
  }
}

export async function syncPendingCaptureJobs(
  options: SyncPendingCaptureJobsOptions = {},
): Promise<SyncCaptureQueueResult> {
  for (const job of await listCaptureJobs()) {
    if (job.state !== "completed" || job.retainLocalFile) continue;
    try {
      removePersistedCaptureFile(job.localUri);
    } catch {
      // A later foreground sync retries cleanup without changing remote state.
    }
  }

  const maxJobs = Math.max(0, options.maxJobs ?? DEFAULT_MAX_SYNC_JOBS);
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const session = await getClipsSession();
  const pending = (await listPendingCaptureJobs())
    .filter(
      (job) =>
        session &&
        (!job.ownerKey || job.ownerKey === session.ownerKey) &&
        (options.force ||
          (job.attempts < maxAttempts &&
            job.resume.retryable !== false &&
            isDue(job))),
    )
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    .slice(0, maxJobs);

  const results: SyncCaptureJobResult[] = [];
  for (const job of pending) {
    results.push(await syncCaptureJob(job.id, options));
  }
  return {
    attempted: results.length,
    completed: results.filter((result) => result.status === "completed").length,
    processing: results.filter((result) => result.status === "processing")
      .length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    results,
  };
}
