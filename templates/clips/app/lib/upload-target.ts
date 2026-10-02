import type { UploadMode } from "@shared/recording-core";

/** The server upload create-recording opened for a take. */
export interface CreatedUploadTarget {
  id: string;
  uploadChunkUrl: string;
  abortUrl: string;
  resetChunksUrl?: string;
  uploadMode?: UploadMode;
}

/**
 * Open the server upload a take streams into, or resolve null to record it
 * into the local copy instead. Without an intake it never throws: no owner
 * at capture, no storage, an unreadable status, a refused create (including
 * a 409 because another account signed in since capture began) or a lost
 * response all record locally, and the row the server may have inserted is
 * dropped. An intake upload has no local fallback, so its failures throw.
 */
export async function openUploadTarget(options: {
  intake: boolean;
  /** The account signed in when capture started; the server refuses any other. */
  ownerEmail: string | null;
  newId: () => string;
  isStale: () => boolean;
  fetchStatus: () => Promise<{ configured: boolean } | null>;
  create: (extra: {
    id?: string;
    expectedOwnerEmail?: string;
  }) => Promise<Response>;
  dropRow: (id: string) => void;
  onCreateFailed?: (
    cause:
      | { kind: "network"; message: string }
      | { kind: "http"; status: number },
  ) => void;
}): Promise<CreatedUploadTarget | null> {
  const { intake } = options;
  let serverId: string | undefined;
  if (!intake) {
    // An ownerless take is claimed explicitly after Stop, never streamed.
    if (!options.ownerEmail) return null;
    const status = await options.fetchStatus();
    if (options.isStale() || status?.configured !== true) return null;
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
    if (intake) throw err;
    options.onCreateFailed?.({
      kind: "network",
      message: err instanceof Error ? err.message : String(err),
    });
    // The server may have inserted the row before the response was lost.
    options.dropRow(serverId!);
    return null;
  }
  if (res.ok) {
    const created = (await res.json()) as {
      result?: CreatedUploadTarget;
    } & Partial<CreatedUploadTarget>;
    const info = created.result ?? (created as CreatedUploadTarget);
    if (!info?.id) {
      if (intake) throw new Error("create-recording did not return an id");
      options.dropRow(serverId!);
      return null;
    }
    // Cancelled while the row was being opened: drop it, keep nothing.
    if (!intake && options.isStale()) {
      options.dropRow(info.id);
      return null;
    }
    return info;
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
  // Storage read as connected but the server opened no upload (an expired
  // grant, an outage, a lost session, another account): the take records
  // locally and keeps its capture-time owner.
  options.onCreateFailed?.({ kind: "http", status: res.status });
  options.dropRow(serverId!);
  return null;
}

const UNSETTLED = Symbol("unsettled");

/**
 * What a take's upload target has settled to by the time capture starts, or
 * null when it is still resolving: capture never waits on storage. A target
 * that settles later is handed to `onLate`, so the row it opened is cleaned up.
 */
export async function uploadTargetAtStart<T>(
  target: Promise<T | null>,
  onLate: (late: T) => void,
): Promise<T | null> {
  const settled = await Promise.race([
    target,
    new Promise<typeof UNSETTLED>((resolve) =>
      setTimeout(() => resolve(UNSETTLED), 0),
    ),
  ]);
  if (settled !== UNSETTLED) return settled;
  void target.then(
    (late) => {
      if (late) onLate(late);
    },
    () => {
      // coercion-ok: a target that failed opened nothing to clean up.
    },
  );
  return null;
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
