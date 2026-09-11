/**
 * Catalog entries for the transactional emails Plan sends.
 *
 * Registered from `server/plugins/transactional-emails.ts` so Dispatch can list
 * and preview them without the app having sent anything yet.
 */

import { defineTransactionalEmail } from "@agent-native/core/email-catalog";

import {
  PLAN_ACCESS_REQUEST_EMAIL_ID,
  renderPlanAccessRequestEmail,
} from "../../actions/request-plan-access.js";
import {
  PLAN_COMMENT_EMAIL_ID,
  renderPlanCommentEmail,
} from "./comment-notifications.js";

let registered = false;

export function registerPlanEmails(): void {
  if (registered) return;
  registered = true;

  defineTransactionalEmail({
    id: PLAN_COMMENT_EMAIL_ID,
    name: "Plan comment",
    trigger:
      "A human (never the agent) posts a comment or reply on a plan or recap. The subject changes for a reply and the body changes with why the recipient was picked; all variants send under this id.",
    recipientLabel: "Owner, mentions, authors",
    recipient:
      "The plan owner, everyone mentioned in the comment, and — for a reply — every other human author in the same thread. The comment's own author, synthetic QA addresses, and the owner when the comment mentions the source author are all dropped. One email per remaining address.",
    senderLabel: "Default sender",
    sender:
      "The configured default sender. This call site sets no `from`, `fromName`, `replyTo`, or `appSender`.",
    preview: () =>
      renderPlanCommentEmail({
        actor: "Sam Rivera",
        app: "Agent-Native Plan",
        planTitle: "Checkout rewrite",
        planUrl: "https://example.com/plans/plan_sample",
        message: "Can we split the migration into two deploys?",
        isReply: false,
        reason: "plan-owner",
      }),
  });

  defineTransactionalEmail({
    id: PLAN_ACCESS_REQUEST_EMAIL_ID,
    name: "Plan access request",
    trigger:
      "A signed-in user who cannot resolve access calls `request-plan-access` on a private plan URL. Skipped when email is not configured or the requester is the owner.",
    recipientLabel: "Plan owner",
    recipient:
      "The plan's `ownerEmail` column. Anonymous public viewers and guest author identities cannot reach this path.",
    senderLabel: "Default sender",
    sender:
      "The configured default sender. This call site sets no `from`, `fromName`, `replyTo`, or `appSender`, so the owner cannot reply straight to the requester.",
    preview: () =>
      renderPlanAccessRequestEmail({
        requesterName: "Sam Rivera",
        requesterEmail: "sam.rivera@example.com",
        planTitle: "Checkout rewrite",
        url: "https://example.com/plans/plan_sample",
      }),
  });
}
