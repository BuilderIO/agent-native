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

import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  requireOrganizationAccess,
  stringifySpaceIds,
} from "../server/lib/recordings.js";
import { createRecordingSchema } from "./lib/create-recording-schema.js";
import { DEFAULT_RECORDING_TITLE } from "./lib/title-source.js";

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

    return {
      id,
      organizationId,
      status: "uploading" as const,
      uploadChunkUrl: `/api/uploads/${id}/chunk`,
      abortUrl: `/api/uploads/${id}/abort`,
      // Frontend substitutes {index}/{total}/{isFinal}
      uploadChunkUrlTemplate: `/api/uploads/${id}/chunk?index={index}&total={total}&isFinal={isFinal}`,
    };
  },
});
