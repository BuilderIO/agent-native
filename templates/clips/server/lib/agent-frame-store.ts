import { createHash, randomUUID } from "node:crypto";

import { deleteUploadedFile } from "@agent-native/core/file-upload";
import { runWithRequestContext } from "@agent-native/core/server";
import { buildRecommendedFrames } from "@shared/agent-context";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  fetchRecordingMediaResponse,
  loadAgentTranscript,
  parseAgentChapters,
  type PublicAgentRecording,
} from "./public-agent-context.js";
import {
  claimLease,
  isLeaseHeld,
  releaseLease,
  renewLease,
  type RecordingLease,
} from "./recording-leases.js";
import { deleteStoredMediaUrl } from "./recording-media-cleanup.js";
import { ownerEmailMatches } from "./recordings.js";
import { uploadRecordingMedia } from "./upload-recording-media.js";

function sameMedia(
  row: Pick<FrameRecording, "videoUrl" | "editsJson">,
  recording: Pick<FrameRecording, "videoUrl" | "editsJson">,
): boolean {
  return (
    row.videoUrl === recording.videoUrl && row.editsJson === recording.editsJson
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type FrameRecording = Pick<
  PublicAgentRecording,
  "id" | "ownerEmail" | "storageMode" | "videoUrl" | "editsJson"
>;

/**
 * Identity of the pixels a frame was cut from. Not `updatedAt`, which a title
 * edit changes; edits are in because a trim or redaction changes the frame.
 */
export function agentFrameMediaKey(
  recording: Pick<FrameRecording, "videoUrl" | "editsJson">,
): string {
  return createHash("sha256")
    .update(`${recording.videoUrl ?? ""}\n${recording.editsJson}`)
    .digest("hex");
}

/**
 * A request's `atMs` as the frame route clamps it, so a recommended timestamp
 * and the request that asks for it name the same stored frame.
 */
export function clampAgentFrameAtMs(atMs: number, durationMs: number): number {
  return durationMs > 0 ? Math.min(atMs, Math.max(0, durationMs - 1)) : atMs;
}

/** A stored frame's object, as the provider that holds it recorded it. */
type FrameObject = {
  storageUrl: string;
  storageProvider: string;
  storageId: string | null;
};

/**
 * Deletes through the provider that stored the object. The Clips S3 providers
 * ("s3", "clips-hosted") register no `delete`, so they go through the Clips
 * storage path.
 */
async function deleteFrameObject(
  recording: Pick<FrameRecording, "id">,
  object: FrameObject,
): Promise<boolean> {
  try {
    const deleted =
      object.storageProvider === "clips-hosted" ||
      object.storageProvider === "s3"
        ? await deleteStoredMediaUrl(object.storageUrl, {
            storageMode:
              object.storageProvider === "clips-hosted" ? "hosted" : "own",
            recordingId: recording.id,
          })
        : await deleteUploadedFile(object.storageProvider, {
            url: object.storageUrl,
            ...(object.storageId ? { id: object.storageId } : {}),
          });
    if (!deleted) {
      console.warn("[agent-frame-store] stored frame cleanup unavailable", {
        recordingId: recording.id,
        provider: object.storageProvider,
      });
    }
    return deleted;
  } catch (error) {
    console.warn("[agent-frame-store] stored frame cleanup failed", {
      recordingId: recording.id,
      error: errorMessage(error),
    });
    return false;
  }
}

/**
 * Deletes a frame's object, then its row only while it still points at that
 * object (a fill may have re-pointed it). False: the object is not confirmed
 * gone, so the row stays for a retry.
 */
async function deleteFrameRow(
  recording: Pick<FrameRecording, "id">,
  row: FrameObject & { id: string },
): Promise<boolean> {
  if (!(await deleteFrameObject(recording, row))) return false;
  await getDb()
    .delete(schema.recordingAgentFrames)
    .where(
      and(
        eq(schema.recordingAgentFrames.id, row.id),
        eq(schema.recordingAgentFrames.storageUrl, row.storageUrl),
      ),
    );
  return true;
}

function loadFrameRows(recordingId: string) {
  return getDb()
    .select()
    .from(schema.recordingAgentFrames)
    .where(eq(schema.recordingAgentFrames.recordingId, recordingId));
}

function loadFrameRow(recordingId: string, atMs: number) {
  return getDb()
    .select()
    .from(schema.recordingAgentFrames)
    .where(
      and(
        eq(schema.recordingAgentFrames.recordingId, recordingId),
        eq(schema.recordingAgentFrames.atMs, atMs),
      ),
    )
    .limit(1);
}

const fillsInFlight = new Map<string, Promise<void>>();

// The fill is also a SQL lease, so other instances see it. It is renewed as
// the fill works, so it only has to outlast one step: a holder that dies
// frees the clip within this long.
const FILL_LEASE_MS = 60 * 1000;
// How long a request waits for someone else's fill before serving on demand,
// and how often it looks across instances.
const FILL_WAIT_MS = 10_000;
const FILL_POLL_MS = 300;

function fillKey(recordingId: string, mediaKey: string): string {
  return `${recordingId}:${mediaKey}`;
}

/**
 * The stored JPEG for `atMs`, or null: no row, other media, or an object that
 * cannot be read (logged; the on-demand path repairs it). A database failure
 * is not a miss and propagates.
 */
async function readStoredFrame(
  recording: FrameRecording,
  atMs: number,
  mediaKey: string,
): Promise<Uint8Array | null> {
  const row = (await loadFrameRow(recording.id, atMs)).find(
    (frame) => frame.mediaKey === mediaKey,
  );
  if (!row) return null;

  try {
    const response = await fetchRecordingMediaResponse(row.storageUrl, {
      recordingId: recording.id,
      storageMode: recording.storageMode,
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error("Stored frame is empty.");
    }
    return bytes;
  } catch (error) {
    console.warn("[agent-frame-store] stored frame unreadable", {
      recordingId: recording.id,
      atMs,
      error: errorMessage(error),
    });
    return null;
  }
}

/**
 * Whether the recording still has the media a frame was cut from. Cheap, so
 * stale work stops before it uploads or deletes; the locked read in
 * `storeAgentFrame` makes it exact.
 */
async function isMediaCurrent(recording: FrameRecording): Promise<boolean> {
  const rows = await getDb()
    .select({
      videoUrl: schema.recordings.videoUrl,
      editsJson: schema.recordings.editsJson,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recording.id),
        ownerEmailMatches(schema.recordings.ownerEmail, recording.ownerEmail),
      ),
    );
  return rows.some((row) => sameMedia(row, recording));
}

/**
 * The right to cut and store a clip's recommended frames, held by one request
 * from its stored-frame miss until it is done. Requests that miss meanwhile
 * wait for it instead of downloading the video themselves.
 */
export type AgentFrameClaim = {
  /** Cuts and stores the frames, then releases the claim. */
  fill(
    extract: (atMs: number) => Promise<Uint8Array>,
    known?: { atMs: number; frame: Uint8Array },
  ): Promise<void>;
  /** Gives the claim up without filling; safe to call after `fill`. */
  release(): Promise<void>;
};

export type StoredAgentFrameLookup =
  | { frame: Uint8Array }
  /** `null`: the store has nothing to add for this request; serve on demand. */
  | { claim: AgentFrameClaim | null };

/**
 * The stored frame for `atMs`, or the claim to fill the clip's frames. A miss
 * for a recommended timestamp while someone else is filling waits for that
 * fill once, so a cold burst shares one download.
 *
 * No claim means serve on demand: the timestamp is not one a fill stores, the
 * fill did not store this frame (taking over would repeat it per waiter), or
 * the store is unreadable (logged; must not queue video downloads).
 */
export async function loadStoredAgentFrame(
  recording: PublicAgentRecording,
  atMs: number,
): Promise<StoredAgentFrameLookup> {
  const mediaKey = agentFrameMediaKey(recording);
  const key = fillKey(recording.id, mediaKey);
  try {
    const frame = await readStoredFrame(recording, atMs, mediaKey);
    if (frame) return { frame };
    const held = fillsInFlight.get(key);
    if (!held)
      return await claimOrWaitForOtherFill(recording, atMs, key, mediaKey);
    if (!(await isRecommendedAgentFrame(recording, atMs))) {
      return { claim: null };
    }
    await waitUpTo(held, FILL_WAIT_MS);
    const filled = await readStoredFrame(recording, atMs, mediaKey);
    return filled ? { frame: filled } : { claim: null };
  } catch (error) {
    console.error("[agent-frame-store] stored frames unavailable", {
      recordingId: recording.id,
      atMs,
      error: errorMessage(error),
    });
    return { claim: null };
  }
}

/** Waits for `promise`, but no longer than `ms`: a stuck fill must not hang its waiters. */
async function waitUpTo(promise: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function fillLeaseKey(recordingId: string, mediaKey: string): string {
  return `agent-frames:${fillKey(recordingId, mediaKey)}`;
}

/**
 * Polls for `atMs` while another instance holds the clip's fill lease. Null
 * when the lease ends without the frame, or the wait runs out.
 */
async function waitForOtherFill(
  recording: FrameRecording,
  atMs: number,
  mediaKey: string,
): Promise<Uint8Array | null> {
  const leaseKey = fillLeaseKey(recording.id, mediaKey);
  const deadline = Date.now() + FILL_WAIT_MS;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, FILL_POLL_MS));
    // The lease is read before the frame: a fill stores its frames before it
    // releases, so a lease seen free means the frame is already there to read.
    const held = await isLeaseHeld(leaseKey);
    const frame = await readStoredFrame(recording, atMs, mediaKey);
    if (frame) return frame;
    if (!held || Date.now() >= deadline) return null;
  }
}

/**
 * Takes the fill for a clip nobody here is filling: this process, then the
 * SQL lease. Losing the lease means another instance is filling.
 */
async function claimOrWaitForOtherFill(
  recording: PublicAgentRecording,
  atMs: number,
  key: string,
  mediaKey: string,
): Promise<StoredAgentFrameLookup> {
  const { claim, holdLease } = claimFill(recording, key, mediaKey);
  try {
    const lease = await claimLease(
      fillLeaseKey(recording.id, mediaKey),
      FILL_LEASE_MS,
    );
    if (lease) {
      holdLease(lease);
      return { claim };
    }
    const wanted = await isRecommendedAgentFrame(recording, atMs);
    const frame = wanted
      ? await waitForOtherFill(recording, atMs, mediaKey)
      : null;
    await claim.release();
    return frame ? { frame } : { claim: null };
  } catch (error) {
    await claim.release();
    throw error;
  }
}

/**
 * The timestamps the agent context recommends, clamped as the frame route
 * clamps a request, so each one is the `atMs` a request will arrive with.
 */
export async function recommendedAgentFrameTimes(
  recording: PublicAgentRecording,
): Promise<number[]> {
  const durationMs =
    typeof recording.durationMs === "number" ? recording.durationMs : 0;
  const { agentSegments } = await loadAgentTranscript(recording.id, durationMs);
  const times = buildRecommendedFrames({
    durationMs: recording.durationMs,
    chapters: parseAgentChapters(recording),
    segments: agentSegments,
  }).map((frame) => clampAgentFrameAtMs(frame.atMs, durationMs));
  return [...new Set(times)];
}

async function isRecommendedAgentFrame(
  recording: PublicAgentRecording,
  atMs: number,
): Promise<boolean> {
  return (await recommendedAgentFrameTimes(recording)).includes(atMs);
}

/**
 * Uploads `frame` and points the row at it. The caller already has the frame
 * to serve, so a failure is logged, not thrown. `previous` is the row the
 * caller saw for this timestamp, if any.
 */
async function storeAgentFrame(
  recording: FrameRecording,
  mediaKey: string,
  atMs: number,
  frame: Uint8Array,
  previous: FrameObject | null,
): Promise<void> {
  // Before anything is uploaded or deleted: a stale fill must never reach a
  // row a newer fill recorded.
  if (!(await isMediaCurrent(recording))) return;

  // Confirmed gone before the row moves on, or the old object is untracked.
  // Outside the lock below: a hosted delete takes the allowance lock, which
  // other paths take before the recording's.
  if (previous && !(await deleteFrameObject(recording, previous))) return;

  let uploaded: Awaited<ReturnType<typeof uploadRecordingMedia>>;
  try {
    uploaded = await uploadRecordingMedia({
      recordingId: recording.id,
      data: frame,
      filename: `agent-frame-${atMs}.jpg`,
      mimeType: "image/jpeg",
      ownerEmail: recording.ownerEmail,
      recordAsset: false,
    });
  } catch (error) {
    console.warn("[agent-frame-store] could not upload frame", {
      recordingId: recording.id,
      atMs,
      error: errorMessage(error),
    });
    return;
  }
  if (!uploaded) return;

  const object: FrameObject = {
    storageUrl: uploaded.url,
    storageProvider: uploaded.provider,
    storageId: uploaded.id ?? null,
  };
  const values = {
    mediaKey,
    ...object,
    sizeBytes: frame.byteLength,
    createdAt: new Date().toISOString(),
  };
  let recorded: boolean;
  try {
    recorded = await getDb().transaction(async (tx) => {
      // A burn or delete changes the recording, then deletes its frames, so
      // a frame from replaced media must not be recorded behind that cleanup.
      // The lock also serializes fills of one clip across instances.
      const current = await tx
        .select({
          videoUrl: schema.recordings.videoUrl,
          editsJson: schema.recordings.editsJson,
        })
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.id, recording.id),
            ownerEmailMatches(
              schema.recordings.ownerEmail,
              recording.ownerEmail,
            ),
          ),
        )
        .for("update");
      if (!current.some((row) => sameMedia(row, recording))) {
        return false;
      }
      // Only the row the caller saw may be replaced: overwriting another
      // fill's row would orphan its object.
      const existing = await tx
        .select({ storageUrl: schema.recordingAgentFrames.storageUrl })
        .from(schema.recordingAgentFrames)
        .where(
          and(
            eq(schema.recordingAgentFrames.recordingId, recording.id),
            eq(schema.recordingAgentFrames.atMs, atMs),
          ),
        );
      const unchanged = previous
        ? existing.some((row) => row.storageUrl === previous.storageUrl)
        : existing.length === 0;
      if (!unchanged) return false;
      await tx
        .insert(schema.recordingAgentFrames)
        .values({
          id: randomUUID(),
          recordingId: recording.id,
          atMs,
          ...values,
        })
        .onConflictDoUpdate({
          target: [
            schema.recordingAgentFrames.recordingId,
            schema.recordingAgentFrames.atMs,
          ],
          set: values,
        });
      return true;
    });
  } catch (error) {
    console.warn("[agent-frame-store] could not record frame", {
      recordingId: recording.id,
      atMs,
      error: errorMessage(error),
    });
    recorded = false;
  }
  if (recorded) return;
  // No row points at this object; if it cannot be deleted, this log is the
  // only record of where it is.
  if (!(await deleteFrameObject(recording, object))) {
    console.error("[agent-frame-store] rejected frame upload left in storage", {
      recordingId: recording.id,
      atMs,
      ...object,
    });
  }
}

/**
 * Cuts and stores every recommended frame not yet stored, from media the claim
 * holder already has on disk. `known` is a frame it already cut. Runs as the
 * clip's owner and never rejects: a frame that cannot be cut or stored is
 * logged and left to the on-demand path.
 */
async function runFill(
  recording: PublicAgentRecording,
  mediaKey: string,
  extract: (atMs: number) => Promise<Uint8Array>,
  known: { atMs: number; frame: Uint8Array } | undefined,
  onProgress: () => Promise<boolean>,
): Promise<void> {
  try {
    await runWithRequestContext(
      {
        userEmail: recording.ownerEmail,
        ...(recording.orgId ? { orgId: recording.orgId } : {}),
      },
      async () => {
        const [times, rows] = await Promise.all([
          recommendedAgentFrameTimes(recording),
          loadFrameRows(recording.id),
        ]);
        const rowsByAtMs = new Map(rows.map((row) => [row.atMs, row]));
        if (!(await onProgress())) return;
        for (const atMs of times) {
          const existing = rowsByAtMs.get(atMs);
          // The requested frame reaches here only after its stored copy was
          // missed, so a current row for it points at an unreadable object.
          if (existing?.mediaKey === mediaKey && known?.atMs !== atMs) {
            continue;
          }
          let frame = known?.atMs === atMs ? known.frame : null;
          if (!frame) {
            try {
              frame = await extract(atMs);
            } catch (error) {
              console.warn("[agent-frame-store] recommended frame not cut", {
                recordingId: recording.id,
                atMs,
                error: errorMessage(error),
              });
              continue;
            }
          }
          await storeAgentFrame(
            recording,
            mediaKey,
            atMs,
            frame,
            existing ?? null,
          );
          if (!(await onProgress())) return;
        }
        // Frames at timestamps no longer recommended would otherwise hold
        // storage and hosted quota until the recording is deleted. Only for
        // current media, so a stale fill never prunes a newer one's frames.
        if (!(await isMediaCurrent(recording))) return;
        const wanted = new Set(times);
        for (const row of rows) {
          if (!wanted.has(row.atMs)) await deleteFrameRow(recording, row);
        }
      },
    );
  } catch (error) {
    console.warn("[agent-frame-store] frame fill skipped", {
      recordingId: recording.id,
      error: errorMessage(error),
    });
  }
}

function claimFill(
  recording: PublicAgentRecording,
  key: string,
  mediaKey: string,
): { claim: AgentFrameClaim; holdLease: (lease: RecordingLease) => void } {
  let resolveHeld: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    resolveHeld = resolve;
  });
  fillsInFlight.set(key, held);
  let lease: RecordingLease | null = null;
  const release = async () => {
    if (fillsInFlight.get(key) === held) fillsInFlight.delete(key);
    resolveHeld();
    const taken = lease;
    lease = null;
    if (!taken) return;
    try {
      await releaseLease(taken);
    } catch (error) {
      // Expires on its own, so other instances wait out the TTL at worst.
      console.warn("[agent-frame-store] fill lease not released", {
        recordingId: recording.id,
        error: errorMessage(error),
      });
    }
  };
  // False once the lease is no longer ours: another instance took the clip
  // over, so this fill stops rather than repeat its uploads.
  const renew = async () => {
    if (!lease) return true;
    try {
      return await renewLease(lease, FILL_LEASE_MS);
    } catch (error) {
      console.warn("[agent-frame-store] fill lease not renewed", {
        recordingId: recording.id,
        error: errorMessage(error),
      });
      return true;
    }
  };
  return {
    claim: {
      fill: async (extract, known) => {
        try {
          await runFill(recording, mediaKey, extract, known, renew);
        } finally {
          await release();
        }
      },
      release,
    },
    holdLease: (taken) => {
      lease = taken;
    },
  };
}

/**
 * Removes every stored frame of a recording, objects then rows. A row stays
 * until its object is confirmed gone. Returns how many frames could not be
 * deleted from storage; the caller must act on that.
 */
export async function deleteStoredAgentFrames(
  recording: Pick<FrameRecording, "id">,
): Promise<number> {
  const rows = await loadFrameRows(recording.id);
  let remaining = 0;
  for (const row of rows) {
    if (!(await deleteFrameRow(recording, row))) remaining += 1;
  }
  return remaining;
}
