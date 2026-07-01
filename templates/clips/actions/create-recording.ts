/**
 * Create a new recording row in 'uploading' status.
 *
 * Returns the new recording id plus a chunk upload URL template the
 * frontend fills in per-chunk. The chunk route accepts a binary body
 * with query params index/total/isFinal and calls finalize when isFinal=true.
 *
 * Usage:
 *   pnpm action create-recording --title="Quick demo"
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getActiveFileUploadProviderForRequest } from "@agent-native/core/file-upload";
import type { UploadMode } from "@shared/recording-core.js";
import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";

import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  requireOrganizationAccess,
  stringifySpaceIds,
} from "../server/lib/recordings.js";
import { setResumableSession } from "../server/lib/resumable-session.js";
import { createRecordingSchema } from "./lib/create-recording-schema.js";
import { DEFAULT_RECORDING_TITLE } from "./lib/title-source.js";

// Temporary kill switch: streaming resumable uploads caused a spike of
// recording issues. Set CLIPS_DISABLE_STREAMING_UPLOAD=false to re-enable
// once the root cause is fixed. Defaults to disabled (streaming off).
function streamingUploadDisabled(): boolean {
  const flag = process.env.CLIPS_DISABLE_STREAMING_UPLOAD ?? "";
  return flag.toLowerCase() !== "false";
}

export default defineAction({
  description:
    "Create a new recording row in 'uploading' status and return its id plus the chunk upload URL template. The frontend POSTs chunks to /api/uploads/:id/chunk?index=N&total=T&isFinal=0|1, then finalizes on the last chunk. Recorders can pass app/window title context for an immediate fallback title.",
  schema: createRecordingSchema,
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = args.id || nanoid();
    const now = new Date().toISOString();
    const title = args.title?.trim() || DEFAULT_RECORDING_TITLE;
    const titleSource =
      args.titleSource ??
      (title === DEFAULT_RECORDING_TITLE ? "default" : "manual");

    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
    );

    const spaceIds = (args.spaceIds ?? []).filter(
      (value, index, arr) => value && arr.indexOf(value) === index,
    );

    await db.insert(schema.recordings).values({
      id,
      organizationId,
      orgId: organizationId,
      folderId: args.folderId ?? null,
      spaceIds: stringifySpaceIds(spaceIds),
      title,
      titleSource,
      sourceAppName: args.sourceAppName?.trim() || null,
      sourceWindowTitle: args.sourceWindowTitle?.trim() || null,
      status: "uploading",
      uploadProgress: 0,
      hasAudio: args.hasAudio ?? true,
      hasCamera: args.hasCamera ?? false,
      visibility: args.visibility ?? "public",
      width: args.width ?? 0,
      height: args.height ?? 0,
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    await writeAppState(`recording-upload-${id}`, {
      recordingId: id,
      status: "uploading",
      progress: 0,
      startedAt: now,
    });

    console.log(`Created recording "${title}" (${id})`);

    // Initialize a resumable upload session so chunks are streamed to the
    // provider during recording (no post-stop assembly). Falls back gracefully
    // to the SQL chunk path when no provider supports resumable uploads or the
    // init fails.
    let uploadMode: UploadMode = "buffered";
    const uploadProvider = await getActiveFileUploadProviderForRequest();
    if (
      args.requestStreaming &&
      !streamingUploadDisabled() &&
      uploadProvider?.resumable
    ) {
      try {
        const recordingMimeType =
          args.mimeType?.split(";")[0]?.trim() || "video/webm";
        const ext = /mp4|quicktime/i.test(recordingMimeType) ? "mp4" : "webm";
        const filename = `${id}.${ext}`;
        console.log(
          `[create-recording] starting resumable session: provider=${uploadProvider.id} mimeType=${recordingMimeType}`,
        );
        const session = await uploadProvider.resumable.startSession(
          filename,
          recordingMimeType,
          MAX_UPLOAD_BYTES,
        );
        await setResumableSession(id, {
          providerId: uploadProvider.id,
          sessionId: session.sessionId,
          meta: session.meta,
          bytesUploaded: 0,
          lastCommittedIndex: -1,
        });
        uploadMode = "streaming";
        console.log(
          `[create-recording] resumable session ready for ${id}: provider=${uploadProvider.id}`,
        );
      } catch (err) {
        console.warn(
          `[create-recording] resumable session init failed, falling back to buffered:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return {
      id,
      organizationId,
      status: "uploading" as const,
      uploadChunkUrl: `/api/uploads/${id}/chunk`,
      abortUrl: `/api/uploads/${id}/abort`,
      // Frontend substitutes {index}/{total}/{isFinal}
      uploadChunkUrlTemplate: `/api/uploads/${id}/chunk?index={index}&total={total}&isFinal={isFinal}`,
      uploadMode,
    };
  },
});
