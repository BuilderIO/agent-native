/**
 * Email notifications for document comments, replies, and mentions.
 *
 * Recipient resolution, preference filtering, and delivery reporting come from
 * `@agent-native/core/server`; this module owns only the Documents rows and the
 * email copy. Share invites are not routed through the `emailNotifications`
 * preference — they have their own delivery path.
 */

import {
  emailStrong,
  getAppProductionUrl,
  notifyActivity,
  renderEmail,
  runActivityNotification,
  sendEmail,
  type ActivityNotificationResult,
} from "@agent-native/core/server";
import { filterRecipientsByResourceAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";

import { CONTENT_USER_PREFS_KEY } from "../../shared/content-user-prefs.js";
import { getDb, schema } from "../db/index.js";
import {
  CONTENT_DOCUMENT_COMMENT_EMAIL_ID,
  CONTENT_DOCUMENT_MENTION_EMAIL_ID,
} from "./emails.js";

export type DocumentCommentNotificationResult = ActivityNotificationResult;

const LOG_LABEL = "[content] comment notification";
const EXCERPT_LIMIT = 240;

function excerpt(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  return collapsed.length > EXCERPT_LIMIT
    ? `${collapsed.slice(0, EXCERPT_LIMIT - 1)}…`
    : collapsed;
}

function documentUrl(documentId: string): string {
  const base = getAppProductionUrl().replace(/\/+$/, "");
  return `${base}/page/${encodeURIComponent(documentId)}`;
}

async function threadParticipants(
  documentId: string,
  threadId: string,
): Promise<string[]> {
  const rows = await getDb()
    .select({ authorEmail: schema.documentComments.authorEmail })
    .from(schema.documentComments)
    .where(
      and(
        eq(schema.documentComments.documentId, documentId),
        eq(schema.documentComments.threadId, threadId),
      ),
    );
  return rows.map((row) => row.authorEmail);
}

export interface DocumentCommentNotificationInput {
  documentId: string;
  /** Read from the access-checked resource by the caller, never re-queried. */
  documentTitle: string;
  /** The document's org, so `org` visibility resolves for its members. */
  orgId?: string | null;
  threadId: string;
  ownerEmail: string;
  authorEmail: string;
  authorName?: string | null;
  content: string;
  mentions: { email: string; name: string }[];
  isReply: boolean;
}

export function renderDocumentCommentEmail({
  actor,
  title,
  url,
  content,
  isReply,
  wasMentioned,
}: {
  actor: string;
  title: string;
  url: string;
  content: string;
  isReply: boolean;
  wasMentioned: boolean;
}) {
  const lead = wasMentioned
    ? `${emailStrong(actor)} mentioned you in a comment on ${emailStrong(title)}.`
    : isReply
      ? `${emailStrong(actor)} replied in a comment thread on ${emailStrong(title)}.`
      : `${emailStrong(actor)} commented on ${emailStrong(title)}.`;

  return {
    subject: wasMentioned
      ? `${actor} mentioned you on "${title}"`
      : isReply
        ? `${actor} replied to a comment on "${title}"`
        : `${actor} commented on "${title}"`,
    ...renderEmail({
      preheader: `${actor} commented on ${title}.`,
      heading: wasMentioned
        ? "You were mentioned"
        : isReply
          ? "New reply on your document"
          : "New comment",
      paragraphs: [lead, `"${excerpt(content)}"`],
      cta: { label: "Open document", url },
      footer:
        "You received this because you own, were mentioned in, or participated in this thread. Turn these off in Documents settings.",
    }),
  };
}

export async function notifyDocumentComment(
  input: DocumentCommentNotificationInput,
): Promise<DocumentCommentNotificationResult> {
  return runActivityNotification(LOG_LABEL, () =>
    deliverDocumentCommentEmails(input),
  );
}

async function deliverDocumentCommentEmails(
  input: DocumentCommentNotificationInput,
): Promise<DocumentCommentNotificationResult> {
  const title = input.documentTitle.trim() || "Untitled";
  const mentioned = new Set(
    input.mentions.map((mention) => mention.email.trim().toLowerCase()),
  );

  const candidates = [input.ownerEmail, ...mentioned];
  if (input.isReply) {
    candidates.push(
      ...(await threadParticipants(input.documentId, input.threadId)),
    );
  }

  // Mentions are caller-supplied and thread rows are historical; re-check both
  // against the document's live ACL before mailing anyone its contents.
  const allowed = await filterRecipientsByResourceAccess({
    resourceType: "document",
    resourceId: input.documentId,
    emails: candidates,
    orgId: input.orgId,
  });

  const actor = input.authorName?.trim() || input.authorEmail;
  const url = documentUrl(input.documentId);

  return notifyActivity({
    candidates: allowed,
    actorEmail: input.authorEmail,
    preferenceKey: CONTENT_USER_PREFS_KEY,
    logLabel: LOG_LABEL,
    send: async (to) => {
      const wasMentioned = mentioned.has(to);
      await sendEmail({
        ...renderDocumentCommentEmail({
          actor,
          title,
          url,
          content: input.content,
          isReply: input.isReply,
          wasMentioned,
        }),
        to,
        templateId: wasMentioned
          ? CONTENT_DOCUMENT_MENTION_EMAIL_ID
          : CONTENT_DOCUMENT_COMMENT_EMAIL_ID,
      });
    },
  });
}
