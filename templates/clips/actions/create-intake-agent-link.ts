import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestContext,
  getRequestUserEmail,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { findOwnedClipIntakeSession } from "../server/lib/clip-intake.js";
import {
  getActiveOrganizationId,
  ownerEmailMatches,
  requireOrganizationAccess,
} from "../server/lib/recordings.js";
import { BUG_REPORT_AGENT_ACCESS_TTL_SECONDS } from "../shared/bug-report.js";
import createRecordingAgentLink from "./create-recording-agent-link.js";

export default defineAction({
  description:
    "Create a temporary read-only agent link for a completed Clips intake recording. This is an authenticated host-side exchange; the anonymous intake bearer cannot mint read access.",
  agentTool: false,
  requiresAuth: true,
  http: { method: "POST" },
  maxBodyBytes: 16 * 1024,
  schema: z.object({
    intakeId: z.string().min(16).max(80),
    recordingId: z.string().min(1).max(200),
    ttlSeconds: z
      .number()
      .int()
      .positive()
      .max(BUG_REPORT_AGENT_ACCESS_TTL_SECONDS)
      .optional(),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to exchange an intake for agent access.", {
        errorCode: "authentication_required",
        statusCode: 401,
      });
    }
    const organizationId = await getActiveOrganizationId();
    const access = await requireOrganizationAccess(organizationId);
    const session = await findOwnedClipIntakeSession(
      args.intakeId,
      access.email,
      access.organizationId,
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
