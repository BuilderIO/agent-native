import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getActiveFileUploadProviderForRequest } from "@agent-native/core/file-upload";
import type { UploadMode } from "@shared/recording-core.js";
import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { eq } from "drizzle-orm";
import { createError } from "h3";

import { getDb, schema } from "../server/db/index.js";
import {
  normalizeRecordingFailureCode,
  trackRecordingFailure,
  type RecordingFailureCode,
} from "../server/lib/recording-failures.js";
import {
  getCurrentOwnerEmail,
  getDefaultRecordingVisibility,
  nanoid,
  requireOrganizationAccess,
  stringifySpaceIds,
} from "../server/lib/recordings.js";
import { setResumableSession } from "../server/lib/resumable-session.js";
import { shouldEnableStreamingUpload } from "../server/lib/streaming-upload-mode.js";
import { uploadLeaseExpiry } from "../server/lib/upload-lease.js";
import {
  allowsSqlRecordingChunkScratch,
  STORAGE_SETUP_REQUIRED_REASON,
} from "../server/lib/video-storage.js";
import { createRecordingSchema } from "./lib/create-recording-schema.js";
import { validateRecordingScope } from "./lib/recording-scope.js";
import { DEFAULT_RECORDING_TITLE } from "./lib/title-source.js";

export function classifyInitialUploadFailure(error: unknown): {
  failureCode: RecordingFailureCode;
  failureStage?: "multipart_start" | "chunk_upload" | "reset_chunks";
  httpStatus?: number;
} {
  const details =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const message =
    error instanceof Error
      ? error.message
      : typeof details.message === "string"
        ? details.message
        : typeof error === "string"
          ? error
          : "";
  const messageStatus = /\b(?:failed|failure|error)\s*\((\d{3})\)/i.exec(
    message,
  )?.[1];
  const status =
    (Number.isInteger(details.status) && Number(details.status)) ||
    (Number.isInteger(details.statusCode) && Number(details.statusCode)) ||
    (messageStatus ? Number(messageStatus) : undefined);
  const httpStatus =
    status && status >= 100 && status <= 599 ? status : undefined;
  const failureStage =
    details.failureStage === "multipart_start" ||
    details.failureStage === "chunk_upload" ||
    details.failureStage === "reset_chunks"
      ? details.failureStage
      : "multipart_start";
  const failureCode = normalizeRecordingFailureCode(details.failureCode);
  const storageSetupRequired =
    failureCode === "storage_setup_required" ||
    details.errorCode === "builder_oauth_reauthorization_required" ||
    httpStatus === 401 ||
    httpStatus === 403 ||
    /credentials?[^.\n]*(?:not configured|missing)|not connected|reconnect builder(?:\.io)?|scope mismatch|missing its space id/i.test(
      message,
    );

  if (storageSetupRequired) {
    return {
      failureCode: "storage_setup_required",
      failureStage,
      ...(httpStatus ? { httpStatus } : {}),
    };
  }

  return {
    failureCode:
      failureCode === "unknown" ? "multipart_start_failed" : failureCode,
    failureStage,
    ...(httpStatus ? { httpStatus } : {}),
  };
}

export default defineAction({
  description:
    "Create a new recording row in 'uploading' status and return its id plus the chunk upload URL template. The frontend POSTs chunks to /api/uploads/:id/chunk?index=N&total=T&isFinal=0|1, then finalizes on the last chunk. Recorders can pass app/window title context for an immediate fallback title.",
  schema: createRecordingSchema,
  run: async (args, actionContext) => {
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
    const defaultVisibility = await getDefaultRecordingVisibility(
      organizationId,
      actionContext?.userEmail ?? ownerEmail,
    );

    const spaceIds = await validateRecordingScope(db, {
      organizationId,
      ownerEmail,
      spaceIds: args.spaceIds ?? [],
      folderId: args.folderId,
    });

    await db.insert(schema.recordings).values({
      id,
      organizationId,
      orgId: organizationId,
      folderId: args.folderId ?? null,
      spaceIds: stringifySpaceIds(spaceIds),
      title,
      titleSource,
      sourceAppName: args.sourceAppName?.trim() || null,
      recordingPlatform: args.recordingPlatform ?? "unknown",
      sourceWindowTitle: args.sourceWindowTitle?.trim() || null,
      status: "uploading",
      uploadProgress: 0,
      uploadLeaseExpiresAt: uploadLeaseExpiry(),
      hasAudio: args.hasAudio ?? true,
      hasCamera: args.hasCamera ?? false,
      visibility: args.visibility ?? defaultVisibility,
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

    let uploadMode: UploadMode = "buffered";
    const uploadProvider = await getActiveFileUploadProviderForRequest();
    const bufferedFallbackAvailable = allowsSqlRecordingChunkScratch();
    const streamingEnabled = shouldEnableStreamingUpload({
      client: args.streamingUploadClient,
      mimeType: args.mimeType,
      bufferedFallbackAvailable,
    });
    const streamingRequired = !bufferedFallbackAvailable;

    const failUploadSetup = async (
      reason: string,
      failure: ReturnType<typeof classifyInitialUploadFailure> = {
        failureCode: "storage_setup_required",
      },
    ): Promise<never> => {
      const failedAt = new Date().toISOString();
      await db
        .update(schema.recordings)
        .set({
          status: "failed",
          failureCode: failure.failureCode,
          failureReason: reason,
          updatedAt: failedAt,
        })
        .where(eq(schema.recordings.id, id));
      trackRecordingFailure({
        recordingId: id,
        userId: ownerEmail,
        platform: args.recordingPlatform,
        ...failure,
      });
      await writeAppState(`recording-upload-${id}`, {
        recordingId: id,
        status: "failed",
        progress: 0,
        failureReason: reason,
        storageSetupRequired: reason === STORAGE_SETUP_REQUIRED_REASON,
        updatedAt: failedAt,
      });
      throw createError({
        statusCode: 503,
        statusMessage: reason,
        data: { retryable: true },
      });
    };

    if (
      streamingRequired &&
      (!streamingEnabled || !uploadProvider?.resumable)
    ) {
      await failUploadSetup(STORAGE_SETUP_REQUIRED_REASON);
    }

    if (
      streamingEnabled &&
      (args.requestStreaming === true || streamingRequired) &&
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
          meta: {
            ...session.meta,
            stableUrl: true,
            recordAsset: false,
          },
          bytesUploaded: 0,
          lastCommittedIndex: -1,
        });
        uploadMode = "streaming";
        console.log(
          `[create-recording] resumable session ready for ${id}: provider=${uploadProvider.id}`,
        );
      } catch (err) {
        if (streamingRequired) {
          const reason = err instanceof Error ? err.message.trim() : "";
          await failUploadSetup(
            reason
              ? `Video storage could not start an upload: ${reason}`
              : "Video storage could not start a resumable upload session. Refresh and try again.",
            classifyInitialUploadFailure(err),
          );
        }
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
      uploadChunkUrlTemplate: `/api/uploads/${id}/chunk?index={index}&total={total}&isFinal={isFinal}`,
      uploadMode,
    };
  },
});
