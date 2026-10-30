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
  requestedRoleOf,
} from "../server/lib/deck-access-requests.js";
import {
  DECK_ACCESS_REQUEST_ROLES,
  deckRoleCovers,
  type DeckAccessRequestRole,
  SLIDES_ACCESS_APPROVAL_TOKEN_PREFIX,
} from "../shared/deck-access.js";
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
  grantedRole: DeckAccessRequestRole;
}): Promise<boolean | null> {
  if (!(await isEmailConfigured())) return null;
  try {
    await sendEmail({
      ...renderDeckAccessGrantedEmail({
        approverName: getRequestUserName()?.trim() || input.approverEmail,
        deckTitle: input.deckTitle,
        url: getDeckUrl(input.deckId),
        grantedRole: input.grantedRole,
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

function grantedMessage(
  email: string,
  role: DeckAccessRequestRole,
  requesterNotified: boolean | null,
): string {
  const can = `${email} can now ${role === "editor" ? "edit" : "view"} the deck.`;
  return requesterNotified === true
    ? `Access granted. ${can} We emailed them to let them know.`
    : requesterNotified === false
      ? `Access granted. ${can} The email to them could not be sent.`
      : `Access granted. ${can}`;
}

export default defineAction({
  description:
    "Approve a Slides deck access request and add the requester to the deck's standard sharing list as a viewer or editor. Only a deck owner or admin can approve. The role defaults to the one requested; an existing share is only ever raised, never lowered.",
  schema: z.object({
    deckId: z.string().min(1).describe("Deck ID to share."),
    approvalToken: z
      .string()
      .trim()
      .min(1)
      .describe("Signed approval capability from the deck owner email."),
    role: z
      .enum(DECK_ACCESS_REQUEST_ROLES)
      .optional()
      .describe(
        "Role to grant. Omit to grant the role the requester asked for.",
      ),
  }),
  agentTool: false,
  run: async ({ deckId, approvalToken, role: roleInput }) => {
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

    // Granting any role, editor included, is managing the deck's access.
    const normalizedApproverEmail = normalizeEmail(approverEmail);
    const access = await resolveAccess("deck", deckId, {
      userEmail: normalizedApproverEmail,
      orgId: getRequestOrgId() ?? undefined,
    });
    if (!access || !["owner", "admin"].includes(access.role)) {
      throw httpError("Only a deck owner or admin can allow access.", 403);
    }

    const db = getDb();
    const deck = (
      await db
        .select({
          id: schema.decks.id,
          title: schema.decks.title,
        })
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .limit(1)
    ).at(0);
    if (!deck) {
      throw httpError(`Deck ${deckId} not found`, 404);
    }

    const requesterEmail = normalizeEmail(token.viewerEmail);
    const request = await findDeckAccessRequest(db, deckId, requesterEmail);
    if (
      !request?.parsed ||
      request.parsed.approvalTokenHash !== approvalTokenHash(approvalToken)
    ) {
      throw httpError("This access request is invalid or expired.", 404);
    }
    const requestPayload = request.parsed;
    const role = roleInput ?? requestedRoleOf(requestPayload);

    const findShare = async () => {
      const shares = await db
        .select({ id: schema.deckShares.id, role: schema.deckShares.role })
        .from(schema.deckShares)
        .where(
          and(
            eq(schema.deckShares.resourceId, deckId),
            eq(schema.deckShares.principalType, "user"),
            sql`lower(${schema.deckShares.principalId}) = ${requesterEmail}`,
          ),
        )
        .limit(1);
      return shares.at(0);
    };
    const alreadyAllowed = (share: { id: string; role: string }) => ({
      ok: true as const,
      alreadyAllowed: true,
      requesterEmail,
      deckId,
      deckTitle: deck.title,
      shareId: share.id,
      role: share.role,
      message: "Access was already granted to this requester.",
    });

    const existingShare = await findShare();
    // A granted request's link never changes the share it made, so a stale
    // approval cannot raise a role the owner has since lowered.
    if (
      existingShare &&
      (deckRoleCovers(existingShare.role, role) ||
        isGrantedAccessRequest(requestPayload))
    ) {
      return alreadyAllowed(existingShare);
    }
    if (isGrantedAccessRequest(requestPayload)) {
      throw httpError("This access request is invalid or expired.", 404);
    }

    // The share and the request's granted record commit together: a share
    // written without its record would leave the request pending and a later
    // click on the link would report "already allowed" without notifying.
    const granted = await db.transaction(async (tx) => {
      let grantedShareId: string;
      if (existingShare) {
        const raisedShare = (
          await tx
            .update(schema.deckShares)
            .set({ role })
            .where(
              and(
                eq(schema.deckShares.id, existingShare.id),
                eq(schema.deckShares.role, existingShare.role),
              ),
            )
            .returning({ id: schema.deckShares.id })
        ).at(0);
        if (!raisedShare) {
          throw httpError(
            "This requester's access changed. Reload to see it.",
            409,
          );
        }
        grantedShareId = raisedShare.id;
      } else {
        const insertedShare = (
          await tx
            .insert(schema.deckShares)
            .values({
              id: deckViewerShareId(deckId, requesterEmail),
              resourceId: deckId,
              principalType: "user",
              principalId: requesterEmail,
              role,
              createdBy: normalizedApproverEmail,
              createdAt: new Date().toISOString(),
            })
            .onConflictDoNothing()
            .returning({ id: schema.deckShares.id })
        ).at(0);
        if (!insertedShare) return null;
        grantedShareId = insertedShare.id;
      }
      const markedRequest = (
        await tx
          .update(schema.deckEvents)
          .set({
            payload: JSON.stringify({
              ...requestPayload,
              accessGrantedAt: new Date().toISOString(),
              accessShareId: grantedShareId,
              grantedRole: role,
            }),
          })
          .where(
            and(
              eq(schema.deckEvents.id, request.id),
              eq(schema.deckEvents.payload, request.payload ?? ""),
            ),
          )
          .returning({ id: schema.deckEvents.id })
      ).at(0);
      if (!markedRequest) {
        throw httpError(
          "This access request changed while it was being approved. Reload to see it.",
          409,
        );
      }
      return { shareId: grantedShareId };
    });
    if (!granted) {
      const shareAfterConflict = await findShare();
      if (!shareAfterConflict) {
        // guard:allow-bare-error — invariant: an insert conflict on a deterministic share id means that share exists.
        throw new Error("Deck access share conflict could not be resolved.");
      }
      return alreadyAllowed(shareAfterConflict);
    }
    const grantedShareId = granted.shareId;
    invalidateCollabAccessCache("deck", deckId);

    // Only the approval that granted the role emails, so repeat clicks on
    // the approval link never notify the requester twice.
    const requesterNotified = await notifyRequesterOfAccess({
      deckId,
      deckTitle: deck.title,
      requesterEmail,
      approverEmail: normalizedApproverEmail,
      grantedRole: role,
    });

    return {
      ok: true as const,
      alreadyAllowed: false,
      requesterEmail,
      deckId,
      deckTitle: deck.title,
      shareId: grantedShareId,
      role,
      requesterNotified,
      message: grantedMessage(requesterEmail, role, requesterNotified),
    };
  },
});
