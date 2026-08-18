import { defineAction } from "@agent-native/core";
import {
  emailStrong,
  isEmailConfigured,
  renderEmail,
  sendEmail,
} from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { currentAccess, resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getDeckUrl } from "./_app-url.js";

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

function cleanSubjectPart(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

async function notifyOwner(input: {
  deckId: string;
  deckTitle: string;
  ownerEmail: string | null;
  requesterEmail: string;
  requesterName: string;
}): Promise<boolean> {
  if (!(await isEmailConfigured())) return false;
  if (
    !input.ownerEmail ||
    input.ownerEmail.toLowerCase() === input.requesterEmail.toLowerCase()
  ) {
    return false;
  }

  const subject = `${cleanSubjectPart(input.requesterName)} requested access to "${cleanSubjectPart(input.deckTitle)}"`;
  const { html, text } = renderEmail({
    preheader: subject,
    heading: "Access request",
    paragraphs: [
      `${emailStrong(input.requesterName)} (${emailStrong(input.requesterEmail)}) requested access to ${emailStrong(input.deckTitle)}.`,
      "Open the deck and use Share to grant access if this request should be approved.",
    ],
    cta: { label: "Open deck", url: getDeckUrl(input.deckId) },
    footer: "You received this because you own this Agent-Native Slide deck.",
  });
  await sendEmail({ to: input.ownerEmail, subject, html, text });
  return true;
}

export default defineAction({
  description:
    "Request access to a private Agent-Native Slides deck. Records an access-request event and notifies the owner when email is configured.",
  schema: z.object({
    deckId: z.string().min(1).describe("Deck ID to request access to."),
  }),
  agentTool: false,
  run: async ({ deckId }) => {
    const requesterEmail = getRequestUserEmail();
    if (!requesterEmail) {
      throw httpError("Sign in to request access to this deck.", 401);
    }

    const db = getDb();
    const [deck] = await db
      .select({
        id: schema.decks.id,
        title: schema.decks.title,
        ownerEmail: schema.decks.ownerEmail,
      })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId))
      .limit(1);

    if (!deck) {
      throw httpError(`Deck ${deckId} not found`, 404);
    }

    const access = await resolveAccess("deck", deckId, currentAccess());
    if (access) {
      return {
        ok: true as const,
        alreadyHasAccess: true,
        notifiedOwner: false,
        message: "You already have access. Refreshing the deck...",
      };
    }

    const requesterName =
      getRequestUserName()?.trim() || displayNameForEmail(requesterEmail);
    const requestId = `req-${nanoid()}`;
    const requestedAt = new Date().toISOString();

    await db.insert(schema.deckEvents).values({
      id: requestId,
      deckId,
      type: "deck.access_requested",
      message: `${requesterEmail} requested access to this deck.`,
      payload: JSON.stringify({
        requestId,
        requesterEmail,
        requesterName,
        requestedAt,
      }),
      createdBy: "human",
      createdAt: requestedAt,
    });

    let notifiedOwner = false;
    try {
      notifiedOwner = await notifyOwner({
        deckId,
        deckTitle: deck.title,
        ownerEmail: deck.ownerEmail ?? null,
        requesterEmail,
        requesterName,
      });
    } catch (error) {
      console.warn("[deck-access] access request notification failed:", error);
    }

    return {
      ok: true as const,
      alreadyHasAccess: false,
      notifiedOwner,
      requestId,
      message: notifiedOwner
        ? "Access request sent to the deck owner."
        : "Access request recorded for the deck owner.",
    };
  },
});
