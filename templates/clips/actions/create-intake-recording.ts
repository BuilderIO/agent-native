import { defineAction, fail } from "@agent-native/core/action";
import { runWithRequestContext } from "@agent-native/core/server";
import { z } from "zod";

import {
  abandonClipIntake,
  attachClipIntakeRecording,
  claimClipIntakeRecording,
  releaseClipIntakeCreation,
} from "../server/lib/clip-intake.js";
import { BUG_REPORT_SEVERITIES } from "../shared/bug-report.js";
import { buildClipIntakeUrl } from "../shared/clip-intake.js";
import createRecording from "./create-recording.js";
import { createRecordingSchema } from "./lib/create-recording-schema.js";
import saveBugReportContext from "./save-bug-report-context.js";
import trashRecording from "./trash-recording.js";

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
      fail("This intake URL has expired or has already been used.", {
        errorCode: "intake_unavailable",
        statusCode: 409,
      });
    }

    const { intakeId, intakeToken, bugReport, ...recordingArgs } = args;
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
      await releaseClipIntakeCreation(intakeId);
      throw error;
    }

    try {
      await attachClipIntakeRecording(intakeId, created.id);
    } catch (error) {
      await abandonClipIntake(intakeId).catch(() => {});
      await Promise.resolve(
        runWithRequestContext(
          {
            userEmail: claimed.ownerEmail,
            orgId: claimed.organizationId,
          },
          () =>
            trashRecording.run(
              { id: created.id, skipIfReady: true },
              {
                caller: "http",
                userEmail: claimed.ownerEmail,
                orgId: claimed.organizationId,
              },
            ),
        ),
      ).catch((cleanupError: unknown) => {
        console.warn("[clip-intake] attach cleanup failed:", cleanupError);
      });
      throw error;
    }

    if (bugReport) {
      await runWithRequestContext(
        {
          userEmail: claimed.ownerEmail,
          orgId: claimed.organizationId,
        },
        async () => {
          try {
            await saveBugReportContext.run(
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
            );
          } catch (error) {
            await abandonClipIntake(intakeId, created.id).catch(() => {});
            await Promise.resolve(
              trashRecording.run(
                { id: created.id, skipIfReady: true },
                {
                  caller: "http",
                  userEmail: claimed.ownerEmail,
                  orgId: claimed.organizationId,
                },
              ),
            ).catch((cleanupError: unknown) => {
              console.warn(
                "[clip-intake] bug report cleanup failed:",
                cleanupError,
              );
            });
            fail(
              "Could not save the bug report context. This intake was not completed. Try again.",
              {
                errorCode: "intake_context_unavailable",
                statusCode: 503,
              },
            );
          }
        },
      );
    }

    return {
      ...created,
      uploadChunkUrl: buildClipIntakeUrl("/api/clip-intake", {
        recordingId: created.id,
        operation: "chunk",
        intakeId,
        token: intakeToken,
      }),
      resetChunksUrl: buildClipIntakeUrl("/api/clip-intake", {
        recordingId: created.id,
        operation: "reset",
        intakeId,
        token: intakeToken,
      }),
      abortUrl: buildClipIntakeUrl("/api/clip-intake", {
        recordingId: created.id,
        operation: "abort",
        intakeId,
        token: intakeToken,
      }),
    };
  },
});
