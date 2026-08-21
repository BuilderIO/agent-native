import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import { notify } from "@agent-native/core/notifications";
import {
  emailStrong,
  getAppProductionUrl,
  isEmailConfigured,
  renderEmail,
  sendEmail,
  signScopedAgentAccessToken,
  verifyScopedAgentAccessToken,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { normalizeOwnerEmail } from "../server/lib/recordings.js";
import {
  CLIPS_ACCESS_APPROVAL_TOKEN_PREFIX,
  CLIPS_ACCESS_APPROVAL_TOKEN_TTL_SECONDS,
  CLIPS_ACCESS_REQUEST_TOKEN_PREFIX,
  recordingAccessApprovalPath,
  recordingSharePath,
} from "../shared/recording-link.js";

export const CLIPS_ACCESS_REQUEST_EMAIL_ID = "clips.access-request";

const ANONYMOUS_ACCESS_REQUEST_WINDOW_MS = 10 * 60 * 1000;
const ANONYMOUS_ACCESS_REQUEST_MAX = 5;
const ANONYMOUS_ACCESS_REQUEST_MAX_BUCKETS = 5000;
const anonymousAccessRequestBuckets = new Map<
  string,
  { count: number; resetAt: number }
>();

export function __resetAnonymousAccessRequestRateLimitForTests(): void {
  anonymousAccessRequestBuckets.clear();
}

function allowAnonymousAccessRequest(recordingId: string): boolean {
  const now = Date.now();
  for (const [key, bucket] of anonymousAccessRequestBuckets) {
    if (bucket.resetAt <= now) anonymousAccessRequestBuckets.delete(key);
  }

  let bucket = anonymousAccessRequestBuckets.get(recordingId);
  if (!bucket) {
    if (
      anonymousAccessRequestBuckets.size >= ANONYMOUS_ACCESS_REQUEST_MAX_BUCKETS
    ) {
      const oldestKey = anonymousAccessRequestBuckets.keys().next().value;
      if (oldestKey) anonymousAccessRequestBuckets.delete(oldestKey);
    }
    bucket = {
      count: 0,
      resetAt: now + ANONYMOUS_ACCESS_REQUEST_WINDOW_MS,
    };
    anonymousAccessRequestBuckets.set(recordingId, bucket);
  }

  if (bucket.count >= ANONYMOUS_ACCESS_REQUEST_MAX) return false;
  bucket.count += 1;
  return true;
}

function accessRequestEventId(
  recordingId: string,
  requesterEmail: string,
): string {
  return (
    "access-request-" +
    createHash("sha256")
      .update(recordingId)
      .update("\0")
      .update(requesterEmail)
      .digest("hex")
  );
}

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

function absoluteAccessApprovalUrl(
  recordingId: string,
  approvalToken: string,
): string {
  return `${withConfiguredAppBasePath(getAppProductionUrl()).replace(/\/+$/, "")}${recordingAccessApprovalPath(recordingId, approvalToken)}`;
}

export function renderRecordingAccessRequestEmail(input: {
  requesterName: string;
  requesterEmail: string;
  recordingTitle: string;
  url: string;
  allowAccessUrl: string;
}) {
  const subject = `Access request for "${input.recordingTitle}"`;
  return {
    subject,
    ...renderEmail({
      brandName: "Clips",
      preheader: subject,
      heading: "Access requested",
      paragraphs: [
        `${emailStrong(input.requesterName)} (${emailStrong(input.requesterEmail)}) requested viewer access to ${emailStrong(input.recordingTitle)}.`,
        "Select Allow access to add them to this Clip's standard sharing list. You can also open the Clip to review sharing first.",
      ],
      cta: { label: "Allow access", url: input.allowAccessUrl },
      secondaryCta: { label: "Open Clip", url: input.url },
      closingParagraphs: [
        "This approval link expires in 7 days and requires you to be signed in as a Clip owner or admin.",
      ],
      footer:
        "You received this because you own this Clip. If you do not recognize the requester, you can ignore this email.",
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

  const approvalToken = signScopedAgentAccessToken({
    resourceKind: CLIPS_ACCESS_APPROVAL_TOKEN_PREFIX,
    resourceId: input.recordingId,
    viewerEmail: input.requesterEmail,
    ttlSeconds: CLIPS_ACCESS_APPROVAL_TOKEN_TTL_SECONDS,
  });

  await sendEmail({
    ...renderRecordingAccessRequestEmail({
      requesterName: input.requesterName,
      requesterEmail: input.requesterEmail,
      recordingTitle: input.recordingTitle,
      url: absoluteRecordingUrl(input.recordingId),
      allowAccessUrl: absoluteAccessApprovalUrl(
        input.recordingId,
        approvalToken,
      ),
    }),
    to: input.ownerEmail,
    replyTo: input.requesterEmail,
    templateId: CLIPS_ACCESS_REQUEST_EMAIL_ID,
  });
  return true;
}

export default defineAction({
  description:
    "Request access to a private Clips recording. Signed-in viewers use their account email; anonymous viewers may provide an email address. Records the request and notifies the owner in-app and by email when configured.",
  schema: z.object({
    recordingId: z
      .string()
      .min(1)
      .describe("Recording ID to request access to."),
    accessRequestToken: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Short-lived capability from the private share page."),
    requesterEmail: z
      .string()
      .trim()
      .email()
      .optional()
      .describe(
        "Email address to request access for when the viewer is not signed in.",
      ),
  }),
  agentTool: false,
  run: async ({ recordingId, accessRequestToken, requesterEmail }) => {
    const sessionEmail = getRequestUserEmail();
    const token = accessRequestToken
      ? verifyScopedAgentAccessToken(accessRequestToken, {
          resourceKind: CLIPS_ACCESS_REQUEST_TOKEN_PREFIX,
          resourceId: recordingId,
        })
      : { ok: false as const, reason: "missing" };
    if (!token.ok) {
      throw httpError(`Recording ${recordingId} not found`, 404);
    }

    const normalizedRequesterEmail = sessionEmail
      ? normalizeOwnerEmail(sessionEmail)
      : requesterEmail
        ? normalizeOwnerEmail(requesterEmail)
        : null;
    if (!normalizedRequesterEmail) {
      throw httpError(
        "Sign in or provide an email address to request access to this clip.",
        401,
      );
    }

    const tokenViewerEmail = token.viewerEmail
      ? normalizeOwnerEmail(token.viewerEmail)
      : null;
    if (tokenViewerEmail && tokenViewerEmail !== normalizedRequesterEmail) {
      throw httpError(
        "This request is tied to a different email. Sign in with the email that opened the link.",
        403,
      );
    }

    const access = await resolveAccess("recording", recordingId, {
      userEmail: normalizedRequesterEmail,
      orgId: sessionEmail ? (getRequestOrgId() ?? undefined) : undefined,
    });

    if (access) {
      const recording = access.resource as {
        trashedAt?: string | null;
      };
      if (recording.trashedAt) {
        throw httpError(`Recording ${recordingId} not found`, 404);
      }
      return {
        ok: true as const,
        alreadyHasAccess: true,
        alreadyRequested: false,
        notifiedOwner: false,
        message: "You already have access to this clip.",
      };
    }

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

    if (
      !recording ||
      recording.trashedAt ||
      recording.visibility === "public"
    ) {
      throw httpError(`Recording ${recordingId} not found`, 404);
    }

    const previousRequests = await db
      .select({ payload: schema.recordingEvents.payload })
      .from(schema.recordingEvents)
      .where(
        and(
          eq(schema.recordingEvents.recordingId, recordingId),
          eq(schema.recordingEvents.kind, "access-request"),
        ),
      );
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
        // coercion-ok: malformed historical event payload cannot represent a matching requester.
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

    if (!sessionEmail && !allowAnonymousAccessRequest(recordingId)) {
      throw httpError(
        "Too many anonymous access requests for this clip. Try again later.",
        429,
      );
    }

    const requesterName =
      getRequestUserName()?.trim() ||
      displayNameForEmail(normalizedRequesterEmail);
    const requestedAt = new Date().toISOString();
    const [insertedRequest] = await db
      .insert(schema.recordingEvents)
      .values({
        id: accessRequestEventId(recordingId, normalizedRequesterEmail),
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
      })
      .onConflictDoNothing()
      .returning({ id: schema.recordingEvents.id });

    // Historical requests use random IDs, so the read above still handles
    // them. New requests use a deterministic primary key so concurrent
    // callers have one database-backed winner before notifications are sent.
    if (!insertedRequest) {
      return {
        ok: true as const,
        alreadyHasAccess: false,
        alreadyRequested: true,
        notifiedOwner: false,
        message: "Your access request is already with the clip owner.",
      };
    }

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
