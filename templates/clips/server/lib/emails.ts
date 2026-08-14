/**
 * Catalog entries for the transactional emails Clips sends.
 *
 * Registered from `server/plugins/transactional-emails.ts` so Dispatch can list
 * and preview them without the app having sent anything yet.
 *
 * Every entry except the organization invite renders through
 * `renderClipsTransactionalEmail`, so a preview shows the real template rather
 * than a copy of it.
 */

import { defineTransactionalEmail } from "@agent-native/core/email-catalog";

import { renderClipsInviteEmail } from "../../actions/invite-member.js";
import {
  CLIPS_ACCESS_REQUEST_EMAIL_ID,
  renderRecordingAccessRequestEmail,
} from "../../actions/request-recording-access.js";
import {
  CLIPS_ACTIVITY_COMMENT_EMAIL_ID,
  CLIPS_ACTIVITY_REACTION_EMAIL_ID,
  CLIPS_FIRST_AGENT_VIEW_EMAIL_ID,
  CLIPS_FIRST_IMPORT_EMAIL_ID,
  CLIPS_FIRST_VIEW_EMAIL_ID,
  CLIPS_MONTHLY_RECAP_EMAIL_ID,
  CLIPS_TWO_CLIPS_EMAIL_ID,
  CLIPS_UNVIEWED_REMINDER_EMAIL_ID,
  renderClipsTransactionalEmail,
  type ClipsTransactionalEmailInput,
  type ClipsTransactionalEmailRenderOptions,
} from "./transactional-email-templates.js";

/** Obviously-fake sample data — these render in a preview pane, never send. */
const PREVIEW_OPTIONS: ClipsTransactionalEmailRenderOptions = {
  appUrl: "https://example.com",
};
const SAMPLE_RECORDING_ID = "rec_sample";
const SAMPLE_TITLE = "Onboarding walkthrough";
const SAMPLE_TO = "sam.rivera@example.com";

function preview(input: ClipsTransactionalEmailInput) {
  return renderClipsTransactionalEmail(input, PREVIEW_OPTIONS);
}

export const CLIPS_ORGANIZATION_INVITE_EMAIL_ID = "clips.organization-invite";

/**
 * How the shared Clips sender resolves From and Reply-To for every kind it
 * renders, so each entry can say so without restating the mechanism.
 */
const CLIPS_SENDER =
  'From is the configured EMAIL_FROM with the display name "Agent-Native Clips"; on first-party agent-native.com deployments it becomes clips@agent-native.com. Reply-to is hello@agent-native.com.';

let registered = false;

export function registerClipsEmails(): void {
  if (registered) return;
  registered = true;

  defineTransactionalEmail({
    id: CLIPS_ACCESS_REQUEST_EMAIL_ID,
    name: "Clip access request",
    trigger:
      "A signed-in viewer requests access to a private Clip from its public share page. One request is recorded per viewer and Clip.",
    recipientLabel: "Clip owner",
    recipient:
      "The owner of the private Clip. The in-app notification is stored even when email delivery is unavailable.",
    senderLabel: "Agent-Native Clips",
    sender: CLIPS_SENDER,
    preview: () =>
      renderRecordingAccessRequestEmail({
        requesterName: "Sam Rivera",
        requesterEmail: "sam.rivera@example.com",
        recordingTitle: SAMPLE_TITLE,
        url: "https://example.com/share/rec_sample",
      }),
  });

  defineTransactionalEmail({
    id: CLIPS_FIRST_VIEW_EMAIL_ID,
    name: "First view on a Clip",
    trigger:
      "The background transactional-email sweep finds the first counted view of a Clip by someone other than its owner, recorded after transactional email was switched on. One per Clip.",
    recipientLabel: "Clip owner",
    recipient:
      "The Clip's owner. Suppressed recipient addresses are skipped, and the send is dropped if the owner is no longer the recording's owner at send time.",
    senderLabel: "Agent-Native Clips",
    sender: CLIPS_SENDER,
    preview: () =>
      preview({
        kind: "first-view",
        to: SAMPLE_TO,
        recordingId: SAMPLE_RECORDING_ID,
        title: SAMPLE_TITLE,
        viewerEmail: "alex.chen@example.com",
      }),
  });

  defineTransactionalEmail({
    id: CLIPS_UNVIEWED_REMINDER_EMAIL_ID,
    name: "Unviewed Clip reminder",
    trigger:
      "A direct share is 48 hours old and the recipient still has no counted view of that Clip. Re-checked at send time, so a view in the meantime cancels it.",
    recipientLabel: "Shared-with address",
    recipient:
      "The address the Clip was directly shared with. Requires the share to still exist.",
    senderLabel: "Sharer via Clips",
    sender:
      'Same as the other Clips emails, except the display name becomes "<sharer> (via Agent-Native Clips)" and reply-to is the sharer\'s own address when it is a valid address, falling back to hello@agent-native.com.',
    preview: () =>
      preview({
        kind: "unviewed-reminder",
        to: SAMPLE_TO,
        recordingId: SAMPLE_RECORDING_ID,
        title: SAMPLE_TITLE,
        senderEmail: "dana.hill@example.com",
        senderName: "Dana Hill",
      }),
  });

  defineTransactionalEmail({
    id: CLIPS_FIRST_AGENT_VIEW_EMAIL_ID,
    name: "First agent read of a Clip",
    trigger:
      "An AI agent reads one of an owner's Clips for the first time since transactional email was switched on. One per owner, not per Clip.",
    recipientLabel: "Clip owner",
    recipient:
      "The owner of the Clip the agent read. Re-checked at send time against the owner's actual first agent view.",
    senderLabel: "Agent-Native Clips",
    sender: CLIPS_SENDER,
    preview: () =>
      preview({
        kind: "first-agent-view",
        to: SAMPLE_TO,
        recordingId: SAMPLE_RECORDING_ID,
        title: SAMPLE_TITLE,
        agentName: "Claude Code",
      }),
  });

  defineTransactionalEmail({
    id: CLIPS_FIRST_IMPORT_EMAIL_ID,
    name: "First imported video is ready",
    trigger:
      "An owner's first imported (rather than recorded) video finishes processing and becomes ready. One per owner.",
    recipientLabel: "Clip owner",
    recipient:
      "The owner of the imported recording, re-checked at send time so a later import does not resend.",
    senderLabel: "Agent-Native Clips",
    sender: CLIPS_SENDER,
    preview: () =>
      preview({
        kind: "first-import",
        to: SAMPLE_TO,
        recordingId: SAMPLE_RECORDING_ID,
        title: "Quarterly demo recording",
      }),
  });

  defineTransactionalEmail({
    id: CLIPS_MONTHLY_RECAP_EMAIL_ID,
    name: "Monthly Clips recap",
    trigger:
      "Once per owner per calendar month, from 14:00 UTC on the 1st, for owners whose Clips had any human views or agent reads in the closed month. Metrics and the top Clip are recomputed at send time.",
    recipientLabel: "Clip owner",
    recipient:
      "The Clip owner whose audience the recap reports. Suppressed addresses are skipped.",
    senderLabel: "Agent-Native Clips",
    sender: CLIPS_SENDER,
    preview: () =>
      preview({
        kind: "monthly-recap",
        to: SAMPLE_TO,
        month: "2025-02",
        humanViews: 42,
        agentSessions: 7,
        topClip: {
          recordingId: SAMPLE_RECORDING_ID,
          title: SAMPLE_TITLE,
          thumbnailUrl: "https://example.com/thumbnails/sample.png",
          durationMs: 214_000,
          recordedAt: "2025-02-11T16:00:00.000Z",
          humanViews: 18,
          agentSessions: 4,
        },
        copy: {
          heroLine: "Your clips were watched 42 times. 7 agents read them.",
          completionNote: "68% average completion · most stopped at 2:31",
          agentBreakdown: "4 from Claude Code · 3 unidentified",
        },
      }),
  });

  defineTransactionalEmail({
    id: CLIPS_TWO_CLIPS_EMAIL_ID,
    name: "Two Clips received",
    trigger:
      "A one-time nudge once someone who owns no Clips of their own has had two distinct Clips directly shared with them. The summary line is AI-generated before the job is released to send.",
    recipientLabel: "Shared-with address",
    recipient:
      "The shared-with address. Dropped at send time if they now own a Clip or no longer hold both shares.",
    senderLabel: "Agent-Native Clips",
    sender: CLIPS_SENDER,
    preview: () =>
      preview({
        kind: "two-clips",
        to: SAMPLE_TO,
        generatedSummary:
          "Two teammates walked you through the new onboarding flow.",
      }),
  });

  defineTransactionalEmail({
    id: CLIPS_ACTIVITY_COMMENT_EMAIL_ID,
    name: "Clip comment",
    trigger:
      "Someone comments or replies on a Clip. Subject and copy differ slightly for a reply; both send under this id.",
    recipientLabel: "Owner and thread authors",
    recipient:
      "The recording owner, plus every prior author in the thread when the comment is a reply. The list is re-checked against the recording's live ACL and filtered by each user's `emailNotifications` preference; the comment's own author never receives it.",
    senderLabel: "Agent-Native Clips",
    sender: CLIPS_SENDER,
    preview: () =>
      preview({
        kind: "activity-comment",
        to: SAMPLE_TO,
        recordingId: SAMPLE_RECORDING_ID,
        title: SAMPLE_TITLE,
        authorEmail: "alex.chen@example.com",
        authorName: "Alex Chen",
        content: "The step at 1:20 is the part new hires always miss.",
        videoTimestampMs: 80_000,
        isReply: false,
      }),
  });

  defineTransactionalEmail({
    id: CLIPS_ACTIVITY_REACTION_EMAIL_ID,
    name: "Clip reaction",
    trigger: "A viewer reacts with an emoji on a Clip.",
    recipientLabel: "Clip owner",
    recipient:
      "The recording owner plus any extra recipients the caller passes, re-checked against the recording's live ACL and filtered by each user's `emailNotifications` preference. The reacting viewer never receives it.",
    senderLabel: "Agent-Native Clips",
    sender: CLIPS_SENDER,
    preview: () =>
      preview({
        kind: "activity-reaction",
        to: SAMPLE_TO,
        recordingId: SAMPLE_RECORDING_ID,
        title: SAMPLE_TITLE,
        emoji: "🎉",
        authorEmail: "alex.chen@example.com",
        authorName: "Alex Chen",
        videoTimestampMs: 45_000,
      }),
  });

  defineTransactionalEmail({
    id: CLIPS_ORGANIZATION_INVITE_EMAIL_ID,
    name: "Organization invitation",
    trigger:
      "An organization admin runs `invite-member`. Any earlier pending invite for the same address is cancelled first, so a re-invite sends a fresh email with a new token.",
    recipientLabel: "Invited address",
    recipient:
      "The address passed to the action, exactly as typed. One email per invite.",
    senderLabel: "Default sender",
    sender:
      "The configured default sender. This call site sets no `from`, `fromName`, `replyTo`, or `appSender`, so unlike the other Clips emails it does not send as Agent-Native Clips.",
    preview: () =>
      renderClipsInviteEmail({
        appName: "Clips",
        orgName: "Northwind Design",
        inviter: "dana.hill@example.com",
        role: "member",
        inviteUrl: "https://example.com/invite/sample-token",
      }),
  });
}
