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
import { SLIDES_ACCESS_APPROVAL_TOKEN_PREFIX } from "../shared/deck-access.js";

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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
    if (!deck || deck.visibility === "public") {
      throw httpError(`Deck ${deckId} not found`, 404);
    }

    const requesterEmail = normalizeEmail(token.viewerEmail);
    const accessRequests = await db
      .select({ payload: schema.deckEvents.payload })
      .from(schema.deckEvents)
      .where(
        and(
          eq(schema.deckEvents.deckId, deckId),
          eq(schema.deckEvents.type, "deck.access_requested"),
        ),
      );
    const request = accessRequests.find((event) => {
      try {
        const payload = JSON.parse(event.payload ?? "") as {
          requesterEmail?: string;
        };
        return (
          typeof payload.requesterEmail === "string" &&
          normalizeEmail(payload.requesterEmail) === requesterEmail
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

    const shareResult = (await shareResource.run({
      resourceType: "deck",
      resourceId: deckId,
      principalType: "user",
      principalId: requesterEmail,
      role: "viewer",
      notify: false,
    })) as { id: string };

    return {
      ok: true as const,
      alreadyAllowed: false,
      requesterEmail,
      deckId,
      deckTitle: deck.title,
      shareId: shareResult.id,
      message: "Access granted. This requester can now open the deck.",
    };
  },
});
