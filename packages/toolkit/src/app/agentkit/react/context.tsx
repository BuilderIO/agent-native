import {
  hasActiveAgentRuns,
  selectActiveAgentRoster,
  type AgentKitController,
  type AgentKitSnapshot,
  type AgentKitSteerQueuedMessageOptions,
  type AgentThreadState,
  type SendMessageInput,
} from "@agent-native/agentkit/client";
import type {
  AgentActivity,
  AgentApprovalRequest,
  AgentApprovalResponse,
  AgentConnectionRequest,
  AgentConnectionResponse,
  AgentCapabilities,
  AgentCapabilityAffordance,
  AgentCapabilityId,
  AgentError,
  AgentInteraction,
  AgentMessage,
  AgentMessagePart,
  AgentObjectReference,
  AgentParticipant,
  AgentQueuedMessage,
  AgentSuggestion,
  AgentTask,
  AgentThread,
  AgentToolCall,
  AgentWorkScope,
  AgentWidget,
  RunId,
  ThreadId,
} from "@agent-native/agentkit/protocol";
import { resolveAgentCapabilityAffordance } from "@agent-native/agentkit/protocol";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";

import type { AgentChatDataChartLayout } from "./data-chart-layout.js";
import type { AgentMessageContentOrderResolver } from "./message-content-order.js";
import {
  AGENTKIT_CLIENT_REQUEST_ID_METADATA_KEY,
  agentKitClientRequestId,
  agentKitPendingSubmissions,
  visiblePendingSubmissions,
  type AgentKitPendingSubmission,
  type AgentKitPendingSubmissionDraft,
} from "./pending-submissions.js";
import { withAgentKitQueueErrorCopy } from "./queue-error-copy.js";
import type { AgentChatWorkedForRowLayout } from "./transcript-layout.js";

export interface AgentKitRenderProps<T> {
  value: T;
  threadId: ThreadId;
  /** True while this part belongs to the actively streaming run. */
  active?: boolean;
  /** Stable key a renderer can use to reset state between streamed parts. */
  resetKey?: string;
}

export interface AgentRunFailureRenderProps {
  error: AgentError;
  runId: RunId;
  threadId: ThreadId;
}

export interface AgentKitRegionRenderProps {
  children: ReactNode;
  threadId: ThreadId;
}

export interface AgentKitQueueRenderProps {
  items: AgentQueuedMessage[];
  threadId: ThreadId;
  active: boolean;
  pending: boolean;
  onSteer?: (message: AgentQueuedMessage) => void;
  onRemove: (message: AgentQueuedMessage) => void;
}

export interface AgentKitSuggestionsRenderProps {
  suggestions: AgentSuggestion[];
  threadId: ThreadId;
  pending: boolean;
  onSelect: (suggestion: AgentSuggestion) => void;
}

export interface AgentKitWorkedForSummaryRenderProps {
  label: string;
  running?: boolean;
  expandable: boolean;
  open: boolean;
  current?: ReactNode;
  layout?: AgentChatWorkedForRowLayout;
}

export interface AgentConnectionErrorRenderProps {
  error: AgentError;
  threadId: ThreadId;
  recover: () => Promise<unknown>;
  recovering: boolean;
  recoveryError?: Error;
  /** Hides this error until the connection fails again. */
  dismiss: () => void;
}

export type AgentKitRenderSurface =
  | "header"
  | "message"
  | "activity"
  | "task"
  | "approval"
  | "connection-request"
  | "connection-error"
  | "composer"
  | (string & {});

export interface AgentKitRenderFailure {
  error: Error;
  surface: AgentKitRenderSurface;
  threadId: ThreadId;
  componentStack?: string;
}

export interface AgentKitSlots {
  header?: ComponentType<AgentKitRegionRenderProps>;
  toolbar?: ComponentType<AgentKitRegionRenderProps>;
  transcript?: ComponentType<AgentKitRegionRenderProps>;
  footer?: ComponentType<AgentKitRegionRenderProps>;
  message?: ComponentType<AgentKitRenderProps<AgentMessage>>;
  /** Host-owned contextual UI rendered after message content and before actions. */
  messageSupplement?: ComponentType<AgentKitRenderProps<AgentMessage>>;
  messageActions?: ComponentType<AgentKitRenderProps<AgentMessage>>;
  /** Host-owned actions aligned with the trailing message-action group. */
  messageActionsTrailing?: ComponentType<AgentKitRenderProps<AgentMessage>>;
  text?: ComponentType<
    AgentKitRenderProps<Extract<AgentMessagePart, { type: "text" }>>
  >;
  reasoning?: ComponentType<
    AgentKitRenderProps<Extract<AgentMessagePart, { type: "reasoning" }>>
  >;
  citation?: ComponentType<
    AgentKitRenderProps<Extract<AgentMessagePart, { type: "citation" }>>
  >;
  annotation?: ComponentType<
    AgentKitRenderProps<Extract<AgentMessagePart, { type: "annotation" }>>
  >;
  file?: ComponentType<
    AgentKitRenderProps<Extract<AgentMessagePart, { type: "file" }>>
  >;
  data?: ComponentType<
    AgentKitRenderProps<Extract<AgentMessagePart, { type: "data" }>>
  >;
  object?: ComponentType<AgentKitRenderProps<AgentObjectReference>>;
  agent?: ComponentType<AgentKitRenderProps<AgentParticipant>>;
  agentInteraction?: ComponentType<AgentKitRenderProps<AgentInteraction>>;
  activity?: ComponentType<AgentKitRenderProps<AgentActivity>>;
  task?: ComponentType<AgentKitRenderProps<AgentTask>>;
  tool?: ComponentType<AgentKitRenderProps<AgentToolCall>>;
  widget?: ComponentType<AgentKitRenderProps<AgentWidget>>;
  approval?: ComponentType<
    AgentKitRenderProps<AgentApprovalRequest> & { runId: string }
  >;
  connectionRequest?: ComponentType<
    AgentKitRenderProps<AgentConnectionRequest> & { runId: string }
  >;
  runFailure?: ComponentType<AgentRunFailureRenderProps>;
  connectionError?: ComponentType<AgentConnectionErrorRenderProps>;
  emptyState?: ComponentType<{ threadId: ThreadId }>;
  /** Replaces the region shown when a thread the host expected to exist is missing. */
  threadUnavailable?: ComponentType<{ threadId: ThreadId }>;
  composer?: ComponentType<{ threadId: ThreadId }>;
  queue?: ComponentType<AgentKitQueueRenderProps>;
  suggestions?: ComponentType<AgentKitSuggestionsRenderProps>;
  /** Replaces the visible work-summary row while the shared disclosure owns its semantics. */
  workedForSummary?: ComponentType<AgentKitWorkedForSummaryRenderProps>;
}

export interface AgentKitToolSource {
  id: string;
  icon: ReactNode;
}

export interface AgentKitRegistry {
  /** Resolve the same source identity and badge for live and historical tool activity. */
  toolSource?: (tool: AgentToolCall) => AgentKitToolSource | undefined;
  widgets?: Record<string, ComponentType<AgentKitRenderProps<AgentWidget>>>;
  tools?: Record<string, ComponentType<AgentKitRenderProps<AgentToolCall>>>;
  activities?: Record<
    string,
    ComponentType<AgentKitRenderProps<AgentActivity>>
  >;
  agents?: Record<string, ComponentType<AgentKitRenderProps<AgentParticipant>>>;
  agentInteractions?: Record<
    string,
    ComponentType<AgentKitRenderProps<AgentInteraction>>
  >;
  tasks?: Record<string, ComponentType<AgentKitRenderProps<AgentTask>>>;
  messageParts?: Record<
    string,
    ComponentType<AgentKitRenderProps<AgentMessagePart>>
  >;
}

export interface AgentKitLabels {
  conversation: string;
  assistant: string;
  you: string;
  approvalApprove: string;
  approvalDeny: string;
  approvalSubmit: string;
  approvalOther: string;
  approvalOtherPlaceholder: string;
  approvalPending: string;
  approvalAnswerPending: string;
  connectionConnect: string;
  connectionConnecting: string;
  connectionConnected: string;
  connectionNotNow: string;
  connectionRetry: string;
  connectionFailed: string;
  connectionAdminRequired: string;
  activities: string;
  activityBuckets?: {
    thinking: string;
    research: string;
    actions: string;
    other: string;
  };
  working: string;
  workingFor: string;
  worked: string;
  workedFor: string;
  showMoreActivities: string;
  /** Work-step copy. One/Other pairs take {{count}}; pick by count === 1. */
  showMoreWorkStepsOne: string;
  showMoreWorkStepsOther: string;
  workStepMoreGroups: string;
  workStepMoreObjects: string;
  workStepSearchedOne: string;
  workStepSearchedOther: string;
  workStepReadPagesOne: string;
  workStepReadPagesOther: string;
  workStepFetchedOne: string;
  workStepFetchedOther: string;
  workStepReadFilesOne: string;
  workStepReadFilesOther: string;
  workStepEditedOne: string;
  workStepEditedOther: string;
  workStepRanCommandsOne: string;
  workStepRanCommandsOther: string;
  workStepRanActionsOne: string;
  workStepRanActionsOther: string;
  /** Takes {{tool}}, the tool's display name. */
  workStepUsedTool: string;
  workStepFailedCount: string;
  workStepSearching: string;
  workStepReadingPages: string;
  workStepFetching: string;
  workStepReadingFiles: string;
  workStepEditing: string;
  workStepRunningCommands: string;
  workStepRunningActions: string;
  durationHourShort: string;
  durationMinuteShort: string;
  durationSecondShort: string;
  agents: string;
  tasks: string;
  toolInput?: string;
  toolResult?: string;
  activityValueIdentifierHidden?: string;
  activityValueOmitted?: string;
  activityValueCircular?: string;
  composerLabel: string;
  composerPlaceholder: string;
  /** Placeholder once the thread has messages. */
  composerReplyPlaceholder?: string;
  /** Greeting the default empty state shows before the first message. */
  emptyStateText: string;
  queue: string;
  /** @deprecated Use queueSendNow. */
  queueSteer: string;
  /** @deprecated Use queueSendNowHint. */
  queueSteerHint: string;
  /** @deprecated Use queueSendNext. */
  queueMoveToTop: string;
  queueSendNow?: string;
  queueSendNowHint?: string;
  queueSendNext?: string;
  queueSendNextHint?: string;
  queueItemBusy?: string;
  queueItemBlocked?: string;
  queueOrderStale?: string;
  queueRemove: string;
  queueMore: string;
  suggestions: string;
  suggestedActions: string;
  copy: string;
  copied: string;
  messageActions: string;
  copyRequestId: string;
  usage: string;
  usageLoading: string;
  usageUnavailable: string;
  usageNotRecorded: string;
  usageIncomplete: string;
  usageReportedCost: string;
  usageEstimatedCost: string;
  usageMixedCost: string;
  usageBuilderCredits: string;
  usageEstimatedBuilderCredits: string;
  usageMixedBuilderCredits: string;
  requestIdUnavailable: string;
  runDetails: string;
  runCreditsUsed: string;
  runCost: string;
  runToolCalls: string;
  runModel: string;
  runDetailUnavailable: string;
  runDetailNotRecorded: string;
  runDetailIncomplete: string;
  runDetailEstimated: string;
  runDetailMixed: string;
  positiveFeedback: string;
  negativeFeedback: string;
  feedbackSubmitted: string;
  feedbackWhatWentWrong: string;
  feedbackPlaceholder: string;
  feedbackKeyboardHint: string;
  feedbackSubmit: string;
  feedbackReasonMisread: string;
  feedbackReasonNotDone: string;
  feedbackReasonWrongNumbers: string;
  feedbackReasonTooSlow: string;
  feedbackCopyDetails: string;
  feedback: string;
  feedbackGood: string;
  feedbackBad: string;
  rateResponse: string;
  forkFromHere: string;
  feedbackNote: string;
  moreMessageActions: string;
  fewerMessageActions: string;
  fork: string;
  previousBranch: string;
  nextBranch: string;
  branchPosition: string;
  copyUnavailable: string;
  messageUnavailable: string;
  navigationUnavailable: string;
  editMessage: string;
  editingMessage: string;
  editingMessageHint: string;
  cancelEditing: string;
  regenerateResponse: string;
  expandMessage: string;
  collapseMessage: string;
  previewAttachment: string;
  pastedText: string;
  attachmentNotSaved: string;
  imagePreview: string;
  closePreview: string;
  dropFilesToAttach: string;
  dropFileFailed: string;
  scrollToBottom: string;
  formatTimestamp?: (createdAt: string) => string;
  error: string;
  renderError: string;
  runFailed: string;
  continueRun: string;
  continueRunUnavailable: string;
  reconnect: string;
  /** Dismiss button on a composer notice. */
  dismissNotice: string;
  reasoning: string;
  expandActivity: string;
  collapseActivity: string;
  agentStarted: string;
  agentResumed: string;
  agentMessaged: string;
  agentDelegated: string;
  agentPaused: string;
  agentCompleted: string;
  agentFailed: string;
  agentClosed: string;
  stop: string;
  copyCode: string;
  codeCopied: string;
  codeBlock: string;
  codeBlockLanguage: string;
  table: string;
  runStopped: string;
  responseReady: string;
  responseFailed: string;
  waitingForApproval: string;
  waitingForInput: string;
  workSummaryFailedCount: string;
  taskStatusPending: string;
  taskStatusRunning: string;
  taskStatusCompleted: string;
  taskStatusFailed: string;
  taskStatusAwaitingInput: string;
  untitledTask: string;
  connectionConnectProvider: string;
  connectionDeclined: string;
  connectionAdminRequiredTitle: string;
  branchPositionLabel: string;
  taskListChecked: string;
  taskListUnchecked: string;
  threadUnavailable: string;
  threadLoadFailed: string;
  threadLoadRetry: string;
  newChat: string;
  loadingConversation: string;
}

export const defaultAgentKitLabels: ResolvedAgentKitLabels = {
  conversation: "Agent conversation",
  assistant: "Assistant",
  you: "You",
  approvalApprove: "Approve",
  approvalDeny: "Deny",
  approvalSubmit: "Submit",
  approvalOther: "Other",
  approvalOtherPlaceholder: "Type your answer",
  approvalPending: "Approval needed",
  approvalAnswerPending: "Answer needed",
  connectionConnect: "Connect",
  connectionConnecting: "Connecting…",
  connectionConnected: "Connected",
  connectionNotNow: "Not now",
  connectionRetry: "Try again",
  connectionFailed: "Connection failed",
  connectionAdminRequired: "Ask a workspace admin to connect this service.",
  activities: "Agent activity",
  activityBuckets: {
    thinking: "Thinking",
    research: "Research",
    actions: "Actions",
    other: "Other",
  },
  working: "Working",
  workingFor: "Working for {{duration}}",
  worked: "Worked",
  workedFor: "Worked for {{duration}}",
  showMoreActivities: "Show {{count}} more",
  showMoreWorkStepsOne: "Show 1 more step",
  showMoreWorkStepsOther: "Show {{count}} more steps",
  workStepMoreGroups: "+{{count}} more",
  workStepMoreObjects: "+{{count}}",
  workStepSearchedOne: "Searched 1 query",
  workStepSearchedOther: "Searched {{count}} queries",
  workStepReadPagesOne: "Read 1 page",
  workStepReadPagesOther: "Read {{count}} pages",
  workStepFetchedOne: "Fetched 1 URL",
  workStepFetchedOther: "Fetched {{count}} URLs",
  workStepReadFilesOne: "Read 1 file",
  workStepReadFilesOther: "Read {{count}} files",
  workStepEditedOne: "Edited 1 file",
  workStepEditedOther: "Edited {{count}} files",
  workStepRanCommandsOne: "Ran 1 command",
  workStepRanCommandsOther: "Ran {{count}} commands",
  workStepRanActionsOne: "Ran 1 action",
  workStepRanActionsOther: "Ran {{count}} actions",
  workStepUsedTool: "Used {{tool}}",
  workStepFailedCount: "{{count}} failed",
  workStepSearching: "Searching",
  workStepReadingPages: "Reading pages",
  workStepFetching: "Fetching URLs",
  workStepReadingFiles: "Reading files",
  workStepEditing: "Editing files",
  workStepRunningCommands: "Running commands",
  workStepRunningActions: "Running actions",
  durationHourShort: "h",
  durationMinuteShort: "m",
  durationSecondShort: "s",
  agents: "Agent collaboration",
  tasks: "Agent tasks",
  toolInput: "Input",
  toolResult: "Result",
  activityValueIdentifierHidden: "[Identifier hidden]",
  activityValueOmitted: "[Content omitted]",
  activityValueCircular: "[Circular reference]",
  composerLabel: "Message agent",
  composerPlaceholder: "Ask anything",
  composerReplyPlaceholder: "Reply…",
  emptyStateText: "How can I help you?",
  queue: "Queued messages",
  queueSteer: "Send now",
  queueSteerHint: "Sends this message at the agent's next step.",
  queueMoveToTop: "Send next",
  queueSendNow: "Send now",
  queueSendNowHint: "Sends this message at the agent's next step.",
  queueSendNext: "Send next",
  queueSendNextHint: "Send after the current response finishes",
  queueItemBusy: "This message sends after this reply.",
  queueItemBlocked:
    "This message couldn't be sent. Remove it and send it again.",
  queueOrderStale: "The queue changed. Try again.",
  queueRemove: "Remove queued message",
  queueMore: "More actions",
  suggestions: "Suggested next actions",
  suggestedActions: "Suggested actions",
  copy: "Copy message",
  copied: "Copied",
  messageActions: "Message actions",
  copyRequestId: "Copy request ID",
  usage: "Usage",
  usageLoading: "Loading usage…",
  usageUnavailable: "Usage unavailable",
  usageNotRecorded: "Usage not recorded",
  usageIncomplete: "Some usage could not be classified; totals are hidden.",
  usageReportedCost: "Cost {{amount}}",
  usageEstimatedCost: "Estimated cost {{amount}}",
  usageMixedCost: "Reported and estimated cost {{amount}}",
  usageBuilderCredits: "Builder credits used {{amount}}",
  usageEstimatedBuilderCredits: "Estimated Builder credits {{amount}}",
  usageMixedBuilderCredits: "Reported and estimated Builder credits {{amount}}",
  requestIdUnavailable: "Request ID unavailable",
  runDetails: "Run details",
  runCreditsUsed: "Credits used",
  runCost: "Cost",
  runToolCalls: "Tool calls",
  runModel: "Model used",
  runDetailUnavailable: "Unavailable",
  runDetailNotRecorded: "Not recorded",
  runDetailIncomplete: "Incomplete",
  runDetailEstimated: "{{amount}} estimated",
  runDetailMixed: "{{amount}} reported and estimated",
  positiveFeedback: "Helpful",
  negativeFeedback: "Not helpful",
  feedbackSubmitted: "Feedback submitted",
  feedbackWhatWentWrong: "What went wrong?",
  feedbackPlaceholder: "Describe what went wrong",
  feedbackKeyboardHint: "Press {{shortcut}}+Enter to submit",
  feedbackSubmit: "Submit feedback",
  feedbackReasonMisread: "Misread my ask",
  feedbackReasonNotDone: "Said done, but wasn't",
  feedbackReasonWrongNumbers: "Wrong numbers",
  feedbackReasonTooSlow: "Too slow",
  feedbackCopyDetails: "Copy details",
  feedback: "Feedback",
  feedbackGood: "Good response",
  feedbackBad: "Bad response",
  rateResponse: "Rate response",
  forkFromHere: "Fork from here",
  feedbackNote: "Add a note (optional)",
  moreMessageActions: "More actions",
  fewerMessageActions: "Fewer actions",
  fork: "Fork conversation",
  previousBranch: "Previous branch",
  nextBranch: "Next branch",
  branchPosition: "{{index}}/{{count}}",
  copyUnavailable: "Copying is unavailable in this browser.",
  messageUnavailable:
    "The message is no longer available in this conversation.",
  navigationUnavailable: "Conversation navigation is unavailable.",
  editMessage: "Edit message",
  editingMessage: "Editing message",
  editingMessageHint: "Sending forks the chat from this message.",
  cancelEditing: "Cancel",
  regenerateResponse: "Retry",
  expandMessage: "Expand",
  collapseMessage: "Collapse",
  previewAttachment: "Preview {{name}}",
  pastedText: "Pasted text",
  attachmentNotSaved: "Not saved with this chat",
  imagePreview: "Image preview",
  closePreview: "Close preview",
  dropFilesToAttach: "Drop files to attach",
  dropFileFailed: "Could not add the dropped file. Try a different format.",
  scrollToBottom: "Scroll to bottom",
  error: "Something went wrong",
  renderError: "This content couldn’t be displayed.",
  runFailed: "Run failed",
  continueRun: "Continue",
  continueRunUnavailable:
    "This run can't be continued anymore. Send a message to keep going.",
  reconnect: "Reconnect",
  dismissNotice: "Dismiss",
  reasoning: "Thinking",
  expandActivity: "Show activity details",
  collapseActivity: "Hide activity details",
  agentStarted: "started working",
  agentResumed: "resumed working",
  agentMessaged: "sent a message",
  agentDelegated: "delegated work",
  agentPaused: "paused",
  agentCompleted: "finished",
  agentFailed: "needs attention",
  agentClosed: "closed",
  stop: "Stop",
  copyCode: "Copy code",
  codeCopied: "Copied",
  codeBlock: "Code block",
  codeBlockLanguage: "{{language}} code",
  table: "Table",
  runStopped: "Stopped",
  responseReady: "Response ready",
  responseFailed: "Response failed",
  waitingForApproval: "Waiting for approval",
  waitingForInput: "Waiting for input",
  workSummaryFailedCount: "{{summary}}, {{count}} failed",
  taskStatusPending: "Pending",
  taskStatusRunning: "Running",
  taskStatusCompleted: "Done",
  taskStatusFailed: "Failed",
  taskStatusAwaitingInput: "Needs input",
  untitledTask: "Untitled task",
  connectionConnectProvider: "Connect {{provider}}",
  connectionDeclined: "{{provider}} not connected",
  connectionAdminRequiredTitle: "{{provider}} needs an admin",
  branchPositionLabel: "Response {{index}} of {{count}}",
  taskListChecked: "Completed",
  taskListUnchecked: "Not completed",
  threadUnavailable: "This chat thread is no longer available",
  threadLoadFailed: "Couldn't load this chat.",
  threadLoadRetry: "Retry",
  newChat: "New chat",
  loadingConversation: "Loading chat…",
};

export interface AgentKitBranchNavigation {
  /** One-based position of the active sibling branch. */
  index: number;
  count: number;
  onPrevious: () => void | Promise<void>;
  onNext: () => void | Promise<void>;
}

export type AgentKitCopyMessageHandler = (input: {
  message: AgentMessage;
  text: string;
}) => boolean | Promise<boolean>;

export interface AgentKitRunUsage {
  durationMs: number | null;
  /**
   * The model the run's calls reported, as an id. Null when no call recorded
   * one; undefined when the loader does not report models.
   */
  model?: string | null;
  billing: {
    providerCostUsd: number | null;
    providerCostSource: "reported" | "estimated" | "mixed" | null;
    builderCredits: number | null;
    builderCreditsSource: "reported" | "estimated" | "mixed" | null;
    incomplete: boolean;
  };
}

export type AgentKitRunUsageLoader = (input: {
  runId: RunId;
  signal: AbortSignal;
}) => Promise<AgentKitRunUsage | null>;

/**
 * The text behind "Copy details" in the thumbs-down popover: whatever lets
 * someone else open the exact run, plus the reader's note.
 */
export type AgentKitFeedbackReportBuilder = (input: {
  threadId: ThreadId;
  runId?: RunId;
  messageId: string;
  note: string;
}) => string;

export interface AgentKitProviderProps {
  controller: AgentKitController;
  threadId: ThreadId;
  slots?: AgentKitSlots;
  registry?: AgentKitRegistry;
  labels?: Partial<AgentKitLabels>;
  onOpenObject?: (object: AgentObjectReference) => void;
  onThreadForked?: (thread: AgentThread) => void;
  branchNavigation?: AgentKitBranchNavigation;
  onCopyMessage?: AgentKitCopyMessageHandler;
  buildFeedbackReport?: AgentKitFeedbackReportBuilder;
  loadRunUsage?: AgentKitRunUsageLoader;
  /**
   * Resolves a provider identifier through host-owned connection setup. The
   * callback, never the agent-authored request, owns OAuth URLs and scopes.
   */
  onConnectionRequest?: (
    request: AgentConnectionRequest,
  ) => Promise<AgentConnectionResponse>;
  /** Receives full renderer failures while the UI shows a safe fallback. */
  onRenderError?: (failure: AgentKitRenderFailure) => void;
  resolveMessageContentOrder?: AgentMessageContentOrderResolver;
  workedForRowLayout?: AgentChatWorkedForRowLayout;
  dataChartLayout?: AgentChatDataChartLayout;
  formatWorkedForDuration?: (durationMs: number) => string;
  /** Display name for a model id in run details; the id shows without it. */
  formatModelName?: (model: string) => string;
  onClientEffect?: (effect: {
    type: "client.effect" | "client.deeplink";
    name: string;
    data?: Record<string, unknown>;
  }) => void;
  /**
   * The outcome of the host's own thread load. Omit it when nothing tracks the
   * load; the chat then infers readiness from the connection state.
   */
  threadLoad?: AgentKitThreadLoadState;
  children: ReactNode;
}

export type AgentKitThreadLoadStatus =
  | "pending"
  | "found"
  | "missing"
  | "failed";

export interface AgentKitThreadLoadState {
  threadId: ThreadId;
  status: AgentKitThreadLoadStatus;
  /** Re-runs the host's load after it failed. */
  retry?: () => void;
}

interface ResolvedAgentKitLabels extends AgentKitLabels {
  toolInput: string;
  toolResult: string;
  queueSendNow: string;
  queueSendNowHint: string;
  queueSendNext: string;
  queueSendNextHint: string;
  queueItemBusy: string;
  queueItemBlocked: string;
  queueOrderStale: string;
}

export interface AgentKitContextValue {
  controller: AgentKitController;
  threadId: ThreadId;
  slots: AgentKitSlots;
  registry: AgentKitRegistry;
  labels: ResolvedAgentKitLabels;
  onOpenObject?: (object: AgentObjectReference) => void;
  onThreadForked?: (thread: AgentThread) => void;
  branchNavigation?: AgentKitBranchNavigation;
  onCopyMessage?: AgentKitCopyMessageHandler;
  buildFeedbackReport?: AgentKitFeedbackReportBuilder;
  loadRunUsage?: AgentKitRunUsageLoader;
  onConnectionRequest?: AgentKitProviderProps["onConnectionRequest"];
  onRenderError?: (failure: AgentKitRenderFailure) => void;
  resolveMessageContentOrder?: AgentMessageContentOrderResolver;
  workedForRowLayout?: AgentChatWorkedForRowLayout;
  dataChartLayout?: AgentChatDataChartLayout;
  formatWorkedForDuration?: (durationMs: number) => string;
  formatModelName?: (model: string) => string;
  registerComposerFocus: (threadId: ThreadId, focus: () => void) => () => void;
  requestComposerFocus: (threadId: ThreadId) => void;
  threadLoad?: AgentKitThreadLoadState;
}

const AgentKitContext = createContext<AgentKitContextValue | null>(null);

// Hosts pass callbacks inline. Forwarding through a ref keeps the context value,
// and every memoized message under it, stable across host re-renders.
function useStableCallback<TArgs extends unknown[], TResult>(
  callback: ((...args: TArgs) => TResult) | undefined,
): ((...args: TArgs) => TResult) | undefined {
  const ref = useRef(callback);
  ref.current = callback;
  const stable = useCallback(
    (...args: TArgs) => (ref.current as (...args: TArgs) => TResult)(...args),
    [],
  );
  return callback ? stable : undefined;
}

function shallowEqualRecords(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
  depth: number,
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  const previousKeys = Object.keys(previous);
  if (previousKeys.length !== Object.keys(next).length) return false;
  return previousKeys.every((key) => {
    if (!Object.hasOwn(next, key)) return false;
    const left = previous[key];
    const right = next[key];
    if (Object.is(left, right)) return true;
    return (
      depth > 0 &&
      typeof left === "object" &&
      typeof right === "object" &&
      left !== null &&
      right !== null &&
      !Array.isArray(left) &&
      !Array.isArray(right) &&
      shallowEqualRecords(
        left as Record<string, unknown>,
        right as Record<string, unknown>,
        depth - 1,
      )
    );
  });
}

function useStableShape<T extends object | undefined>(value: T, depth = 0): T {
  const ref = useRef(value);
  if (
    !shallowEqualRecords(
      ref.current as Record<string, unknown> | undefined,
      value as Record<string, unknown> | undefined,
      depth,
    )
  ) {
    ref.current = value;
  }
  return ref.current;
}

const emptySlots: AgentKitSlots = {};
const emptyRegistry: AgentKitRegistry = {};

export function AgentKitProvider({
  controller,
  threadId,
  slots: slotsInput = emptySlots,
  registry: registryInput = emptyRegistry,
  labels: labelsInput,
  onOpenObject: onOpenObjectInput,
  onThreadForked: onThreadForkedInput,
  branchNavigation: branchNavigationInput,
  onCopyMessage: onCopyMessageInput,
  buildFeedbackReport: buildFeedbackReportInput,
  loadRunUsage: loadRunUsageInput,
  onConnectionRequest: onConnectionRequestInput,
  onRenderError: onRenderErrorInput,
  resolveMessageContentOrder,
  workedForRowLayout: workedForRowLayoutInput,
  dataChartLayout: dataChartLayoutInput,
  formatWorkedForDuration,
  formatModelName: formatModelNameInput,
  onClientEffect: onClientEffectInput,
  threadLoad,
  children,
}: AgentKitProviderProps) {
  const slots = useStableShape(slotsInput);
  const registry = useStableShape(registryInput, 1);
  const labels = useStableShape(labelsInput, 1);
  const onOpenObject = useStableCallback(onOpenObjectInput);
  const onThreadForked = useStableCallback(onThreadForkedInput);
  const onCopyMessage = useStableCallback(onCopyMessageInput);
  const buildFeedbackReport = useStableCallback(buildFeedbackReportInput);
  const loadRunUsage = useStableCallback(loadRunUsageInput);
  const formatModelName = useStableCallback(formatModelNameInput);
  const onConnectionRequest = useStableCallback(onConnectionRequestInput);
  const onRenderError = useStableCallback(onRenderErrorInput);
  const workedForRowLayout = useStableShape(workedForRowLayoutInput, 1);
  const dataChartLayout = useStableShape(dataChartLayoutInput, 1);
  const onPreviousBranch = useStableCallback(branchNavigationInput?.onPrevious);
  const onNextBranch = useStableCallback(branchNavigationInput?.onNext);
  const branchIndex = branchNavigationInput?.index;
  const branchCount = branchNavigationInput?.count;
  const branchNavigation = useMemo<AgentKitBranchNavigation | undefined>(
    () =>
      branchIndex !== undefined &&
      branchCount !== undefined &&
      onPreviousBranch &&
      onNextBranch
        ? {
            index: branchIndex,
            count: branchCount,
            onPrevious: onPreviousBranch,
            onNext: onNextBranch,
          }
        : undefined,
    [branchCount, branchIndex, onNextBranch, onPreviousBranch],
  );
  const onClientEffectRef = useRef(onClientEffectInput);
  onClientEffectRef.current = onClientEffectInput;
  const hasClientEffectHandler = onClientEffectInput !== undefined;
  const composerFocusTargets = useRef(new Map<ThreadId, () => void>());
  const registerComposerFocus = useCallback(
    (targetThreadId: ThreadId, focus: () => void) => {
      composerFocusTargets.current.set(targetThreadId, focus);
      return () => {
        if (composerFocusTargets.current.get(targetThreadId) === focus) {
          composerFocusTargets.current.delete(targetThreadId);
        }
      };
    },
    [],
  );
  const requestComposerFocus = useCallback((targetThreadId: ThreadId) => {
    composerFocusTargets.current.get(targetThreadId)?.();
  }, []);
  const mergedLabels = useMemo<ResolvedAgentKitLabels>(
    () => ({
      ...defaultAgentKitLabels,
      ...labels,
      toolInput: labels?.toolInput ?? defaultAgentKitLabels.toolInput,
      toolResult: labels?.toolResult ?? defaultAgentKitLabels.toolResult,
      queueSteer:
        labels?.queueSteer ??
        labels?.queueSendNow ??
        defaultAgentKitLabels.queueSteer,
      queueSteerHint:
        labels?.queueSteerHint ??
        labels?.queueSendNowHint ??
        defaultAgentKitLabels.queueSteerHint,
      queueMoveToTop:
        labels?.queueMoveToTop ??
        labels?.queueSendNext ??
        defaultAgentKitLabels.queueMoveToTop,
      queueSendNow:
        labels?.queueSendNow ??
        labels?.queueSteer ??
        defaultAgentKitLabels.queueSendNow,
      queueSendNowHint:
        labels?.queueSendNowHint ??
        labels?.queueSteerHint ??
        defaultAgentKitLabels.queueSendNowHint,
      queueSendNext:
        labels?.queueSendNext ??
        labels?.queueMoveToTop ??
        defaultAgentKitLabels.queueSendNext,
      queueSendNextHint:
        labels?.queueSendNextHint ?? defaultAgentKitLabels.queueSendNextHint,
      queueItemBusy:
        labels?.queueItemBusy ?? defaultAgentKitLabels.queueItemBusy,
      queueItemBlocked:
        labels?.queueItemBlocked ?? defaultAgentKitLabels.queueItemBlocked,
      queueOrderStale:
        labels?.queueOrderStale ?? defaultAgentKitLabels.queueOrderStale,
    }),
    [labels],
  );
  const value = useMemo(
    () => ({
      controller,
      threadId,
      slots,
      registry,
      labels: mergedLabels,
      onOpenObject,
      onThreadForked,
      branchNavigation,
      onCopyMessage,
      buildFeedbackReport,
      loadRunUsage,
      onConnectionRequest,
      onRenderError,
      resolveMessageContentOrder,
      workedForRowLayout,
      dataChartLayout,
      formatWorkedForDuration,
      formatModelName,
      registerComposerFocus,
      requestComposerFocus,
      threadLoad,
    }),
    [
      controller,
      threadId,
      slots,
      registry,
      mergedLabels,
      onOpenObject,
      onThreadForked,
      branchNavigation,
      onCopyMessage,
      buildFeedbackReport,
      loadRunUsage,
      onConnectionRequest,
      onRenderError,
      resolveMessageContentOrder,
      workedForRowLayout,
      dataChartLayout,
      formatWorkedForDuration,
      formatModelName,
      registerComposerFocus,
      requestComposerFocus,
      threadLoad,
    ],
  );
  const seenEffects = useRef({
    controller,
    threadId,
    hydrated: false,
    ids: new Set<string>(),
  });
  if (
    seenEffects.current.controller !== controller ||
    seenEffects.current.threadId !== threadId
  ) {
    seenEffects.current = {
      controller,
      threadId,
      hydrated: false,
      ids: new Set<string>(),
    };
  }

  useEffect(() => {
    if (!hasClientEffectHandler) return;
    const scope = seenEffects.current;
    const deliver = () => {
      if (seenEffects.current !== scope) return;
      const thread = controller.getSnapshot().threads[threadId] as
        | AgentThreadState
        | undefined;
      const events = thread?.events ?? [];
      if (!scope.hydrated) {
        if (!thread || (events.length === 0 && thread.thread === undefined)) {
          return;
        }
        scope.hydrated = true;
        // Effects from a loaded history already ran when they streamed; only
        // a run that is still live can still owe the page its effects.
        for (const event of events) {
          if (
            (event.type === "client.effect" ||
              event.type === "client.deeplink") &&
            !thread.activeRunIds.includes(event.runId)
          ) {
            scope.ids.add(event.id);
          }
        }
      }
      for (const event of events) {
        if (
          (event.type === "client.effect" ||
            event.type === "client.deeplink") &&
          !scope.ids.has(event.id)
        ) {
          scope.ids.add(event.id);
          onClientEffectRef.current?.({
            type: event.type,
            name: event.name,
            ...(event.data === undefined ? {} : { data: event.data }),
          });
        }
      }
    };
    deliver();
    return controller.subscribe(deliver);
  }, [controller, hasClientEffectHandler, threadId]);

  return (
    <AgentKitContext.Provider value={value}>
      {children}
    </AgentKitContext.Provider>
  );
}

interface AgentKitUpdateChannel {
  listeners: Set<{ notify: () => void }>;
  unsubscribe?: (() => void) | undefined;
  timeout?: ReturnType<typeof setTimeout> | undefined;
}

const agentKitUpdateChannels = new WeakMap<
  AgentKitController,
  AgentKitUpdateChannel
>();

/**
 * Coalesces same-turn transport bursts without dropping the latest snapshot.
 * Every subscriber of a controller shares one timer, so a change reaches all
 * of them in one task and React renders their updates together; a timer per
 * subscriber would turn one change into one render per mounted row.
 */
function subscribeToAgentKitUpdate(
  controller: AgentKitController,
  listener: () => void,
): () => void {
  let channel = agentKitUpdateChannels.get(controller);
  if (!channel) {
    channel = { listeners: new Set() };
    agentKitUpdateChannels.set(controller, channel);
  }
  const current = channel;
  if (!current.unsubscribe) {
    current.unsubscribe = controller.subscribe(() => {
      if (current.timeout !== undefined) return;
      current.timeout = setTimeout(() => {
        current.timeout = undefined;
        for (const entry of Array.from(current.listeners)) {
          // A listener earlier in this flush can unmount a later one.
          if (current.listeners.has(entry)) entry.notify();
        }
      }, 0);
    });
  }
  const entry = { notify: listener };
  current.listeners.add(entry);
  return () => {
    current.listeners.delete(entry);
    if (current.listeners.size > 0) return;
    current.unsubscribe?.();
    current.unsubscribe = undefined;
    if (current.timeout !== undefined) clearTimeout(current.timeout);
    current.timeout = undefined;
  };
}

function useAgentKitControllerSnapshot(
  controller: AgentKitController,
): AgentKitSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => subscribeToAgentKitUpdate(controller, listener),
    [controller],
  );
  return useSyncExternalStore(
    subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
}

export function useAgentKit(): AgentKitContextValue {
  const value = useContext(AgentKitContext);
  if (!value) throw new Error("AgentKit hooks require an AgentKitProvider.");
  return value;
}

/**
 * The tracked load outcome for a thread, or undefined when the host does not
 * track loads. A tracked thread whose load has not reported yet is pending.
 */
export function useAgentThreadLoadStatus(
  requestedThreadId?: ThreadId,
): AgentKitThreadLoadStatus | undefined {
  const { threadId: contextThreadId, threadLoad } = useAgentKit();
  const threadId = requestedThreadId ?? contextThreadId;
  if (!threadLoad) return undefined;
  return threadLoad.threadId === threadId ? threadLoad.status : "pending";
}

export function useAgentKitSnapshot(): AgentKitSnapshot {
  const { controller } = useAgentKit();
  return useAgentKitControllerSnapshot(controller);
}

export function useAgentKitSelector<T>(
  selector: (snapshot: AgentKitSnapshot) => T,
  isEqual: (previous: T, next: T) => boolean = Object.is,
): T {
  const { controller } = useAgentKit();
  const subscribe = useCallback(
    (listener: () => void) => subscribeToAgentKitUpdate(controller, listener),
    [controller],
  );
  const selectorRef = useRef(selector);
  const equalityRef = useRef(isEqual);
  const cacheRef = useRef<{
    controller: AgentKitController;
    snapshot: AgentKitSnapshot;
    selector: typeof selector;
    isEqual: typeof isEqual;
    selection: T;
  } | null>(null);
  selectorRef.current = selector;
  equalityRef.current = isEqual;
  const getSelection = useCallback(() => {
    const snapshot = controller.getSnapshot();
    const cached = cacheRef.current;
    if (
      cached?.controller === controller &&
      cached.snapshot === snapshot &&
      cached.selector === selectorRef.current &&
      cached.isEqual === equalityRef.current
    ) {
      return cached.selection;
    }
    const selection = selectorRef.current(snapshot);
    if (
      cached?.controller === controller &&
      equalityRef.current(cached.selection, selection)
    ) {
      cacheRef.current = {
        controller,
        snapshot,
        selector: selectorRef.current,
        isEqual: equalityRef.current,
        selection: cached.selection,
      };
      return cached.selection;
    }
    cacheRef.current = {
      controller,
      snapshot,
      selector: selectorRef.current,
      isEqual: equalityRef.current,
      selection,
    };
    return selection;
  }, [controller]);
  return useSyncExternalStore(subscribe, getSelection, getSelection);
}

export type AgentKitMutationStatus =
  | "idle"
  | "pending"
  | "succeeded"
  | "failed";

export interface AgentKitMutation<TArgs extends unknown[], TResult> {
  status: AgentKitMutationStatus;
  pending: boolean;
  error?: Error;
  execute(...args: TArgs): Promise<TResult>;
  reset(): void;
}

/**
 * Gives custom AgentKit controls the same race-safe pending and error contract
 * as the reference components. Only the latest invocation owns visible state.
 */
export function useAgentKitMutation<TArgs extends unknown[], TResult>(
  mutation: (...args: TArgs) => Promise<TResult>,
  scopeKey?: unknown,
): AgentKitMutation<TArgs, TResult> {
  const { controller, threadId } = useAgentKit();
  const mutationRef = useRef(mutation);
  const invocationRef = useRef(0);
  const scopeRef = useRef({ controller, threadId, scopeKey });
  const [state, setState] = useState<{
    status: AgentKitMutationStatus;
    error?: Error;
    controller?: AgentKitController;
    threadId?: ThreadId;
    scopeKey?: unknown;
  }>({ status: "idle" });
  if (
    scopeRef.current.controller !== controller ||
    scopeRef.current.threadId !== threadId ||
    scopeRef.current.scopeKey !== scopeKey
  ) {
    scopeRef.current = { controller, threadId, scopeKey };
    invocationRef.current += 1;
  }
  mutationRef.current = mutation;
  const execute = useCallback(async (...args: TArgs) => {
    const invocation = ++invocationRef.current;
    const scope = scopeRef.current;
    setState({ status: "pending", ...scope });
    try {
      const result = await mutationRef.current(...args);
      if (invocation === invocationRef.current) {
        setState({ status: "succeeded", ...scope });
      }
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      if (invocation === invocationRef.current) {
        setState({ status: "failed", error, ...scope });
      }
      throw error;
    }
  }, []);
  const reset = useCallback(() => {
    invocationRef.current += 1;
    setState({ status: "idle", ...scopeRef.current });
  }, []);
  const visibleState: { status: AgentKitMutationStatus; error?: Error } =
    state.controller === controller &&
    state.threadId === threadId &&
    state.scopeKey === scopeKey
      ? state
      : { status: "idle" as const };
  return {
    status: visibleState.status,
    pending: visibleState.status === "pending",
    error: visibleState.error,
    execute,
    reset,
  };
}

/**
 * The boolean projection cannot express degraded or temporarily unavailable
 * capabilities, and it renders an unreported capability identically to a
 * denied one. Gate affordances on `useAgentCapability` instead.
 */
export function useAgentCapabilities(): AgentCapabilities {
  return useAgentKitSelector((snapshot) => snapshot.capabilities);
}

export function useAgentCapability(
  capability: AgentCapabilityId,
): AgentCapabilityAffordance {
  return useAgentKitSelector(
    (snapshot) =>
      resolveAgentCapabilityAffordance(
        {
          discovery: snapshot.capabilityDiscovery,
          capabilities: snapshot.capabilities,
        },
        capability,
      ),
    (previous, next) =>
      previous.state === next.state &&
      previous.visible === next.visible &&
      previous.enabled === next.enabled &&
      previous.reason === next.reason,
  );
}

export function useAgentConnection() {
  return useAgentKitSelector(
    (snapshot) => ({
      status: snapshot.connection,
      error: snapshot.error,
    }),
    (previous, next) =>
      previous.status === next.status && previous.error === next.error,
  );
}

export function useAgentRun(runId?: string) {
  const thread = useAgentThread();
  return runId ? thread.runs[runId] : undefined;
}

export function useAgentParticipant(agentId?: string) {
  const thread = useAgentThread();
  return agentId ? thread.agents[agentId] : undefined;
}

export function useAgentRoster(): AgentParticipant[] {
  const thread = useAgentThread();
  return useMemo(() => selectActiveAgentRoster(thread.agents), [thread.agents]);
}

export interface AgentInteractionFilter {
  runId?: RunId;
  agentId?: string;
  scope?: AgentWorkScope;
}

export function useAgentInteractions(
  filter: AgentInteractionFilter = {},
): AgentInteraction[] {
  const thread = useAgentThread();
  return useMemo(
    () =>
      thread.events.flatMap((event) => {
        if (event.type !== "agent.interaction") return [];
        if (filter.runId && event.runId !== filter.runId) return [];
        if (
          filter.agentId &&
          event.interaction.agentId !== filter.agentId &&
          event.interaction.targetAgentId !== filter.agentId
        ) {
          return [];
        }
        if (filter.scope && event.interaction.scope !== filter.scope) {
          return [];
        }
        return [event.interaction];
      }),
    [filter.agentId, filter.runId, filter.scope, thread.events],
  );
}

export function useAgentThread(requestedThreadId?: ThreadId) {
  const { controller, threadId: contextThreadId } = useAgentKit();
  const threadId = requestedThreadId ?? contextThreadId;
  return useAgentKitSelector(
    (snapshot) => snapshot.threads[threadId] ?? controller.getThread(threadId),
  );
}

/**
 * Reads one derived value from the thread and re-renders only when `isEqual`
 * sees it change. Per-row renderers use this instead of `useAgentThread`,
 * which re-renders on every streamed delta of every message.
 */
export function useAgentThreadSelector<T>(
  select: (thread: AgentThreadState) => T,
  isEqual: (previous: T, next: T) => boolean = Object.is,
  requestedThreadId?: ThreadId,
): T {
  const { controller, threadId: contextThreadId } = useAgentKit();
  const threadId = requestedThreadId ?? contextThreadId;
  return useAgentKitSelector(
    (snapshot) =>
      select(snapshot.threads[threadId] ?? controller.getThread(threadId)),
    isEqual,
  );
}

/**
 * User messages sent from this controller that the client has not appended
 * yet, in send order. Each is retired when its own message lands, matched by
 * client request id, or when its send settles.
 */
export function useAgentKitPendingSubmissions(
  requestedThreadId?: ThreadId,
): readonly AgentMessage[] {
  const { controller, threadId: contextThreadId } = useAgentKit();
  const threadId = requestedThreadId ?? contextThreadId;
  const store = agentKitPendingSubmissions(controller);
  const getPending = useCallback(
    () => store.messages(threadId),
    [store, threadId],
  );
  const pending = useSyncExternalStore(store.subscribe, getPending, getPending);
  const thread = useAgentThread(threadId);
  return useMemo(
    () => visiblePendingSubmissions(pending, thread),
    [pending, thread.messages, thread.queuedMessages],
  );
}

/** A send on the thread was accepted and its run is not registered yet. */
export function useAgentKitSubmissionStarting(
  requestedThreadId?: ThreadId,
): boolean {
  const { controller, threadId: contextThreadId } = useAgentKit();
  const threadId = requestedThreadId ?? contextThreadId;
  const store = agentKitPendingSubmissions(controller);
  const getStarting = useCallback(
    () => store.starting(threadId),
    [store, threadId],
  );
  return useSyncExternalStore(store.subscribe, getStarting, getStarting);
}

/**
 * A send on the thread has taken its draft and has no run yet, preflight
 * included. What is submitted meanwhile queues behind it.
 */
export function useAgentKitSubmissionHoldsTurn(
  requestedThreadId?: ThreadId,
): boolean {
  const { controller, threadId: contextThreadId } = useAgentKit();
  const threadId = requestedThreadId ?? contextThreadId;
  const store = agentKitPendingSubmissions(controller);
  const getHolds = useCallback(
    () => store.holdsTurn(threadId),
    [store, threadId],
  );
  return useSyncExternalStore(store.subscribe, getHolds, getHolds);
}

/** Shows a user message for a send before the client's own awaits finish. */
export function useAgentKitBeginPendingSubmission(): (
  threadId: ThreadId,
  draft: AgentKitPendingSubmissionDraft,
  options?: { release?: () => void; adoptable?: boolean },
) => AgentKitPendingSubmission {
  const { controller } = useAgentKit();
  return useCallback(
    (threadId, draft, options) =>
      agentKitPendingSubmissions(controller).begin(threadId, draft, options),
    [controller],
  );
}

async function sendWithPendingSubmission(
  controller: AgentKitController,
  input: SendMessageInput,
): ReturnType<AgentKitController["sendMessage"]> {
  const store = agentKitPendingSubmissions(controller);
  const showsMessage =
    input.metadata?.hideUserMessage !== true &&
    !input.queuedMessageReservationId &&
    !hasActiveAgentRuns(controller.getThread(input.threadId)) &&
    (input.text.trim().length > 0 || Boolean(input.attachments?.length));
  const requestId =
    agentKitClientRequestId(input.metadata) ??
    (showsMessage ? store.adopt(input.threadId) : undefined);
  const withRequestId = (id: string): SendMessageInput => ({
    ...input,
    metadata: {
      ...input.metadata,
      [AGENTKIT_CLIENT_REQUEST_ID_METADATA_KEY]: id,
    },
  });
  // Another send already holds the turn even before its run id exists, so
  // this one follows it, whether or not it brought a copy of its own.
  const ahead = {
    ownId: requestId,
    queued: Boolean(
      input.queuedMessageReservationId || input.queuedWhileRunActive,
    ),
  };
  if (store.hasAhead(input.threadId, ahead)) {
    // The client cannot queue behind a turn it has no run id for yet, and
    // sending now would race that turn's start. The row shows at once and
    // the send follows once the turn's run is registered.
    const queues =
      input.queueWhileRunning !== false ||
      input.interruptActiveRun ||
      input.deliverInActiveRun;
    const queuedMessageReservationId =
      input.queuedMessageReservationId ??
      (queues
        ? controller.reserveQueuedMessage(
            { threadId: input.threadId, text: input.text },
            input.onLocalSubmit,
          ).id
        : undefined);
    await store.settled(input.threadId, ahead);
    return controller.sendMessage(
      queuedMessageReservationId
        ? { ...input, queuedMessageReservationId }
        : input,
    );
  }
  if (requestId && store.has(requestId)) {
    return store.track(
      requestId,
      controller.sendMessage(withRequestId(requestId)),
    );
  }
  if (!showsMessage) return controller.sendMessage(input);
  const pending = store.begin(
    input.threadId,
    {
      text: input.text,
      attachments: input.attachments,
      metadata: input.metadata,
    },
    requestId ? { id: requestId } : undefined,
  );
  return store
    .track(pending.id, controller.sendMessage(withRequestId(pending.id)))
    .finally(pending.end);
}

export function useAgentKitControl(requestedThreadId?: ThreadId) {
  const { controller, labels, threadId: contextThreadId } = useAgentKit();
  const threadId = requestedThreadId ?? contextThreadId;
  return useMemo(
    () => ({
      send: (
        text: string,
        options?: Parameters<AgentKitController["sendMessage"]>[0]["options"],
      ) =>
        sendWithPendingSubmission(controller, {
          threadId,
          text,
          ...(options === undefined ? {} : { options }),
        }),
      sendMessage: (input: Omit<SendMessageInput, "threadId">) =>
        sendWithPendingSubmission(controller, { ...input, threadId }),
      load: () => controller.loadThread(threadId),
      resubscribe: (runId: string) =>
        controller.resubscribeRun(threadId, runId),
      queue: (text: string) => controller.queueMessage({ threadId, text }),
      queueMessage: (input: Omit<SendMessageInput, "threadId">) =>
        controller.queueMessage({ ...input, threadId }),
      reserveQueuedMessage: (text: string, onLocalSubmit?: () => void) =>
        controller.reserveQueuedMessage({ threadId, text }, onLocalSubmit),
      cancelQueuedMessageReservation: (messageId: string) =>
        controller.cancelQueuedMessageReservation(threadId, messageId),
      cancel: (runId: string) => controller.cancelRun(threadId, runId),
      /**
       * The runs to stop once sends with no run yet have one. A send that
       * fails registers no run, so it leaves nothing to stop.
       */
      runIdsOnceStarted: async () => {
        await agentKitPendingSubmissions(controller).settled(threadId);
        return controller.getThread(threadId).activeRunIds;
      },
      canContinueRun: controller.supportsRunContinuation?.() === true,
      continueRun: (runId: string) =>
        controller.continueRun
          ? controller.continueRun(threadId, runId)
          : Promise.reject(new Error(labels.error)),
      approve: (
        runId: string,
        approvalId: string,
        optionId?: string,
        input?: Record<string, unknown>,
      ) =>
        controller.resolveApproval({
          threadId,
          runId,
          approvalId,
          optionId,
          response: {
            decision: "approve",
            optionIds: optionId ? [optionId] : undefined,
            input,
          },
        }),
      resolveApproval: (
        runId: string,
        approvalId: string,
        response: AgentApprovalResponse,
      ) =>
        controller.resolveApproval({ threadId, runId, approvalId, response }),
      resolveConnectionRequest: (
        runId: string,
        requestId: string,
        response: AgentConnectionResponse,
      ) =>
        controller.resolveConnectionRequest({
          threadId,
          runId,
          requestId,
          response,
        }),
      removeQueued: (messageId: string) =>
        withAgentKitQueueErrorCopy(
          controller.removeQueuedMessage(threadId, messageId),
          labels,
        ),
      moveQueuedMessageToTop: (messageId: string) =>
        controller.moveQueuedMessageToTop
          ? withAgentKitQueueErrorCopy(
              controller.moveQueuedMessageToTop(threadId, messageId),
              labels,
            )
          : Promise.reject(new Error(labels.error)),
      reorderQueuedMessages: (messageIds: readonly string[]) =>
        controller.reorderQueuedMessages
          ? withAgentKitQueueErrorCopy(
              controller.reorderQueuedMessages(threadId, messageIds),
              labels,
            )
          : Promise.reject(new Error(labels.error)),
      steerQueued: (
        messageId: string,
        options?: AgentKitSteerQueuedMessageOptions,
      ) =>
        withAgentKitQueueErrorCopy(
          controller.steerQueuedMessage(
            threadId,
            messageId,
            undefined,
            options,
          ),
          labels,
        ),
      submitFeedback: (
        messageId: string,
        value: "positive" | "negative" | "dismissed",
        options?: NonNullable<
          Parameters<AgentKitController["submitFeedback"]>[3]
        >,
      ) =>
        options
          ? controller.submitFeedback(threadId, messageId, value, options)
          : controller.submitFeedback(threadId, messageId, value),
      fork: (fromMessageId: string) =>
        controller.forkThread(threadId, fromMessageId),
      updateThread: (
        patch: Parameters<AgentKitController["updateThread"]>[1],
      ) => controller.updateThread(threadId, patch),
      deleteThread: () => controller.deleteThread(threadId),
      uploadFiles: controller.uploadFiles.bind(controller, threadId),
      invokeAction: controller.invokeAction.bind(controller),
    }),
    [controller, labels, threadId],
  );
}
