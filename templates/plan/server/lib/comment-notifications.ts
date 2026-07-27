import {
  emailStrong,
  getAppProductionUrl,
  isEmailConfigured,
  renderEmail,
  sendEmail,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";

import {
  SOURCE_AUTHOR_COMMENT_MENTION_EMAIL,
  extractCommentMentions,
} from "../../shared/comment-context.js";
import type { PlanBundle, PlanComment } from "../../shared/types.js";
import { getDb, schema } from "../db/index.js";

type CommentNotificationInput = {
  bundle: PlanBundle;
  insertedCommentIds: string[];
  priorComments?: PlanComment[];
};

type NotificationRecipient = {
  email: string;
  reason: "plan-owner" | "thread-participant" | "mention";
};

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || null;
}

function isSyntheticQaEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  if (trimmed === SOURCE_AUTHOR_COMMENT_MENTION_EMAIL) return true;
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return false;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return (
    local.includes("+qa") &&
    (domain === "example.test" ||
      domain.endsWith(".test") ||
      domain === "example.invalid" ||
      domain.endsWith(".invalid"))
  );
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

function actorName(comment: PlanComment): string {
  const explicit = comment.authorName?.trim();
  if (explicit) return explicit;
  const email = normalizeEmail(comment.authorEmail);
  return email ? displayNameForEmail(email) : "Someone";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function commentExcerpt(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  const excerpt =
    normalized.length > 260
      ? `${normalized.slice(0, 257).trim()}...`
      : normalized;
  return escapeHtml(excerpt || "Open the plan to read the comment.");
}

function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!base) return path;
  const normalizedBase = `/${base}`;
  if (path === normalizedBase || path.startsWith(`${normalizedBase}/`)) {
    return path;
  }
  return `${normalizedBase}${path}`;
}

function planUrl(planId: string): string {
  const appUrl = getAppProductionUrl().replace(/\/+$/, "");
  const path = appPath(`/plans/${encodeURIComponent(planId)}`);
  try {
    return new URL(path, `${appUrl}/`).toString();
  } catch {
    return `${appUrl}${path}`;
  }
}

function appName(): string {
  return (
    process.env.APP_NAME || process.env.VITE_APP_NAME || "Agent-Native Plan"
  );
}

function commentTime(comment: PlanComment): number {
  const time = Date.parse(comment.createdAt);
  return Number.isFinite(time) ? time : 0;
}

function sortComments(comments: PlanComment[]): PlanComment[] {
  return [...comments].sort((a, b) => {
    const delta = commentTime(a) - commentTime(b);
    return delta === 0 ? a.id.localeCompare(b.id) : delta;
  });
}

function findThreadRoot(
  comment: PlanComment,
  byId: Map<string, PlanComment>,
): PlanComment {
  let current = comment;
  const seen = new Set<string>();
  while (current.parentCommentId) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    const parent = byId.get(current.parentCommentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

function commentsInThread(
  rootId: string,
  comments: PlanComment[],
): PlanComment[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  return sortComments(
    comments.filter((comment) => findThreadRoot(comment, byId).id === rootId),
  );
}

export function planCommentNotificationRecipients(input: {
  comment: PlanComment;
  comments: PlanComment[];
  planOwnerEmail?: string | null;
  sourceAuthorEmail?: string | null;
}): NotificationRecipient[] {
  if (input.comment.createdBy !== "human") return [];
  const actorEmail = normalizeEmail(input.comment.authorEmail);
  const sourceAuthorEmail = normalizeEmail(input.sourceAuthorEmail);
  const recipients = new Map<string, NotificationRecipient>();
  const addRecipient = (
    email: string | null | undefined,
    reason: NotificationRecipient["reason"],
  ) => {
    const normalized = normalizeEmail(email);
    if (!normalized) return;
    if (actorEmail && normalized === actorEmail) return;
    if (isSyntheticQaEmail(normalized)) return;
    if (recipients.has(normalized)) return;
    recipients.set(normalized, { email: normalized, reason });
  };

  const mentionedPeople =
    input.comment.mentions && input.comment.mentions.length > 0
      ? input.comment.mentions
      : extractCommentMentions(input.comment.message);
  const mentionsSourceAuthor = mentionedPeople.some(
    (mention) =>
      normalizeEmail(mention.email) === SOURCE_AUTHOR_COMMENT_MENTION_EMAIL,
  );
  if (!(mentionsSourceAuthor && sourceAuthorEmail)) {
    addRecipient(input.planOwnerEmail, "plan-owner");
  }
  for (const mention of mentionedPeople) {
    if (normalizeEmail(mention.email) === SOURCE_AUTHOR_COMMENT_MENTION_EMAIL) {
      addRecipient(sourceAuthorEmail, "mention");
      continue;
    }
    addRecipient(mention.email, "mention");
  }

  if (!input.comment.parentCommentId) {
    return Array.from(recipients.values());
  }

  const byId = new Map(input.comments.map((comment) => [comment.id, comment]));
  const root = findThreadRoot(input.comment, byId);
  for (const threadComment of commentsInThread(root.id, input.comments)) {
    if (threadComment.id === input.comment.id) continue;
    if (threadComment.createdBy !== "human") continue;
    addRecipient(threadComment.authorEmail, "thread-participant");
  }
  return Array.from(recipients.values());
}

async function sendPlanCommentNotification(input: {
  recipient: NotificationRecipient;
  comment: PlanComment;
  planTitle: string;
  planId: string;
}) {
  const actor = actorName(input.comment);
  const app = appName();
  const isReply = Boolean(input.comment.parentCommentId);
  const subject = isReply
    ? `${actor} replied to a comment on "${input.planTitle}"`
    : `${actor} commented on "${input.planTitle}"`;
  const actionText =
    input.recipient.reason === "mention"
      ? "mentioned you in a comment on"
      : input.recipient.reason === "plan-owner"
        ? "left a comment on your plan"
        : "replied in a comment thread you participated in";
  const { html, text } = renderEmail({
    preheader: `${actor} ${actionText} on ${app}.`,
    heading: isReply ? "New reply on your plan" : "New comment on your plan",
    paragraphs: [
      `${emailStrong(actor)} ${actionText} ${emailStrong(input.planTitle)}.`,
      `Comment: "${commentExcerpt(input.comment.message)}"`,
    ],
    cta: { label: "Open plan", url: planUrl(input.planId) },
    footer:
      input.recipient.reason === "plan-owner"
        ? "You received this because you own this plan."
        : input.recipient.reason === "mention"
          ? "You received this because you were mentioned in this comment."
          : "You received this because you participated in this comment thread.",
  });
  await sendEmail({ to: input.recipient.email, subject, html, text });
}

export async function notifyPlanCommentRecipients({
  bundle,
  insertedCommentIds,
  priorComments,
}: CommentNotificationInput): Promise<void> {
  if (insertedCommentIds.length === 0 || !(await isEmailConfigured())) return;

  const db = getDb();
  const [planRow] = await db
    .select({
      id: schema.plans.id,
      title: schema.plans.title,
      ownerEmail: schema.plans.ownerEmail,
      sourceAuthorEmail: schema.plans.sourceAuthorEmail,
    })
    .from(schema.plans)
    .where(eq(schema.plans.id, bundle.plan.id));
  const planOwnerEmail = planRow?.ownerEmail ?? null;
  const sourceAuthorEmail = planRow?.sourceAuthorEmail ?? null;
  const planTitle = planRow?.title ?? bundle.plan.title;
  const insertedById = new Map(
    bundle.comments
      .filter((comment) => insertedCommentIds.includes(comment.id))
      .map((comment) => [comment.id, comment]),
  );
  const inserted = insertedCommentIds
    .map((commentId) => insertedById.get(commentId))
    .filter((comment): comment is PlanComment => Boolean(comment));
  const visibleComments = priorComments ? [...priorComments] : bundle.comments;

  for (const comment of inserted) {
    const commentsForRecipients = priorComments
      ? [...visibleComments, comment]
      : bundle.comments;
    const recipients = planCommentNotificationRecipients({
      comment,
      comments: commentsForRecipients,
      planOwnerEmail,
      sourceAuthorEmail,
    });
    for (const recipient of recipients) {
      try {
        await sendPlanCommentNotification({
          recipient,
          comment,
          planTitle,
          planId: bundle.plan.id,
        });
      } catch (error) {
        console.warn("[plan-comments] email notification failed:", error);
      }
    }
    if (priorComments) visibleComments.push(comment);
  }
}
