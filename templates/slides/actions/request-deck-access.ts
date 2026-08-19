import { createHash, randomUUID } from "node:crypto";

import { defineAction } from "@agent-native/core";
import { notifyWithDelivery } from "@agent-native/core/notifications";
import {
  isEmailConfigured,
  sendEmail,
  signScopedAgentAccessToken,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { currentAccess, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  renderDeckAccessRequestEmail,
  SLIDES_DECK_ACCESS_REQUEST_EMAIL_ID,
} from "../server/lib/access-request-email.js";
import {
  SLIDES_ACCESS_REQUEST_FALLBACK_TOKEN_PREFIX,
  SLIDES_ACCESS_REQUEST_TOKEN_PREFIX,
  deckAccessApprovalPath,
  SLIDES_ACCESS_APPROVAL_TOKEN_PREFIX,
  SLIDES_ACCESS_APPROVAL_TOKEN_TTL_SECONDS,
} from "../shared/deck-access.js";
import { getDeckUrl, getSlidesAppUrl } from "./_app-url.js";

const ANONYMOUS_ACCESS_REQUEST_WINDOW_MS = 10 * 60 * 1000;
const ANONYMOUS_ACCESS_REQUEST_MAX = 5;

async function claimAnonymousAccessRequestSlot(
  db: ReturnType<typeof getDb>,
  deckId: string,
): Promise<{ windowStartedAt: string }> {
  const now = new Date();
  const windowStartedAt = now.toISOString();
  const resetBefore = new Date(
    now.getTime() - ANONYMOUS_ACCESS_REQUEST_WINDOW_MS,
  ).toISOString();
  const limits = schema.deckAccessRequestLimits;
  const [bucket] = await db
    .insert(limits)
    .values({
      deckId,
      windowStartedAt,
      requestCount: 1,
    })
    .onConflictDoUpdate({
      target: limits.deckId,
      set: {
        windowStartedAt: sql`CASE WHEN ${limits.windowStartedAt} <= ${resetBefore} THEN ${windowStartedAt} ELSE ${limits.windowStartedAt} END`,
        requestCount: sql`CASE WHEN ${limits.windowStartedAt} <= ${resetBefore} THEN 1 ELSE ${limits.requestCount} + 1 END`,
      },
      where: sql`${limits.windowStartedAt} <= ${resetBefore} OR ${limits.requestCount} < ${ANONYMOUS_ACCESS_REQUEST_MAX}`,
    })
    .returning({
      requestCount: limits.requestCount,
      windowStartedAt: limits.windowStartedAt,
    });

  if (!bucket) {
    throw httpError(
      "Too many anonymous access requests for this deck. Try again later.",
      429,
    );
  }
  return { windowStartedAt: bucket.windowStartedAt };
}

async function refundAnonymousAccessRequestSlot(
  db: ReturnType<typeof getDb>,
  deckId: string,
  windowStartedAt: string,
): Promise<void> {
  const limits = schema.deckAccessRequestLimits;
  await db
    .update(limits)
    .set({
      requestCount: sql`${limits.requestCount} - 1`,
    })
    .where(
      and(
        eq(limits.deckId, deckId),
        eq(limits.windowStartedAt, windowStartedAt),
        sql`${limits.requestCount} > 0`,
      ),
    )
    .returning({ deckId: limits.deckId });
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function absoluteDeckAccessApprovalUrl(
  deckId: string,
  approvalToken: string,
): string {
  return `${getSlidesAppUrl().replace(/\/+$/, "")}${deckAccessApprovalPath(deckId, approvalToken)}`;
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
  inAppNotified?: boolean;
  emailNotified?: boolean;
  notificationClaimedAt?: string;
  notificationClaimToken?: string;
};

type AccessRequestNotificationState = {
  inAppNotified: boolean;
  emailNotified: boolean;
  emailRequired: boolean;
  ownerCanNotify: boolean;
};

const NOTIFICATION_CLAIM_TTL_MS = 5 * 60 * 1000;
const NOTIFICATION_CLAIM_HEARTBEAT_MS = Math.floor(
  NOTIFICATION_CLAIM_TTL_MS / 3,
);

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

function notificationStateFor(
  payload: AccessRequestPayload,
  ownerEmail: string | null,
  requesterEmail: string,
  emailConfigured: boolean,
): AccessRequestNotificationState {
  const ownerCanNotify = Boolean(
    ownerEmail && normalizeEmail(ownerEmail) !== requesterEmail,
  );
  const legacyNotified = payload.notifiedOwner === true;
  return {
    inAppNotified: payload.inAppNotified ?? legacyNotified,
    emailNotified: payload.emailNotified ?? legacyNotified,
    emailRequired: ownerCanNotify && emailConfigured,
    ownerCanNotify,
  };
}

function notificationWasDelivered(
  state: AccessRequestNotificationState,
): boolean {
  return state.inAppNotified || state.emailNotified;
}

function notificationStillNeeded(
  state: AccessRequestNotificationState,
): boolean {
  return (
    state.ownerCanNotify &&
    (!state.inAppNotified || (state.emailRequired && !state.emailNotified))
  );
}

function hasRecentNotificationClaim(
  claimedAt: string | undefined,
  now = Date.now(),
): boolean {
  if (!claimedAt) return false;
  const claimedAtMs = Date.parse(claimedAt);
  return (
    Number.isFinite(claimedAtMs) &&
    now - claimedAtMs < NOTIFICATION_CLAIM_TTL_MS
  );
}

async function notifyAccessRequestOwner(input: {
  deckId: string;
  deckTitle: string;
  ownerEmail: string | null;
  requesterEmail: string;
  requesterName: string;
  state: AccessRequestNotificationState;
}): Promise<AccessRequestNotificationState> {
  const ownerEmail = input.ownerEmail;
  if (!ownerEmail || !input.state.ownerCanNotify) return input.state;

  let state = input.state;

  if (!state.inAppNotified) {
    try {
      const delivery = await notifyWithDelivery(
        {
          severity: "info",
          title: "Deck access requested",
          body: `${input.requesterName} requested access to “${input.deckTitle}”.`,
          channels: ["inbox"],
          metadata: {
            deckId: input.deckId,
            requesterEmail: input.requesterEmail,
            link: getDeckUrl(input.deckId),
          },
        },
        { owner: ownerEmail },
      );
      state = {
        ...state,
        inAppNotified:
          state.inAppNotified || delivery.deliveredChannels.includes("inbox"),
      };
    } catch (error) {
      console.warn(
        "[deck-access] in-app access request notification failed:",
        error,
      );
    }
  }

  if (state.emailRequired && !state.emailNotified) {
    try {
      const approvalToken = signScopedAgentAccessToken({
        resourceKind: SLIDES_ACCESS_APPROVAL_TOKEN_PREFIX,
        resourceId: input.deckId,
        viewerEmail: input.requesterEmail,
        ttlSeconds: SLIDES_ACCESS_APPROVAL_TOKEN_TTL_SECONDS,
      });
      await sendEmail({
        ...renderDeckAccessRequestEmail({
          requesterName: input.requesterName,
          requesterEmail: input.requesterEmail,
          deckTitle: input.deckTitle,
          url: getDeckUrl(input.deckId),
          allowAccessUrl: absoluteDeckAccessApprovalUrl(
            input.deckId,
            approvalToken,
          ),
        }),
        to: ownerEmail,
        replyTo: input.requesterEmail,
        templateId: SLIDES_DECK_ACCESS_REQUEST_EMAIL_ID,
      });
      state = { ...state, emailNotified: true };
    } catch (error) {
      console.warn("[deck-access] access request email failed:", error);
    }
  }

  return state;
}

export default defineAction({
  description:
    "Request access to a private Agent-Native Slides deck. Signed-in viewers use their account email; anonymous viewers may provide an email address. Records an access-request event and notifies the owner in-app and by email when configured.",
  schema: z.object({
    deckId: z.string().min(1).describe("Deck ID to request access to."),
    accessRequestToken: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Short-lived capability from the private deck page."),
    requesterEmail: z
      .string()
      .trim()
      .email()
      .optional()
      .describe(
        "Email address to request access for when the viewer is not signed in.",
      ),
  }),
  requiresAuth: false,
  agentTool: false,
  run: async ({
    deckId,
    accessRequestToken,
    requesterEmail: requesterEmailInput,
  }) => {
    const sessionEmail = getRequestUserEmail();
    let requestToken = accessRequestToken
      ? verifyScopedAgentAccessToken(accessRequestToken, {
          resourceKind: SLIDES_ACCESS_REQUEST_TOKEN_PREFIX,
          resourceId: deckId,
        })
      : { ok: false as const, reason: "missing" };
    let accessProbeWasUnavailable = false;
    if (accessRequestToken && !requestToken.ok) {
      const fallbackToken = verifyScopedAgentAccessToken(accessRequestToken, {
        resourceKind: SLIDES_ACCESS_REQUEST_FALLBACK_TOKEN_PREFIX,
        resourceId: deckId,
      });
      if (fallbackToken.ok) {
        requestToken = fallbackToken;
        accessProbeWasUnavailable = true;
      }
    }
    if (accessRequestToken && !requestToken.ok) {
      throw httpError(`Deck ${deckId} not found`, 404);
    }
    if (!sessionEmail && !requestToken.ok) {
      throw httpError(`Deck ${deckId} not found`, 404);
    }
    const normalizedRequesterEmail = sessionEmail
      ? normalizeEmail(sessionEmail)
      : requesterEmailInput
        ? normalizeEmail(requesterEmailInput)
        : null;
    if (!normalizedRequesterEmail) {
      throw httpError(
        "Sign in or provide an email address to request access to this deck.",
        401,
      );
    }
    const tokenViewerEmail =
      requestToken.ok && requestToken.viewerEmail
        ? normalizeEmail(requestToken.viewerEmail)
        : null;
    if (tokenViewerEmail && tokenViewerEmail !== normalizedRequesterEmail) {
      throw httpError(
        "This request is tied to a different email. Sign in with the email that opened the link.",
        403,
      );
    }
    const requesterEmail = normalizedRequesterEmail;

    const db = getDb();
    const claimNotification = async (
      requestId: string,
      currentPayloadJson: string,
      payload: AccessRequestPayload,
    ): Promise<AccessRequestPayload | null> => {
      const claimedPayload: AccessRequestPayload = {
        ...payload,
        notificationClaimedAt: new Date().toISOString(),
        notificationClaimToken: randomUUID(),
      };
      try {
        const [claimed] = await db
          .update(schema.deckEvents)
          .set({
            payload: JSON.stringify(claimedPayload),
          })
          .where(
            and(
              eq(schema.deckEvents.id, requestId),
              eq(schema.deckEvents.payload, currentPayloadJson),
            ),
          )
          .returning({ id: schema.deckEvents.id });
        return claimed ? claimedPayload : null;
      } catch (error) {
        console.warn("[deck-access] notification claim failed:", error);
        return null;
      }
    };
    const renewNotificationClaim = async (
      requestId: string,
      claimedPayload: AccessRequestPayload,
    ): Promise<AccessRequestPayload | null> => {
      const renewedPayload: AccessRequestPayload = {
        ...claimedPayload,
        notificationClaimedAt: new Date().toISOString(),
      };
      try {
        const [renewed] = await db
          .update(schema.deckEvents)
          .set({
            payload: JSON.stringify(renewedPayload),
          })
          .where(
            and(
              eq(schema.deckEvents.id, requestId),
              eq(schema.deckEvents.payload, JSON.stringify(claimedPayload)),
            ),
          )
          .returning({ id: schema.deckEvents.id });
        return renewed ? renewedPayload : null;
      } catch (error) {
        // Keep the current payload so the next heartbeat can retry a
        // transient database failure without dropping the claim.
        console.warn("[deck-access] notification claim renewal failed:", error);
        return claimedPayload;
      }
    };
    const notifyWithClaimHeartbeat = async (
      requestId: string,
      claimedPayload: AccessRequestPayload,
      notify: () => Promise<AccessRequestNotificationState>,
    ): Promise<{
      state: AccessRequestNotificationState;
      claimedPayload: AccessRequestPayload;
    }> => {
      let currentPayload = claimedPayload;
      let stopped = false;
      let renewalInFlight = Promise.resolve();
      const renew = () => {
        if (stopped) return renewalInFlight;
        renewalInFlight = renewalInFlight.then(async () => {
          if (stopped) return;
          const renewedPayload = await renewNotificationClaim(
            requestId,
            currentPayload,
          );
          if (renewedPayload) currentPayload = renewedPayload;
        });
        return renewalInFlight;
      };
      const heartbeat = setInterval(renew, NOTIFICATION_CLAIM_HEARTBEAT_MS);
      let deliveredState: AccessRequestNotificationState | null = null;
      try {
        deliveredState = await notify();
      } finally {
        stopped = true;
        clearInterval(heartbeat);
        await renewalInFlight;
      }
      if (!deliveredState) {
        throw new Error("Notification delivery did not return a state.");
      }
      return {
        state: deliveredState,
        claimedPayload: currentPayload,
      };
    };
    const recordNotification = async (
      requestId: string,
      claimedPayload: AccessRequestPayload,
      state: AccessRequestNotificationState,
    ): Promise<boolean> => {
      const delivered = notificationWasDelivered(state);
      const persistedPayload: AccessRequestPayload = {
        ...claimedPayload,
        inAppNotified: state.inAppNotified,
        emailNotified: state.emailNotified,
        notifiedOwner: delivered,
        notificationClaimedAt: undefined,
        notificationClaimToken: undefined,
        ...(delivered ? { notifiedAt: new Date().toISOString() } : {}),
      };
      try {
        const [persisted] = await db
          .update(schema.deckEvents)
          .set({ payload: JSON.stringify(persistedPayload) })
          .where(
            and(
              eq(schema.deckEvents.id, requestId),
              eq(schema.deckEvents.payload, JSON.stringify(claimedPayload)),
            ),
          )
          .returning({ id: schema.deckEvents.id });
        if (!persisted) {
          console.warn(
            "[deck-access] notification status update was superseded:",
            requestId,
          );
        }
        return Boolean(persisted);
      } catch (error) {
        console.warn("[deck-access] notification status update failed:", error);
        return false;
      }
    };
    const [deck] = await db
      .select({
        id: schema.decks.id,
        title: schema.decks.title,
        ownerEmail: schema.decks.ownerEmail,
        visibility: schema.decks.visibility,
      })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId))
      .limit(1);

    if (!deck) {
      throw httpError(`Deck ${deckId} not found`, 404);
    }

    const access = accessProbeWasUnavailable
      ? null
      : await resolveAccess("deck", deckId, currentAccess());
    if (access) {
      return {
        ok: true as const,
        alreadyHasAccess: true,
        notifiedOwner: false,
        message: "You already have access. Refreshing the deck...",
      };
    }
    if ((deck.visibility ?? "private") !== "private") {
      return {
        ok: true as const,
        alreadyHasAccess: false,
        alreadyRequested: false,
        notifiedOwner: false,
        message: "Access requests are only available for private decks.",
      };
    }

    const requesterName =
      getRequestUserName()?.trim() || displayNameForEmail(requesterEmail);
    const ownerEmail = deck.ownerEmail?.trim() || null;
    const emailConfigured = await isEmailConfigured();
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
      const previousRequestId = previousRequest.id;
      if (!previousPayload) {
        return {
          ok: true as const,
          alreadyHasAccess: false,
          alreadyRequested: true,
          notifiedOwner: false,
          requestId: previousRequestId,
          message: "Your access request is already with the deck owner.",
        };
      }

      const previousState = notificationStateFor(
        previousPayload,
        ownerEmail,
        requesterEmail,
        emailConfigured,
      );
      if (!notificationStillNeeded(previousState)) {
        return {
          ok: true as const,
          alreadyHasAccess: false,
          alreadyRequested: true,
          notifiedOwner: notificationWasDelivered(previousState),
          requestId: previousRequestId,
          message: "Your access request is already with the deck owner.",
        };
      }
      if (hasRecentNotificationClaim(previousPayload.notificationClaimedAt)) {
        return {
          ok: true as const,
          alreadyHasAccess: false,
          alreadyRequested: true,
          notifiedOwner: notificationWasDelivered(previousState),
          requestId: previousRequestId,
          message: "Your access request is already with the deck owner.",
        };
      }

      const claimedPayload = await claimNotification(
        previousRequestId,
        previousRequest.payload ?? "",
        previousPayload,
      );
      if (!claimedPayload) {
        return {
          ok: true as const,
          alreadyHasAccess: false,
          alreadyRequested: true,
          notifiedOwner: notificationWasDelivered(previousState),
          requestId: previousRequestId,
          message: "Your access request is already with the deck owner.",
        };
      }

      const delivery = await notifyWithClaimHeartbeat(
        previousRequestId,
        claimedPayload,
        () =>
          notifyAccessRequestOwner({
            deckId,
            deckTitle: deck.title,
            ownerEmail,
            requesterEmail,
            requesterName:
              previousPayload?.requesterName?.trim() || requesterName,
            state: previousState,
          }),
      );
      const persisted = await recordNotification(
        previousRequestId,
        delivery.claimedPayload,
        delivery.state,
      );
      const notifiedOwner =
        persisted && notificationWasDelivered(delivery.state);

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

    const anonymousSlot = sessionEmail
      ? null
      : await claimAnonymousAccessRequestSlot(db, deckId);

    const requestId = accessRequestEventId(deckId, requesterEmail);
    const requestedAt = new Date().toISOString();
    const initialPayload: AccessRequestPayload = {
      requestId,
      requesterEmail,
      requesterName,
      requestedAt,
      notifiedOwner: false,
      inAppNotified: false,
      emailNotified: false,
      notificationClaimedAt: requestedAt,
      notificationClaimToken: randomUUID(),
    };
    const initialPayloadJson = JSON.stringify(initialPayload);

    const [insertedRequest] = await db
      .insert(schema.deckEvents)
      .values({
        id: requestId,
        deckId,
        type: "deck.access_requested",
        message: `${requesterEmail} requested access to this deck.`,
        payload: initialPayloadJson,
        createdBy: "human",
        createdAt: requestedAt,
      })
      .onConflictDoNothing()
      .returning({ id: schema.deckEvents.id });

    if (!insertedRequest) {
      if (anonymousSlot) {
        await refundAnonymousAccessRequestSlot(
          db,
          deckId,
          anonymousSlot.windowStartedAt,
        );
      }
      return {
        ok: true as const,
        alreadyHasAccess: false,
        alreadyRequested: true,
        notifiedOwner: false,
        message: "Your access request is already with the deck owner.",
      };
    }

    const initialState = notificationStateFor(
      initialPayload,
      ownerEmail,
      requesterEmail,
      emailConfigured,
    );
    const delivery = await notifyWithClaimHeartbeat(
      requestId,
      initialPayload,
      () =>
        notifyAccessRequestOwner({
          deckId,
          deckTitle: deck.title,
          ownerEmail,
          requesterEmail,
          requesterName,
          state: initialState,
        }),
    );
    const persisted = await recordNotification(
      requestId,
      delivery.claimedPayload,
      delivery.state,
    );
    const notifiedOwner = persisted && notificationWasDelivered(delivery.state);

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
