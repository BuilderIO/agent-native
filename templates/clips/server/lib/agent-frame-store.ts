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
import { deleteStoredMediaUrl } from "./recording-media-cleanup.js";
import { ownerEmailMatches } from "./recordings.js";
import { uploadRecordingMedia } from "./upload-recording-media.js";

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
 * register no `delete` for the registry to call (the own one is "s3", the
 * hosted one "clips-hosted"), so their objects go through the Clips storage
 * path; any other registered provider deletes its own.
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
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function loadFrameRows(recordingId: string) {
  return getDb()
    .select()
    .from(schema.recordingAgentFrames)
    .where(eq(schema.recordingAgentFrames.recordingId, recordingId));
}

const fillsInFlight = new Map<string, Promise<void>>();

function fillKey(recordingId: string, mediaKey: string): string {
  return `${recordingId}:${mediaKey}`;
}

/**
 * The stored JPEG for `atMs`, or null when there is none to serve: no row, a
 * row cut from different media, or bytes that cannot be read. The last two
 * are logged and left to the on-demand path rather than served as a failure.
 */
async function readStoredFrame(
  recording: FrameRecording,
  atMs: number,
  mediaKey: string,
): Promise<Uint8Array | null> {
  try {
    const row = (await loadFrameRows(recording.id)).find(
      (frame) => frame.atMs === atMs,
    );
    if (!row || row.mediaKey !== mediaKey) return null;

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
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * The stored frame for `atMs`, waiting for a fill another request is running
 * for this clip first, so a burst of requests shares one video download.
 */
export async function loadStoredAgentFrame(
  recording: FrameRecording,
  atMs: number,
): Promise<Uint8Array | null> {
  const mediaKey = agentFrameMediaKey(recording);
  const frame = await readStoredFrame(recording, atMs, mediaKey);
  if (frame) return frame;
  const fill = fillsInFlight.get(fillKey(recording.id, mediaKey));
  if (!fill) return null;
  await fill;
  return readStoredFrame(recording, atMs, mediaKey);
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
  // The object being replaced goes first and must be confirmed gone: once the
  // row points at the new object nothing records the old one, so a failed
  // delete afterwards would leak it for good. Left as is, the next fill
  // retries.
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
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (!uploaded) return;

  const values = {
    mediaKey,
    storageUrl: uploaded.url,
    storageProvider: uploaded.provider,
    storageId: uploaded.id ?? null,
    sizeBytes: frame.byteLength,
    createdAt: new Date().toISOString(),
  };
  let recorded: boolean;
  try {
    recorded = await getDb().transaction(async (tx) => {
      // Locked and re-read: a burn or delete changes the recording first and
      // deletes its frames after, so a frame cut from media that has since
      // been replaced must not be recorded behind that cleanup. The lock also
      // serializes fills of one clip, even across instances.
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
      if (!current.some((row) => agentFrameMediaKey(row) === mediaKey)) {
        return false;
      }
      // Only the row the caller saw may be replaced. Another fill that got
      // here first has recorded its own object; overwriting it would leave
      // that object with no row to find it by.
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
      error: error instanceof Error ? error.message : String(error),
    });
    recorded = false;
  }
  // The row never pointed at this object, so nothing else can find it.
  if (!recorded) {
    await deleteFrameObject(recording, {
      storageUrl: uploaded.url,
      storageProvider: uploaded.provider,
      storageId: uploaded.id ?? null,
    });
  }
}

/**
 * Cuts and stores every recommended frame not yet stored, from media the
 * caller already has on disk: whoever asks for one frame is likely to ask for
 * the rest. `known` is a frame the caller already cut. Runs as the clip's
 * owner, who owns the frames, and never rejects: a frame that cannot be cut
 * or stored is logged and left to the on-demand path.
 */
export function fillRecommendedAgentFrames(
  recording: PublicAgentRecording,
  extract: (atMs: number) => Promise<Uint8Array>,
  known?: { atMs: number; frame: Uint8Array },
): Promise<void> {
  const mediaKey = agentFrameMediaKey(recording);
  const key = fillKey(recording.id, mediaKey);
  const running = fillsInFlight.get(key);
  if (running) return running;

  const fill = Promise.resolve()
    .then(() =>
      runWithRequestContext(
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
                  error: error instanceof Error ? error.message : String(error),
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
          }
        },
      ),
    )
    .catch((error: unknown) => {
      console.warn("[agent-frame-store] frame fill skipped", {
        recordingId: recording.id,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      fillsInFlight.delete(key);
    });
  fillsInFlight.set(key, fill);
  return fill;
}

/**
 * Removes every stored frame of a recording, objects then rows. Called when
 * the media changes or the recording goes: a frame cut before a redaction
 * must never be served again. A row stays until its object is confirmed gone,
 * so what is left can be retried. Returns how many frames could not be
 * deleted from storage, which the caller must act on.
 */
export async function deleteStoredAgentFrames(
  recording: Pick<FrameRecording, "id">,
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.recordingAgentFrames.id,
      storageUrl: schema.recordingAgentFrames.storageUrl,
      storageProvider: schema.recordingAgentFrames.storageProvider,
      storageId: schema.recordingAgentFrames.storageId,
    })
    .from(schema.recordingAgentFrames)
    .where(eq(schema.recordingAgentFrames.recordingId, recording.id));
  let remaining = 0;
  for (const row of rows) {
    if (!(await deleteFrameObject(recording, row))) {
      remaining += 1;
      continue;
    }
    // Only the row whose object was just deleted: a fill may have pointed it
    // at a new object since the read above, and that row must stay.
    await db
      .delete(schema.recordingAgentFrames)
      .where(
        and(
          eq(schema.recordingAgentFrames.id, row.id),
          eq(schema.recordingAgentFrames.storageUrl, row.storageUrl),
        ),
      );
  }
  return remaining;
}
