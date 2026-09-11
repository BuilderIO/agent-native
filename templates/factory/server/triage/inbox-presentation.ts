import {
  metadataBoolean,
  metadataString,
  parseTriageMetadata,
  type TriageMetadata,
} from "./metadata.js";
import { babysitLeavesReviewWindow } from "./pr-babysit.js";
import {
  isClaimedSlackReactionName,
  slackFeedbackLeavesReviewWindow,
} from "./slack-review-window.js";

export type InboxPillTone =
  | "muted"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "progress";

export type InboxPill = {
  key: string;
  labelKey: string;
  tone: InboxPillTone;
  hintKey?: string;
};

export type InboxPresentation = {
  routing: InboxPill;
  automation: InboxPill | null;
  leavesReviewWindow: boolean;
};

const ROUTING_TONE: Record<string, InboxPillTone> = {
  needs_manual: "warning",
  automation_started: "progress",
  context_fetching: "info",
  failed: "danger",
  reconciliation_required: "danger",
  auto_approved: "success",
  merged: "success",
  resolved: "success",
  reviewed: "success",
};

const BABYSIT_PHASE: Record<
  string,
  { key: string; labelKey: string; tone: InboxPillTone }
> = {
  queued: {
    key: "babysit.queued",
    labelKey: "triage.inboxPhase.babysit.queued",
    tone: "progress",
  },
  waiting: {
    key: "babysit.waiting",
    labelKey: "triage.inboxPhase.babysit.waiting",
    tone: "info",
  },
  quiet: {
    key: "babysit.waiting",
    labelKey: "triage.inboxPhase.babysit.waiting",
    tone: "info",
  },
  defer: {
    key: "babysit.builder_active",
    labelKey: "triage.inboxPhase.babysit.builder_active",
    tone: "muted",
  },
  stuck: {
    key: "babysit.stuck",
    labelKey: "triage.inboxPhase.babysit.stuck",
    tone: "danger",
  },
  clean: {
    key: "babysit.clean",
    labelKey: "triage.inboxPhase.babysit.clean",
    tone: "success",
  },
  "closed-or-draft": {
    key: "babysit.ineligible",
    labelKey: "triage.inboxPhase.babysit.ineligible",
    tone: "muted",
  },
  "out-of-scope": {
    key: "babysit.ineligible",
    labelKey: "triage.inboxPhase.babysit.ineligible",
    tone: "muted",
  },
};

export function deriveInboxPresentation(input: {
  source: string;
  status: string;
  metadataJson: string;
}): InboxPresentation {
  const metadata = parseTriageMetadata(input.metadataJson);
  return {
    routing: resolveRoutingPill(input.status),
    automation: resolveAutomationPill(input.source, input.status, metadata),
    leavesReviewWindow: resolveLeavesReviewWindow({
      source: input.source,
      status: input.status,
      metadata,
    }),
  };
}

function resolveRoutingPill(status: string): InboxPill {
  const normalized = status.trim().toLowerCase();
  return {
    key: `routing.${normalized || "unknown"}`,
    labelKey: `triage.inboxRouting.${normalized || "unknown"}`,
    tone: ROUTING_TONE[normalized] ?? "muted",
  };
}

function resolveAutomationPill(
  source: string,
  status: string,
  metadata: TriageMetadata,
): InboxPill | null {
  if (source === "github") {
    return resolveGithubBabysitPhase(metadata);
  }
  if (source === "slack") {
    return resolveSlackFeedbackPhase(status, metadata);
  }
  return null;
}

function resolveGithubBabysitPhase(metadata: TriageMetadata): InboxPill | null {
  const babysitState = metadataString(metadata, "prBabysitState");
  if (!babysitState) return null;
  const mapped = BABYSIT_PHASE[babysitState];
  if (!mapped) return null;
  const hintKey = metadataBoolean(metadata, "prBabysitPendingReopen")
    ? "triage.inboxPhase.babysit.reopened"
    : undefined;
  return hintKey ? { ...mapped, hintKey } : mapped;
}

function resolveSlackFeedbackPhase(
  status: string,
  metadata: TriageMetadata,
): InboxPill | null {
  const reaction = metadataString(metadata, "slackReactionName");
  if (isClaimedSlackReactionName(reaction)) {
    return {
      key: "slack.claimed",
      labelKey: "triage.inboxPhase.slack.claimed",
      tone: "info",
    };
  }
  if (status === "automation_started") {
    return {
      key: "slack.agent_running",
      labelKey: "triage.inboxPhase.slack.agent_running",
      tone: "progress",
    };
  }
  if (status === "evidence_ready") {
    return {
      key: "slack.evidence_ready",
      labelKey: "triage.inboxPhase.slack.evidence_ready",
      tone: "info",
    };
  }
  if (status === "needs_manual") {
    return {
      key: "slack.needs_human",
      labelKey: "triage.inboxPhase.slack.needs_human",
      tone: "warning",
    };
  }
  const disposition = metadataString(metadata, "slackDisposition");
  if (disposition) {
    return {
      key: "slack.disposition",
      labelKey: "triage.inboxPhase.slack.disposition",
      tone: "info",
    };
  }
  if (
    status === "received" &&
    metadataString(metadata, "slackBuilderReplyAt")
  ) {
    return {
      key: "slack.builder_notified",
      labelKey: "triage.inboxPhase.slack.builder_notified",
      tone: "info",
    };
  }
  if (status === "received") {
    return {
      key: "slack.new",
      labelKey: "triage.inboxPhase.slack.new",
      tone: "muted",
    };
  }
  return null;
}

export function resolveLeavesReviewWindow(input: {
  source: string;
  status: string;
  metadata: TriageMetadata;
}): boolean {
  if (input.source === "github") {
    return babysitLeavesReviewWindow(
      metadataString(input.metadata, "prBabysitState"),
    );
  }
  if (input.source === "slack") {
    return slackFeedbackLeavesReviewWindow({
      status: input.status,
      slackReactionName: metadataString(input.metadata, "slackReactionName"),
    });
  }
  return false;
}
