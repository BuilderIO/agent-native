import {
  registerReviewableResource,
  type ReviewResourceAccess,
  type ReviewResourceContext,
  type ReviewResourceRole,
} from "@agent-native/core/review";
import { resolveAccess, type AccessContext } from "@agent-native/core/sharing";

import { SLIDE_REVIEW_RESOURCE_TYPE } from "../../shared/slide-review.js";
import { SLIDES_USER_PREFS_KEY } from "../../shared/slides-user-prefs.js";
import {
  renderSlideReviewEmail,
  slideReviewThreadUrl,
} from "./comment-notifications.js";
import { SLIDES_DECK_COMMENT_EMAIL_ID } from "./emails.js";
import { ensureSlideReviewMigrated } from "./slide-review-migration.js";

function accessContext(
  ctx: ReviewResourceContext | undefined,
): AccessContext | undefined {
  if (!ctx) return undefined;
  const transaction = ctx.transaction as AccessContext["transaction"];
  return {
    ...(ctx.userEmail ? { userEmail: ctx.userEmail } : {}),
    ...(ctx.orgId ? { orgId: ctx.orgId } : {}),
    ...(transaction ? { transaction } : {}),
  };
}

/**
 * Deck access for review threads. Every review read and write resolves this
 * first, so it is where a deck's legacy comments are copied over: lazily, on
 * the first request that needs them, never at boot.
 */
export async function resolveSlideReviewAccess(
  deckId: string,
  ctx?: ReviewResourceContext,
): Promise<ReviewResourceAccess | null> {
  const access = await resolveAccess(
    SLIDE_REVIEW_RESOURCE_TYPE,
    deckId,
    accessContext(ctx),
    { skipResourceBody: true },
  );
  if (!access) return null;
  const deck = access.resource as {
    ownerEmail?: string | null;
    orgId?: string | null;
    visibility?: "private" | "org" | "public" | null;
  };
  // A caller inside a transaction already passed through here for this deck:
  // the panel lists before it writes, and so does every action.
  if (!ctx?.transaction) await ensureSlideReviewMigrated(deckId, deck);
  return {
    role: access.role as ReviewResourceRole,
    ownerEmail: deck.ownerEmail ?? null,
    orgId: deck.orgId ?? null,
    visibility: deck.visibility ?? null,
  };
}

export function registerSlideReview(): void {
  registerReviewableResource({
    type: SLIDE_REVIEW_RESOURCE_TYPE,
    displayName: "deck",
    resolveAccess: resolveSlideReviewAccess,
    commentNotifications: {
      preferenceKey: SLIDES_USER_PREFS_KEY,
      templateId: SLIDES_DECK_COMMENT_EMAIL_ID,
      resolveThreadUrl: (comment) =>
        slideReviewThreadUrl(comment.resourceId, comment.threadId),
      renderEmail: renderSlideReviewEmail,
    },
  });
}

// Actions import this module outside the Nitro plugin lifecycle too, such as
// `pnpm action`, and every one of them needs the deck registered.
registerSlideReview();
