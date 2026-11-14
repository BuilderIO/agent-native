import type { useFormatters, useT } from "@agent-native/core/client/i18n";

import type { AgentKitLabels } from "../../agentkit/react/context.js";
import {
  agentKitQuestionLabels,
  agentKitWorkStepLabels,
} from "./work-step-labels.js";

/** Both Chat roots, the sidebar and the /chat route, spread these labels. */
export function agentKitChatLabels(
  t: ReturnType<typeof useT>,
  formatDate: ReturnType<typeof useFormatters>["formatDate"],
): Partial<AgentKitLabels> {
  return {
    conversation: t("agentChat.message.messages"),
    assistant: t("agentChat.common.agent"),
    you: t("agentChat.common.you"),
    approvalApprove: t("agentChat.approval.approve"),
    approvalDeny: t("agentChat.approval.deny"),
    approvalSubmit: t("agentChat.approval.submit"),
    approvalOther: t("agentChat.approval.other"),
    approvalOtherPlaceholder: t("agentChat.approval.otherPlaceholder"),
    approvalPending: t("agentChat.approval.pending"),
    approvalAnswerPending: t("agentChat.approval.answerPending"),
    connectionConnect: t("agentChat.common.connect"),
    connectionConnecting: t("agentChat.connection.connecting"),
    connectionRetry: t("agentChat.common.retry"),
    connectionConnected: t("agentChat.integrations.connectedSection"),
    connectionNotNow: t("agentChat.connection.notNow"),
    connectionFailed: t("agentChat.connection.failed"),
    connectionAdminRequired: t("agentChat.connection.adminRequired"),
    activities: t("agentChat.activity.groupLabel"),
    activityBuckets: {
      thinking: t("agentChat.activity.bucketThinking"),
      research: t("agentChat.activity.bucketResearch"),
      actions: t("agentChat.activity.bucketActions"),
      other: t("agentChat.activity.bucketOther"),
    },
    agents: t("agentChat.activity.agents"),
    tasks: t("agentChat.activity.tasks"),
    tasksProgress: t("agentChat.activity.tasksProgress", {
      completed: "{{completed}}",
      total: "{{total}}",
    }),
    toolInput: t("agentChat.tool.input"),
    toolResult: t("agentChat.tool.result"),
    activityValueIdentifierHidden: t("agentChat.tool.identifierHidden"),
    activityValueOmitted: t("agentChat.tool.contentOmitted"),
    activityValueCircular: t("agentChat.tool.circularReference"),
    working: t("agentChat.status.working"),
    workingFor: t("agentChat.status.workingFor", {
      duration: "{{duration}}",
    }),
    worked: t("agentChat.tool.worked"),
    workedFor: t("agentChat.tool.workedFor", { duration: "{{duration}}" }),
    showMoreActivities: t("agentChat.activity.showMore", {
      count: "{{count}}",
    }),
    ...agentKitWorkStepLabels(t),
    ...agentKitQuestionLabels(t),
    durationHourShort: t("agentChat.duration.hourShort"),
    durationMinuteShort: t("agentChat.duration.minuteShort"),
    durationSecondShort: t("agentChat.duration.secondShort"),
    composerLabel: t("agentChat.composer.messageAgent"),
    composerReplyPlaceholder: t("agentChat.composer.replyPlaceholder"),
    emptyStateText: t("agentChat.empty.prompt"),
    queue: t("agentChat.queue.label"),
    queueSendNow: t("agentChat.queue.sendNow"),
    queueSendNowHint: t("agentChat.queue.sendNowHint"),
    queueSendNext: t("agentChat.queue.sendNext"),
    queueSendNextHint: t("agentChat.queue.sendNextHint"),
    queueItemBusy: t("agentChat.queue.itemBusy"),
    queueItemBlocked: t("agentChat.queue.itemBlocked"),
    queueOrderStale: t("agentChat.queue.orderStale"),
    queueRemove: t("agentChat.queue.remove"),
    queueMore: t("agentChat.queue.moreActions"),
    suggestions: t("agentChat.composer.suggestedPrompts"),
    copy: t("agentChat.message.copyMessage"),
    copied: t("agentChat.common.copied"),
    messageActions: t("agentChat.message.actions"),
    copyRequestId: t("agentChat.message.copyRequestId"),
    usage: t("agentChat.message.usage"),
    usageLoading: t("agentChat.message.usageLoading"),
    usageUnavailable: t("agentChat.message.usageUnavailable"),
    usageNotRecorded: t("agentChat.message.usageNotRecorded"),
    usageIncomplete: t("agentChat.message.usageIncomplete"),
    usageReportedCost: t("agentChat.message.usageReportedCost", {
      amount: "{{amount}}",
    }),
    usageEstimatedCost: t("agentChat.message.usageEstimatedCost", {
      amount: "{{amount}}",
    }),
    usageMixedCost: t("agentChat.message.usageMixedCost", {
      amount: "{{amount}}",
    }),
    usageBuilderCredits: t("agentChat.message.usageBuilderCredits", {
      amount: "{{amount}}",
    }),
    usageEstimatedBuilderCredits: t(
      "agentChat.message.usageEstimatedBuilderCredits",
      { amount: "{{amount}}" },
    ),
    usageMixedBuilderCredits: t("agentChat.message.usageMixedBuilderCredits", {
      amount: "{{amount}}",
    }),
    requestIdUnavailable: t("agentChat.message.requestIdUnavailable"),
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
    suggestedActions: t("agentChat.composer.suggestedActions"),
    messageUnavailable: t("agentChat.message.unavailable"),
    navigationUnavailable: t("agentChat.message.navigationUnavailable"),
    copyUnavailable: t("agentChat.recovery.copyFailed"),
    positiveFeedback: t("agentChat.feedback.thumbsUp"),
    negativeFeedback: t("agentChat.feedback.notHelpful"),
    feedbackSubmitted: t("agentChat.feedback.submitted"),
    feedbackWhatWentWrong: t("agentChat.feedback.whatWentWrong"),
    feedbackPlaceholder: t("agentChat.feedback.placeholder"),
    feedbackKeyboardHint: t("agentChat.feedback.keyboardHint", {
      shortcut: "{{shortcut}}",
    }),
    feedbackSubmit: t("agentChat.feedback.submit"),
    feedbackReasonMisread: t("agentChat.feedback.reasonMisread"),
    feedbackReasonNotDone: t("agentChat.feedback.reasonNotDone"),
    feedbackReasonWrongNumbers: t("agentChat.feedback.reasonWrongNumbers"),
    feedbackReasonTooSlow: t("agentChat.feedback.tooSlow"),
    feedbackCopyDetails: t("agentChat.feedback.copyDetails"),
    feedback: t("agentChat.feedback.label"),
    feedbackGood: t("agentChat.feedback.goodResponse"),
    feedbackBad: t("agentChat.feedback.badResponse"),
    rateResponse: t("agentChat.feedback.rate"),
    forkFromHere: t("agentChat.message.forkFromHere"),
    feedbackNote: t("agentChat.feedback.note"),
    moreMessageActions: t("agentChat.message.moreActions"),
    fewerMessageActions: t("agentChat.message.fewerActions"),
    fork: t("agentChat.message.forkChat"),
    previousBranch: t("agentChat.message.previousBranch"),
    nextBranch: t("agentChat.message.nextBranch"),
    branchPosition: "{{index}}/{{count}}",
    error: t("agentChat.error.failed"),
    renderError: t("agentChat.error.render"),
    runFailed: t("agentChat.error.failed"),
    continueRun: t("agentChat.common.continue"),
    continueRunUnavailable: t("agentChat.recovery.continueUnavailable"),
    reconnect: t("agentChat.common.reconnect"),
    dismissNotice: t("agentChat.common.dismiss"),
    reasoning: t("agentChat.status.thinking"),
    expandActivity: t("agentChat.common.expand"),
    collapseActivity: t("agentChat.common.collapse"),
    agentStarted: t("agentChat.agent.started"),
    agentResumed: t("agentChat.agent.resumed"),
    agentMessaged: t("agentChat.agent.messaged"),
    agentDelegated: t("agentChat.agent.delegated"),
    agentWorking: t("agentChat.agent.working"),
    agentWorkedFor: t("agentChat.agent.workedFor", {
      duration: "{{duration}}",
    }),
    agentPaused: t("agentChat.agent.paused"),
    agentCompleted: t("agentChat.agent.completed"),
    agentFailed: t("agentChat.agent.failed"),
    agentClosed: t("agentChat.agent.closed"),
    editMessage: t("agentChat.message.edit"),
    editingMessage: t("agentChat.message.editing"),
    editingMessageHint: t("agentChat.message.editingHint"),
    cancelEditing: t("agentChat.common.cancel"),
    regenerateResponse: t("agentChat.common.retry"),
    expandMessage: t("agentChat.common.expand"),
    collapseMessage: t("agentChat.common.collapse"),
    previewAttachment: t("agentChat.composer.previewAttachment", {
      name: "{{name}}",
    }),
    pastedText: t("agentChat.pastedText.title"),
    attachmentNotSaved: t("agentChat.composer.attachmentNotSaved"),
    imagePreview: t("agentChat.composer.imagePreview"),
    closePreview: t("agentChat.composer.closePreview"),
    dropFilesToAttach: t("agentChat.composer.dropToAttach"),
    dropFileFailed: t("agentChat.composer.droppedFileError"),
    scrollToBottom: t("agentChat.composer.scrollToBottom"),
    skipToComposer: t("agentChat.composer.skipToMessageBox"),
    stop: t("agentChat.composer.stop"),
    copyCode: t("agentChat.message.copyCode"),
    codeCopied: t("agentChat.message.codeCopied"),
    codeBlock: t("agentChat.message.codeBlock"),
    codeBlockLanguage: t("agentChat.message.codeBlockLanguage", {
      language: "{{language}}",
    }),
    table: t("agentChat.message.table"),
    runStopped: t("agentChat.message.runStopped"),
    responseReady: t("agentChat.message.responseReady"),
    responseFailed: t("agentChat.message.responseFailed"),
    waitingForApproval: t("agentChat.message.waitingForApproval"),
    waitingForInput: t("agentChat.message.waitingForInput"),
    workSummaryFailedCount: t("agentChat.message.workSummaryFailedCount", {
      summary: "{{summary}}",
      count: "{{count}}",
    }),
    taskStatusPending: t("agentChat.message.taskStatusPending"),
    taskStatusRunning: t("agentChat.message.taskStatusRunning"),
    taskStatusCompleted: t("agentChat.message.taskStatusCompleted"),
    taskStatusFailed: t("agentChat.message.taskStatusFailed"),
    taskStatusAwaitingInput: t("agentChat.message.taskStatusAwaitingInput"),
    untitledTask: t("agentChat.message.untitledTask"),
    connectionConnectProvider: t("agentChat.message.connectProvider", {
      provider: "{{provider}}",
    }),
    connectionDeclined: t("agentChat.message.connectionDeclined", {
      provider: "{{provider}}",
    }),
    connectionAdminRequiredTitle: t(
      "agentChat.message.connectionAdminRequiredTitle",
      { provider: "{{provider}}" },
    ),
    branchPositionLabel: t("agentChat.message.branchPositionLabel", {
      index: "{{index}}",
      count: "{{count}}",
    }),
    taskListChecked: t("agentChat.message.taskListChecked"),
    taskListUnchecked: t("agentChat.message.taskListUnchecked"),
    threadUnavailable: t("agentChat.message.threadNotFound"),
    newChat: t("agentChat.tabs.newChat"),
    loadingConversation: t("agentChat.empty.loadingChat"),
    formatTimestamp: (createdAt: string) => {
      const date = new Date(createdAt);
      if (Number.isNaN(date.getTime())) return createdAt;
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const time = formatDate(date, {
        hour: "numeric",
        minute: "2-digit",
      });
      const sameDay = (left: Date, right: Date) =>
        left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate();
      if (sameDay(date, now)) return time;
      if (sameDay(date, yesterday)) {
        return `${t("agentChat.history.yesterday")} ${time}`;
      }
      return formatDate(date, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    },
  };
}
