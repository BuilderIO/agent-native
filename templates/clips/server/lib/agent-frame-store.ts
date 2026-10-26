import { createHash, randomUUID } from "node:crypto";

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

async function deleteFrameObject(
  recording: Pick<FrameRecording, "id" | "storageMode">,
  url: string,
): Promise<boolean> {
  try {
    const deleted = await deleteStoredMediaUrl(url, {
      storageMode: recording.storageMode,
      recordingId: recording.id,
    });
    if (!deleted) {
      console.warn("[agent-frame-store] stored frame cleanup unavailable", {
        recordingId: recording.id,
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
 * to serve, so a failure is logged, not thrown.
 */
async function storeAgentFrame(
  recording: FrameRecording,
  mediaKey: string,
  atMs: number,
  frame: Uint8Array,
  previousUrl: string | null,
): Promise<void> {
  // The object being replaced goes first and must be confirmed gone: once the
  // row points at the new object nothing records the old one, so a failed
  // delete afterwards would leak it for good. Left as is, the next fill
  // retries.
  if (previousUrl && !(await deleteFrameObject(recording, previousUrl))) return;

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
      // been replaced must not be recorded behind that cleanup.
      const current = await tx
        .select({
          videoUrl: schema.recordings.videoUrl,
          editsJson: schema.recordings.editsJson,
        })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, recording.id))
        .for("update");
      if (current.length === 0 || agentFrameMediaKey(current[0]) !== mediaKey) {
        return false;
      }
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
  if (!recorded) await deleteFrameObject(recording, uploaded.url);
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
          orgId: recording.orgId ?? undefined,
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
              existing?.storageUrl ?? null,
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
 * so a failure here can be retried; it throws after trying every frame.
 */
export async function deleteStoredAgentFrames(
  recording: Pick<FrameRecording, "id" | "storageMode">,
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.recordingAgentFrames.id,
      storageUrl: schema.recordingAgentFrames.storageUrl,
    })
    .from(schema.recordingAgentFrames)
    .where(eq(schema.recordingAgentFrames.recordingId, recording.id));
  let failed = 0;
  for (const row of rows) {
    if (!(await deleteFrameObject(recording, row.storageUrl))) {
      failed += 1;
      continue;
    }
    await db
      .delete(schema.recordingAgentFrames)
      .where(eq(schema.recordingAgentFrames.id, row.id));
  }
  if (failed > 0) {
    // guard:allow-bare-error — invariant: callers must know an unredacted frame may remain in storage.
    throw new Error(
      `${failed} stored agent frame(s) of ${recording.id} could not be deleted from storage.`,
    );
  }
}
