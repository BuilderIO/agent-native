import {
  notifyActivity,
  runActivityNotification,
  type ActivityNotificationResult,
} from "../server/activity-notifications.js";
import { getAppProductionUrl } from "../server/app-url.js";
import {
  emailStrong,
  escapeEmailHtml,
  renderEmail,
} from "../server/email-template.js";
import { sendEmail } from "../server/email.js";
import { filterRecipientsByResourceAccess } from "../sharing/recipients.js";
import { commentExcerpt } from "./plain-text.js";
import {
  getReviewableResource,
  resolveReviewableResourceAccess,
} from "./registry.js";
import {
  claimReviewNotificationDelivery,
  filterUnmutedReviewThreadRecipients,
  finishReviewNotificationDelivery,
  listReviewThreadParticipantEmails,
  markReviewCommentNotificationCompleted,
  releaseReviewNotificationDelivery,
  reviewCommentNotificationCompleted,
} from "./store.js";
import type { ReviewComment } from "./types.js";

export const REVIEW_NOTIFICATION_PREFS_KEY = "activity-notification-prefs";

const LOG_LABEL = "[review] comment notification";

async function resourceUrl(comment: ReviewComment): Promise<string> {
  const registration = getReviewableResource(comment.resourceType);
  const resolved = await registration?.resolveUrl?.(
    comment.resourceId,
    comment,
  );
  return resolved?.trim() || getAppProductionUrl();
}

async function resourceTitle(comment: ReviewComment): Promise<string | null> {
  const registration = getReviewableResource(comment.resourceType);
  const title = await registration?.resolveTitle?.(comment.resourceId);
  return title?.trim() || null;
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
  // person who is genuinely in the thread. The lookup is by thread, so a busy
  // resource's other threads can't push this thread's people out of a page.
  return listReviewThreadParticipantEmails({
    resourceType: comment.resourceType,
    resourceId: comment.resourceId,
    threadId: comment.threadId,
  });
}

export type ReviewNotificationResult = ActivityNotificationResult;

export async function notifyReviewComment(
  comment: ReviewComment,
): Promise<ReviewNotificationResult | null> {
  const send = getReviewableResource(comment.resourceType)?.email?.send;
  return runActivityNotification(LOG_LABEL, () =>
    send ? send(comment) : deliverReviewCommentEmails(comment),
  );
}

export async function notifyReviewCommentWithReceipt(
  comment: ReviewComment,
): Promise<ReviewNotificationResult | null> {
  try {
    if (await reviewCommentNotificationCompleted(comment.id)) return null;
    if (getReviewableResource(comment.resourceType)?.email?.send) {
      return (await markReviewCommentNotificationCompleted(comment.id))
        ? await notifyReviewComment(comment)
        : null;
    }
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
  const title = await resourceTitle(comment);
  const emailSettings = getReviewableResource(comment.resourceType)?.email;

  return notifyActivity({
    candidates: isReply
      ? await filterUnmutedReviewThreadRecipients(comment.threadId, allowed)
      : allowed,
    actorEmail: comment.authorEmail,
    preferenceKey:
      emailSettings?.preferenceKey ?? REVIEW_NOTIFICATION_PREFS_KEY,
    logLabel: LOG_LABEL,
    send: async (to) => {
      const wasMentioned = mentioned.has(to);
      const excerpt = commentExcerpt(comment.body);
      const wording = title
        ? titledWording({ actor, title, label, wasMentioned, isReply })
        : untitledWording({ actor, label, wasMentioned, isReply });
      const footer = `${wording.footer}${
        emailSettings?.settingsName
          ? ` Turn these off in ${emailSettings.settingsName}.`
          : ""
      }`;

      const { html, text } = renderEmail({
        preheader: wording.preheader,
        heading: wording.heading,
        // Paragraphs are HTML; the excerpt is the commenter's own text. A
        // comment that's only an image has none to quote.
        paragraphs: excerpt
          ? [wording.lead, `"${escapeEmailHtml(excerpt)}"`]
          : [wording.lead],
        cta: { label: wording.cta, url },
        footer,
      });

      const deliver = () =>
        sendEmail({
          to,
          subject: wording.subject,
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

interface EmailWordingInput {
  actor: string;
  label: string;
  wasMentioned: boolean;
  isReply: boolean;
}

interface EmailWording {
  subject: string;
  preheader: string;
  heading: string;
  lead: string;
  cta: string;
  footer: string;
}

function untitledWording({
  actor,
  label,
  wasMentioned,
  isReply,
}: EmailWordingInput): EmailWording {
  return {
    subject: wasMentioned
      ? `${actor} mentioned you in a review comment`
      : isReply
        ? `${actor} replied to a review thread`
        : `${actor} left a review comment`,
    preheader: `${actor} commented on this ${label}.`,
    heading: wasMentioned
      ? "You were mentioned in a review"
      : isReply
        ? "New reply in a review thread"
        : "New review comment",
    lead: wasMentioned
      ? `${emailStrong(actor)} mentioned you in a review comment on this ${label}.`
      : isReply
        ? `${emailStrong(actor)} replied in a review thread on this ${label}.`
        : `${emailStrong(actor)} left a review comment on this ${label}.`,
    cta: "Open review",
    footer:
      "You received this because you own, were mentioned in, or participated in this review thread.",
  };
}

function titledWording({
  actor,
  title,
  label,
  wasMentioned,
  isReply,
}: EmailWordingInput & { title: string }): EmailWording {
  const strongTitle = emailStrong(title);
  return {
    subject: wasMentioned
      ? `${actor} mentioned you on "${title}"`
      : isReply
        ? `${actor} replied to a comment on "${title}"`
        : `${actor} commented on "${title}"`,
    preheader: isReply
      ? `${actor} replied to a comment on ${title}.`
      : `${actor} commented on ${title}.`,
    heading: wasMentioned
      ? "You were mentioned"
      : isReply
        ? "New reply"
        : "New comment",
    lead: wasMentioned
      ? `${emailStrong(actor)} mentioned you in a comment on ${strongTitle}.`
      : isReply
        ? `${emailStrong(actor)} replied in a comment thread on ${strongTitle}.`
        : `${emailStrong(actor)} commented on ${strongTitle}.`,
    cta: `Open ${label.toLowerCase()}`,
    footer:
      "You received this because you own, were mentioned in, or participated in this thread.",
  };
}
