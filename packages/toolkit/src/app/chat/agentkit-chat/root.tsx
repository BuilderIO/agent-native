import { describeModelForEngine } from "@agent-native/core/agent/model-catalog";
import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useMemo } from "react";

import { AgentKitRoot } from "../../agentkit/react/root.js";
import type { AgentKitRootProps } from "../../agentkit/react/root.js";
import { AgentKitActionWidget } from "./action-widget.js";
import { CoreAgentKitApproval } from "./approval-card.js";
import { agentKitWorkStepLabels } from "./work-step-labels.js";

// Every agent-native app serves this framework action, so run details can
// show credits and the model that ran without each host wiring a loader.
const loadCoreRunUsage: NonNullable<
  AgentKitRootProps["loadRunUsage"]
> = async ({ runId, signal }) => {
  const run = await callAction<undefined, "get-usage-run">(
    "get-usage-run",
    { runId, scope: "me" },
    { method: "GET", signal },
  );
  if (!run) return null;
  // The usage store reports "unknown" when no call recorded a model.
  return { ...run, model: run.model === "unknown" ? null : run.model };
};

/** The catalog's short name, or the id itself for a model it does not know. */
function coreModelDisplayName(model: string): string {
  return describeModelForEngine(model).shortName ?? model;
}

export function CoreAgentKitRoot(props: AgentKitRootProps) {
  const t = useT();
  const slots = useMemo(
    () => ({
      ...props.slots,
      widget: props.slots?.widget ?? AgentKitActionWidget,
      approval: props.slots?.approval ?? CoreAgentKitApproval,
    }),
    [props.slots],
  );
  // Thread-load states, the empty greeting, the default approval card and the
  // reply footer render for any host, so their copy is localized here rather
  // than left to each host.
  const labels = useMemo(
    () => ({
      threadUnavailable: t("agentChat.message.threadNotFound"),
      threadLoadFailed: t("agentChat.message.threadLoadFailed"),
      threadLoadRetry: t("agentChat.common.retry"),
      newChat: t("agentChat.tabs.newChat"),
      loadingConversation: t("agentChat.empty.loadingChat"),
      emptyStateText: t("agentChat.empty.prompt"),
      composerPlaceholder: t("agentChat.composer.newChatPlaceholder"),
      composerReplyPlaceholder: t("agentChat.composer.replyPlaceholder"),
      worked: t("agentChat.tool.worked"),
      workedFor: t("agentChat.tool.workedFor", { duration: "{{duration}}" }),
      showMoreActivities: t("agentChat.activity.showMore", {
        count: "{{count}}",
      }),
      ...agentKitWorkStepLabels(t),
      approvalApprove: t("agentChat.approval.approve"),
      approvalDeny: t("agentChat.approval.deny"),
      approvalSubmit: t("agentChat.approval.submit"),
      approvalOther: t("agentChat.approval.other"),
      approvalOtherPlaceholder: t("agentChat.approval.otherPlaceholder"),
      approvalPending: t("agentChat.approval.pending"),
      approvalAnswerPending: t("agentChat.approval.answerPending"),
      messageActions: t("agentChat.message.actions"),
      moreMessageActions: t("agentChat.message.moreActions"),
      fewerMessageActions: t("agentChat.message.fewerActions"),
      copyRequestId: t("agentChat.message.copyRequestId"),
      copy: t("agentChat.message.copyMessage"),
      copied: t("agentChat.common.copied"),
      runDetails: t("agentChat.message.runDetails"),
      runCreditsUsed: t("agentChat.message.creditsUsed"),
      runCost: t("agentChat.message.cost"),
      runToolCalls: t("agentChat.message.toolCalls"),
      runModel: t("agentChat.message.modelUsed"),
      runDetailUnavailable: t("agentChat.message.detailUnavailable"),
      runDetailNotRecorded: t("agentChat.message.notRecorded"),
      runDetailIncomplete: t("agentChat.message.incomplete"),
      runDetailEstimated: t("agentChat.message.estimatedAmount", {
        amount: "{{amount}}",
      }),
      runDetailMixed: t("agentChat.message.mixedAmount", {
        amount: "{{amount}}",
      }),
      regenerateResponse: t("agentChat.common.retry"),
      suggestedActions: t("agentChat.composer.suggestedActions"),
      fork: t("agentChat.message.forkChat"),
      editMessage: t("agentChat.message.edit"),
      editingMessage: t("agentChat.message.editing"),
      editingMessageHint: t("agentChat.message.editingHint"),
      cancelEditing: t("agentChat.common.cancel"),
      feedback: t("agentChat.feedback.label"),
      feedbackGood: t("agentChat.feedback.goodResponse"),
      feedbackBad: t("agentChat.feedback.badResponse"),
      rateResponse: t("agentChat.feedback.rate"),
      forkFromHere: t("agentChat.message.forkFromHere"),
      feedbackNote: t("agentChat.feedback.note"),
      feedbackSubmit: t("agentChat.feedback.submit"),
      feedbackSubmitted: t("agentChat.feedback.submitted"),
      runFailed: t("agentChat.error.failed"),
      continueRun: t("agentChat.common.continue"),
      continueRunUnavailable: t("agentChat.recovery.continueUnavailable"),
      reconnect: t("agentChat.common.reconnect"),
      dismissNotice: t("agentChat.common.dismiss"),
      ...props.labels,
    }),
    [props.labels, t],
  );
  return (
    <AgentKitRoot
      {...props}
      slots={slots}
      labels={labels}
      loadRunUsage={props.loadRunUsage ?? loadCoreRunUsage}
      formatModelName={props.formatModelName ?? coreModelDisplayName}
    />
  );
}
