import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import { notify } from "@agent-native/core/notifications";
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
import { and, eq } from "drizzle-orm";
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function accessRequestEventId(deckId: string, requesterEmail: string): string {
  return (
    "access-request-" +
    createHash("sha256")
      .update(deckId)
      .update("\0")
      .update(requesterEmail)
      .digest("hex")
  );
}

type AccessRequestPayload = {
  requestId?: string;
  requesterEmail?: string;
  requesterName?: string;
  requestedAt?: string;
  notifiedOwner?: boolean;
  notifiedAt?: string;
};

function parseAccessRequestPayload(
  payload: string | null | undefined,
): AccessRequestPayload | null {
  try {
    const parsed = JSON.parse(payload ?? "") as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as AccessRequestPayload)
      : null;
  } catch {
    // coercion-ok: malformed historical event payload cannot represent a matching requester.
    return null;
  }
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

async function notifyAccessRequestOwner(input: {
  deckId: string;
  deckTitle: string;
  ownerEmail: string | null;
  requesterEmail: string;
  requesterName: string;
}): Promise<boolean> {
  const ownerEmail = input.ownerEmail;
  const ownerEmailKey = ownerEmail ? normalizeEmail(ownerEmail) : null;
  if (!ownerEmail || ownerEmailKey === input.requesterEmail) return false;

  let notifiedOwner = false;
  try {
    const notification = await notify(
      {
        severity: "info",
        title: "Deck access requested",
        body: `${input.requesterName} requested access to “${input.deckTitle}”.`,
        metadata: {
          deckId: input.deckId,
          requesterEmail: input.requesterEmail,
          link: getDeckUrl(input.deckId),
        },
      },
      // Keep the stored owner identity's original casing. Authentication may
      // preserve that casing, while the requester's dedupe key is canonical.
      { owner: ownerEmail },
    );
    notifiedOwner = Boolean(notification);
  } catch (error) {
    console.warn("[deck-access] in-app notification failed:", error);
  }

  try {
    notifiedOwner = (await notifyOwner(input)) || notifiedOwner;
  } catch (error) {
    console.warn("[deck-access] access request notification failed:", error);
  }

  return notifiedOwner;
}

export default defineAction({
  description:
    "Request access to a private Agent-Native Slides deck. Records an access-request event and notifies the owner when email is configured.",
  schema: z.object({
    deckId: z.string().min(1).describe("Deck ID to request access to."),
  }),
  agentTool: false,
  run: async ({ deckId }) => {
    const rawRequesterEmail = getRequestUserEmail();
    if (!rawRequesterEmail) {
      throw httpError("Sign in to request access to this deck.", 401);
    }
    const requesterEmail = normalizeEmail(rawRequesterEmail);

    const db = getDb();
    const recordNotification = async (
      requestId: string,
      payload: AccessRequestPayload,
    ): Promise<void> => {
      try {
        await db
          .update(schema.deckEvents)
          .set({
            payload: JSON.stringify({
              ...payload,
              notifiedOwner: true,
              notifiedAt: new Date().toISOString(),
            }),
          })
          .where(eq(schema.deckEvents.id, requestId));
      } catch (error) {
        console.warn("[deck-access] notification status update failed:", error);
      }
    };
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
    const ownerEmail = deck.ownerEmail?.trim() || null;
    const previousRequests = await db
      .select({
        id: schema.deckEvents.id,
        payload: schema.deckEvents.payload,
      })
      .from(schema.deckEvents)
      .where(
        and(
          eq(schema.deckEvents.deckId, deckId),
          eq(schema.deckEvents.type, "deck.access_requested"),
        ),
      );
    const previousRequest = previousRequests.find((event) => {
      const payload = parseAccessRequestPayload(event.payload);
      return (
        typeof payload?.requesterEmail === "string" &&
        normalizeEmail(payload.requesterEmail) === requesterEmail
      );
    });

    if (previousRequest) {
      const previousPayload = parseAccessRequestPayload(
        previousRequest.payload,
      );
      const previousRequestId =
        previousPayload?.requestId || previousRequest.id;
      if (previousPayload?.notifiedOwner) {
        return {
          ok: true as const,
          alreadyHasAccess: false,
          alreadyRequested: true,
          notifiedOwner: true,
          requestId: previousRequestId,
          message: "Your access request is already with the deck owner.",
        };
      }

      const notifiedOwner = await notifyAccessRequestOwner({
        deckId,
        deckTitle: deck.title,
        ownerEmail,
        requesterEmail,
        requesterName: previousPayload?.requesterName?.trim() || requesterName,
      });
      if (notifiedOwner && previousPayload) {
        await recordNotification(previousRequestId, previousPayload);
      }

      return {
        ok: true as const,
        alreadyHasAccess: false,
        alreadyRequested: true,
        notifiedOwner,
        requestId: previousRequestId,
        message: notifiedOwner
          ? "Access request sent to the deck owner."
          : "Your access request is already with the deck owner.",
      };
    }

    const requestId = accessRequestEventId(deckId, requesterEmail);
    const requestedAt = new Date().toISOString();

    const [insertedRequest] = await db
      .insert(schema.deckEvents)
      .values({
        id: requestId,
        deckId,
        type: "deck.access_requested",
        message: `${requesterEmail} requested access to this deck.`,
        payload: JSON.stringify({
          requestId,
          requesterEmail,
          requesterName,
          requestedAt,
          notifiedOwner: false,
        }),
        createdBy: "human",
        createdAt: requestedAt,
      })
      .onConflictDoNothing()
      .returning({ id: schema.deckEvents.id });

    if (!insertedRequest) {
      return {
        ok: true as const,
        alreadyHasAccess: false,
        alreadyRequested: true,
        notifiedOwner: false,
        message: "Your access request is already with the deck owner.",
      };
    }

    let notifiedOwner = false;
    notifiedOwner = await notifyAccessRequestOwner({
      deckId,
      deckTitle: deck.title,
      ownerEmail,
      requesterEmail,
      requesterName,
    });
    if (notifiedOwner) {
      await recordNotification(requestId, {
        requestId,
        requesterEmail,
        requesterName,
        requestedAt,
        notifiedOwner: false,
      });
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
