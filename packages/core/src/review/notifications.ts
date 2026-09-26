
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
import {
  claimReviewNotificationDelivery,
  filterUnmutedReviewThreadRecipients,
  finishReviewNotificationDelivery,
  markReviewCommentNotificationCompleted,
  queryReviewComments,
  releaseReviewNotificationDelivery,
  reviewCommentNotificationCompleted,
} from "./store.js";
import type { ReviewComment } from "./types.js";

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
  // participants are read unscoped so a viewer's narrower scope cannot hide a
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

export async function notifyReviewComment(
  comment: ReviewComment,
): Promise<ReviewNotificationResult> {
  return runActivityNotification(LOG_LABEL, () =>
    deliverReviewCommentEmails(comment),
  );
}

export async function notifyReviewCommentWithReceipt(
  comment: ReviewComment,
): Promise<ReviewNotificationResult | null> {
  try {
    if (await reviewCommentNotificationCompleted(comment.id)) return null;
    const result = await runActivityNotification(LOG_LABEL, () =>
      deliverReviewCommentEmails(comment, true),
    );
    if (
      result.failed.length === 0 &&
      (result.status === "delivered" || result.status === "no-recipients")
    ) {
      await markReviewCommentNotificationCompleted(comment.id);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_LABEL} receipt failed: ${message}`);
    return {
      status: "notification-error",
      error: message,
      sent: [],
      failed: [],
    };
  }
}

async function deliverReviewCommentEmails(
  comment: ReviewComment,
  withReceipt = false,
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

  const allowed = await filterRecipientsByResourceAccess({
    resourceType: comment.resourceType,
    resourceId: comment.resourceId,
    emails: candidates.filter((email): email is string => Boolean(email)),
    orgId: comment.orgId,
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
    candidates: isReply
      ? await filterUnmutedReviewThreadRecipients(comment.threadId, allowed)
      : allowed,
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

      const deliver = () =>
        sendEmail({
          to,
          subject: wasMentioned
            ? `${actor} mentioned you in a review comment`
            : isReply
              ? `${actor} replied to a review thread`
              : `${actor} left a review comment`,
          html,
          text,
        });
      if (!withReceipt) {
        await deliver();
        return;
      }
      const claim = await claimReviewNotificationDelivery(comment.id, to);
      if (claim.status !== "claimed") {
        if (claim.status === "sent") return;
        throw new Error("Review notification delivery is already in progress");
      }
      try {
        await deliver();
        await finishReviewNotificationDelivery(comment.id, to, claim.token);
      } catch (error) {
        await releaseReviewNotificationDelivery(comment.id, to, claim.token);
        throw error;
      }
    },
  });
}
