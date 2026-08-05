import AsyncStorage from "@react-native-async-storage/async-storage";

import { createCaptureId } from "./capture-id";

export const CAPTURE_QUEUE_STORAGE_KEY = "agent-native:capture-queue:v1";

const CAPTURE_QUEUE_VERSION = 1;
const MAX_COMPLETED_CAPTURE_JOBS = 50;

export type CaptureKind = "meeting" | "dictation" | "video";
export type CaptureJobState =
  | "captured"
  | "uploading"
  | "processing"
  | "completed"
  | "failed"
  | "exhausted";
export type CaptureUploadMode = "buffered" | "streaming";

export interface CaptureResumeMetadata {
  recordingId?: string;
  uploadChunkUrl?: string;
  abortUrl?: string;
  uploadMode?: CaptureUploadMode;
  uploadMimeType?: string;
  fileSizeBytes?: number;
  chunkSizeBytes?: number;
  totalChunks?: number;
  nextChunkIndex: number;
  uploadedBytes: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastError?: string;
  retryable?: boolean;
}

export interface CaptureJob {
  id: string;
  localUri: string;
  ownerKey?: string;
  kind: CaptureKind;
  durationMs: number;
  mimeType: string;
  title: string;
  state: CaptureJobState;
  attempts: number;
  resume: CaptureResumeMetadata;
  createdAt: string;
  updatedAt: string;
  capturedAt: string;
  retainLocalFile: boolean;
  uploadStartedAt?: string;
  processingStartedAt?: string;
  completedAt?: string;
  failedAt?: string;
  exhaustedAt?: string;
  remoteRecordingUrl?: string;
}

export interface EnqueueCaptureJobInput {
  id?: string;
  localUri: string;
  ownerKey?: string;
  kind: CaptureKind;
  durationMs: number;
  mimeType: string;
  title: string;
  capturedAt?: string;
  retainLocalFile?: boolean;
}

export interface CaptureJobTransition {
  state: CaptureJobState;
  resume?: Partial<CaptureResumeMetadata>;
  remoteRecordingUrl?: string;
}

interface CaptureQueueStore {
  version: typeof CAPTURE_QUEUE_VERSION;
  jobs: CaptureJob[];
}

export class CaptureQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureQueueError";
  }
}

export class CaptureQueueOwnerMismatchError extends CaptureQueueError {
  constructor(id: string) {
    super(`Capture job ${id} belongs to a different Clips account`);
    this.name = "CaptureQueueOwnerMismatchError";
  }
}

const ALLOWED_TRANSITIONS: Record<CaptureJobState, Set<CaptureJobState>> = {
  captured: new Set(["captured", "uploading", "failed", "exhausted"]),
  uploading: new Set([
    "uploading",
    "processing",
    "completed",
    "failed",
    "exhausted",
  ]),
  processing: new Set(["processing", "completed", "failed", "exhausted"]),
  completed: new Set(["completed"]),
  failed: new Set(["failed", "uploading", "exhausted"]),
  exhausted: new Set(["exhausted", "uploading"]),
};

let queueMutationTail: Promise<void> = Promise.resolve();

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isCaptureKind(value: unknown): value is CaptureKind {
  return value === "meeting" || value === "dictation" || value === "video";
}

function isCaptureJobState(value: unknown): value is CaptureJobState {
  return (
    value === "captured" ||
    value === "uploading" ||
    value === "processing" ||
    value === "completed" ||
    value === "failed" ||
    value === "exhausted"
  );
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requiredString(value: unknown, field: string, jobId?: string): string {
  const result = optionalString(value);
  if (result) return result;
  throw new CaptureQueueError(
    `Capture queue entry${jobId ? ` ${jobId}` : ""} has an invalid ${field}`,
  );
}

function nonNegativeNumber(
  value: unknown,
  field: string,
  jobId?: string,
): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  throw new CaptureQueueError(
    `Capture queue entry${jobId ? ` ${jobId}` : ""} has an invalid ${field}`,
  );
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function decodeResume(value: unknown, jobId: string): CaptureResumeMetadata {
  const record = asRecord(value);
  if (!record) {
    throw new CaptureQueueError(
      `Capture queue entry ${jobId} has invalid resume metadata`,
    );
  }
  const uploadMode = optionalString(record.uploadMode);
  if (uploadMode && uploadMode !== "buffered" && uploadMode !== "streaming") {
    throw new CaptureQueueError(
      `Capture queue entry ${jobId} has an invalid upload mode`,
    );
  }

  return {
    recordingId: optionalString(record.recordingId),
    uploadChunkUrl: optionalString(record.uploadChunkUrl),
    abortUrl: optionalString(record.abortUrl),
    uploadMode: uploadMode as CaptureUploadMode | undefined,
    uploadMimeType: optionalString(record.uploadMimeType),
    fileSizeBytes: optionalNonNegativeNumber(record.fileSizeBytes),
    chunkSizeBytes: optionalNonNegativeNumber(record.chunkSizeBytes),
    totalChunks: optionalNonNegativeNumber(record.totalChunks),
    nextChunkIndex: nonNegativeNumber(
      record.nextChunkIndex,
      "next chunk index",
      jobId,
    ),
    uploadedBytes: nonNegativeNumber(
      record.uploadedBytes,
      "uploaded byte count",
      jobId,
    ),
    lastAttemptAt: optionalString(record.lastAttemptAt),
    nextAttemptAt: optionalString(record.nextAttemptAt),
    lastError: optionalString(record.lastError),
    retryable:
      typeof record.retryable === "boolean" ? record.retryable : undefined,
  };
}

function decodeJob(value: unknown): CaptureJob {
  const record = asRecord(value);
  if (!record) {
    throw new CaptureQueueError("Capture queue contains an invalid entry");
  }
  const id = requiredString(record.id, "id");
  if (!isCaptureKind(record.kind)) {
    throw new CaptureQueueError(
      `Capture queue entry ${id} has an invalid kind`,
    );
  }
  if (!isCaptureJobState(record.state)) {
    throw new CaptureQueueError(
      `Capture queue entry ${id} has an invalid state`,
    );
  }

  return {
    id,
    localUri: requiredString(record.localUri, "local URI", id),
    ownerKey: optionalString(record.ownerKey),
    kind: record.kind,
    durationMs: nonNegativeNumber(record.durationMs, "duration", id),
    mimeType: requiredString(record.mimeType, "MIME type", id),
    title: requiredString(record.title, "title", id),
    state: record.state,
    attempts: nonNegativeNumber(record.attempts, "attempt count", id),
    resume: decodeResume(record.resume, id),
    createdAt: requiredString(record.createdAt, "creation timestamp", id),
    updatedAt: requiredString(record.updatedAt, "update timestamp", id),
    capturedAt: requiredString(record.capturedAt, "capture timestamp", id),
    retainLocalFile:
      typeof record.retainLocalFile === "boolean"
        ? record.retainLocalFile
        : record.kind === "dictation",
    uploadStartedAt: optionalString(record.uploadStartedAt),
    processingStartedAt: optionalString(record.processingStartedAt),
    completedAt: optionalString(record.completedAt),
    failedAt: optionalString(record.failedAt),
    exhaustedAt: optionalString(record.exhaustedAt),
    remoteRecordingUrl: optionalString(record.remoteRecordingUrl),
  };
}

function cloneJob(job: CaptureJob): CaptureJob {
  return { ...job, resume: { ...job.resume } };
}

async function readStore(): Promise<CaptureQueueStore> {
  const raw = await AsyncStorage.getItem(CAPTURE_QUEUE_STORAGE_KEY);
  if (!raw) return { version: CAPTURE_QUEUE_VERSION, jobs: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CaptureQueueError("Capture queue storage is corrupted");
  }

  const record = asRecord(parsed);
  if (
    record?.version !== CAPTURE_QUEUE_VERSION ||
    !Array.isArray(record.jobs)
  ) {
    throw new CaptureQueueError("Capture queue storage has an unknown format");
  }

  return {
    version: CAPTURE_QUEUE_VERSION,
    jobs: record.jobs.map(decodeJob),
  };
}

export async function recoverCaptureQueueStore(): Promise<boolean> {
  await queueMutationTail;
  try {
    await readStore();
    return false;
  } catch (error) {
    if (!(error instanceof CaptureQueueError)) throw error;
    await AsyncStorage.removeItem(CAPTURE_QUEUE_STORAGE_KEY);
    return true;
  }
}

async function mutateStore<T>(
  mutation: (jobs: CaptureJob[]) => T | Promise<T>,
): Promise<T> {
  const operation = queueMutationTail.then(async () => {
    const store = await readStore();
    const result = await mutation(store.jobs);
    const decodedJobs = store.jobs.map(decodeJob);
    const completedJobs = decodedJobs
      .filter((job) => job.state === "completed")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_COMPLETED_CAPTURE_JOBS);
    store.jobs = [
      ...decodedJobs.filter((job) => job.state !== "completed"),
      ...completedJobs,
    ];
    await AsyncStorage.setItem(
      CAPTURE_QUEUE_STORAGE_KEY,
      JSON.stringify(store),
    );
    return result;
  });
  queueMutationTail = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

function findJobOrThrow(jobs: CaptureJob[], id: string): CaptureJob {
  const job = jobs.find((candidate) => candidate.id === id);
  if (!job) throw new CaptureQueueError(`Capture job ${id} was not found`);
  return job;
}

function applyTransition(
  job: CaptureJob,
  transition: CaptureJobTransition,
  now: string,
): CaptureJob {
  if (!ALLOWED_TRANSITIONS[job.state].has(transition.state)) {
    throw new CaptureQueueError(
      `Capture job ${job.id} cannot transition from ${job.state} to ${transition.state}`,
    );
  }

  job.state = transition.state;
  job.updatedAt = now;
  if (transition.resume) {
    job.resume = { ...job.resume, ...transition.resume };
  }
  if (transition.remoteRecordingUrl) {
    job.remoteRecordingUrl = transition.remoteRecordingUrl;
  }

  if (transition.state === "uploading") {
    job.uploadStartedAt ??= now;
    job.exhaustedAt = undefined;
  } else if (transition.state === "processing") {
    job.processingStartedAt ??= now;
  } else if (transition.state === "completed") {
    job.completedAt = now;
    job.failedAt = undefined;
    job.exhaustedAt = undefined;
    job.resume.nextAttemptAt = undefined;
    job.resume.lastError = undefined;
    job.resume.retryable = undefined;
  } else if (transition.state === "failed") {
    job.failedAt = now;
  } else if (transition.state === "exhausted") {
    job.failedAt = now;
    job.exhaustedAt = now;
    job.resume.nextAttemptAt = undefined;
    job.resume.retryable = false;
  }

  return cloneJob(job);
}

export async function enqueueCaptureJob(
  input: EnqueueCaptureJobInput,
): Promise<CaptureJob> {
  const localUri = requiredString(input.localUri, "local URI");
  const mimeType = requiredString(input.mimeType, "MIME type");
  const title = requiredString(input.title, "title");
  if (!isCaptureKind(input.kind)) {
    throw new CaptureQueueError("Capture kind is invalid");
  }
  const durationMs = nonNegativeNumber(input.durationMs, "duration");
  const id = input.id?.trim() || createCaptureId();
  const capturedAt = input.capturedAt?.trim() || new Date().toISOString();

  return mutateStore((jobs) => {
    const existing = jobs.find((job) => job.id === id);
    if (
      existing &&
      existing.localUri === localUri &&
      existing.kind === input.kind &&
      existing.mimeType === mimeType
    ) {
      return cloneJob(existing);
    }
    if (existing) {
      throw new CaptureQueueError(`Capture job ${id} already exists`);
    }
    const job: CaptureJob = {
      id,
      localUri,
      ownerKey: optionalString(input.ownerKey),
      kind: input.kind,
      durationMs,
      mimeType,
      title,
      state: "captured",
      attempts: 0,
      resume: { nextChunkIndex: 0, uploadedBytes: 0 },
      createdAt: capturedAt,
      updatedAt: capturedAt,
      capturedAt,
      retainLocalFile: input.retainLocalFile ?? input.kind === "dictation",
    };
    jobs.push(job);
    return cloneJob(job);
  });
}

export async function listCaptureJobs(): Promise<CaptureJob[]> {
  await queueMutationTail;
  const store = await readStore();
  return store.jobs.map(cloneJob);
}

export async function getCaptureJob(id: string): Promise<CaptureJob | null> {
  const jobs = await listCaptureJobs();
  const job = jobs.find((candidate) => candidate.id === id);
  return job ? cloneJob(job) : null;
}

export async function listPendingCaptureJobs(): Promise<CaptureJob[]> {
  const jobs = await listCaptureJobs();
  return jobs.filter(
    (job) =>
      (job.state === "captured" ||
        job.state === "uploading" ||
        job.state === "processing" ||
        job.state === "failed") &&
      (job.state !== "failed" || job.resume.retryable !== false),
  );
}

export async function transitionCaptureJob(
  id: string,
  transition: CaptureJobTransition,
): Promise<CaptureJob> {
  return mutateStore((jobs) =>
    applyTransition(
      findJobOrThrow(jobs, id),
      transition,
      new Date().toISOString(),
    ),
  );
}

export async function updateCaptureJobResume(
  id: string,
  resume: Partial<CaptureResumeMetadata>,
): Promise<CaptureJob> {
  return mutateStore((jobs) => {
    const job = findJobOrThrow(jobs, id);
    job.resume = { ...job.resume, ...resume };
    job.updatedAt = new Date().toISOString();
    return cloneJob(job);
  });
}

export async function bindCaptureJobOwner(
  id: string,
  ownerKey: string,
): Promise<CaptureJob> {
  const normalizedOwnerKey = requiredString(ownerKey, "owner key", id);
  return mutateStore((jobs) => {
    const job = findJobOrThrow(jobs, id);
    if (job.ownerKey && job.ownerKey !== normalizedOwnerKey) {
      throw new CaptureQueueOwnerMismatchError(id);
    }
    job.ownerKey = normalizedOwnerKey;
    job.updatedAt = new Date().toISOString();
    return cloneJob(job);
  });
}

export async function releaseCaptureJobLocalFile(
  id: string,
): Promise<CaptureJob> {
  return mutateStore((jobs) => {
    const job = findJobOrThrow(jobs, id);
    job.retainLocalFile = false;
    job.updatedAt = new Date().toISOString();
    return cloneJob(job);
  });
}

export async function startCaptureUploadAttempt(
  id: string,
): Promise<CaptureJob> {
  return mutateStore((jobs) => {
    const job = findJobOrThrow(jobs, id);
    const now = new Date().toISOString();
    job.attempts += 1;
    job.failedAt = undefined;
    return applyTransition(
      job,
      {
        state: "uploading",
        resume: {
          lastAttemptAt: now,
          nextAttemptAt: undefined,
          lastError: undefined,
          retryable: undefined,
        },
      },
      now,
    );
  });
}

export async function markCaptureJobFailed(
  id: string,
  error: string,
  options: { retryable: boolean; nextAttemptAt?: string },
): Promise<CaptureJob> {
  return transitionCaptureJob(id, {
    state: "failed",
    resume: {
      lastError: error.trim() || "Capture sync failed",
      retryable: options.retryable,
      nextAttemptAt: options.nextAttemptAt,
    },
  });
}

export async function markCaptureJobExhausted(
  id: string,
  error: string,
): Promise<CaptureJob> {
  return transitionCaptureJob(id, {
    state: "exhausted",
    resume: {
      lastError: error.trim() || "Capture sync exhausted automatic retries",
      retryable: false,
      nextAttemptAt: undefined,
    },
  });
}

export async function removeCaptureJob(id: string): Promise<boolean> {
  return mutateStore((jobs) => {
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0) return false;
    if (
      jobs[index].state === "uploading" ||
      jobs[index].state === "processing"
    ) {
      throw new CaptureQueueError(
        `Capture job ${id} cannot be removed while it is ${jobs[index].state}`,
      );
    }
    jobs.splice(index, 1);
    return true;
  });
}
