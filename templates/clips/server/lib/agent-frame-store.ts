import { createHash, randomUUID } from "node:crypto";

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
    .update(`${recording.videoUrl ?? ""}\n${recording.editsJson ?? ""}`)
    .digest("hex");
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

/**
 * The stored JPEG for `atMs`, or null when there is none to serve: no row, a
 * row cut from different media, or bytes that cannot be read. The last is
 * logged and left to the on-demand path rather than served as a failure.
 */
export async function loadStoredAgentFrame(
  recording: FrameRecording,
  atMs: number,
): Promise<Uint8Array | null> {
  const [row] = await getDb()
    .select()
    .from(schema.recordingAgentFrames)
    .where(
      and(
        eq(schema.recordingAgentFrames.recordingId, recording.id),
        eq(schema.recordingAgentFrames.atMs, atMs),
      ),
    )
    .limit(1);
  if (!row || row.mediaKey !== agentFrameMediaKey(recording)) return null;

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
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Whether `atMs` is one of the timestamps the agent context recommends. */
export async function isRecommendedAgentFrame(
  recording: PublicAgentRecording,
  atMs: number,
): Promise<boolean> {
  const durationMs =
    typeof recording.durationMs === "number" ? recording.durationMs : 0;
  const { agentSegments } = await loadAgentTranscript(recording.id, durationMs);
  return buildRecommendedFrames({
    durationMs: recording.durationMs,
    chapters: parseAgentChapters(recording),
    segments: agentSegments,
  }).some((frame) => frame.atMs === atMs);
}

/**
 * Keeps `frame` for later requests. Best effort: the caller already has the
 * frame to serve, so a failure here is logged, not thrown.
 */
export async function storeAgentFrame(
  recording: FrameRecording,
  atMs: number,
  frame: Uint8Array,
): Promise<void> {
  let uploaded: Awaited<ReturnType<typeof uploadRecordingMedia>> = null;
  try {
    uploaded = await uploadRecordingMedia({
      recordingId: recording.id,
      data: frame,
      filename: `agent-frame-${atMs}.jpg`,
      mimeType: "image/jpeg",
      ownerEmail: recording.ownerEmail,
      recordAsset: false,
    });
    if (!uploaded) return;

    const mediaKey = agentFrameMediaKey(recording);
    const db = getDb();
    const [previous] = await db
      .select({ storageUrl: schema.recordingAgentFrames.storageUrl })
      .from(schema.recordingAgentFrames)
      .where(
        and(
          eq(schema.recordingAgentFrames.recordingId, recording.id),
          eq(schema.recordingAgentFrames.atMs, atMs),
        ),
      )
      .limit(1);
    const values = {
      mediaKey,
      storageUrl: uploaded.url,
      storageProvider: uploaded.provider,
      storageId: uploaded.id ?? null,
      sizeBytes: frame.byteLength,
      createdAt: new Date().toISOString(),
    };
    await db
      .insert(schema.recordingAgentFrames)
      .values({ id: randomUUID(), recordingId: recording.id, atMs, ...values })
      .onConflictDoUpdate({
        target: [
          schema.recordingAgentFrames.recordingId,
          schema.recordingAgentFrames.atMs,
        ],
        set: values,
      });
    if (previous && previous.storageUrl !== uploaded.url) {
      await deleteFrameObject(recording, previous.storageUrl);
    }
    uploaded = null;
  } catch (error) {
    console.warn("[agent-frame-store] could not store frame", {
      recordingId: recording.id,
      atMs,
      error: error instanceof Error ? error.message : String(error),
    });
    // Reached with `uploaded` set only if the row never pointed at it.
    if (uploaded) await deleteFrameObject(recording, uploaded.url);
  }
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
