import { defineAction } from "@agent-native/core";
import { notify } from "@agent-native/core/notifications";
import {
  emailStrong,
  getAppProductionUrl,
  isEmailConfigured,
  renderEmail,
  sendEmail,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nanoid, normalizeOwnerEmail } from "../server/lib/recordings.js";
import { recordingSharePath } from "../shared/recording-link.js";

export const CLIPS_ACCESS_REQUEST_EMAIL_ID = "clips.access-request";

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function displayNameForEmail(email: string): string {
  const local = email.replace(/@.*/, "");
  const parts = local
    .split(/[._+-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return email;
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function absoluteRecordingUrl(recordingId: string): string {
  return `${withConfiguredAppBasePath(getAppProductionUrl()).replace(/\/+$/, "")}${recordingSharePath(recordingId)}`;
}

export function renderRecordingAccessRequestEmail(input: {
  requesterName: string;
  requesterEmail: string;
  recordingTitle: string;
  url: string;
}) {
  const subject = `${input.requesterName} requested access to "${input.recordingTitle}"`;
  return {
    subject,
    ...renderEmail({
      brandName: "Clips",
      preheader: subject,
      heading: "Access request",
      paragraphs: [
        `${emailStrong(input.requesterName)} (${emailStrong(input.requesterEmail)}) requested access to ${emailStrong(input.recordingTitle)}.`,
        "Open the Clip and use Share to grant access if this request should be approved.",
      ],
      cta: { label: "Open Clip", url: input.url },
      footer: "You received this because you own this Clip.",
    }),
  };
}

async function notifyOwner(input: {
  recordingId: string;
  recordingTitle: string;
  ownerEmail: string | null;
  requesterEmail: string;
  requesterName: string;
}): Promise<boolean> {
  if (!input.ownerEmail || input.ownerEmail === input.requesterEmail) {
    return false;
  }
  if (!(await isEmailConfigured())) return false;

  await sendEmail({
    ...renderRecordingAccessRequestEmail({
      requesterName: input.requesterName,
      requesterEmail: input.requesterEmail,
      recordingTitle: input.recordingTitle,
      url: absoluteRecordingUrl(input.recordingId),
    }),
    to: input.ownerEmail,
    replyTo: input.requesterEmail,
    templateId: CLIPS_ACCESS_REQUEST_EMAIL_ID,
  });
  return true;
}

export default defineAction({
  description:
    "Request access to a private Clips recording. Records the request and notifies the owner in-app and by email when configured.",
  schema: z.object({
    recordingId: z
      .string()
      .min(1)
      .describe("Recording ID to request access to."),
  }),
  agentTool: false,
  run: async ({ recordingId }) => {
    const requesterEmail = getRequestUserEmail();
    if (!requesterEmail) {
      throw httpError("Sign in to request access to this clip.", 401);
    }

    const normalizedRequesterEmail = normalizeOwnerEmail(requesterEmail);
    const db = getDb();
    const [recording] = await db
      .select({
        id: schema.recordings.id,
        title: schema.recordings.title,
        ownerEmail: schema.recordings.ownerEmail,
        visibility: schema.recordings.visibility,
        trashedAt: schema.recordings.trashedAt,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, recordingId))
      .limit(1);

    if (!recording || recording.trashedAt) {
      throw httpError(`Recording ${recordingId} not found`, 404);
    }

    const access = await resolveAccess("recording", recordingId, {
      userEmail: normalizedRequesterEmail,
      orgId: getRequestOrgId() ?? undefined,
    });
    if (access || recording.visibility === "public") {
      return {
        ok: true as const,
        alreadyHasAccess: true,
        alreadyRequested: false,
        notifiedOwner: false,
        message: "You already have access to this clip.",
      };
    }

    const previousRequests = await db
      .select({ payload: schema.recordingEvents.payload })
      .from(schema.recordingEvents)
      .where(
        and(
          eq(schema.recordingEvents.recordingId, recordingId),
          eq(schema.recordingEvents.kind, "access-request"),
        ),
      )
      .orderBy(desc(schema.recordingEvents.createdAt))
      .limit(100);
    const alreadyRequested = previousRequests.some((event) => {
      try {
        const payload = JSON.parse(event.payload) as {
          requesterEmail?: string;
        };
        return (
          typeof payload.requesterEmail === "string" &&
          normalizeOwnerEmail(payload.requesterEmail) ===
            normalizedRequesterEmail
        );
      } catch {
        return false;
      }
    });

    if (alreadyRequested) {
      return {
        ok: true as const,
        alreadyHasAccess: false,
        alreadyRequested: true,
        notifiedOwner: false,
        message: "Your access request is already with the clip owner.",
      };
    }

    const requesterName =
      getRequestUserName()?.trim() ||
      displayNameForEmail(normalizedRequesterEmail);
    const requestedAt = new Date().toISOString();
    await db.insert(schema.recordingEvents).values({
      id: nanoid(),
      recordingId,
      viewerId: null,
      kind: "access-request",
      timestampMs: 0,
      payload: JSON.stringify({
        requesterEmail: normalizedRequesterEmail,
        requesterName,
        requestedAt,
      }),
      createdAt: requestedAt,
    });

    const ownerEmail = recording.ownerEmail
      ? normalizeOwnerEmail(recording.ownerEmail)
      : null;
    let notifiedOwner = false;
    try {
      if (ownerEmail) {
        await notify(
          {
            severity: "info",
            title: "Clip access requested",
            body: `${requesterName} requested access to “${recording.title}”.`,
            metadata: {
              recordingId,
              requesterEmail: normalizedRequesterEmail,
              url: absoluteRecordingUrl(recordingId),
            },
          },
          { owner: ownerEmail },
        );
      }
      notifiedOwner = await notifyOwner({
        recordingId,
        recordingTitle: recording.title,
        ownerEmail,
        requesterEmail: normalizedRequesterEmail,
        requesterName,
      });
    } catch (error) {
      console.warn(
        "[recording-access] access request notification failed:",
        error,
      );
    }

    return {
      ok: true as const,
      alreadyHasAccess: false,
      alreadyRequested: false,
      notifiedOwner,
      message: notifiedOwner
        ? "Access request sent to the clip owner."
        : "Access request recorded for the clip owner.",
    };
  },
});
