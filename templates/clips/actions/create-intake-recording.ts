import {
  defineAction,
  fail,
  isActionContractError,
} from "@agent-native/core/action";
import { runWithRequestContext } from "@agent-native/core/server";
import { z } from "zod";

import {
  abandonClipIntake,
  attachClipIntakeRecording,
  claimClipIntakeRecording,
  findClipIntakeSession,
  findRecoverableClipIntakeRecording,
  releaseClipIntakeCreation,
} from "../server/lib/clip-intake.js";
import { getResumableSession } from "../server/lib/resumable-session.js";
import { BUG_REPORT_SEVERITIES } from "../shared/bug-report.js";
import { buildClipIntakeUrl } from "../shared/clip-intake.js";
import abandonRecordingStart from "./abandon-recording-start.js";
import createRecording from "./create-recording.js";
import { createRecordingSchema } from "./lib/create-recording-schema.js";
import saveBugReportContext from "./save-bug-report-context.js";

const bugReportSchema = z.object({
  projectId: z.string().max(120).nullish(),
  title: z.string().max(500).nullish(),
  description: z.string().max(5_000).nullish(),
  severity: z.enum(BUG_REPORT_SEVERITIES).default("normal"),
  sourceUrl: z.string().max(8_000).nullish(),
  pageTitle: z.string().max(500).nullish(),
  appVersion: z.string().max(120).nullish(),
  environment: z.string().max(120).nullish(),
  reporterEmail: z.string().max(320).nullish(),
  reporterName: z.string().max(200).nullish(),
  reporterId: z.string().max(200).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

const intakeRecordingSchema = createRecordingSchema
  .omit({ id: true, folderId: true, spaceIds: true, organizationId: true })
  .extend({
    intakeId: z.string().min(16).max(80),
    intakeToken: z.string().min(1).max(4096),
    bugReport: bugReportSchema.nullish(),
  });

function intakeUploadUrls(
  intakeId: string,
  intakeToken: string,
  recordingId: string,
) {
  return {
    uploadChunkUrl: buildClipIntakeUrl("/api/clip-intake", {
      recordingId,
      operation: "chunk",
      intakeId,
      token: intakeToken,
    }),
    resetChunksUrl: buildClipIntakeUrl("/api/clip-intake", {
      recordingId,
      operation: "reset",
      intakeId,
      token: intakeToken,
    }),
    abortUrl: buildClipIntakeUrl("/api/clip-intake", {
      recordingId,
      operation: "abort",
      intakeId,
      token: intakeToken,
    }),
  };
}

export default defineAction({
  description:
    "Create the one recording allowed by a signed Clips intake URL. This is a write-only anonymous capability and never grants library or agent read access.",
  agentTool: false,
  requiresAuth: false,
  http: { method: "POST" },
  maxBodyBytes: 64 * 1024,
  schema: intakeRecordingSchema,
  run: async (args) => {
    const claimed = await claimClipIntakeRecording(
      args.intakeId,
      args.intakeToken,
    );
    if (!claimed) {
      const existingSession = await findClipIntakeSession(
        args.intakeId,
        args.intakeToken,
      );
      const existing = existingSession
        ? await findRecoverableClipIntakeRecording(existingSession)
        : null;
      if (existing && existingSession) {
        const resumableSession = await getResumableSession(existing.id);
        return {
          id: existing.id,
          organizationId: existing.organizationId,
          status: "uploading" as const,
          uploadMode: resumableSession ? ("streaming" as const) : "buffered",
          ...intakeUploadUrls(args.intakeId, args.intakeToken, existing.id),
        };
      }
      if (existingSession?.status === "creating") {
        fail("A recording is already being prepared for this intake.", {
          errorCode: "intake_creation_in_progress",
          statusCode: 409,
          details: { retryable: true },
        });
      }
      fail("This intake URL has expired or has already been used.", {
        errorCode: "intake_unavailable",
        statusCode: 409,
      });
    }

    const { intakeId, intakeToken, bugReport, ...recordingArgs } = args;
    const abandonRecordingRow = async (recordingId: string) =>
      await runWithRequestContext(
        {
          userEmail: claimed.ownerEmail,
          orgId: claimed.organizationId,
        },
        () =>
          abandonRecordingStart.run(
            { id: recordingId },
            {
              caller: "http",
              userEmail: claimed.ownerEmail,
              orgId: claimed.organizationId,
            },
          ),
      );

    let created: Awaited<ReturnType<typeof createRecording.run>>;
    try {
      created = await runWithRequestContext(
        {
          userEmail: claimed.ownerEmail,
          orgId: claimed.organizationId,
        },
        () =>
          createRecording.run(
            {
              ...recordingArgs,
              organizationId: claimed.organizationId,
              visibility: "private",
            },
            {
              caller: "http",
              userEmail: claimed.ownerEmail,
              orgId: claimed.organizationId,
            },
          ),
      );
    } catch (error) {
      if (isActionContractError(error)) {
        const details = { ...error.details };
        const recordingId = details.recordingId;
        const cleanupWasConfirmed = details.cleanupConfirmed;
        delete details.recordingId;
        delete details.cleanupConfirmed;
        let cleanupConfirmed =
          typeof recordingId === "string"
            ? cleanupWasConfirmed === true
            : cleanupWasConfirmed === true ||
              (cleanupWasConfirmed !== false &&
                error.details?.retryable !== true);
        if (
          error.details?.retryable === true &&
          typeof recordingId !== "string" &&
          cleanupWasConfirmed !== true
        ) {
          // The intake row can't be safely retried if its failed recording
          // could not be identified for cleanup.
          details.retryable = false;
        }
        if (typeof recordingId === "string") {
          if (cleanupConfirmed) {
            try {
              const cleanup = await abandonRecordingRow(recordingId);
              cleanupConfirmed = cleanup.skipped !== true;
              if (!cleanupConfirmed) details.retryable = false;
            } catch (cleanupError) {
              console.warn(
                "[clip-intake] failed recording cleanup after create failure:",
                cleanupError,
              );
              details.retryable = false;
              cleanupConfirmed = false;
            }
          } else {
            details.retryable = false;
          }
        }
        if (cleanupConfirmed) {
          try {
            await releaseClipIntakeCreation(intakeId);
          } catch (releaseError) {
            console.warn(
              "[clip-intake] cleaned recording but could not reopen intake:",
              releaseError,
            );
            fail(error.message, {
              errorCode: "intake_creation_release_failed",
              statusCode: 503,
              details: {
                ...details,
                cleanupConfirmed: true,
                retryable: false,
                intakeClaimReleased: false,
              },
            });
          }
        }
        fail(error.message, {
          errorCode: error.errorCode,
          statusCode: error.statusCode,
          ...(Object.keys(details).length > 0 ? { details } : {}),
        });
      }
      // A plain error cannot tell us whether the create action left a row or
      // provider session behind. Keep the one-use claim rather than risk a duplicate.
      throw error;
    }

    const cleanupCreatedRecording = async () => {
      await abandonClipIntake(intakeId).catch((cleanupError: unknown) => {
        console.warn("[clip-intake] session cleanup failed:", cleanupError);
      });
      await abandonRecordingRow(created.id).catch((cleanupError: unknown) => {
        console.warn("[clip-intake] recording cleanup failed:", cleanupError);
      });
    };

    if (bugReport) {
      try {
        await runWithRequestContext(
          {
            userEmail: claimed.ownerEmail,
            orgId: claimed.organizationId,
          },
          () =>
            saveBugReportContext.run(
              {
                recordingId: created.id,
                ...bugReport,
                metadata: bugReport.metadata ?? undefined,
              },
              {
                caller: "http",
                userEmail: claimed.ownerEmail,
                orgId: claimed.organizationId,
              },
            ),
        );
      } catch {
        await cleanupCreatedRecording();
        fail(
          "Could not save the bug report context. This intake was not completed. Try again.",
          {
            errorCode: "intake_context_unavailable",
            statusCode: 503,
          },
        );
      }
    }

    try {
      await attachClipIntakeRecording(intakeId, created.id);
    } catch (error) {
      await cleanupCreatedRecording();
      throw error;
    }

    return {
      id: created.id,
      organizationId: created.organizationId,
      status: created.status,
      uploadMode: created.uploadMode,
      ...intakeUploadUrls(intakeId, intakeToken, created.id),
    };
  },
});
