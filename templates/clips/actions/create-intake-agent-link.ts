import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestContext,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { findClipIntakeSession } from "../server/lib/clip-intake.js";
import { ownerEmailMatches } from "../server/lib/recordings.js";
import { BUG_REPORT_AGENT_ACCESS_TTL_SECONDS } from "../shared/bug-report.js";
import createRecordingAgentLink from "./create-recording-agent-link.js";

export default defineAction({
  description:
    "Create a temporary read-only agent link for the recording created by one signed Clips intake URL. The intake token is never a library-read token.",
  agentTool: false,
  requiresAuth: false,
  http: { method: "POST" },
  maxBodyBytes: 16 * 1024,
  schema: z.object({
    intakeId: z.string().min(16).max(80),
    intakeToken: z.string().min(1).max(4096),
    recordingId: z.string().min(1).max(200),
    ttlSeconds: z
      .number()
      .int()
      .positive()
      .max(BUG_REPORT_AGENT_ACCESS_TTL_SECONDS)
      .optional(),
  }),
  run: async (args) => {
    const session = await findClipIntakeSession(
      args.intakeId,
      args.intakeToken,
    );
    if (
      !session ||
      session.recordingId !== args.recordingId ||
      session.status !== "completed"
    ) {
      fail("This intake recording is not available.", {
        errorCode: "intake_recording_unavailable",
        statusCode: 404,
      });
    }

    const [recording] = await getDb()
      .select({
        id: schema.recordings.id,
        status: schema.recordings.status,
        videoUrl: schema.recordings.videoUrl,
        archivedAt: schema.recordings.archivedAt,
        trashedAt: schema.recordings.trashedAt,
      })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, args.recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, session.ownerEmail),
          eq(schema.recordings.organizationId, session.organizationId),
        ),
      )
      .limit(1);
    if (
      !recording ||
      recording.status !== "ready" ||
      !recording.videoUrl ||
      recording.archivedAt ||
      recording.trashedAt
    ) {
      fail("This intake recording is not available yet.", {
        errorCode: "intake_recording_not_ready",
        statusCode: 409,
      });
    }

    const requestOrigin = getRequestContext()?.requestOrigin;
    return runWithRequestContext(
      {
        userEmail: session.ownerEmail,
        orgId: session.organizationId,
        requestOrigin,
      },
      () =>
        createRecordingAgentLink.run(
          {
            recordingId: args.recordingId,
            ttlSeconds: args.ttlSeconds,
          },
          {
            caller: "http",
            userEmail: session.ownerEmail,
            orgId: session.organizationId,
          },
        ),
    );
  },
});
