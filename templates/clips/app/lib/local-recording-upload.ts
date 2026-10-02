import { appBasePath } from "@agent-native/core/client/api-path";
import { callAction } from "@agent-native/core/client/hooks";
import { waitForAcceptedRecordingAfterFinalizeError } from "@shared/finalize-recovery";
import {
  chunkUploadUrl,
  classifyUploadResponseError,
  UPLOAD_SLICE_BYTES,
} from "@shared/recording-core";

import {
  deleteRecordingBackup,
  localRecordingState,
  nextLocalRecordingState,
  readRecoverableRecordingBackup,
  updateRecordingBackupMeta,
  verifyServerCopy,
  type LocalRecordingState,
  type RecordingBackupMeta,
} from "./recording-backup";
import { isStorageSetupFailureReason } from "./storage-failures";
import { uploadVideoBlobThumbnail } from "./thumbnail-capture";
import {
  fetchUploadStatus,
  postUploadAbort,
  uploadChunkRequest,
} from "./upload-request";

export type LocalUploadFailureCode =
  | "missing_local_copy"
  | "unreadable_local_copy"
  | "owner_unconfirmed"
  | "owner_mismatch"
  | "lock_unavailable"
  | "copy_kept"
  | "storage_setup_required"
  | "session_expired"
  | "recording_too_large"
  | "network"
  | "server_unavailable"
  | "chunk_html_error"
  | "upload_failed";

const RETRYABLE_FAILURES = new Set<LocalUploadFailureCode>([
  "network",
  "server_unavailable",
]);

/** Server-side failure codes a failed attempt is recorded under. */
const SERVER_FAILURE_CODE: Record<LocalUploadFailureCode, string> = {
  missing_local_copy: "upload_failed",
  unreadable_local_copy: "upload_failed",
  owner_unconfirmed: "upload_failed",
  owner_mismatch: "upload_failed",
  lock_unavailable: "upload_failed",
  copy_kept: "upload_failed",
  storage_setup_required: "storage_setup_required",
  session_expired: "upload_interrupted",
  recording_too_large: "recording_too_large",
  network: "upload_interrupted",
  server_unavailable: "upload_interrupted",
  chunk_html_error: "chunk_html_error",
  upload_failed: "upload_failed",
};

export class LocalRecordingUploadError extends Error {
  readonly code: LocalUploadFailureCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(code: LocalUploadFailureCode, message: string, status?: number) {
    super(message);
    this.name = "LocalRecordingUploadError";
    this.code = code;
    this.status = status;
    this.retryable = RETRYABLE_FAILURES.has(code);
  }
}

/** The create-recording refusal when the signed-in account is not the copy's owner. */
export const RECORDING_OWNER_MISMATCH = "recording_owner_mismatch";

export function classifyLocalUploadFailure(input: {
  status?: number;
  message?: string;
  errorCode?: string;
  isHtml?: boolean;
  networkError?: boolean;
}): LocalUploadFailureCode {
  const message = input.message ?? "";
  if (input.networkError) return "network";
  if (input.errorCode === RECORDING_OWNER_MISMATCH) return "owner_mismatch";
  if (
    input.errorCode === "builder_oauth_reauthorization_required" ||
    isStorageSetupFailureReason(message) ||
    /video storage could not start|reconnect builder|builder\.io access/i.test(
      message,
    )
  ) {
    return "storage_setup_required";
  }
  if (input.status === 401 || input.status === 403) return "session_expired";
  if (input.status === 413 || /too large/i.test(message)) {
    return "recording_too_large";
  }
  if (input.isHtml) return "chunk_html_error";
  if (
    input.status !== undefined &&
    [408, 425, 429, 500, 502, 503, 504].includes(input.status)
  ) {
    return "server_unavailable";
  }
  return "upload_failed";
}

function errorDetails(error: unknown): {
  status?: number;
  message: string;
  errorCode?: string;
} {
  const details =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  return {
    status: typeof details.status === "number" ? details.status : undefined,
    message:
      typeof details.actionMessage === "string"
        ? details.actionMessage
        : error instanceof Error
          ? error.message
          : String(error),
    errorCode:
      typeof details.errorCode === "string" ? details.errorCode : undefined,
  };
}

function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AbortError";
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export function newRecordingId(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  for (const byte of crypto.getRandomValues(new Uint8Array(size))) {
    id += chars[byte % chars.length];
  }
  return id;
}

export type ServerUploadStatus =
  | { found: false }
  | {
      found: true;
      status: string;
      verificationPending: boolean;
      /** Bytes finalize received; null when the server did not report them. */
      sourceSizeBytes: number | null;
      durationMs: number | null;
    };

export async function fetchServerUploadStatus(
  recordingId: string,
  signal?: AbortSignal,
): Promise<ServerUploadStatus> {
  const response = await fetchUploadStatus(recordingId, signal);
  if (response.status === 404) return { found: false };
  if (!response.ok) {
    throw new LocalRecordingUploadError(
      classifyLocalUploadFailure({ status: response.status }),
      `Could not check the upload (${response.status}).`,
      response.status,
    );
  }
  const body = (await response.json()) as {
    recording?: {
      status?: unknown;
      verificationPending?: unknown;
      sourceSizeBytes?: unknown;
      durationMs?: unknown;
    };
  };
  if (typeof body.recording?.status !== "string") {
    throw new LocalRecordingUploadError(
      "upload_failed",
      "The upload status response was unreadable.",
    );
  }
  return {
    found: true,
    status: body.recording.status,
    verificationPending: body.recording.verificationPending === true,
    sourceSizeBytes:
      typeof body.recording.sourceSizeBytes === "number"
        ? body.recording.sourceSizeBytes
        : null,
    durationMs:
      typeof body.recording.durationMs === "number"
        ? body.recording.durationMs
        : null,
  };
}

export interface LocalUploadOptions {
  /**
   * The signed-in account. A copy uploads only into its own owner's account;
   * the server re-checks this against the live session.
   */
  ownerEmail: string;
  signal?: AbortSignal;
  /**
   * The recording held in memory, used instead of the local copy when that
   * copy could not be written (a full disk). Its state is then best effort.
   */
  memorySource?: {
    blob: Blob;
    mimeType: string;
    durationMs: number;
    width: number;
    height: number;
    hasAudio: boolean;
    hasCamera: boolean;
    title?: string | null;
    /** The account that recorded it; the stored copy's owner wins. */
    ownerEmail?: string | null;
    /** False when the recorder never delivered its final chunk. */
    whole?: boolean;
  };
  /**
   * Upload again even though an earlier attempt reads ready, because that
   * server copy did not match this one.
   */
  reuploadMismatched?: boolean;
  onProgress?: (fraction: number) => void;
  /** Delays between attempts of one chunk; one attempt more than entries. */
  retryDelaysMs?: readonly number[];
  folderId?: string | null;
  spaceIds?: string[];
}

export type LocalUploadResult = {
  recordingId: string;
  status: "ready" | "processing";
  /**
   * Set when the local copy was kept after the upload: "partial" when the
   * copy itself is not the whole recording, "unverified" when the server did
   * not report what it received, "mismatch" when it reported less.
   */
  kept?: "partial" | "unverified" | "mismatch";
};

const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 15_000] as const;

/**
 * Upload a recording's local copy as a fresh server recording.
 *
 * The local copy is deleted only once the server reports the clip `ready`.
 * Every failure leaves it in `recorded-local` with the classified error, and
 * the attempt's server row is marked failed with that code so analytics see a
 * real cause. A previous attempt's row that never became ready is trashed once
 * this upload succeeds.
 */
export async function uploadLocalRecording(
  localId: string,
  options: LocalUploadOptions,
): Promise<LocalUploadResult> {
  const { signal, memorySource } = options;
  const stored = await readRecoverableRecordingBackup(localId).catch(
    (error: unknown) => {
      if (memorySource) return null;
      throw new LocalRecordingUploadError(
        "unreadable_local_copy",
        `This recording's local copy could not be read: ${errorDetails(error).message}`,
      );
    },
  );
  const copy = memorySource
    ? {
        meta: {
          ...stored?.meta,
          ...memorySource,
          ownerEmail: stored?.meta.ownerEmail ?? memorySource.ownerEmail,
          recordingId: localId,
          localOnly: stored?.meta.localOnly ?? true,
          bytes: memorySource.blob.size,
          chunkCount: stored?.meta.chunkCount ?? 0,
          savedAt: stored?.meta.savedAt ?? new Date().toISOString(),
          completedAt: new Date().toISOString(),
        } satisfies RecordingBackupMeta,
        blob: memorySource.blob,
        whole: memorySource.whole !== false,
      }
    : stored;
  if (!copy) {
    throw new LocalRecordingUploadError(
      "missing_local_copy",
      "This recording's local copy is no longer in this browser.",
    );
  }
  const { meta, blob, whole } = copy;
  if (!blob) {
    throw new LocalRecordingUploadError(
      "unreadable_local_copy",
      "This recording's local copy is incomplete.",
    );
  }
  if (!meta.ownerEmail) {
    throw new LocalRecordingUploadError(
      "owner_unconfirmed",
      "This recording isn't linked to an account yet.",
    );
  }
  if (meta.ownerEmail.toLowerCase() !== options.ownerEmail.toLowerCase()) {
    throw new LocalRecordingUploadError(
      "owner_mismatch",
      "This recording belongs to another account.",
    );
  }
  const persist = (
    patch: Parameters<typeof updateRecordingBackupMeta>[1],
  ): Promise<unknown> =>
    memorySource
      ? updateRecordingBackupMeta(localId, patch).catch(() => {
          // coercion-ok: the bytes are in memory; there is no stored copy to update.
        })
      : updateRecordingBackupMeta(localId, patch);

  const local = { bytes: blob.size, durationMs: meta.durationMs };
  // Only a whole copy that the server proves it received in full is deleted;
  // anything else stays in this browser until the user decides.
  const settleReady = async (
    serverId: string,
    proof: ReturnType<typeof verifyServerCopy>,
  ): Promise<LocalUploadResult> => {
    if (proof === "verified" && whole) {
      await trashStaleServerRecordings([...staleServerIds]);
      await deleteRecordingBackup(localId);
      return { recordingId: serverId, status: "ready" };
    }
    const kept =
      proof === "mismatch" ? "mismatch" : !whole ? "partial" : "unverified";
    await persist({ state: "uploaded", keptAfterUpload: kept });
    return { recordingId: serverId, status: "ready", kept };
  };

  const staleServerIds = new Set(meta.staleServerRecordingIds ?? []);
  const previousServerId =
    meta.serverRecordingId ?? (meta.localOnly ? null : meta.recordingId);
  if (previousServerId) {
    const previous = await fetchServerUploadStatus(previousServerId, signal);
    if (previous.found && previous.status === "ready") {
      const proof = verifyServerCopy(previous, local);
      if (proof !== "mismatch" || !options.reuploadMismatched) {
        return settleReady(previousServerId, proof);
      }
    }
    if (previous.found && previous.status === "processing") {
      await persist({ state: "uploaded" });
      return { recordingId: previousServerId, status: "processing" };
    }
    if (previous.found) staleServerIds.add(previousServerId);
  }

  let state: LocalRecordingState = localRecordingState(meta);
  if (state === "recording" || state === "uploading") {
    state = nextLocalRecordingState(state, "interrupt") as LocalRecordingState;
  }
  if (state === "uploaded") {
    state = nextLocalRecordingState(state, "failed") as LocalRecordingState;
  }
  const serverId =
    meta.localOnly && !meta.serverRecordingId ? localId : newRecordingId();
  await persist({
    state: nextLocalRecordingState(state, "upload") as LocalRecordingState,
    serverRecordingId: serverId,
    staleServerRecordingIds: [...staleServerIds],
    lastError: null,
  });

  let uploaded: Awaited<ReturnType<typeof createAndUpload>>;
  try {
    uploaded = await createAndUpload(serverId, meta, blob, options);
  } catch (error) {
    const failure =
      error instanceof LocalRecordingUploadError
        ? error
        : isAbortError(error)
          ? null
          : new LocalRecordingUploadError(
              classifyLocalUploadFailure(errorDetails(error)),
              errorDetails(error).message,
              errorDetails(error).status,
            );
    await persist({
      state: "recorded-local",
      lastError: failure?.message ?? null,
    });
    const failedAbortUrl = (error as { abortUrl?: string } | null)?.abortUrl;
    if (failure && failedAbortUrl) {
      void postUploadAbort(failedAbortUrl, {
        reason: failure.message,
        failureCode: SERVER_FAILURE_CODE[failure.code],
        ...(failure.status ? { httpStatus: failure.status } : {}),
      }).catch(() => {
        // coercion-ok: a lost abort leaves the row to the upload reaper.
      });
    }
    throw failure ?? error;
  }

  // The server holds the clip now; bookkeeping below can only leave a stale
  // local copy, which the next recovery scan reconciles once it reads ready.
  if (uploaded.status === "processing") {
    await persist({ state: "uploaded" }).catch(() => {
      // coercion-ok: see above; a leftover copy is reconciled, never re-uploaded.
    });
    return { recordingId: serverId, status: "processing" };
  }
  return settleReady(serverId, verifyServerCopy(uploaded, local)).catch(
    (error: unknown) => {
      console.warn(
        "[clips] local copy bookkeeping after upload failed:",
        error,
      );
      // coercion-ok: the clip is saved; a leftover copy is reconciled by the next scan.
      return {
        recordingId: serverId,
        status: "ready" as const,
        kept: "unverified" as const,
      };
    },
  );
}

/**
 * Trash the server rows of attempts this copy superseded. They never became
 * ready (`skipIfReady` guards a race), and leaving them shows a failed card
 * next to the clip that did upload.
 */
export async function trashStaleServerRecordings(
  ids: readonly string[],
): Promise<void> {
  await Promise.all(
    ids.map((id) =>
      callAction(
        "trash-recording" as any,
        { id, skipIfReady: true } as any,
      ).catch(() => {
        // coercion-ok: a leftover failed card is cosmetic and never costs
        // the uploaded clip; the user can remove it from the card menu.
      }),
    ),
  );
}

async function createAndUpload(
  serverId: string,
  meta: RecordingBackupMeta,
  blob: Blob,
  options: LocalUploadOptions,
): Promise<{
  status: "ready" | "processing";
  sourceSizeBytes: number | null;
  durationMs: number | null;
}> {
  const { signal } = options;
  type UploadTarget = {
    id?: string;
    uploadChunkUrl?: string;
    abortUrl?: string;
  };
  let created: UploadTarget & { result?: UploadTarget };
  try {
    created = (await callAction(
      "create-recording" as any,
      {
        id: serverId,
        expectedOwnerEmail: meta.ownerEmail,
        title: meta.title ?? undefined,
        titleSource: meta.title ? "context" : undefined,
        recordingPlatform: "web",
        hasAudio: meta.hasAudio,
        hasCamera: meta.hasCamera,
        width: meta.width,
        height: meta.height,
        mimeType: meta.mimeType,
        requestStreaming: true,
        folderId: options.folderId ?? undefined,
        spaceIds: options.spaceIds,
      } as any,
      { signal },
    )) as typeof created;
  } catch (error) {
    if (isAbortError(error)) throw error;
    const details = errorDetails(error);
    throw new LocalRecordingUploadError(
      classifyLocalUploadFailure(details),
      details.message,
      details.status,
    );
  }
  const target = created?.result ?? created;
  if (target?.id !== serverId || !target.uploadChunkUrl) {
    throw new LocalRecordingUploadError(
      "upload_failed",
      "Clips did not return an upload target.",
    );
  }
  const abortUrl = `${appBasePath()}${target.abortUrl ?? `/api/uploads/${serverId}/abort`}`;
  const withAbortUrl = (error: unknown) =>
    Object.assign(error as object, { abortUrl });

  if (meta.transcript || meta.transcriptFailureReason) {
    void callAction(
      "save-browser-transcript" as any,
      {
        recordingId: serverId,
        fullText: meta.transcript ?? "",
        source: "web-speech",
        failureReason: meta.transcriptFailureReason ?? undefined,
      } as any,
    ).catch(() => {
      // coercion-ok: cloud transcription still runs when this native copy is lost.
    });
  }
  void uploadVideoBlobThumbnail(serverId, blob, { signal }).catch(() => {
    // coercion-ok: the thumbnail sweeper fills in a missing poster later.
  });

  const base = `${appBasePath()}${target.uploadChunkUrl}`;
  const total = Math.max(1, Math.ceil(blob.size / UPLOAD_SLICE_BYTES));
  let finalBody: Record<string, unknown> | null = null;
  try {
    for (let index = 0; index < total; index++) {
      const isFinal = index === total - 1;
      const url = chunkUploadUrl(base, {
        index,
        total,
        isFinal,
        mimeType: meta.mimeType,
        ...(isFinal
          ? {
              durationMs: meta.durationMs,
              width: meta.width,
              height: meta.height,
              hasAudio: meta.hasAudio,
              hasCamera: meta.hasCamera,
            }
          : {}),
      });
      const start = index * UPLOAD_SLICE_BYTES;
      const body = await blob
        .slice(start, Math.min(start + UPLOAD_SLICE_BYTES, blob.size))
        .arrayBuffer();
      const response = await postChunkWithRetry(
        url,
        body,
        meta.mimeType,
        options,
      ).catch(async (error) => {
        // Only a failed-transport final chunk is ambiguous: finalize may have
        // committed server-side. A refusal (storage, auth, size) is not.
        if (
          !isFinal ||
          !(error instanceof LocalRecordingUploadError) ||
          !error.retryable
        ) {
          throw error;
        }
        const recovered = await waitForAcceptedRecordingAfterFinalizeError({
          uploadUrl: base,
          recordingId: serverId,
          preferAuthenticated: true,
          signal,
        });
        if (!recovered) throw error;
        return recovered as unknown as Record<string, unknown>;
      });
      options.onProgress?.((index + 1) / total);
      if (isFinal) finalBody = response;
    }
  } catch (error) {
    throw withAbortUrl(error);
  }

  const status = finalBody?.status;
  const waitingForStorage =
    status === "waiting_storage" || finalBody?.waitingForStorage === true;
  const proof = {
    sourceSizeBytes:
      typeof finalBody?.sourceSizeBytes === "number"
        ? finalBody.sourceSizeBytes
        : null,
    durationMs:
      typeof finalBody?.durationMs === "number" ? finalBody.durationMs : null,
  };
  if (status === "ready") return { status: "ready", ...proof };
  if (status === "processing" && !waitingForStorage) {
    return { status: "processing", ...proof };
  }
  throw withAbortUrl(
    new LocalRecordingUploadError(
      waitingForStorage ? "storage_setup_required" : "upload_failed",
      typeof finalBody?.failureReason === "string"
        ? finalBody.failureReason
        : "The upload finished without a saved video.",
    ),
  );
}

async function postChunkWithRetry(
  url: string,
  body: ArrayBuffer,
  contentType: string,
  options: LocalUploadOptions,
): Promise<Record<string, unknown>> {
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    let failure: LocalRecordingUploadError;
    try {
      const response = await uploadChunkRequest({
        url,
        body,
        contentType: contentType || "application/octet-stream",
        signal: options.signal,
      });
      const text = await response.text();
      const classified = classifyUploadResponseError({
        contentType: response.headers.get("content-type"),
        body: text,
        status: response.status,
        stage: "chunk_upload",
      });
      if (response.ok && !classified.isHtml) {
        try {
          return JSON.parse(text) as Record<string, unknown>;
        } catch {
          // coercion-ok: an unparsable 2xx is an accepted chunk with no
          // finalize detail; the caller treats a missing status as unsaved.
          return {};
        }
      }
      let message = classified.responseText || response.statusText;
      let finalizeFailed = false;
      try {
        const parsed = JSON.parse(text) as {
          error?: unknown;
          failureReason?: unknown;
          status?: unknown;
        };
        if (typeof parsed.error === "string") message = parsed.error;
        else if (typeof parsed.failureReason === "string") {
          message = parsed.failureReason;
        }
        finalizeFailed = parsed.status === "failed";
      } catch {
        // coercion-ok: a non-JSON error body keeps its raw text as the message.
      }
      const code = classifyLocalUploadFailure({
        status: response.status,
        message,
        isHtml: classified.isHtml,
      });
      failure = new LocalRecordingUploadError(
        // A finalize that already marked the row failed is terminal; resending
        // the chunk cannot change it.
        finalizeFailed && code === "server_unavailable"
          ? "upload_failed"
          : code,
        message || `Upload failed (${response.status}).`,
        response.status,
      );
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throw error;
      failure = new LocalRecordingUploadError(
        "network",
        error instanceof Error ? error.message : String(error),
      );
    }
    const delay = delays[attempt];
    if (!failure.retryable || delay === undefined) throw failure;
    await wait(delay, options.signal);
  }
}
