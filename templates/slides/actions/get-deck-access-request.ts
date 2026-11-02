import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { verifyScopedAgentAccessToken } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  findDeckAccessRequest,
  isGrantedAccessRequest,
  normalizeEmail,
  requestedRoleOf,
} from "../server/lib/deck-access-requests.js";
import {
  DECK_ACCESS_REQUEST_ROLES,
  SLIDES_ACCESS_APPROVAL_TOKEN_PREFIX,
} from "../shared/deck-access.js";

const INVALID_REQUEST = "This access request is invalid or expired.";

export default defineAction({
  description:
    "Read the deck access request behind an approval link, so the deck owner or admin can choose the role before allowing it. Changes nothing.",
  schema: z.object({
    deckId: z.string().min(1).describe("Deck ID the request is for."),
    approvalToken: z
      .string()
      .trim()
      .min(1)
      .describe("Signed approval capability from the deck owner email."),
  }),
  outputSchema: z.object({
    deckId: z.string(),
    deckTitle: z.string(),
    requesterEmail: z.string(),
    requesterName: z.string().nullable(),
    note: z.string().nullable(),
    requestedRole: z.enum(DECK_ACCESS_REQUEST_ROLES),
    granted: z.boolean(),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async ({ deckId, approvalToken }) => {
    const approverEmail = getRequestUserEmail();
    if (!approverEmail) {
      fail("Sign in as the deck owner to allow access.", { statusCode: 401 });
    }

    const token = verifyScopedAgentAccessToken(approvalToken, {
      resourceKind: SLIDES_ACCESS_APPROVAL_TOKEN_PREFIX,
      resourceId: deckId,
    });
    if (!token.ok || !token.viewerEmail) {
      fail(INVALID_REQUEST, { statusCode: 404 });
    }

    const orgId = getRequestOrgId();
    const access = await resolveAccess("deck", deckId, {
      userEmail: normalizeEmail(approverEmail),
      ...(orgId ? { orgId } : {}),
    });
    if (!access || !["owner", "admin"].includes(access.role)) {
      fail("Only a deck owner or admin can allow access.", {
        statusCode: 403,
      });
    }

    const db = getDb();
    const deck = (
      await db
        .select({ title: schema.decks.title })
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .limit(1)
    ).at(0);
    if (!deck) fail(INVALID_REQUEST, { statusCode: 404 });

    const requesterEmail = normalizeEmail(token.viewerEmail);
    const request = await findDeckAccessRequest(db, deckId, requesterEmail);
    const tokenHash = createHash("sha256").update(approvalToken).digest("hex");
    if (!request?.parsed || request.parsed.approvalTokenHash !== tokenHash) {
      fail(INVALID_REQUEST, { statusCode: 404 });
    }

    return {
      deckId,
      deckTitle: deck.title,
      requesterEmail,
      requesterName: request.parsed.requesterName?.trim() || null,
      note: request.parsed.note ?? null,
      requestedRole: requestedRoleOf(request.parsed),
      granted: isGrantedAccessRequest(request.parsed),
    };
  },
});
