import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { captureError } from "@agent-native/core/server";
import { getRequestContext } from "@agent-native/core/server/request-context";
import type { UploadMode } from "@shared/recording-core.js";
import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { eq } from "drizzle-orm";
import { createError } from "h3";

import { getDb, schema } from "../server/db/index.js";
import { trackRecordingCreated } from "../server/lib/recording-created.js";
import {
  hostedStorageAuthFailure,
  normalizeRecordingFailureCode,
  trackRecordingFailure,
  type RecordingFailureCode,
} from "../server/lib/recording-failures.js";
import { snapshotUploadRecoveryPolicy } from "../server/lib/recording-policy.js";
import {
  getCurrentOwnerEmail,
  getDefaultRecordingVisibility,
  nanoid,
  requireOrganizationAccess,
  stringifySpaceIds,
} from "../server/lib/recordings.js";
import {
  deleteResumableSession,
  setResumableSession,
  type StoredResumableSession,
} from "../server/lib/resumable-session.js";
import { abortResumableUploadSession } from "../server/lib/resumable-upload-cleanup.js";
import { S3MultipartStartError } from "../server/lib/s3-upload-provider.js";
import { shouldEnableStreamingUpload } from "../server/lib/streaming-upload-mode.js";
import { uploadLeaseExpiry } from "../server/lib/upload-lease.js";
import {
  allowsSqlRecordingChunkScratch,
  HOSTED_STORAGE_UNAVAILABLE_REASON,
  releaseHostedClipRecording,
  resolveClipsVideoStorage,
  STORAGE_SETUP_REQUIRED_REASON,
} from "../server/lib/video-storage.js";
import { DEFAULT_RECORDING_TITLE } from "../shared/title-source.js";
import { createRecordingSchema } from "./lib/create-recording-schema.js";
import { validateRecordingScope } from "./lib/recording-scope.js";

/** The `sourceAppName` the native mobile app (packages/mobile-app) sends. */
const MOBILE_APP_SOURCE_NAME = "Agent-Native Mobile";

export function classifyInitialUploadFailure(
  error: unknown,
  options: { storageMode?: "own" | "hosted" } = {},
): {
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
  const isSignedUrlFailure = /builder\.io signed-url request failed/i.test(
    message,
  );
  const messageStatus = /\b(?:failed|failure|error)\s*\((\d{3})\)/i.exec(
    message,
  )?.[1];
  const status =
    (Number.isInteger(details.status) && Number(details.status)) ||
    (Number.isInteger(details.statusCode) && Number(details.statusCode)) ||
    (messageStatus ? Number(messageStatus) : undefined);
  const httpStatus =
    status && status >= 100 && status <= 599 ? status : undefined;
  const hostedAuthFailure =
    options.storageMode === "hosted" ? hostedStorageAuthFailure(error) : null;
  const failureStage =
    details.failureStage === "multipart_start" ||
    details.failureStage === "chunk_upload" ||
    details.failureStage === "reset_chunks"
      ? details.failureStage
      : "multipart_start";
  const failureCode = normalizeRecordingFailureCode(details.failureCode);
  if (hostedAuthFailure) {
    return {
      failureCode: "hosted_storage_unavailable",
      failureStage,
      ...(hostedAuthFailure.status
        ? { httpStatus: hostedAuthFailure.status }
        : {}),
    };
  }
  // A nested signed-URL response does not mean the account needs reauthorization.
  const storageSetupRequired =
    failureCode === "storage_setup_required" ||
    details.errorCode === "builder_oauth_reauthorization_required" ||
    details.errorCode === "builder_credentials_rejected" ||
    (!isSignedUrlFailure && (httpStatus === 401 || httpStatus === 403)) ||
    /credentials?[^.\n]*(?:not configured|missing)|not connected|(?:reconnect|use) builder(?:\.io)?|scope mismatch|missing its space id/i.test(
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
    if (
      args.expectedOwnerEmail &&
      args.expectedOwnerEmail.toLowerCase() !== ownerEmail.toLowerCase()
    ) {
      fail("This recording belongs to another account.", {
        errorCode: "recording_owner_mismatch",
        statusCode: 409,
      });
    }
    const id = args.id || nanoid();
    const now = new Date().toISOString();
    const title = args.title?.trim() || DEFAULT_RECORDING_TITLE;
    const titleSource =
      args.titleSource ??
      (title === DEFAULT_RECORDING_TITLE ? "default" : "manual");

    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
    );
    const visibility = await getDefaultRecordingVisibility(
      organizationId,
      actionContext?.userEmail ?? ownerEmail,
      args.visibility,
    );

    const spaceIds = await validateRecordingScope(db, {
      organizationId,
      ownerEmail,
      spaceIds: args.spaceIds ?? [],
      folderId: args.folderId,
    });

    // The native mobile app names itself but sends no platform; read it from
    // that name so its rows and events are not left "unknown".
    const recordingPlatform =
      args.recordingPlatform ??
      (args.sourceAppName?.trim() === MOBILE_APP_SOURCE_NAME
        ? "mobile"
        : undefined);

    await snapshotUploadRecoveryPolicy(ownerEmail, organizationId, id);

    const storage = await resolveClipsVideoStorage({
      intent: "new",
      recordingId: id,
      email: ownerEmail,
      requestHeaders: actionContext?.requestHeaders,
    });
    if (storage.mode === "none") {
      fail(STORAGE_SETUP_REQUIRED_REASON, {
        errorCode: storage.denyReason ?? "storage_setup_required",
        statusCode: storage.denyReason === "exhausted" ? 402 : 403,
        details: storage.denyReason ? { denyReason: storage.denyReason } : {},
      });
    }
    const storageMode = storage.mode;
    const hostedUserId = getRequestContext()?.authUserId;
    const releaseHostedReservation = async () => {
      if (storageMode !== "hosted" || storage.reservationCreated === false)
        return;
      if (!hostedUserId) {
        // guard:allow-bare-error — invariant: hosted mode is only returned after reserving against the authenticated user's stable id.
        throw new Error(
          "Hosted Clips reservation is missing its authenticated user id.",
        );
      }
      await releaseHostedClipRecording({
        recordingId: id,
        userId: hostedUserId,
      });
    };
    const maxUploadBytes =
      storage.mode === "hosted" ? storage.maxClipBytes : MAX_UPLOAD_BYTES;

    try {
      await db.insert(schema.recordings).values({
        id,
        organizationId,
        orgId: organizationId,
        folderId: args.folderId ?? null,
        spaceIds: stringifySpaceIds(spaceIds),
        title,
        titleSource,
        sourceAppName: args.sourceAppName?.trim() || null,
        recordingPlatform: recordingPlatform ?? "unknown",
        sourceWindowTitle: args.sourceWindowTitle?.trim() || null,
        status: "uploading",
        uploadProgress: 0,
        uploadLeaseExpiresAt: uploadLeaseExpiry(),
        hasAudio: args.hasAudio ?? true,
        hasCamera: args.hasCamera ?? false,
        visibility,
        width: args.width ?? 0,
        height: args.height ?? 0,
        ownerEmail,
        storageMode,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      await releaseHostedReservation();
      throw error;
    }

    trackRecordingCreated({
      recordingId: id,
      userId: ownerEmail,
      platform: recordingPlatform,
      // The desktop app, extension and native mobile app only create rows
      // from their recorders, and builds already installed send no source.
      source:
        args.recordingSource ??
        (args.recordingPlatform === "desktop" ||
        args.recordingPlatform === "extension" ||
        args.sourceAppName?.trim() === MOBILE_APP_SOURCE_NAME
          ? "recorder"
          : undefined),
      attemptId: args.recordingAttemptId,
      hasAudio: args.hasAudio ?? true,
      hasCamera: args.hasCamera ?? false,
    });

    try {
      await writeAppState("refresh-signal", { ts: Date.now() });
      await writeAppState(`recording-upload-${id}`, {
        recordingId: id,
        status: "uploading",
        progress: 0,
        startedAt: now,
      });
    } catch (error) {
      await releaseHostedReservation();
      await db
        .update(schema.recordings)
        .set({
          status: "failed",
          failureCode: "upload_state_initialization_failed",
          failureReason: "Recording upload state could not be initialized.",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.recordings.id, id));
      throw error;
    }

    console.log(`Created recording "${title}" (${id})`);

    let uploadMode: UploadMode = "buffered";
    const uploadProvider = storage.provider;
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
      reservationCleanupConfirmed = true,
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
      if (reservationCleanupConfirmed) {
        await releaseHostedReservation();
      } else if (storageMode === "hosted") {
        console.error(
          "[create-recording] hosted allowance remains reserved because upload cleanup was not confirmed",
          { recordingId: id },
        );
      }
      trackRecordingFailure({
        recordingId: id,
        userId: ownerEmail,
        platform: recordingPlatform,
        ...failure,
      });
      await writeAppState(`recording-upload-${id}`, {
        recordingId: id,
        status: "failed",
        progress: 0,
        failureReason: reason,
        storageSetupRequired: failure.failureCode === "storage_setup_required",
        updatedAt: failedAt,
      });
      throw createError({
        statusCode: 503,
        statusMessage: reason,
        data: {
          errorCode: failure.failureCode,
          retryable: failure.failureCode !== "storage_setup_required",
        },
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
      let startedSession: StoredResumableSession | null = null;
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
          maxUploadBytes,
        );
        startedSession = {
          providerId: uploadProvider.id,
          sessionId: session.sessionId,
          meta: {
            ...session.meta,
            stableUrl: true,
            recordAsset: false,
          },
          bytesUploaded: 0,
          lastCommittedIndex: -1,
        };
        await setResumableSession(id, startedSession);
        uploadMode = "streaming";
        console.log(
          `[create-recording] resumable session ready for ${id}: provider=${uploadProvider.id}`,
        );
      } catch (err) {
        if (streamingRequired) {
          const reason = err instanceof Error ? err.message.trim() : "";
          const cleanupConfirmed = startedSession
            ? await abortResumableUploadSession(startedSession, {
                provider: uploadProvider,
                label: "create-recording",
              })
            : err instanceof S3MultipartStartError ||
              /credentials are not configured/i.test(reason);
          if (startedSession && cleanupConfirmed) {
            await deleteResumableSession(id).catch((cleanupError: unknown) => {
              console.warn(
                "[create-recording] could not clear aborted resumable state:",
                cleanupError instanceof Error
                  ? cleanupError.message
                  : String(cleanupError),
              );
            });
          }
          if (!cleanupConfirmed) {
            console.error(
              "[create-recording] could not confirm resumable upload cleanup",
              { recordingId: id },
            );
          }
          const failure = classifyInitialUploadFailure(err, { storageMode });
          if (failure.failureCode === "hosted_storage_unavailable") {
            try {
              captureError(err, {
                route: "/_agent-native/actions/create-recording",
                errorMessagePolicy: "omit",
                tags: {
                  area: "clips-storage",
                  source: "clips-hosted-storage",
                  storageMode: "hosted",
                  errorCode: "hosted_storage_unavailable",
                  reportExpected: "true",
                  ...(failure.httpStatus
                    ? { providerStatus: String(failure.httpStatus) }
                    : {}),
                },
              });
            } catch {
              // Error reporting must not mask the upload failure.
            }
          }
          await failUploadSetup(
            failure.failureCode === "hosted_storage_unavailable"
              ? HOSTED_STORAGE_UNAVAILABLE_REASON
              : reason
                ? `Video storage could not start an upload: ${reason}`
                : "Video storage could not start a resumable upload session. Refresh and try again.",
            failure,
            cleanupConfirmed,
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
      // Hosted-only per-take cap; the mode was decided above, so recorders
      // need not trust a stale storage probe. Own storage is uncapped.
      maxClipDurationMs:
        storageMode === "hosted" ? storage.maxClipDurationMs : null,
    };
  },
});
