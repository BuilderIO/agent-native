import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import {
  isEmailConfigured,
  sendEmail,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import { invalidateCollabAccessCache } from "@agent-native/core/server/poll";
import {
  getRequestOrgId,
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  renderDeckAccessGrantedEmail,
  SLIDES_DECK_ACCESS_GRANTED_EMAIL_ID,
} from "../server/lib/access-request-email.js";
import {
  findDeckAccessRequest,
  isGrantedAccessRequest,
  normalizeEmail,
} from "../server/lib/deck-access-requests.js";
import { SLIDES_ACCESS_APPROVAL_TOKEN_PREFIX } from "../shared/deck-access.js";
import { getDeckUrl } from "./_app-url.js";

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function approvalTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Whether the requester was emailed: `null` when no email provider is
 * configured, so the caller can tell "not attempted" from "failed".
 */
async function notifyRequesterOfAccess(input: {
  deckId: string;
  deckTitle: string;
  requesterEmail: string;
  approverEmail: string;
}): Promise<boolean | null> {
  if (!(await isEmailConfigured())) return null;
  try {
    await sendEmail({
      ...renderDeckAccessGrantedEmail({
        approverName: getRequestUserName()?.trim() || input.approverEmail,
        deckTitle: input.deckTitle,
        url: getDeckUrl(input.deckId),
      }),
      to: input.requesterEmail,
      replyTo: input.approverEmail,
      templateId: SLIDES_DECK_ACCESS_GRANTED_EMAIL_ID,
    });
    return true;
  } catch (error) {
    console.warn("[deck-access] access granted email failed:", error);
    return false;
  }
}

function deckViewerShareId(deckId: string, requesterEmail: string): string {
  return (
    "deck-share-" +
    createHash("sha256")
      .update(deckId)
      .update("\0")
      .update(requesterEmail)
      .digest("hex")
  );
}

export default defineAction({
  description:
    "Approve a private Slides deck access request and add the requester as a viewer in the deck's standard sharing list.",
  schema: z.object({
    deckId: z.string().min(1).describe("Deck ID to share."),
    approvalToken: z
      .string()
      .trim()
      .min(1)
      .describe("Signed approval capability from the deck owner email."),
  }),
  agentTool: false,
  run: async ({ deckId, approvalToken }) => {
    const approverEmail = getRequestUserEmail();
    if (!approverEmail) {
      throw httpError("Sign in as the deck owner to allow access.", 401);
    }

    const token = verifyScopedAgentAccessToken(approvalToken, {
      resourceKind: SLIDES_ACCESS_APPROVAL_TOKEN_PREFIX,
      resourceId: deckId,
    });
    if (!token.ok || !token.viewerEmail) {
      throw httpError("This access request is invalid or expired.", 404);
    }

    const normalizedApproverEmail = normalizeEmail(approverEmail);
    const access = await resolveAccess("deck", deckId, {
      userEmail: normalizedApproverEmail,
      orgId: getRequestOrgId() ?? undefined,
    });
    if (!access || !["owner", "admin"].includes(access.role)) {
      throw httpError("Only a deck owner or admin can allow access.", 403);
    }

    const db = getDb();
    const [deck] = await db
      .select({
        id: schema.decks.id,
        title: schema.decks.title,
        visibility: schema.decks.visibility,
      })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId))
      .limit(1);
    if (!deck || deck.visibility !== "private") {
      throw httpError(`Deck ${deckId} not found`, 404);
    }

    const requesterEmail = normalizeEmail(token.viewerEmail);
    const request = await findDeckAccessRequest(db, deckId, requesterEmail);
    if (
      !request ||
      request.parsed.approvalTokenHash !== approvalTokenHash(approvalToken)
    ) {
      throw httpError("This access request is invalid or expired.", 404);
    }
    const requestPayload = request.parsed;

    const [existingShare] = await db
      .select({ id: schema.deckShares.id })
      .from(schema.deckShares)
      .where(
        and(
          eq(schema.deckShares.resourceId, deckId),
          eq(schema.deckShares.principalType, "user"),
          // Share email principals are normalized on write, but this keeps
          // approval idempotent for rows created before that convention.
          sql`lower(${schema.deckShares.principalId}) = ${requesterEmail}`,
        ),
      )
      .limit(1);
    if (existingShare) {
      return {
        ok: true as const,
        alreadyAllowed: true,
        requesterEmail,
        deckId,
        deckTitle: deck.title,
        shareId: existingShare.id,
        message: "Access was already granted to this requester.",
      };
    }
    if (isGrantedAccessRequest(requestPayload)) {
      throw httpError("This access request is invalid or expired.", 404);
    }

    // Use a deterministic primary key as the idempotency key. The generic
    // shares table predates a composite unique constraint, but concurrent
    // approvals for this flow still collide atomically on this key.
    const shareId = deckViewerShareId(deckId, requesterEmail);
    const [insertedShare] = await db
      .insert(schema.deckShares)
      .values({
        id: shareId,
        resourceId: deckId,
        principalType: "user",
        principalId: requesterEmail,
        role: "viewer",
        createdBy: normalizedApproverEmail,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .returning({ id: schema.deckShares.id });
    if (!insertedShare) {
      const [existingShareAfterConflict] = await db
        .select({ id: schema.deckShares.id })
        .from(schema.deckShares)
        .where(
          and(
            eq(schema.deckShares.resourceId, deckId),
            eq(schema.deckShares.principalType, "user"),
            sql`lower(${schema.deckShares.principalId}) = ${requesterEmail}`,
          ),
        )
        .limit(1);
      if (!existingShareAfterConflict) {
        throw new Error("Deck access share conflict could not be resolved.");
      }
      return {
        ok: true as const,
        alreadyAllowed: true,
        requesterEmail,
        deckId,
        deckTitle: deck.title,
        shareId: existingShareAfterConflict.id,
        message: "Access was already granted to this requester.",
      };
    }
    const [markedRequest] = await db
      .update(schema.deckEvents)
      .set({
        payload: JSON.stringify({
          ...requestPayload,
          accessGrantedAt: new Date().toISOString(),
          accessShareId: insertedShare.id,
        }),
      })
      .where(
        and(
          eq(schema.deckEvents.id, request.id),
          eq(schema.deckEvents.payload, request.payload ?? ""),
        ),
      )
      .returning({ id: schema.deckEvents.id });
    if (!markedRequest) {
      throw new Error("Deck access request approval could not be recorded.");
    }
    invalidateCollabAccessCache("deck", deckId);

    // Only the approval that created the share emails, so repeat clicks on
    // the approval link never notify the requester twice.
    const requesterNotified = await notifyRequesterOfAccess({
      deckId,
      deckTitle: deck.title,
      requesterEmail,
      approverEmail: normalizedApproverEmail,
    });

    return {
      ok: true as const,
      alreadyAllowed: false,
      requesterEmail,
      deckId,
      deckTitle: deck.title,
      shareId: insertedShare.id,
      requesterNotified,
      message:
        requesterNotified === true
          ? "Access granted. We emailed the requester to let them know."
          : requesterNotified === false
            ? "Access granted, but the email to the requester could not be sent."
            : "Access granted. This requester can now open the deck.",
    };
  },
});
