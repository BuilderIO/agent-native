/**
 * Add a recording as a source in a video project (the full multi-track
 * editor). Creates the project when no projectId is given.
 *
 * The recording's bytes are never copied — the project references the
 * authenticated media route (/api/video/:id). The import is queued in
 * `pending_imports_json`; the editor materialises it as timeline items on next
 * load (the client owns the item shape) and then clears the queue.
 *
 * By default the simple editor's edits are respected: the clip is imported as
 * its kept ranges laid out sequentially, subdivided at split markers so each
 * clips-editor segment becomes its own timeline item. Transcript captions can
 * be imported as a caption track, remapped to the edited timeline.
 *
 * Usage:
 *   pnpm action add-recording-to-video-project --recordingId=<id>
 *   pnpm action add-recording-to-video-project --recordingId=<id> --projectId=<id> --includeCaptions
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { parseTranscriptSegments } from "@shared/transcript-segments.js";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  getKeptRanges,
  getKeptSegments,
  originalToEdited,
  parseEdits,
} from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import { resolvePlayerVideoUrl } from "../server/lib/player-video-url.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  requireOrganizationAccess,
} from "../server/lib/recordings.js";

const MIN_CAPTION_MS = 80;

export default defineAction({
  description:
    "Add a recording as a source in a video project (full multi-track editor). Omit projectId to create a new project named after the recording. Respects the recording's simple-editor edits by default: trimmed ranges are dropped and split markers carry over as separate timeline items (respectEdits=false imports the raw clip). Set includeCaptions=true to also add the transcript as a caption track. Returns the projectId; open it at /video-projects/:id.",
  schema: z.object({
    recordingId: z.string().describe("Recording to add as a source"),
    projectId: z
      .string()
      .optional()
      .describe("Existing project to add to; omit to create a new project"),
    respectEdits: z.coerce
      .boolean()
      .default(true)
      .optional()
      .describe(
        "Import only the kept (non-trimmed) ranges from the simple editor",
      ),
    includeCaptions: z.coerce
      .boolean()
      .default(false)
      .optional()
      .describe("Import the recording's transcript as a caption track"),
  }),
  link: ({ result }) => {
    const projectId = (result as { projectId?: unknown } | null)?.projectId;
    if (typeof projectId !== "string") return null;
    return { url: `/video-projects/${projectId}`, label: "Open video project" };
  },
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "viewer");

    const db = getDb();
    const [recording] = await db
      .select({
        id: schema.recordings.id,
        title: schema.recordings.title,
        status: schema.recordings.status,
        videoUrl: schema.recordings.videoUrl,
        videoFormat: schema.recordings.videoFormat,
        videoSizeBytes: schema.recordings.videoSizeBytes,
        durationMs: schema.recordings.durationMs,
        width: schema.recordings.width,
        height: schema.recordings.height,
        hasAudio: schema.recordings.hasAudio,
        editsJson: schema.recordings.editsJson,
        password: schema.recordings.password,
        sourceAppName: schema.recordings.sourceAppName,
        sourceWindowTitle: schema.recordings.sourceWindowTitle,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId));

    if (!recording) {
      throw new Error(`Recording not found: ${args.recordingId}`);
    }
    if (recording.status !== "ready" || !recording.videoUrl) {
      throw new Error(
        `Recording ${args.recordingId} is not ready yet (status: ${recording.status})`,
      );
    }

    const videoUrl = resolvePlayerVideoUrl(recording, {
      proxyRemoteMedia: true,
      addPasswordToken: true,
    });
    if (!videoUrl) {
      throw new Error(`Recording ${args.recordingId} has no playable video`);
    }

    const edits = parseEdits(recording.editsJson);
    const respectEdits = args.respectEdits ?? true;
    // Captions clamp against merged kept ranges (a split must not slice a
    // caption in two); timeline items use split-subdivided segments so the
    // clips editor's segmentation carries over as separate items.
    const keptRanges = respectEdits
      ? getKeptRanges(recording.durationMs, edits).filter(
          (range) => range.endMs > range.startMs,
        )
      : null;
    const keptSegments = respectEdits
      ? getKeptSegments(recording.durationMs, edits).filter(
          (range) => range.endMs > range.startMs,
        )
      : null;

    let captions: Array<{
      text: string;
      startMs: number;
      endMs: number;
    }> | null = null;
    if (args.includeCaptions) {
      const [transcript] = await db
        .select({
          segmentsJson: schema.recordingTranscripts.segmentsJson,
          status: schema.recordingTranscripts.status,
        })
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, args.recordingId));

      const segments = parseTranscriptSegments(transcript?.segmentsJson);
      if (segments.length > 0) {
        if (respectEdits && keptRanges && keptRanges.length > 0) {
          // Remap original-time segments onto the edited (kept-only) timeline;
          // clamp to each kept range and drop slivers.
          captions = [];
          for (const range of keptRanges) {
            for (const segment of segments) {
              const start = Math.max(segment.startMs, range.startMs);
              const end = Math.min(segment.endMs, range.endMs);
              if (end - start < MIN_CAPTION_MS) continue;
              captions.push({
                text: segment.text,
                startMs: originalToEdited(start, edits),
                endMs: originalToEdited(end, edits),
              });
            }
          }
          captions.sort((a, b) => a.startMs - b.startMs);
        } else {
          captions = segments.map((segment) => ({
            text: segment.text,
            startMs: segment.startMs,
            endMs: segment.endMs,
          }));
        }
        if (captions.length === 0) captions = null;
      }
    }

    const pendingImport = {
      kind: "recording" as const,
      recordingId: recording.id,
      title: recording.title,
      videoUrl,
      mimeType: recording.videoFormat === "webm" ? "video/webm" : "video/mp4",
      sizeBytes: recording.videoSizeBytes,
      durationMs: recording.durationMs,
      width: recording.width,
      height: recording.height,
      hasAudio: recording.hasAudio,
      keptRanges: keptSegments,
      captions,
    };

    const now = new Date().toISOString();
    let projectId = args.projectId ?? null;
    let created = false;

    if (projectId) {
      await assertAccess("video-project", projectId, "editor");
      const [project] = await db
        .select({
          id: schema.videoProjects.id,
          pendingImportsJson: schema.videoProjects.pendingImportsJson,
          sourceRecordingIds: schema.videoProjects.sourceRecordingIds,
          trashedAt: schema.videoProjects.trashedAt,
        })
        .from(schema.videoProjects)
        .where(eq(schema.videoProjects.id, projectId));
      if (!project || project.trashedAt) {
        throw new Error(`Video project not found: ${projectId}`);
      }

      const pending = safeParseArray(project.pendingImportsJson);
      pending.push(pendingImport);
      const sourceIds = new Set(
        safeParseArray(project.sourceRecordingIds).filter(
          (v): v is string => typeof v === "string",
        ),
      );
      sourceIds.add(recording.id);

      await db
        .update(schema.videoProjects)
        .set({
          pendingImportsJson: JSON.stringify(pending),
          sourceRecordingIds: JSON.stringify([...sourceIds]),
          updatedAt: now,
        })
        .where(eq(schema.videoProjects.id, projectId));
    } else {
      const ownerEmail = getCurrentOwnerEmail();
      const { organizationId } = await requireOrganizationAccess(undefined);
      projectId = nanoid();
      created = true;

      await db.insert(schema.videoProjects).values({
        id: projectId,
        organizationId,
        orgId: organizationId,
        title: recording.title,
        pendingImportsJson: JSON.stringify([pendingImport]),
        sourceRecordingIds: JSON.stringify([recording.id]),
        ownerEmail,
        createdAt: now,
        updatedAt: now,
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      projectId,
      created,
      recordingId: recording.id,
      importedRanges: keptSegments?.length ?? 1,
      includedCaptions: Boolean(captions),
      url: `/video-projects/${projectId}`,
    };
  },
});

function safeParseArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
