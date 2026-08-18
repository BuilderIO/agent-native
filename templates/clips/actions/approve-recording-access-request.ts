import { defineAction } from "@agent-native/core";
import { verifyScopedAgentAccessToken } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import shareResource from "@agent-native/core/sharing/actions/share-resource";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { normalizeOwnerEmail } from "../server/lib/recordings.js";
import { CLIPS_ACCESS_APPROVAL_TOKEN_PREFIX } from "../shared/recording-link.js";

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

export default defineAction({
  description:
    "Approve a private Clips access request and add the requester as a viewer in the recording's standard sharing list.",
  schema: z.object({
    recordingId: z.string().min(1).describe("Recording ID to share."),
    approvalToken: z
      .string()
      .trim()
      .min(1)
      .describe("Signed approval capability from the owner email."),
  }),
  agentTool: false,
  run: async ({ recordingId, approvalToken }) => {
    const approverEmail = getRequestUserEmail();
    if (!approverEmail) {
      throw httpError("Sign in as the clip owner to allow access.", 401);
    }

    const token = verifyScopedAgentAccessToken(approvalToken, {
      resourceKind: CLIPS_ACCESS_APPROVAL_TOKEN_PREFIX,
      resourceId: recordingId,
    });
    if (!token.ok || !token.viewerEmail) {
      throw httpError("This access request is invalid or expired.", 404);
    }

    const normalizedApproverEmail = normalizeOwnerEmail(approverEmail);
    const access = await resolveAccess("recording", recordingId, {
      userEmail: normalizedApproverEmail,
      orgId: getRequestOrgId() ?? undefined,
    });
    if (!access || !["owner", "admin"].includes(access.role)) {
      throw httpError("Only a clip owner or admin can allow access.", 403);
    }

    const db = getDb();
    const [recording] = await db
      .select({
        id: schema.recordings.id,
        title: schema.recordings.title,
        visibility: schema.recordings.visibility,
        trashedAt: schema.recordings.trashedAt,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, recordingId))
      .limit(1);
    if (
      !recording ||
      recording.trashedAt ||
      recording.visibility === "public"
    ) {
      throw httpError(`Recording ${recordingId} not found`, 404);
    }

    const requesterEmail = normalizeOwnerEmail(token.viewerEmail);
    const accessRequests = await db
      .select({ payload: schema.recordingEvents.payload })
      .from(schema.recordingEvents)
      .where(
        and(
          eq(schema.recordingEvents.recordingId, recordingId),
          eq(schema.recordingEvents.kind, "access-request"),
        ),
      );
    const request = accessRequests.find((event) => {
      try {
        const payload = JSON.parse(event.payload) as {
          requesterEmail?: string;
        };
        return (
          typeof payload.requesterEmail === "string" &&
          normalizeOwnerEmail(payload.requesterEmail) === requesterEmail
        );
      } catch {
        // coercion-ok: malformed historical event payload cannot authorize a share.
        return false;
      }
    });
    if (!request) {
      throw httpError("This access request is invalid or expired.", 404);
    }

    const [existingShare] = await db
      .select({ id: schema.recordingShares.id })
      .from(schema.recordingShares)
      .where(
        and(
          eq(schema.recordingShares.resourceId, recordingId),
          eq(schema.recordingShares.principalType, "user"),
          // Share email principals are normalized on write, but this keeps
          // approval idempotent for rows created before that convention.
          sql`lower(${schema.recordingShares.principalId}) = ${requesterEmail}`,
        ),
      )
      .limit(1);
    if (existingShare) {
      return {
        ok: true as const,
        alreadyAllowed: true,
        requesterEmail,
        recordingId,
        recordingTitle: recording.title,
        shareId: existingShare.id,
        message: "Access was already granted to this requester.",
      };
    }

    const shareResult = (await shareResource.run({
      resourceType: "recording",
      resourceId: recordingId,
      principalType: "user",
      principalId: requesterEmail,
      role: "viewer",
      notify: false,
    })) as { id: string };
    const shareId = shareResult.id;

    return {
      ok: true as const,
      alreadyAllowed: false,
      requesterEmail,
      recordingId,
      recordingTitle: recording.title,
      shareId,
      message: "Access granted. This requester can now view the clip.",
    };
  },
});
