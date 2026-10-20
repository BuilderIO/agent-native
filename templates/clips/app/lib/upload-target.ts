import type { UploadMode } from "@shared/recording-core";

/** The server upload create-recording opened for a take. */
export interface CreatedUploadTarget {
  id: string;
  uploadChunkUrl: string;
  abortUrl: string;
  resetChunksUrl?: string;
  uploadMode?: UploadMode;
  clientLimits?: {
    maxClipBytes: number;
    maxClipDurationMs: number;
  };
}

interface VideoStorageUploadStatus {
  configured: boolean;
  mode: "own" | "hosted" | "none";
  hostedRemaining: number;
  maxClipBytes: number;
  maxClipDurationMs: number;
}

/**
 * The status carries the hosted caps in every mode; only hosted uploads are
 * bound by them, so own storage gets none.
 */
export function hostedUploadLimits(
  status: VideoStorageUploadStatus | null,
): NonNullable<CreatedUploadTarget["clientLimits"]> | null {
  return status?.mode === "hosted"
    ? {
        maxClipBytes: status.maxClipBytes,
        maxClipDurationMs: status.maxClipDurationMs,
      }
    : null;
}

export type UploadTargetErrorCode =
  | "session_expired"
  | "storage_setup_required"
  | "storage_status_unavailable"
  | "hosted_storage_unavailable"
  | "recording_owner_mismatch"
  | "upload_target_unavailable";

export class UploadTargetError extends Error {
  constructor(readonly code: UploadTargetErrorCode) {
    super(code);
    this.name = "UploadTargetError";
  }
}

const STORAGE_SETUP_DENIAL_CODES = new Set([
  "storage_setup_required",
  "unverified",
  "disposable",
  "ip_velocity",
  "global_daily_cap",
  "global_storage_cap",
  "disabled",
  "exhausted",
]);

/** Runs capture preparation only after the server accepts an upload target. */
export async function prepareCaptureAfterUploadTarget<T>(
  resolveTarget: () => Promise<T | null>,
  prepareCapture: (target: T) => Promise<void>,
): Promise<T | null> {
  const target = await resolveTarget();
  if (target) await prepareCapture(target);
  return target;
}

/** Open the server upload a take streams into. A take cannot start without it. */
export async function openUploadTarget(options: {
  intake: boolean;
  /** The account signed in when capture started; the server refuses any other. */
  ownerEmail: string | null;
  newId: () => string;
  isStale: () => boolean;
  fetchStatus: () => Promise<VideoStorageUploadStatus | null>;
  create: (extra: {
    id?: string;
    expectedOwnerEmail?: string;
  }) => Promise<Response>;
  dropRow: (id: string) => void;
  onCreateFailed?: (
    cause:
      | { kind: "network"; message: string }
      | { kind: "http"; status: number; storageSetupRequired?: boolean },
  ) => void;
}): Promise<CreatedUploadTarget | null> {
  const { intake } = options;
  let serverId: string | undefined;
  let uploadStatus: VideoStorageUploadStatus | null = null;
  if (!intake) {
    if (!options.ownerEmail) {
      throw new UploadTargetError("session_expired");
    }
    try {
      uploadStatus = await options.fetchStatus();
    } catch {
      if (options.isStale()) return null;
      throw new UploadTargetError("storage_status_unavailable");
    }
    if (options.isStale()) return null;
    if (!uploadStatus) {
      throw new UploadTargetError("storage_status_unavailable");
    }
    const hasUploadStorage =
      uploadStatus?.mode === "own" ||
      (uploadStatus?.mode === "hosted" && uploadStatus.hostedRemaining > 0);
    if (uploadStatus.configured !== true || !hasUploadStorage) {
      throw new UploadTargetError("storage_setup_required");
    }
    serverId = options.newId();
  }
  let res: Response;
  try {
    res = await options.create(
      serverId
        ? { id: serverId, expectedOwnerEmail: options.ownerEmail ?? undefined }
        : {},
    );
  } catch (err) {
    options.onCreateFailed?.({
      kind: "network",
      message: err instanceof Error ? err.message : String(err),
    });
    // The server may have inserted the row before the response was lost.
    if (serverId) options.dropRow(serverId);
    throw new UploadTargetError("upload_target_unavailable");
  }
  if (res.ok) {
    let created: {
      result?: CreatedUploadTarget;
    } & Partial<CreatedUploadTarget>;
    try {
      created = (await res.json()) as typeof created;
    } catch {
      if (serverId) options.dropRow(serverId);
      throw new UploadTargetError("upload_target_unavailable");
    }
    const info = created.result ?? (created as CreatedUploadTarget);
    if (!info?.id) {
      if (intake) throw new Error("create-recording did not return an id");
      options.dropRow(serverId!);
      throw new UploadTargetError("upload_target_unavailable");
    }
    // Cancelled while the row was being opened: drop it, keep nothing.
    if (!intake && options.isStale()) {
      options.dropRow(info.id);
      return null;
    }
    const clientLimits = hostedUploadLimits(uploadStatus);
    return { ...info, ...(clientLimits ? { clientLimits } : {}) };
  }
  if (intake) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("SESSION_EXPIRED");
    }
    // coercion-ok: a non-JSON error body falls back to the HTTP status below.
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `create-recording failed (${res.status})`);
  }
  // Action failures include the storage denial reason as an errorCode and in
  // details.denyReason. Status alone cannot distinguish those from auth errors.
  // coercion-ok: non-JSON failures have no denial code and use the status fallback.
  const body = (await res.json().catch(() => null)) as {
    errorCode?: string;
    details?: { denyReason?: string };
  } | null;
  const denialCode = body?.details?.denyReason ?? body?.errorCode;
  const storageSetupRequired = STORAGE_SETUP_DENIAL_CODES.has(denialCode ?? "");
  // Storage read as connected but the server opened no upload (an expired
  // grant, an outage, a lost session, another account): stop before capture.
  options.onCreateFailed?.({
    kind: "http",
    status: res.status,
    ...(storageSetupRequired ? { storageSetupRequired: true } : {}),
  });
  options.dropRow(serverId!);
  if (storageSetupRequired) {
    throw new UploadTargetError("storage_setup_required");
  }
  if (denialCode === "hosted_storage_unavailable") {
    throw new UploadTargetError("hosted_storage_unavailable");
  }
  if (denialCode === "recording_owner_mismatch") {
    throw new UploadTargetError("recording_owner_mismatch");
  }
  if (res.status === 401 || res.status === 403) {
    throw new UploadTargetError("session_expired");
  }
  throw new UploadTargetError("upload_target_unavailable");
}

/**
 * Give up a take's server upload when its recorder could not start: an
 * intake row is aborted, any other row trashed unless it is already ready.
 */
export function abandonUploadTarget(
  pending: { id: string; abortUrl: string; localOnly?: boolean } | null,
  options: {
    intake: boolean;
    trash: (id: string) => Promise<unknown>;
    abort: (abortUrl: string) => Promise<unknown>;
  },
): Promise<unknown> | null {
  if (!pending || pending.localOnly) return null;
  return (
    options.intake ? options.abort(pending.abortUrl) : options.trash(pending.id)
  ).catch((err: unknown) => {
    // coercion-ok: a row left behind is reaped when its lease expires.
    console.warn("[recorder] could not give up the upload row:", err);
  });
}
