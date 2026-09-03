/**
 * Email notifications for review threads.
 *
 * Implemented here rather than in one app so every surface built on review
 * comments (Design's review threads today) gets the same behavior. Recipient
 * resolution, preference filtering, and delivery reporting come from the
 * shared activity-notification helpers.
 */

import {
  notifyActivity,
  runActivityNotification,
  type ActivityNotificationResult,
} from "../server/activity-notifications.js";
import { getAppProductionUrl } from "../server/app-url.js";
import { emailStrong, renderEmail } from "../server/email-template.js";
import { sendEmail } from "../server/email.js";
import { filterRecipientsByResourceAccess } from "../sharing/recipients.js";
import {
  getReviewableResource,
  resolveReviewableResourceAccess,
} from "./registry.js";
import { queryReviewComments } from "./store.js";
import type { ReviewComment } from "./types.js";

/**
 * Shared across every review surface. Apps that want a user-facing toggle
 * write `{ emailNotifications: boolean }` under this key; an absent value
 * means opted in.
 */
export const REVIEW_NOTIFICATION_PREFS_KEY = "activity-notification-prefs";

const LOG_LABEL = "[review] comment notification";
const EXCERPT_LIMIT = 240;

function excerpt(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  return collapsed.length > EXCERPT_LIMIT
    ? `${collapsed.slice(0, EXCERPT_LIMIT - 1)}…`
    : collapsed;
}

async function resourceUrl(comment: ReviewComment): Promise<string> {
  const registration = getReviewableResource(comment.resourceType);
  const resolved = await registration?.resolveUrl?.(comment.resourceId);
  return resolved?.trim() || getAppProductionUrl();
}

function resourceLabel(comment: ReviewComment): string {
  return (
    getReviewableResource(comment.resourceType)?.displayName?.trim() ||
    comment.resourceType
  );
}

async function threadParticipants(comment: ReviewComment): Promise<string[]> {
  // Scope is already established by the action that inserted the comment;
  // participants are read unscoped so a viewer's narrower scope cannot hide a
  // person who is genuinely in the thread.
  const comments = await queryReviewComments({
    resourceType: comment.resourceType,
    resourceId: comment.resourceId,
    scope: { userEmail: null, orgId: null },
    bypassScope: true,
    includeResolved: true,
  });
  return comments
    .filter((entry) => entry.threadId === comment.threadId)
    .map((entry) => entry.authorEmail)
    .filter((email): email is string => Boolean(email));
}

export type ReviewNotificationResult = ActivityNotificationResult;

/**
 * Email the resource owner, mentioned people, and — on a reply — everyone else
 * already in the thread. Never throws: the comment is already persisted, and a
 * rejection here would make the client retry and duplicate it.
 */
export async function notifyReviewComment(
  comment: ReviewComment,
): Promise<ReviewNotificationResult> {
  return runActivityNotification(LOG_LABEL, () =>
    deliverReviewCommentEmails(comment),
  );
}

async function deliverReviewCommentEmails(
  comment: ReviewComment,
): Promise<ActivityNotificationResult> {
  const mentioned = new Set(
    comment.mentions
      .map((mention) => mention.email?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email)),
  );

  const candidates = [comment.ownerEmail, ...mentioned];
  const isReply = Boolean(comment.parentCommentId);
  if (isReply) {
    candidates.push(...(await threadParticipants(comment)));
  }

  // Mentions are caller-supplied and thread rows are historical; neither is an
  // access grant. Re-check every address against the resource's current ACL
  // before it can receive the comment body.
  const allowed = await filterRecipientsByResourceAccess({
    resourceType: comment.resourceType,
    resourceId: comment.resourceId,
    emails: candidates.filter((email): email is string => Boolean(email)),
    orgId: comment.orgId,
    // The review registry owns access for its types; unregistered ones resolve
    // to null there, so nobody is notified rather than everybody.
    resolveRole: (ctx) =>
      resolveReviewableResourceAccess(
        comment.resourceType,
        comment.resourceId,
        ctx,
      ),
  });

  const actor = comment.authorName?.trim() || comment.authorEmail || "Someone";
  const label = resourceLabel(comment);
  const url = await resourceUrl(comment);

  return notifyActivity({
    candidates: allowed,
    actorEmail: comment.authorEmail,
    preferenceKey: REVIEW_NOTIFICATION_PREFS_KEY,
    logLabel: LOG_LABEL,
    send: async (to) => {
      const wasMentioned = mentioned.has(to);
      const lead = wasMentioned
        ? `${emailStrong(actor)} mentioned you in a review comment on this ${label}.`
        : isReply
          ? `${emailStrong(actor)} replied in a review thread on this ${label}.`
          : `${emailStrong(actor)} left a review comment on this ${label}.`;

      const { html, text } = renderEmail({
        preheader: `${actor} commented on this ${label}.`,
        heading: wasMentioned
          ? "You were mentioned in a review"
          : isReply
            ? "New reply in a review thread"
            : "New review comment",
        paragraphs: [lead, `"${excerpt(comment.body)}"`],
        cta: { label: "Open review", url },
        footer:
          "You received this because you own, were mentioned in, or participated in this review thread.",
      });

      await sendEmail({
        to,
        subject: wasMentioned
          ? `${actor} mentioned you in a review comment`
          : isReply
            ? `${actor} replied to a review thread`
            : `${actor} left a review comment`,
        html,
        text,
      });
    },
  });
}
