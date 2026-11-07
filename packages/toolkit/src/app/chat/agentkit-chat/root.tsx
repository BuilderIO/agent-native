import { describeModelForEngine } from "@agent-native/core/agent/model-catalog";
import {
  getAgentNativeAgentKitUploadDriver,
  clearAgentNativeAgentKitUploads,
} from "@agent-native/core/client/agentkit-chat/transport";
import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { readFileUploadStatus } from "@agent-native/core/client/uploads";
import { useSession } from "@agent-native/core/client/use-session";
import { useMemo, useEffect } from "react";

import { CoreFileStorageSetupContext } from "../../agentkit/react/core-file-storage.js";
import { AgentKitRoot } from "../../agentkit/react/root.js";
import type { AgentKitRootProps } from "../../agentkit/react/root.js";
import { FileStorageSetupPopover } from "../FileStorageSetupPopover.js";
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
  const nativeUpload = props.transport
    ? getAgentNativeAgentKitUploadDriver(props.transport)
    : undefined;
  const { session } = useSession();
  const scopeKey = JSON.stringify([
    session?.email ?? null,
    session?.orgId ?? null,
    session?.authUserId ?? null,
  ]);
  const storageScope = useMemo(
    () =>
      nativeUpload
        ? {
            scopeKey,
            readStatus: readFileUploadStatus,
            Setup: FileStorageSetupPopover,
          }
        : null,
    [nativeUpload, scopeKey],
  );
  useEffect(
    () => () => {
      if (props.transport) clearAgentNativeAgentKitUploads(props.transport);
    },
    [props.transport, scopeKey],
  );
  const upload = useMemo(
    () =>
      nativeUpload
        ? async (...args: Parameters<typeof nativeUpload>) => {
            try {
              await nativeUpload(...args);
            } catch (cause) {
              const code =
                cause && typeof cause === "object" && "code" in cause
                  ? cause.code
                  : undefined;
              const key =
                code === "upload_builder_oauth_reauthorization_required"
                  ? "agentChat.composer.uploadBuilderReconnect"
                  : code === "upload_too_large"
                    ? "agentChat.composer.fileTooLarge"
                    : code === "upload_session_expired"
                      ? "agentChat.composer.sessionExpired"
                      : code === "upload_unsupported_type"
                        ? "agentChat.composer.unsupportedFileType"
                        : code === "upload_network_error"
                          ? "agentChat.composer.uploadOffline"
                          : code === "upload_unavailable"
                            ? "agentChat.composer.uploadUnavailable"
                            : "agentChat.composer.uploadFailed";
              throw Object.assign(new Error(t(key, { size: 25 }), { cause }), {
                code,
                ...(cause && typeof cause === "object" && "status" in cause
                  ? { status: cause.status }
                  : {}),
                ...(cause && typeof cause === "object" && "retryable" in cause
                  ? { retryable: cause.retryable }
                  : {}),
              });
            }
          }
        : undefined,
    [nativeUpload, t],
  );
  const clientOptions = useMemo(
    () => ({
      ...props.clientOptions,
      ...(!props.clientOptions?.upload && upload ? { upload } : {}),
    }),
    [props.clientOptions, upload],
  );
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
  const rootProps: AgentKitRootProps = props.controller
    ? props
    : { ...props, clientOptions };
  return (
    <CoreFileStorageSetupContext.Provider value={storageScope}>
      <AgentKitRoot
        {...rootProps}
        slots={slots}
        labels={labels}
        loadRunUsage={props.loadRunUsage ?? loadCoreRunUsage}
        formatModelName={props.formatModelName ?? coreModelDisplayName}
      />
    </CoreFileStorageSetupContext.Provider>
  );
}
