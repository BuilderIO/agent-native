import {
  formatAttachmentError,
  TextAttachmentAdapter,
} from "@agent-native/toolkit/composer/attachment-accept";
import { isPastedTextAttachmentName } from "@agent-native/toolkit/composer/pasted-text";
import { PastedTextChip } from "@agent-native/toolkit/composer/PastedTextChip";
import {
  appendRealtimeVoiceTranscriptToRepository,
  realtimeVoiceTranscriptRegistry,
} from "@agent-native/toolkit/composer/realtime-voice-transcript";
import type {
  ComposerAgentOption,
  ComposerImageModelMenu,
} from "@agent-native/toolkit/composer/TiptapComposer";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useThreadRuntime,
  useThread,
  useAui,
  useComposer,
  useComposerRuntime,
  useMessageRuntime,
  ThreadPrimitive,
} from "@assistant-ui/react";
import type {
  Attachment,
  ChatModelAdapter,
  ExportedMessageRepository,
} from "@assistant-ui/react";
import { CompositeAttachmentAdapter } from "@assistant-ui/react";
import {
  IconArrowUp,
  IconMessage,
  IconX,
  IconPlayerStopFilled,
  IconTerminal,
  IconAlertTriangle,
  IconRefresh,
} from "@tabler/icons-react";
import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useLayoutEffect,
  forwardRef,
  useImperativeHandle,
} from "react";

import {
  normalizeAgentActionScope,
  type AgentActionScope,
  type AgentChatAttachment,
} from "../agent/types.js";
import { createPollEngine } from "../shared/poll-engine.js";
import type { ReasoningEffort } from "../shared/reasoning-effort.js";
import type { ThinkingDisplay } from "../shared/thinking-display.js";
import {
  clearPendingTurnIfMatches,
  clearActiveRunIfMatches,
  getPendingTurn,
  getActiveRunActivityTool,
  getActiveRun,
  hasRecentActiveRunProgress,
  resolveReconnectAfterSeq,
  setActiveRun,
  type ActiveRunState,
  updateActiveRunActivity,
  updateActiveRunSeq,
} from "./active-run-state.js";
import {
  activeRunLooksAlive,
  createAgentChatAdapter,
  generateAgentChatTurnId,
  hasInFlightToolCall,
  type AgentChatSurfaceKind,
} from "./agent-chat-adapter.js";
import {
  appendAgentChatContextToMessage,
  filterAgentChatContextItems,
  formatAgentChatContextItemsForPrompt,
  getAgentChatContextState,
  isAgentChatSubmitCancelled,
  normalizeAgentChatContextItem,
  publishAgentChatContextItems,
  refreshAgentChatContext,
  reportAgentChatSubmitResult,
  subscribeAgentChatContext,
  type AgentChatContextItem,
} from "./agent-chat.js";
import { captureError } from "./analytics.js";
import { agentNativePath } from "./api-path.js";
import {
  AssistantMessageListErrorBoundary,
  AssistantUiStaleIndexErrorBoundary,
} from "./assistant-ui-recovery.js";
import { getBrowserTabId } from "./browser-tab-id.js";
import { modelCatalogConfirmsMissing } from "./chat-model-groups.js";
import { AGENT_CHAT_VIEW_TRANSITION_PREPARE_EVENT } from "./chat-view-transition.js";
import { AgentActivityTrace } from "./chat/agent-activity-trace.js";
import {
  DownscalingImageAttachmentAdapter,
  BinaryDocumentAttachmentAdapter,
  MAX_PDF_BYTES,
  MAX_ESTIMATED_BODY_BYTES,
  AGGRESSIVE_MAX_IMAGE_DIMENSION,
  AGGRESSIVE_JPEG_QUALITY,
  transcodeImageToDataURL,
  createAgentImageAttachments,
  serializeQueuedAttachments,
  getSubmittedPromptBodyStrings,
  measureJsonStringBytes,
  getAttachmentBodyStrings,
  type QueuedAttachment,
} from "./chat/attachment-adapters.js";
import {
  readAssistantChatComposerDraft,
  writeAssistantChatComposerDraft,
} from "./chat/composer-draft.js";
import {
  AgentTextStreamingProvider,
  ExternalTextStreamingContext,
} from "./chat/markdown-renderer.js";
import {
  AssistantChatHistoryContext,
  AssistantChatHistoryBeginningRevertButton,
  assistantMessageHasCompletedSideEffect,
  findAssistantChatHistoryBeginningVersion,
  findMatchingAssistantChatHistoryVersion,
  isAssistantChatHistoryVersion,
  type AssistantChatHistoryConfig,
  type AssistantChatHistoryMessage,
  type AssistantChatHistoryVersion,
  CheckpointContext,
  MessageActionsContext,
  assistantMessageRunId,
  assistantMessageTurnId,
  UserMessage,
  AssistantMessage,
  ExternalUserStoppedRunContext,
  SelectionAttachedPill,
  displayableUserMessageText,
  isHiddenUserMessage,
  ServerRunActiveContext,
  UserStoppedRunContext,
} from "./chat/message-components.js";
import {
  repoHasAssistantMessage,
  getRepoMessages,
  getRepoMessage,
  shouldImportServerThreadData,
  dedupeRepoMessagesById,
  dropEmptyAssistantMessages,
  withLastAssistantRunDuration,
} from "./chat/repo-helpers.js";
import {
  BuilderSetupCard,
  LoopLimitContinueCard,
  RunErrorRecoveryCard,
  PlanModeCallout,
  getLoopLimitMetadata,
  getRunErrorMetadata,
  getRequestModeMetadata,
  isBuilderReconnectRunError,
  runErrorKey,
  type BuilderSetupCardLayout,
  type LoopLimitInfo,
  type RunErrorInfo,
} from "./chat/run-recovery.js";
import {
  createAgentChatRuntimeAdapter,
  type AgentChatRuntime,
} from "./chat/runtime.js";
import {
  ChatRunningContext,
  ChatRunningRunIdContext,
  ChatRunningTurnIdContext,
  ChatRunDurationContext,
  SuppressInlineOpenAppContext,
  ApprovalContext,
  type ApprovalResolution,
  type ApprovalContextValue,
  ReconnectStreamMessage,
} from "./chat/tool-call-display.js";
import { useAgentChatLifecycleTracking } from "./chat/use-agent-chat-lifecycle-tracking.js";
import { useReconnectReaderOwner } from "./chat/use-reconnect-reader-owner.js";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "./components/ui/message-scroller.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip.js";
import {
  AgentComposerFrame,
  AgentSuggestionBar,
  agentSuggestionPrompt,
  MessageQueueDrawer,
  PromptBar,
  TiptapComposer,
  type AgentComposerLayoutVariant,
  type AgentSuggestionInput,
  type ComposerSubmitIntent,
  type Reference,
  type TiptapComposerHandle,
} from "./composer/index.js";
import {
  useAgentDynamicSuggestionsResult,
  type AgentDynamicSuggestionsOption,
} from "./dynamic-suggestions.js";
import { isProviderAuthenticationError } from "./error-format.js";
import {
  GuidedQuestionFlow,
  useGuidedQuestionFlow,
} from "./guided-questions.js";
import { useT } from "./i18n.js";
import { buildSignInReturnHref } from "./require-session.js";
import {
  addMcpConnectionCompleteListener,
  consumeMcpConnectionResume,
  type McpConnectionResumeRequest,
} from "./resources/mcp-connection-resume.js";
import {
  claimRunStream,
  createRunStreamToken,
  ownsRunStream,
  releaseRunStream,
} from "./run-stream-ownership.js";
import { signOut } from "./sign-out.js";
import {
  AgentAutoContinueSignal,
  type ContentPart,
  type PreparingActionState,
  readSSEStreamRaw,
  settleInterruptedToolCalls,
} from "./sse-event-processor.js";
import { ThinkingDisplayProvider } from "./thinking-display.js";
import {
  humanizeToolName,
  runningToolLabel,
  toolLabel,
} from "./tool-display.js";
import { callAction, useActionMutation, useActionQuery } from "./use-action.js";
import { useAgentEngineConfigured } from "./use-agent-engine-configured.js";
import {
  appendChatThreadScopeParams,
  type ChatThreadScope,
  type ChatThreadSnapshot,
} from "./use-chat-threads.js";
import { useDevMode } from "./use-dev-mode.js";
import { useRunStuckDetection } from "./use-run-stuck-detection.js";
import { cn } from "./utils.js";

export {
  AssistantMessageListErrorBoundary,
  AssistantUiStaleIndexErrorBoundary,
  assistantUiRecoverableRenderErrorKind,
  isAssistantUiRecoverableRenderError,
  isAssistantUiStaleIndexError,
} from "./assistant-ui-recovery.js";

export { displayableUserMessageText } from "./chat/message-components.js";

type AuthSessionCheckResult = "available" | "missing" | "unknown";
type ThreadRestoreErrorKind = "not-found" | "unavailable";

export function shouldSuppressUnauthenticatedDesktopThreadRestore(
  surface: AgentChatSurfaceKind,
  status: number,
  desktopIdentityUnauthenticated = false,
): boolean {
  return (
    surface === "desktop" &&
    (status === 401 ||
      status === 403 ||
      (status === 404 && desktopIdentityUnauthenticated))
  );
}

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

type AssistantUiMessageResourceShape = {
  id: string;
  content: readonly unknown[];
  attachments?: readonly { id: string }[];
};

export function assistantUiMessageListStructureKey(
  messages: readonly AssistantUiMessageResourceShape[],
): string {
  return JSON.stringify(
    messages.map((message) => [
      message.id,
      message.content.map((part, index) => {
        const partObject =
          typeof part === "object" && part !== null ? part : null;
        const toolCallId =
          partObject && "toolCallId" in partObject
            ? partObject.toolCallId
            : undefined;
        return typeof toolCallId === "string"
          ? `toolCallId-${toolCallId}`
          : `index-${index}`;
      }),
      (message.attachments ?? []).map((attachment) => attachment.id),
    ]),
  );
}

export type AgentRequestMode = "act" | "plan";
export type AgentRecoveryAction = "continue" | "retry";
export interface AssistantChatSendOptions {
  trackInRunsTray?: boolean;
  requestMode?: AgentRequestMode;
  attachments?: AgentChatAttachment[];
  submitMessageId?: string;
  usageLabel?: string;
  actionScope?: AgentActionScope;
  approvedToolCalls?: string[];
  hideUserMessage?: boolean;
}

export function createUserMessageRunConfig(
  references?: Reference[],
  requestMode?: AgentRequestMode,
  recoveryAction?: AgentRecoveryAction,
  trackInRunsTray?: boolean,
  approvedToolCalls?: string[],
  queuedMessageId?: string,
  hideUserMessage?: boolean,
  modelSnapshot?: {
    model?: string;
    engine?: string;
    effort?: ReasoningEffort;
  },
  turnId?: string,
  usageLabel?: string,
  actionScope?: AgentActionScope,
) {
  const custom: {
    references?: Reference[];
    requestMode?: AgentRequestMode;
    trackInRunsTray?: boolean;
    agentNativeQueuedMessageId?: string;
    approvedToolCalls?: string[];
    model?: string;
    engine?: string;
    effort?: ReasoningEffort;
    turnId?: string;
    usageLabel?: string;
    actionScope?: AgentActionScope;
  } = {};
  if (modelSnapshot?.model) custom.model = modelSnapshot.model;
  if (modelSnapshot?.engine) custom.engine = modelSnapshot.engine;
  if (modelSnapshot?.effort) custom.effort = modelSnapshot.effort;
  if (references && references.length > 0) {
    custom.references = references;
  }
  if (requestMode) {
    custom.requestMode = requestMode;
  }
  if (trackInRunsTray) {
    custom.trackInRunsTray = true;
  }
  if (queuedMessageId) {
    custom.agentNativeQueuedMessageId = queuedMessageId;
  }
  if (approvedToolCalls && approvedToolCalls.length > 0) {
    custom.approvedToolCalls = approvedToolCalls;
  }
  if (turnId) {
    custom.turnId = turnId;
  }
  if (usageLabel) {
    custom.usageLabel = usageLabel;
  }
  if (actionScope) {
    custom.actionScope = actionScope;
  }
  const options: {
    runConfig?: { custom: typeof custom };
    metadata?: {
      custom: {
        agentNativeRecoveryAction?: AgentRecoveryAction;
        agentNativeHiddenUserMessage?: boolean;
        agentNativeQueuedMessageId?: string;
        turnId?: string;
        actionScope?: AgentActionScope;
      };
    };
  } = {};
  if (Object.keys(custom).length > 0) {
    options.runConfig = { custom };
  }
  if (
    recoveryAction ||
    hideUserMessage ||
    queuedMessageId ||
    turnId ||
    actionScope
  ) {
    options.metadata = {
      custom: {
        ...(recoveryAction
          ? { agentNativeRecoveryAction: recoveryAction }
          : {}),
        ...(hideUserMessage ? { agentNativeHiddenUserMessage: true } : {}),
        ...(queuedMessageId
          ? { agentNativeQueuedMessageId: queuedMessageId }
          : {}),
        ...(turnId ? { turnId } : {}),
        ...(actionScope ? { actionScope } : {}),
      },
    };
  }
  return options;
}

const PENDING_SELECTION_KEY = "pending-selection-context";
const POLL_ABORT_MIN_MS = 10_000;
function getPollAbortMs(interval: number): number {
  return Math.max(POLL_ABORT_MIN_MS, interval * 4);
}
const ACTIVE_RUN_CLEAR_TIMEOUT_MS = 5_000;
const ACTIVE_RUN_CLEAR_STABLE_POLLS = 2;
const ACTIVE_RUN_CLEAR_RETRY_DELAY_MS = 1_000;
const ACTIVE_RUN_STUCK_THRESHOLD_MS = 90_000;
const BACKGROUND_ACTIVE_RUN_STUCK_THRESHOLD_MS = 13 * 60_000;
const ACTIVE_RUN_POLL_INTERVAL_MS = 150;
const AUTO_RESUME_STATUS_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_AUTO_RECOVERIES = 3;
const RECONNECT_NO_PROGRESS_CONTINUE_MESSAGE =
  "Continue from where you stopped. Use the partial work above, verify what succeeded, and finish the original request. If the last visible step was preparing an app action and no tool result was returned, treat that action input as stalled or too large: change strategy, use a smaller bounded input, and preserve optional details as visible affordances instead of repeating the same giant action. Do not rerun the exact same failed tool input unless the failure was transient or the user explicitly asked for an exact rerun. Prefer dedicated app actions over raw database edits when they exist.";
const RECONNECT_EMPTY_RETRY_MESSAGE =
  "The previous attempt disconnected before producing any output. Start the original request again.";
const ACTIVITY_LABEL_REVEAL_DELAY_MS = 6_000;
const DEFAULT_ASSISTANT_CHAT_COMPOSER_PLACEHOLDER =
  "Ask the agent to explore, build, or explain…";
type ActiveRunLookup = {
  active?: boolean;
  runId?: string;
  turnId?: string;
  threadId?: string;
  status?: string;
  heartbeatAt?: number | null;
  lastProgressAt?: number | null;
  dispatchMode?: string | null;
  terminalReason?: string | null;
  serverNow?: number;
  awaitingRedispatch?: boolean;
};

type PendingReconnectRecovery = {
  id: number;
  message: string;
  turnId?: string;
};

function isReplayableTerminalRun(runInfo: ActiveRunLookup): boolean {
  const dispatchMode =
    typeof runInfo.dispatchMode === "string" ? runInfo.dispatchMode : "";
  return (
    runInfo.status !== "running" &&
    dispatchMode.startsWith("background") &&
    runInfo.terminalReason === "run_timeout"
  );
}

function activeRunStuckThresholdMs(runInfo: ActiveRunLookup): number {
  const dispatchMode =
    typeof runInfo.dispatchMode === "string" ? runInfo.dispatchMode : "";
  return dispatchMode.startsWith("background")
    ? BACKGROUND_ACTIVE_RUN_STUCK_THRESHOLD_MS
    : ACTIVE_RUN_STUCK_THRESHOLD_MS;
}

function activeRunLooksStale(runInfo: ActiveRunLookup): boolean {
  const lastProgressAt =
    typeof runInfo.lastProgressAt === "number"
      ? runInfo.lastProgressAt
      : typeof runInfo.heartbeatAt === "number"
        ? runInfo.heartbeatAt
        : null;
  const nowMs =
    typeof runInfo.serverNow === "number" ? runInfo.serverNow : Date.now();
  const thresholdMs = activeRunStuckThresholdMs(runInfo);
  if (
    hasRecentActiveRunProgress(runInfo.threadId, runInfo.runId, thresholdMs)
  ) {
    return false;
  }
  return (
    runInfo.status === "running" &&
    lastProgressAt != null &&
    nowMs - lastProgressAt > thresholdMs
  );
}

const ACTIVE_RUN_PROBE_RETRY_DELAYS_MS = [400, 1200];

export function reconnectProgressTimedOut(args: {
  lastProgressAt: number;
  now: number;
  thresholdMs?: number;
}): boolean {
  const threshold = args.thresholdMs ?? ACTIVE_RUN_STUCK_THRESHOLD_MS;
  return args.now - args.lastProgressAt >= threshold;
}

export function matchesUserStoppedRun(
  stopped: { runId?: string; threadId?: string; turnId?: string } | null,
  threadId?: string,
  runId?: string,
  turnId?: string,
): boolean {
  if (!stopped || stopped.threadId !== threadId) return false;
  return Boolean(
    (stopped.runId && runId && stopped.runId === runId) ||
    (stopped.turnId && turnId && stopped.turnId === turnId),
  );
}

function activeRunMatchesThread(
  state: ActiveRunState | null,
  threadId: string | undefined,
): boolean {
  return Boolean(threadId && state?.threadId === threadId && state.runId);
}

export { assistantMessageRunId };

export function shouldAcceptRunError(args: {
  errorRunId?: string;
  activeRunId?: string;
  latestAssistantRunId?: string;
}): boolean {
  if (!args.errorRunId) return true;
  const expectedRunId = args.activeRunId ?? args.latestAssistantRunId;
  return !expectedRunId || args.errorRunId === expectedRunId;
}

function isAssistantUiDuplicateMessageIdError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("MessageRepository") &&
    message.includes("same id already exists")
  );
}

type AssistantUiMessageRepository = {
  addOrUpdateMessage: (parentId: unknown, message: unknown) => unknown;
  __agentNativePatched?: boolean;
  head?: { current?: { id?: string } } | null;
};

type AssistantUiThreadBinding = {
  getState?: () => { repository?: AssistantUiMessageRepository };
  outerSubscribe?: (callback: () => void) => void | (() => void);
};

export function installAssistantUiMessageRepositoryRecovery(
  threadRuntime: unknown,
): () => void {
  const binding = (
    threadRuntime as {
      __internal_threadBinding?: AssistantUiThreadBinding;
    }
  )?.__internal_threadBinding;
  if (!binding?.getState) return () => {};

  const patchCurrentRepository = () => {
    const repo = binding.getState?.()?.repository;
    if (!repo || typeof repo.addOrUpdateMessage !== "function") return;
    if (repo.__agentNativePatched) return;
    repo.__agentNativePatched = true;
    const original = repo.addOrUpdateMessage.bind(repo);
    repo.addOrUpdateMessage = function (parentId: unknown, message: unknown) {
      try {
        return original(parentId, message);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (parentId && errorMessage.includes("Parent message not found")) {
          const fallbackParent = this.head?.current?.id ?? null;
          if (fallbackParent && fallbackParent !== parentId) {
            return original(fallbackParent, message);
          }
          return original(null, message);
        }
        if (errorMessage.includes("same id already exists")) return;
        throw error;
      }
    };
  };

  patchCurrentRepository();
  const unsubscribe = binding.outerSubscribe?.(patchCurrentRepository);
  return typeof unsubscribe === "function" ? unsubscribe : () => {};
}

function cloneContentParts(content: ContentPart[]): ContentPart[] {
  return content.map((part) =>
    part.type === "text" || part.type === "reasoning"
      ? { ...part }
      : {
          ...part,
          args: { ...part.args },
          ...(part.mcpApp ? { mcpApp: { ...part.mcpApp } } : {}),
          ...(part.chatUI ? { chatUI: { ...part.chatUI } } : {}),
          ...(part.approval ? { approval: { ...part.approval } } : {}),
        },
  );
}

export function settleInterruptedAssistantToolCallsInRepo<
  T extends { messages?: unknown[] },
>(
  repo: T,
  options?: { userStopped?: boolean; runId?: string; turnId?: string },
): { repo: T; changed: boolean } {
  if (!Array.isArray(repo.messages)) return { repo, changed: false };
  let changed = false;
  const nextMessages = repo.messages.map((entry) => {
    const wrapper =
      entry && typeof entry === "object" && "message" in entry
        ? (entry as { message?: unknown })
        : null;
    const message = (wrapper?.message ?? entry) as
      | {
          role?: unknown;
          content?: unknown;
          status?: unknown;
          metadata?: { custom?: Record<string, unknown> };
        }
      | null
      | undefined;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) {
      return entry;
    }
    const scopedToRunOrTurn =
      options?.runId !== undefined || options?.turnId !== undefined;
    if (
      scopedToRunOrTurn &&
      !(
        (options.runId !== undefined &&
          assistantMessageRunId(message) === options.runId) ||
        (options.turnId !== undefined &&
          assistantMessageTurnId(message) === options.turnId)
      )
    ) {
      return entry;
    }
    const content = cloneContentParts(message.content as ContentPart[]);
    if (
      !settleInterruptedToolCalls(content, undefined, {
        includeActivity: true,
        userStopped: options?.userStopped,
      })
    ) {
      return entry;
    }
    changed = true;
    const nextMessage = {
      ...message,
      content,
      status: options?.userStopped
        ? { type: "complete", reason: "stop" }
        : { type: "incomplete", reason: "error" },
      ...(options?.userStopped
        ? {
            metadata: {
              ...(message.metadata ?? {}),
              custom: {
                ...(message.metadata?.custom ?? {}),
                userStopped: true,
              },
            },
          }
        : {}),
    };
    return wrapper
      ? { ...(entry as Record<string, unknown>), message: nextMessage }
      : nextMessage;
  });
  return changed
    ? { repo: { ...repo, messages: nextMessages }, changed }
    : { repo, changed };
}

function clearPendingSelection() {
  fetch(
    agentNativePath(
      `/_agent-native/application-state/${PENDING_SELECTION_KEY}`,
    ),
    {
      method: "DELETE",
      keepalive: true,
      headers: { "X-Agent-Native-CSRF": "1" },
    },
  ).catch(() => {});
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("agent-panel:selection-cleared"));
  }
}

export async function waitForThreadRunToClear(
  apiUrl: string,
  threadId?: string,
): Promise<boolean> {
  if (!threadId) return true;
  const deadline = Date.now() + ACTIVE_RUN_CLEAR_TIMEOUT_MS;
  let activeRunToResume: ActiveRunLookup | null = null;
  let consecutiveClearPolls = 0;

  const resumeActiveRun = (info: ActiveRunLookup) => {
    if (!info.runId) return;
    const stored = getActiveRun();
    const sameStoredRun =
      stored?.threadId === threadId && stored.runId === info.runId;
    const storedOwnerTabId = sameStoredRun ? stored?.tabId : undefined;
    setActiveRun({
      threadId,
      runId: info.runId,
      ...(storedOwnerTabId ? { tabId: storedOwnerTabId } : {}),
      ...(info.turnId ? { turnId: info.turnId } : {}),
      lastSeq: sameStoredRun ? stored.lastSeq : -1,
      ...(sameStoredRun && stored.activityTool
        ? { activityTool: stored.activityTool }
        : {}),
    });
  };

  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
      );
      if (res.ok) {
        const info = (await res.json()) as ActiveRunLookup;
        const runLooksClear =
          !info?.active ||
          info?.status !== "running" ||
          activeRunLooksStale(info);
        if (runLooksClear) {
          consecutiveClearPolls += 1;
          if (consecutiveClearPolls >= ACTIVE_RUN_CLEAR_STABLE_POLLS) {
            return true;
          }
        } else {
          consecutiveClearPolls = 0;
        }
        if (!runLooksClear && info.runId) {
          activeRunToResume = info;
          if (info.awaitingRedispatch === true) {
            resumeActiveRun(info);
            return false;
          }
        }
      } else {
        consecutiveClearPolls = 0;
      }
    } catch {
      consecutiveClearPolls = 0;
      // Transient poll failure — try again until the short grace period ends.
    }

    await new Promise((resolve) =>
      window.setTimeout(resolve, ACTIVE_RUN_POLL_INTERVAL_MS),
    );
  }

  if (activeRunToResume) {
    resumeActiveRun(activeRunToResume);
    return false;
  }
  return true;
}


function getImageAttachmentSrc(attachment: Attachment): string | null {
  if (attachment.type !== "image") return null;

  const uploadUrl = (attachment as any).metadata?.uploadUrl as
    | string
    | undefined;
  if (uploadUrl) return uploadUrl;

  if ("file" in attachment && attachment.file) {
    return URL.createObjectURL(attachment.file);
  }

  const imagePart = attachment.content?.find((part) => part.type === "image");
  return imagePart && "image" in imagePart ? imagePart.image : null;
}

function ComposerAttachmentPreviewCard({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: (id: string) => void;
}) {
  const t = useT();
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  useEffect(() => {
    const nextSrc = getImageAttachmentSrc(attachment);
    setImageSrc(nextSrc);

    return () => {
      if (nextSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(nextSrc);
      }
    };
  }, [attachment]);

  if (isPastedTextAttachmentName(attachment.name)) {
    return <PastedTextChip attachment={attachment} onRemove={onRemove} />;
  }

  const isImage = !!imageSrc;

  return (
    <div
      className={cn(
        "group relative overflow-hidden border border-border/70 bg-muted/50 text-foreground",
        isImage
          ? "h-20 w-20 rounded-xl shadow-[0_12px_30px_-18px_rgba(0,0,0,0.7)]"
          : "inline-flex min-w-0 max-w-[220px] items-center gap-2 rounded-lg px-2.5 py-2 pe-9 text-xs",
      )}
    >
      {isImage ? (
        <>
          <img
            src={imageSrc}
            alt={attachment.name}
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-2 py-1.5">
            <div className="truncate text-[10px] font-medium text-white/95">
              {attachment.name}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {attachment.name.split(".").pop() || "file"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{attachment.name}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {attachment.contentType || attachment.type}
            </div>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        className={cn(
          "absolute flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-background/95 text-foreground shadow-sm transition-colors hover:bg-accent",
          isImage
            ? "end-1.5 top-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100"
            : "end-1.5 top-1.5",
        )}
        aria-label={t("agentChat.composer.removeAttachment", {
          name: attachment.name,
        })}
      >
        <IconX className="h-3 w-3" />
      </button>
    </div>
  );
}

function ComposerAttachmentPreviewStrip() {
  const attachments = useComposer((state) => state.attachments);
  const aui = useAui();

  const handleRemove = useCallback(
    (id: string) => {
      void aui.composer().attachment({ id }).remove();
    },
    [aui],
  );

  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-2 pt-2">
      {attachments.map((attachment) => (
        <ComposerAttachmentPreviewCard
          key={attachment.id}
          attachment={attachment}
          onRemove={handleRemove}
        />
      ))}
    </div>
  );
}

function getMessageText(message: unknown): string {
  const msg = (message as { message?: unknown })?.message ?? message;
  const content = (msg as { content?: unknown })?.content;
  if (Array.isArray(content)) {
    return displayableUserMessageText(
      content
        .filter((p: any) => p?.type === "text" && typeof p.text === "string")
        .map((p: any) => p.text)
        .join("\n"),
    );
  }
  return typeof content === "string" ? displayableUserMessageText(content) : "";
}

export function reconnectActivityFallbackContent(
  toolName: string | null | undefined,
): ContentPart[] {
  const tool = toolName?.trim();
  if (!tool || tool === "call-agent") return [];
  return [
    {
      type: "tool-call",
      toolCallId: `reconnect-activity:${tool}`,
      toolName: tool,
      argsText: "",
      args: {},
      activity: true,
    },
  ];
}

function toolCallIdFromContentPart(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const candidate = part as { type?: unknown; toolCallId?: unknown };
  if (candidate.type !== "tool-call") return null;
  return typeof candidate.toolCallId === "string" && candidate.toolCallId
    ? candidate.toolCallId
    : null;
}

function toolCallPartHasResult(part: unknown): boolean {
  if (!part || typeof part !== "object") return false;
  const candidate = part as { type?: unknown; result?: unknown };
  return candidate.type === "tool-call" && "result" in candidate;
}

function toolCallProgressRank(part: unknown): number {
  if (!part || typeof part !== "object") return 0;
  const candidate = part as {
    type?: unknown;
    result?: unknown;
    activity?: unknown;
    argsText?: unknown;
  };
  if (candidate.type !== "tool-call") return 0;
  if ("result" in candidate) return 4;
  if (candidate.activity === true) return 1;
  return typeof candidate.argsText === "string" && candidate.argsText.length > 0
    ? 2
    : 1;
}

function toolCallFingerprintFromContentPart(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const candidate = part as {
    type?: unknown;
    toolName?: unknown;
    argsText?: unknown;
    activity?: unknown;
  };
  if (candidate.type !== "tool-call") return null;
  if (candidate.activity === true) return null;
  const name =
    typeof candidate.toolName === "string" && candidate.toolName
      ? candidate.toolName
      : null;
  const argsText =
    typeof candidate.argsText === "string" ? candidate.argsText : "";
  if (!name || !argsText) return null;
  return `${name}\u0000${argsText}`;
}

function toolCallNameFromContentPart(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const candidate = part as { type?: unknown; toolName?: unknown };
  if (candidate.type !== "tool-call") return null;
  return typeof candidate.toolName === "string" && candidate.toolName
    ? candidate.toolName
    : null;
}

function toolCallIdsRepresentSameLocalCall(
  renderedId: string,
  reconnectId: string,
): boolean {
  return renderedId === reconnectId || renderedId.endsWith(`:${reconnectId}`);
}

function toolCallIdIsReaderLocal(id: string): boolean {
  return (
    /^tc_\d+$/.test(id) ||
    /:tc_\d+$/.test(id) ||
    id.startsWith("reconnect-activity:")
  );
}

function toolCallReaderLocalKey(id: string): string | null {
  const counterMatch = id.match(/(?:^|:)(tc_\d+)$/);
  if (counterMatch?.[1]) return counterMatch[1];
  return id.startsWith("reconnect-activity:") ? id : null;
}

function collectRenderedToolCallStates(messages: readonly unknown[]): {
  byId: Map<string, { rank: number }>;
  latestAssistantByFingerprint: Map<string, { rank: number }>;
  latestAssistantByName: Map<
    string,
    {
      rank: number;
      ids: Set<string>;
      pendingIds: Set<string>;
      pendingRank: number;
    }
  >;
} {
  const byId = new Map<string, { rank: number }>();
  for (const message of messages) {
    const msg = (message as { message?: unknown })?.message ?? message;
    const content = (msg as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const id = toolCallIdFromContentPart(part);
      if (!id) continue;
      const rank = toolCallProgressRank(part);
      const existing = byId.get(id);
      byId.set(id, {
        rank: Math.max(existing?.rank ?? 0, rank),
      });
    }
  }

  const latestAssistantByFingerprint = new Map<string, { rank: number }>();
  const latestAssistantByName = new Map<
    string,
    {
      rank: number;
      ids: Set<string>;
      pendingIds: Set<string>;
      pendingRank: number;
    }
  >();
  const latestEntry = messages.at(-1);
  const latestMessage = getRepoMessage(latestEntry as any);
  const latestContent = latestMessage?.content;
  if (latestMessage?.role === "assistant" && Array.isArray(latestContent)) {
    for (const part of latestContent) {
      const rank = toolCallProgressRank(part);
      const fingerprint = toolCallFingerprintFromContentPart(part);
      if (fingerprint) {
        const existing = latestAssistantByFingerprint.get(fingerprint);
        latestAssistantByFingerprint.set(fingerprint, {
          rank: Math.max(existing?.rank ?? 0, rank),
        });
      }
      const name = toolCallNameFromContentPart(part);
      if (name) {
        const existing = latestAssistantByName.get(name);
        const id = toolCallIdFromContentPart(part);
        const ids = new Set(existing?.ids);
        const pendingIds = new Set(existing?.pendingIds);
        if (id) ids.add(id);
        if (id && rank < 4) pendingIds.add(id);
        latestAssistantByName.set(name, {
          rank: Math.max(existing?.rank ?? 0, rank),
          ids,
          pendingIds,
          pendingRank:
            rank < 4
              ? Math.max(existing?.pendingRank ?? 0, rank)
              : (existing?.pendingRank ?? 0),
        });
      }
    }
  }

  return { byId, latestAssistantByFingerprint, latestAssistantByName };
}

function assistantTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        part?.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
}

function latestRenderedAssistantText(messages: readonly unknown[]): string {
  const latestEntry = messages.at(-1);
  const latestMessage = getRepoMessage(latestEntry as any);
  if (latestMessage?.role !== "assistant") return "";
  return assistantTextFromContent(latestMessage.content);
}

function latestRenderedAssistantReasoning(
  messages: readonly unknown[],
): string[] {
  const latestEntry = messages.at(-1);
  const latestMessage = getRepoMessage(latestEntry as any);
  if (
    latestMessage?.role !== "assistant" ||
    !Array.isArray(latestMessage.content)
  ) {
    return [];
  }
  return latestMessage.content.flatMap((part) =>
    part?.type === "reasoning" &&
    typeof part.text === "string" &&
    part.text.length > 0
      ? [part.text]
      : [],
  );
}

function trimReconnectReasoningAlreadyRendered(
  content: ContentPart[],
  renderedReasoning: readonly string[],
  options?: { trimTailOverlap?: boolean },
): ContentPart[] {
  if (renderedReasoning.length === 0) return content;
  const firstReconnectReasoning = content.find(
    (part): part is Extract<ContentPart, { type: "reasoning" }> =>
      part.type === "reasoning" && part.text.length > 0,
  )?.text;
  let renderedOffset = 0;
  if (options?.trimTailOverlap && firstReconnectReasoning) {
    for (let index = renderedReasoning.length - 1; index >= 0; index -= 1) {
      const rendered = renderedReasoning[index];
      if (
        rendered === firstReconnectReasoning ||
        rendered.startsWith(firstReconnectReasoning) ||
        firstReconnectReasoning.startsWith(rendered) ||
        longestSuffixPrefixOverlap(rendered, firstReconnectReasoning) > 0
      ) {
        renderedOffset = index;
        break;
      }
    }
  }
  let reasoningIndex = 0;
  let changed = false;
  const next: ContentPart[] = [];

  for (const part of content) {
    if (part.type !== "reasoning") {
      next.push(part);
      continue;
    }
    const rendered = renderedReasoning[renderedOffset + reasoningIndex];
    reasoningIndex += 1;
    if (!rendered) {
      next.push(part);
      continue;
    }
    if (rendered === part.text || rendered.startsWith(part.text)) {
      changed = true;
      continue;
    }
    if (part.text.startsWith(rendered)) {
      const tail = part.text.slice(rendered.length);
      if (tail) next.push({ ...part, text: tail });
      changed = true;
      continue;
    }
    if (options?.trimTailOverlap) {
      const overlap = longestSuffixPrefixOverlap(rendered, part.text);
      if (overlap > 0) {
        const tail = part.text.slice(overlap);
        if (tail) next.push({ ...part, text: tail });
        changed = true;
        continue;
      }
    }
    next.push(part);
  }

  return changed ? next : content;
}

function dedupePendingToolCallReplaysWithinContent(
  content: ContentPart[],
): ContentPart[] {
  const laterStatesByFingerprint = new Map<
    string,
    {
      ids: Set<string>;
      readerLocalKeys: Set<string>;
      hasStableId: boolean;
    }
  >();
  let changed = false;
  const nextReversed: ContentPart[] = [];

  for (let i = content.length - 1; i >= 0; i -= 1) {
    const part = content[i];
    if (!part) continue;
    const fingerprint = toolCallFingerprintFromContentPart(part);
    const laterState = fingerprint
      ? laterStatesByFingerprint.get(fingerprint)
      : undefined;
    const id = toolCallIdFromContentPart(part);
    const readerLocalKey = id ? toolCallReaderLocalKey(id) : null;
    const isReaderReplay = Boolean(
      id &&
      laterState &&
      (laterState.ids.has(id) ||
        (readerLocalKey && laterState.readerLocalKeys.has(readerLocalKey)) ||
        (toolCallIdIsReaderLocal(id) && laterState.hasStableId)),
    );
    if (fingerprint && !toolCallPartHasResult(part) && isReaderReplay) {
      changed = true;
      continue;
    }
    if (fingerprint) {
      const state = laterState ?? {
        ids: new Set(),
        readerLocalKeys: new Set(),
        hasStableId: false,
      };
      if (id) {
        state.ids.add(id);
        const key = toolCallReaderLocalKey(id);
        if (key) state.readerLocalKeys.add(key);
        else state.hasStableId = true;
      }
      laterStatesByFingerprint.set(fingerprint, state);
    }
    nextReversed.push(part);
  }

  return changed ? nextReversed.reverse() : content;
}

function pendingToolCallCountsByName(
  content: readonly ContentPart[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const part of content) {
    const name = toolCallNameFromContentPart(part);
    if (!name || toolCallProgressRank(part) >= 4) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function longestSuffixPrefixOverlap(
  renderedText: string,
  reconnectText: string,
): number {
  const maxOverlap = Math.min(renderedText.length, reconnectText.length);
  if (maxOverlap === 0) return 0;

  const pattern = reconnectText.slice(0, maxOverlap);
  const prefixLengths = new Array<number>(pattern.length).fill(0);
  for (let index = 1; index < pattern.length; index += 1) {
    let matched = prefixLengths[index - 1] ?? 0;
    while (matched > 0 && pattern[index] !== pattern[matched]) {
      matched = prefixLengths[matched - 1] ?? 0;
    }
    if (pattern[index] === pattern[matched]) matched += 1;
    prefixLengths[index] = matched;
  }

  let matched = 0;
  const renderedStart = renderedText.length - maxOverlap;
  for (let index = renderedStart; index < renderedText.length; index += 1) {
    const character = renderedText[index];
    while (matched > 0 && character !== pattern[matched]) {
      matched = prefixLengths[matched - 1] ?? 0;
    }
    if (character === pattern[matched]) matched += 1;
    if (matched === pattern.length && index < renderedText.length - 1) {
      matched = prefixLengths[matched - 1] ?? 0;
    }
  }
  return matched;
}

function trimReconnectTextAlreadyRendered(
  content: ContentPart[],
  renderedAssistantText: string,
  options?: { trimTailOverlap?: boolean },
): ContentPart[] {
  if (!renderedAssistantText) return content;

  const reconnectText = assistantTextFromContent(content);
  if (!reconnectText) return content;

  let overlapLength = 0;
  if (reconnectText.startsWith(renderedAssistantText)) {
    overlapLength = renderedAssistantText.length;
  } else if (renderedAssistantText.startsWith(reconnectText)) {
    overlapLength = reconnectText.length;
  } else if (options?.trimTailOverlap) {
    const tailOverlap = longestSuffixPrefixOverlap(
      renderedAssistantText,
      reconnectText,
    );
    if (tailOverlap > 0) {
      const renderedBeforeOverlap =
        renderedAssistantText[renderedAssistantText.length - tailOverlap - 1];
      const reconnectAfterOverlap = reconnectText[tailOverlap];
      const isWordCharacter = (value: string | undefined) =>
        value ? /[\p{L}\p{N}_]/u.test(value) : false;
      const isWholeBoundary =
        !isWordCharacter(renderedBeforeOverlap) &&
        !isWordCharacter(reconnectAfterOverlap);
      if (tailOverlap === reconnectText.length || isWholeBoundary) {
        overlapLength = tailOverlap;
      }
    }
  }

  if (overlapLength === 0) return content;

  let remainingOverlap = overlapLength;
  let changed = false;
  const next: ContentPart[] = [];

  for (const part of content) {
    if (part.type !== "text" || remainingOverlap === 0) {
      next.push(part);
      continue;
    }

    if (part.text.length <= remainingOverlap) {
      remainingOverlap -= part.text.length;
      changed = true;
      continue;
    }

    next.push({ ...part, text: part.text.slice(remainingOverlap) });
    remainingOverlap = 0;
    changed = true;
  }

  return changed ? next : content;
}

/**
 * Whether the reconnect overlay — a SECOND fold of a run, rendered as a sibling
 * of the message list — may appear.
 *
 * The adapter runtime and the reconnect reader both fold the same SSE events
 * into their own accumulator. Whenever both are on screen the user sees the
 * turn twice: duplicate tool cards (one spinning, one static) and the final
 * message streaming in two places. Content-similarity dedupe cannot reliably
 * hide the second copy, because the two readers disagree on tool-call identity
 * (id-less activity cards get reader-local ids) and on how a turn is split
 * across assistant messages.
 *
 * So ownership decides visibility, not similarity: if a runtime owns the turn,
 * the overlay does not render. Keep this a pure function — it is the invariant
 * the duplicate-render bug kept violating, and it must stay falsifiable.
 */
export function shouldShowReconnectOverlay(state: {
  isRuntimeRunning: boolean;
  isReconnecting: boolean;
  reconnectFrozen: boolean;
  reconnectOwnsStream?: boolean;
}): boolean {
  if (state.isRuntimeRunning) return false;
  if (state.reconnectOwnsStream === false) return false;
  return state.isReconnecting || state.reconnectFrozen;
}

export function dedupeReconnectContentAgainstMessages(
  content: ContentPart[],
  messages: readonly unknown[],
  options?: {
    suppressToolRepeats?: boolean;
    trimTailTextOverlap?: boolean;
  },
): ContentPart[] {
  if (content.length === 0) return content;
  const snapshotDeduped = dedupePendingToolCallReplaysWithinContent(content);
  const reconnectPendingCounts = pendingToolCallCountsByName(snapshotDeduped);
  let changed = snapshotDeduped !== content;
  if (messages.length === 0) return changed ? snapshotDeduped : content;
  const { byId, latestAssistantByFingerprint, latestAssistantByName } =
    collectRenderedToolCallStates(messages);
  const renderedAssistantText = latestRenderedAssistantText(messages);
  const renderedAssistantReasoning = latestRenderedAssistantReasoning(messages);
  if (
    byId.size === 0 &&
    latestAssistantByFingerprint.size === 0 &&
    latestAssistantByName.size === 0 &&
    !renderedAssistantText &&
    renderedAssistantReasoning.length === 0
  ) {
    return changed ? snapshotDeduped : content;
  }

  const filtered =
    byId.size > 0 ||
    latestAssistantByFingerprint.size > 0 ||
    latestAssistantByName.size > 0
      ? snapshotDeduped.filter((part) => {
          const reconnectRank = toolCallProgressRank(part);
          const id = toolCallIdFromContentPart(part);
          const existing = id ? byId.get(id) : undefined;
          if (existing) {
            if (options?.suppressToolRepeats) {
              changed = true;
              return false;
            }
            if (reconnectRank <= existing.rank) {
              changed = true;
              return false;
            }
            return true;
          }
          const fingerprint = toolCallFingerprintFromContentPart(part);
          const latestByFingerprint = fingerprint
            ? latestAssistantByFingerprint.get(fingerprint)
            : undefined;
          const isCompletedRepeat =
            reconnectRank >= 4 && latestByFingerprint?.rank === 4;
          const keepCompletedRepeat =
            isCompletedRepeat && !options?.suppressToolRepeats;
          if (latestByFingerprint && options?.suppressToolRepeats) {
            changed = true;
            return false;
          }
          if (
            latestByFingerprint &&
            !keepCompletedRepeat &&
            reconnectRank <= latestByFingerprint.rank
          ) {
            changed = true;
            return false;
          }
          if (!fingerprint) {
            const name = toolCallNameFromContentPart(part);
            const latestByName = name
              ? latestAssistantByName.get(name)
              : undefined;
            const reconnectPendingCount = name
              ? (reconnectPendingCounts.get(name) ?? 0)
              : 0;
            const hasReaderLocalIdentity = Boolean(
              (id && toolCallIdIsReaderLocal(id)) ||
              (latestByName &&
                Array.from(latestByName.pendingIds).some(
                  toolCallIdIsReaderLocal,
                )),
            );
            if (
              options?.suppressToolRepeats &&
              latestByName &&
              latestByName.pendingIds.size === 1 &&
              reconnectPendingCount === 1 &&
              hasReaderLocalIdentity &&
              latestByName.pendingRank >= reconnectRank
            ) {
              changed = true;
              return false;
            }
            const matchesRenderedLocalId =
              id && latestByName
                ? Array.from(latestByName.ids).some((renderedId) =>
                    toolCallIdsRepresentSameLocalCall(renderedId, id),
                  )
                : false;
            const matchesRenderedPendingLocalId =
              id && latestByName
                ? Array.from(latestByName.pendingIds).some((renderedId) =>
                    toolCallIdsRepresentSameLocalCall(renderedId, id),
                  )
                : false;
            if (
              latestByName &&
              matchesRenderedLocalId &&
              matchesRenderedPendingLocalId &&
              reconnectRank <= latestByName.pendingRank
            ) {
              changed = true;
              return false;
            }
          }
          return true;
        })
      : snapshotDeduped;
  const reasoningDeduped = trimReconnectReasoningAlreadyRendered(
    filtered,
    renderedAssistantReasoning,
    { trimTailOverlap: options?.trimTailTextOverlap },
  );
  if (reasoningDeduped !== filtered) changed = true;
  const textDeduped = trimReconnectTextAlreadyRendered(
    reasoningDeduped,
    renderedAssistantText,
    { trimTailOverlap: options?.trimTailTextOverlap },
  );
  if (textDeduped !== reasoningDeduped) changed = true;
  return changed ? textDeduped : content;
}

const RECOVERY_USER_MESSAGE_PREFIXES = [
  "Continue from where you left off",
  "Continue from where you stopped",
  "Retry the previous request from a clean approach",
];

function protocolMessageCustomMetadata(
  message: unknown,
): Record<string, unknown> | undefined {
  const metadata = (message as { metadata?: unknown })?.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const custom = (metadata as { custom?: unknown }).custom;
  return custom && typeof custom === "object"
    ? (custom as Record<string, unknown>)
    : undefined;
}

function protocolMessageTurnId(message: unknown): string | undefined {
  const turnId = protocolMessageCustomMetadata(message)?.turnId;
  return typeof turnId === "string" && turnId ? turnId : undefined;
}

export function protocolContinuationContext(
  messages: readonly unknown[],
  turnId: string | undefined,
): { turnId?: string; actionScope?: AgentActionScope } {
  if (!turnId) return {};
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (protocolMessageTurnId(message) !== turnId) continue;
    const custom = protocolMessageCustomMetadata(message);
    if (!custom || !Object.hasOwn(custom, "actionScope")) continue;
    return {
      turnId,
      actionScope: normalizeAgentActionScope(custom.actionScope),
    };
  }
  return { turnId };
}

export function latestProtocolContinuationContext(
  messages: readonly unknown[],
): { turnId?: string; actionScope?: AgentActionScope } {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const turnId = protocolMessageTurnId(messages[index]);
    if (turnId) return protocolContinuationContext(messages, turnId);
  }
  return {};
}

export function approvalProtocolContinuationContext(
  messages: readonly unknown[],
  approvalKey: string,
): { turnId?: string; actionScope?: AgentActionScope } {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: unknown; content?: unknown };
    if (message?.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }
    const hasApproval = message.content.some((part) => {
      if (!part || typeof part !== "object") return false;
      const approval = (part as { approval?: unknown }).approval;
      return (
        approval !== null &&
        typeof approval === "object" &&
        (approval as { approvalKey?: unknown }).approvalKey === approvalKey
      );
    });
    if (!hasApproval) continue;
    const turnId = protocolMessageTurnId(message);
    if (turnId) return protocolContinuationContext(messages, turnId);
    return latestProtocolContinuationContext(messages.slice(0, index + 1));
  }
  return {};
}

function getRecoveryActionMetadata(
  message: unknown,
): AgentRecoveryAction | null {
  const meta = (message as { metadata?: unknown })?.metadata as
    | { custom?: { agentNativeRecoveryAction?: unknown } }
    | undefined;
  const action = meta?.custom?.agentNativeRecoveryAction;
  return action === "continue" || action === "retry" ? action : null;
}

function isRecoveryUserMessage(message: unknown): boolean {
  if (getRecoveryActionMetadata(message)) return true;
  const text = getMessageText(message);
  return RECOVERY_USER_MESSAGE_PREFIXES.some((prefix) =>
    text.startsWith(prefix),
  );
}

export function latestNonRecoveryUserMessageText(
  messages: readonly unknown[],
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: unknown };
    if (message?.role !== "user") continue;
    if (isRecoveryUserMessage(message)) continue;
    const text = getMessageText(message);
    if (text) return text;
  }
  return "";
}

export function resolveAssistantChatSuggestionInputs(
  resolvedPrompts: readonly string[] | undefined,
  providedSuggestions: readonly AgentSuggestionInput[] | undefined,
): AgentSuggestionInput[] | undefined {
  if (!resolvedPrompts || resolvedPrompts.length === 0) return undefined;

  const providedByPrompt = new Map(
    (providedSuggestions ?? []).map((suggestion) => [
      agentSuggestionPrompt(suggestion),
      suggestion,
    ]),
  );
  return resolvedPrompts.map(
    (prompt) => providedByPrompt.get(prompt) ?? prompt,
  );
}

export function resolveAssistantChatSubmitIntent({
  isRunning,
  isSubmissionInFlight = false,
  requestedIntent,
}: {
  isRunning: boolean;
  isSubmissionInFlight?: boolean;
  requestedIntent?: ComposerSubmitIntent;
}): ComposerSubmitIntent {
  if (isRunning || isSubmissionInFlight) return "queued";
  return requestedIntent ?? "immediate";
}

export function resolveAssistantChatRunningState({
  forceStopped,
  isRuntimeRunning,
  isReconnecting,
  optimisticRunning,
  isAutoResuming,
  hasActiveServerRun,
  hasTerminalRunError,
}: {
  forceStopped: boolean;
  isRuntimeRunning: boolean;
  isReconnecting: boolean;
  optimisticRunning: boolean;
  isAutoResuming: boolean;
  hasActiveServerRun?: boolean;
  hasTerminalRunError?: boolean;
}): { isRunning: boolean; showRunningInUI: boolean } {
  const isRunning =
    !forceStopped &&
    (isRuntimeRunning ||
      isReconnecting ||
      optimisticRunning ||
      Boolean(hasActiveServerRun));
  return {
    isRunning,
    showRunningInUI:
      !forceStopped && !hasTerminalRunError && (isRunning || isAutoResuming),
  };
}

export function resolveAssistantChatRunningStatusLabel({
  runningActivityLabel,
  runningActivityTool,
  isAutoResuming,
  isReconnecting,
  hasReconnectContent,
  labels = {
    thinking: "Thinking",
    resuming: "Resuming",
    stillWorking: "Still working",
  },
}: {
  runningActivityLabel: string | null | undefined;
  runningActivityTool?: string | null;
  isAutoResuming: boolean;
  isReconnecting: boolean;
  hasReconnectContent: boolean;
  labels?: {
    thinking: string;
    resuming: string;
    stillWorking: string;
    working?: string;
    contactingModel?: string;
    starting?: (activity: string) => string;
    preparing?: (activity: string) => string;
    writing?: (activity: string) => string;
    stillGenerating?: (activity: string) => string;
    runningTool?: (toolName: string) => string;
    toolDisplayName?: (toolName: string) => string;
  };
}): string {
  if (runningActivityLabel) {
    if (runningActivityLabel === "Thinking") return labels.thinking;
    if (runningActivityLabel === "Working") {
      return labels.working ?? "Working";
    }
    if (runningActivityLabel === "Contacting model") {
      return labels.contactingModel ?? "Contacting model";
    }
    const activityTool = runningActivityTool?.trim();
    if (
      activityTool &&
      labels.runningTool &&
      runningActivityLabel === runningToolLabel(activityTool)
    ) {
      return labels.runningTool(activityTool);
    }
    const localizedActivityPatterns: Array<
      [RegExp, ((activity: string) => string) | undefined]
    > = [
      [/^Starting (.+)\.\.\.$/, labels.starting],
      [/^Preparing (.+)\.\.\.$/, labels.preparing],
      [/^Writing (.+)\.\.\.$/, labels.writing],
      [/^Still generating (.+)$/, labels.stillGenerating],
    ];
    for (const [pattern, translateActivity] of localizedActivityPatterns) {
      const match = runningActivityLabel.match(pattern);
      if (match?.[1] && translateActivity) {
        const activity =
          activityTool &&
          labels.toolDisplayName &&
          match[1] === humanizeToolName(activityTool)
            ? labels.toolDisplayName(activityTool)
            : match[1];
        return translateActivity(activity);
      }
    }
    return runningActivityLabel;
  }
  if (isAutoResuming) return labels.resuming;
  if (isReconnecting && hasReconnectContent) return labels.stillWorking;
  return labels.thinking;
}

export function resolveAssistantChatComposerPlaceholder(
  composerPlaceholder: string | null | undefined,
): string {
  return composerPlaceholder ?? DEFAULT_ASSISTANT_CHAT_COMPOSER_PLACEHOLDER;
}

function contentHasVisibleTailReasoning(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const part = content[index];
    if (!part || typeof part !== "object") continue;
    const candidate = part as { type?: unknown; text?: unknown };
    if (
      (candidate.type === "text" || candidate.type === "reasoning") &&
      (typeof candidate.text !== "string" || candidate.text.trim().length === 0)
    ) {
      continue;
    }
    return candidate.type === "reasoning";
  }
  return false;
}

function contentHasActiveToolCall(
  content: unknown,
  toolName?: string | null,
): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    if (!part || typeof part !== "object") return false;
    const candidate = part as {
      type?: unknown;
      toolName?: unknown;
      result?: unknown;
    };
    return (
      candidate.type === "tool-call" &&
      candidate.result === undefined &&
      (!toolName || candidate.toolName === toolName)
    );
  });
}

export function shouldShowGlobalRunningStatus({
  showRunningInUI,
  runningActivityLabel,
  runningActivityTool,
  latestMessage,
  reconnectContent,
}: {
  showRunningInUI: boolean;
  runningActivityLabel: string | null | undefined;
  runningActivityTool?: string | null;
  latestMessage: unknown;
  reconnectContent: readonly ContentPart[];
}): boolean {
  if (!showRunningInUI) return false;

  const message =
    latestMessage && typeof latestMessage === "object"
      ? (latestMessage as { role?: unknown; content?: unknown })
      : null;
  const latestMessageHasTailReasoning =
    message?.role === "assistant" &&
    contentHasVisibleTailReasoning(message.content);
  const latestMessageHasActiveTool =
    message?.role === "assistant" && contentHasActiveToolCall(message.content);
  const reconnectHasActiveTool = contentHasActiveToolCall(reconnectContent);
  const reconnectHasTailReasoning =
    contentHasVisibleTailReasoning(reconnectContent);
  const matchingActivityToolIsVisible = Boolean(
    runningActivityTool &&
    ((message?.role === "assistant" &&
      contentHasActiveToolCall(message.content, runningActivityTool)) ||
      contentHasActiveToolCall(reconnectContent, runningActivityTool)),
  );

  if (runningActivityLabel && matchingActivityToolIsVisible) {
    return false;
  }
  if (
    !runningActivityLabel &&
    (latestMessageHasActiveTool || reconnectHasActiveTool)
  ) {
    return false;
  }
  if (
    runningActivityLabel === "Thinking" &&
    (latestMessageHasActiveTool ||
      reconnectHasActiveTool ||
      latestMessageHasTailReasoning ||
      reconnectHasTailReasoning)
  ) {
    return false;
  }
  if (runningActivityLabel) return true;

  return (
    !latestMessageHasActiveTool &&
    !reconnectHasActiveTool &&
    !latestMessageHasTailReasoning &&
    !reconnectHasTailReasoning
  );
}

export function assistantChatAutoscrollStatusKey({
  showGlobalRunningStatus,
  runningStatusLabel,
}: {
  showGlobalRunningStatus: boolean;
  runningStatusLabel: string;
}): string {
  return showGlobalRunningStatus ? runningStatusLabel : "idle";
}

type QueuedMessage = {
  id: string;
  text: string;
  promoted?: boolean;
  images?: string[];
  attachments?: QueuedAttachment[];
  references?: Reference[];
  requestMode?: AgentRequestMode;
  recoveryAction?: AgentRecoveryAction;
  trackInRunsTray?: boolean;
  hideUserMessage?: boolean;
  approvedToolCalls?: string[];
  turnId?: string;
  usageLabel?: string;
  actionScope?: AgentActionScope;
  model?: string;
  engine?: string;
  effort?: ReasoningEffort;
};

export function hoistQueuedMessageToFront<T extends { id: string }>(
  messages: readonly T[],
  id: string,
): T[] {
  const target = messages.find((message) => message.id === id);
  if (!target) return [...messages];
  return [target, ...messages.filter((message) => message.id !== id)];
}

export function promoteQueuedMessage<T extends { id: string }>(
  messages: readonly T[],
  id: string,
): T[] {
  return hoistQueuedMessageToFront(messages, id).map((message) =>
    message.id === id ? { ...message, promoted: true } : message,
  );
}

export function queuedMessageImageSources(
  message: Pick<QueuedMessage, "attachments" | "images">,
): string[] {
  const sources = new Set<string>();

  // ponytail: cap queue previews at four; all references remain queued and are sent on dequeue.
  for (const attachment of message.attachments ?? []) {
    for (const part of attachment.content) {
      if (
        part.type === "image" &&
        "image" in part &&
        typeof part.image === "string" &&
        part.image.trim().length > 0
      ) {
        sources.add(part.image);
      }
      if (sources.size === 4) return [...sources];
    }
  }
  for (const image of message.images ?? []) {
    if (image.trim().length === 0) continue;
    sources.add(image);
    if (sources.size === 4) break;
  }

  return [...sources];
}

function AssistantChatUserMessageItem() {
  const messageRuntime = useMessageRuntime();
  const message = messageRuntime.getState();
  if (isHiddenUserMessage(message)) return null;
  return (
    <MessageScrollerItem messageId={message.id}>
      <UserMessage />
    </MessageScrollerItem>
  );
}

function AssistantChatAssistantMessageItem() {
  const messageRuntime = useMessageRuntime();
  const message = messageRuntime.getState();
  return (
    <MessageScrollerItem messageId={message.id}>
      <AssistantMessage />
    </MessageScrollerItem>
  );
}

function AssistantChatScrollerControls({
  resumeFollowingRef,
}: {
  resumeFollowingRef: React.MutableRefObject<() => void>;
}) {
  const { scrollToEnd } = useMessageScroller();

  useBrowserLayoutEffect(() => {
    resumeFollowingRef.current = () => {
      scrollToEnd({ behavior: "auto" });
    };
    return () => {
      resumeFollowingRef.current = () => {};
    };
  }, [resumeFollowingRef, scrollToEnd]);

  return null;
}


export interface AssistantChatHandle {
  sendMessage(
    text: string,
    images?: string[],
    options?: AssistantChatSendOptions,
  ): void;
  implementPlan(): boolean;
  prefillMessage(text: string): void;
  setComposerContextItem(
    item: AgentChatContextItem,
    options?: { focus?: boolean },
  ): void;
  removeComposerContextItem(key: string): void;
  clearComposerContextItems(): void;
  sendRecoveryMessage(
    text: string,
    recoveryAction: AgentRecoveryAction,
    images?: string[],
  ): void;
  queueMessage(text: string, images?: string[]): void;
  isRunning(): boolean;
  hasInFlightWork(): boolean;
  focusComposer(): void;
  exportThreadSnapshot(): ChatThreadSnapshot | null;
}

export type AssistantChatThreadFooterSlot =
  | React.ReactNode
  | ((context: {
      threadId: string | null;
      tabId: string | null;
    }) => React.ReactNode);

export type AssistantChatSuggestionVisibility =
  | "always"
  | "after-agent-response";

export function shouldShowAssistantChatSuggestions(
  visibility: AssistantChatSuggestionVisibility,
  hasAssistantMessage: boolean,
): boolean {
  return visibility === "always" || hasAssistantMessage;
}

export interface AssistantChatAdapterContext {
  apiUrl: string;
  streamingUrl?: string;
  tabId?: string;
  threadId?: string;
  modelRef: { current: string | undefined };
  engineRef: { current: string | undefined };
  effortRef: { current: ReasoningEffort | undefined };
  harnessRef?: { current: string | undefined };
  hostedHarnessRef?: { current: boolean };
  execModeRef: { current: "build" | "plan" | undefined };
  browserTabId?: string;
  scopeRef: { current: ChatThreadScope | null | undefined };
  surface: AgentChatSurfaceKind;
}

export async function restoreAssistantChatHistoryVersion<
  TVersion extends AssistantChatHistoryVersion,
  TRestoreResult,
>(options: {
  history: AssistantChatHistoryConfig<unknown, TVersion, TRestoreResult>;
  version: TVersion;
  restore: (args: Record<string, unknown>) => Promise<TRestoreResult>;
  refetch: () => Promise<unknown>;
  onRefetchError: (error: unknown) => void;
}) {
  await options.history.restore.beforeRestore?.();
  const args = await options.history.restore.args(options.version);
  const restored = await options.restore(args);
  let applicationFailed = false;
  let applicationError: unknown;
  try {
    await options.history.restore.onRestored?.(restored, options.version);
  } catch (error) {
    applicationFailed = true;
    applicationError = error;
  }
  try {
    await options.refetch();
  } catch (error) {
    options.onRefetchError(error);
  }
  if (applicationFailed) throw applicationError;
}

export interface AssistantChatProps {
  apiUrl?: string;
  streamingUrl?: string;
  tabId?: string;
  browserTabId?: string;
  threadId?: string;
  contextScope?: ChatThreadScope | null;
  chatHistory?: AssistantChatHistoryConfig<any, any, any>;
  isolateHistoryByScope?: boolean;
  contextNamespace?: string;
  isActiveComposer?: boolean;
  agentChatSurface?: AgentChatSurfaceKind;
  desktopIdentityUnauthenticated?: boolean;
  desktopIdentityAuthenticated?: boolean;
  suppressInlineOpenApp?: boolean;
  emptyStateText?: string;
  suggestions?: AgentSuggestionInput[];
  dynamicSuggestions?: AgentDynamicSuggestionsOption;
  suggestionPlacement?: "empty-state" | "context-chips" | "hidden";
  suggestionVisibility?: AssistantChatSuggestionVisibility;
  threadContentSlot?: AssistantChatThreadFooterSlot;
  threadFooterSlot?: AssistantChatThreadFooterSlot;
  emptyStateAddon?: React.ReactNode;
  emptyStateFooter?: React.ReactNode;
  showHeader?: boolean;
  className?: string;
  onSwitchToCli?: () => void;
  onMessageCountChange?: (count: number) => void;
  onSaveThread?: (
    threadId: string,
    data: {
      threadData: string;
      title: string;
      preview: string;
      messageCount: number;
    },
  ) => void;
  onGenerateTitle?: (threadId: string, message: string) => void;
  composerSlot?: React.ReactNode;
  onComposerTextChange?: (text: string) => void;
  composerAreaClassName?: string;
  composerPlaceholder?: string;
  missingApiKeySetupLayout?: BuilderSetupCardLayout;
  composerLayoutVariant?: AgentComposerLayoutVariant;
  centerComposerWhenEmpty?: boolean;
  emptyStateDisplay?: "default" | "hidden";
  composerToolbarSlot?: React.ReactNode;
  composerExtraActionButton?: React.ReactNode;
  showModelSelector?: boolean;
  composerDisabled?: boolean;
  composerDisabledPlaceholder?: string;
  isNewThread?: boolean;
  onThreadRestoreNotFound?: () => void;
  isThreadStateLoading?: boolean;
  onSlashCommand?: (command: string) => void;
  execMode?: "build" | "plan";
  onExecModeChange?: (mode: "build" | "plan") => void;
  planModeDisabled?: boolean;
  planModeDisabledReason?: string;
  selectedModel?: string;
  defaultModel?: string;
  selectedEngine?: string;
  selectedEffort?: ReasoningEffort;
  availableModels?: Array<{
    engine: string;
    label: string;
    models: string[];
    configured: boolean;
  }>;
  modelListLoading?: boolean;
  onModelChange?: (model: string, engine: string) => void;
  onEffortChange?: (effort: ReasoningEffort) => void;
  availableAgents?: ComposerAgentOption[];
  selectedAgent?: string;
  hostedHarness?: boolean;
  onAgentChange?: (agent: string) => void;
  imageModelMenu?: ComposerImageModelMenu;
  onForkChat?: () => void | boolean | Promise<void | boolean>;
  onConnectProvider?: () => void;
  onConnectLocalRuntime?: (engine: string) => void;
  plusMenuMode?: "full" | "upload-only" | "hidden";
  providerStatusChecksEnabled?: boolean;
  createAdapter?: (context: AssistantChatAdapterContext) => ChatModelAdapter;
  runtime?: AgentChatRuntime;
  adapterReloadKey?: unknown;
  loadHistoryRepository?: () => Promise<ExportedMessageRepository | null>;
  historyReloadKey?: string | number | null;
  externalStreaming?: boolean;
  externalUserStopped?: boolean;
  onStop?: () => void | Promise<unknown>;
  approvalActions?: {
    onDeny?: (approvalKey: string) => void;
    onAlwaysAllow?: (
      approvalKey: string,
      toolName: string,
    ) => void | Promise<void>;
    alwaysAllowScope?: "action" | "exact-command";
  };
  thinkingDisplay?: ThinkingDisplay;
}

export function shouldShowAssistantChatModelSelector(
  showModelSelector: boolean | undefined,
): boolean {
  return showModelSelector !== false;
}

export const CHAT_STORAGE_PREFIX = "agent-chat:";
const THREAD_SNAPSHOT_CACHE_PREFIX = `${CHAT_STORAGE_PREFIX}thread-snapshot:`;

function threadSnapshotCacheKey(apiUrl: string, threadId: string): string {
  return `${THREAD_SNAPSHOT_CACHE_PREFIX}${apiUrl}:${threadId}`;
}

function normalizeCachedThreadSnapshot(
  value: unknown,
): ChatThreadSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<ChatThreadSnapshot>;
  if (typeof snapshot.threadData !== "string") return null;
  return {
    threadData: snapshot.threadData,
    title: typeof snapshot.title === "string" ? snapshot.title : "",
    preview: typeof snapshot.preview === "string" ? snapshot.preview : "",
    messageCount:
      typeof snapshot.messageCount === "number" &&
      Number.isFinite(snapshot.messageCount)
        ? snapshot.messageCount
        : 0,
  };
}

function readCachedThreadSnapshot(
  apiUrl: string,
  threadId?: string,
): ChatThreadSnapshot | null {
  if (!threadId || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(
      threadSnapshotCacheKey(apiUrl, threadId),
    );
    return raw ? normalizeCachedThreadSnapshot(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCachedThreadSnapshot(
  apiUrl: string,
  threadId: string | undefined,
  snapshot: ChatThreadSnapshot,
) {
  if (!threadId || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      threadSnapshotCacheKey(apiUrl, threadId),
      JSON.stringify(snapshot),
    );
  } catch {}
}

export function clearChatStorage(tabId?: string) {
  try {
    sessionStorage.removeItem(`${CHAT_STORAGE_PREFIX}${tabId || "default"}`);
  } catch {}
}

export function ensureMessageMetadata(repo: any): any {
  repo = dropEmptyAssistantMessages(dedupeRepoMessagesById(repo));
  if (!repo?.messages || !Array.isArray(repo.messages)) return repo;
  const messages = repo.messages.map((entry: any) => {
    const msg = entry?.message ?? entry;
    if (!msg) return entry;
    const next = { ...msg, metadata: msg.metadata ?? {} };
    if (next.role === "assistant") {
      const statusType =
        next.status && typeof next.status === "object"
          ? (next.status as { type?: unknown }).type
          : undefined;
      const isTerminal =
        statusType === "complete" || statusType === "incomplete";
      if (!isTerminal) {
        const runError =
          next.metadata?.custom?.runError ?? next.metadata?.runError;
        next.status = runError
          ? { type: "incomplete", reason: "error" }
          : { type: "complete", reason: "stop" };
      }
      if (Array.isArray(next.content)) {
        next.content = next.content.map((part: any) =>
          part?.type === "tool-call" ? { ...part } : part,
        );
        settleInterruptedToolCalls(next.content);
      }
    }
    return entry?.message ? { ...entry, message: next } : next;
  });
  return { ...repo, messages };
}

import {
  extractThreadMeta,
  normalizeThreadRepository,
} from "../agent/thread-data-builder.js";
export { extractThreadMeta };

function stripBase64FromRepo(repo: unknown): unknown {
  if (!repo || typeof repo !== "object") return repo;
  const r = repo as Record<string, unknown>;
  if (!Array.isArray(r.messages)) return repo;

  const messages = r.messages.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") return entry;
    const e = entry as Record<string, unknown>;
    const msg = (e.message ?? e) as Record<string, unknown> | null;
    if (!msg || typeof msg !== "object") return entry;

    const attachments = msg.attachments;
    if (!Array.isArray(attachments)) return entry;

    const strippedAttachments = attachments.map((att: unknown) => {
      if (!att || typeof att !== "object") return att;
      const a = att as Record<string, unknown>;
      const meta = a.metadata as Record<string, unknown> | undefined;
      if (!meta?.uploadUrl) return att;

      if (!Array.isArray(a.content)) return att;
      const strippedContent = a.content.map((part: unknown) => {
        if (!part || typeof part !== "object") return part;
        const p = part as Record<string, unknown>;
        if (
          p.type === "image" &&
          typeof p.image === "string" &&
          p.image.startsWith("data:")
        ) {
          return { ...p, image: meta.uploadUrl };
        }
        if (
          p.type === "file" &&
          typeof p.data === "string" &&
          p.data.startsWith("data:")
        ) {
          const { data: _d, ...rest } = p;
          return { ...rest, url: meta.uploadUrl };
        }
        return part;
      });
      return { ...a, content: strippedContent };
    });

    const strippedMsg = { ...msg, attachments: strippedAttachments };
    if (e.message !== undefined) {
      return { ...e, message: strippedMsg };
    }
    return strippedMsg;
  });

  return { ...r, messages };
}

export function useAutoResumeStatus(
  tabId: string | undefined,
  forceStopped: boolean,
): { isAutoResuming: boolean; clearAutoResume: () => void } {
  const [isAutoResuming, setIsAutoResuming] = useState(false);
  const autoResumeTimerRef = useRef<number | null>(null);

  const clearAutoResume = useCallback(() => {
    if (autoResumeTimerRef.current !== null) {
      window.clearTimeout(autoResumeTimerRef.current);
      autoResumeTimerRef.current = null;
    }
    setIsAutoResuming(false);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tabId?: string };
      if (tabId && detail?.tabId && detail.tabId !== tabId) return;
      if (autoResumeTimerRef.current !== null) {
        window.clearTimeout(autoResumeTimerRef.current);
      }
      setIsAutoResuming(true);
      autoResumeTimerRef.current = window.setTimeout(() => {
        autoResumeTimerRef.current = null;
        setIsAutoResuming(false);
      }, AUTO_RESUME_STATUS_TIMEOUT_MS);
    };
    window.addEventListener("agent-chat:auto-continue", handler);
    return () => {
      if (autoResumeTimerRef.current !== null) {
        window.clearTimeout(autoResumeTimerRef.current);
        autoResumeTimerRef.current = null;
      }
      window.removeEventListener("agent-chat:auto-continue", handler);
    };
  }, [tabId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tabId?: string };
      if (tabId && detail?.tabId && detail.tabId !== tabId) return;
      clearAutoResume();
    };
    window.addEventListener("agent-chat:stream-progress", handler);
    return () =>
      window.removeEventListener("agent-chat:stream-progress", handler);
  }, [clearAutoResume, tabId]);

  useEffect(() => {
    if (forceStopped) {
      clearAutoResume();
    }
  }, [clearAutoResume, forceStopped]);

  return { isAutoResuming, clearAutoResume };
}

function approvalResolutionIdentity(
  approvalKey: string,
  toolCallId?: string,
  askId?: string,
): string {
  return `${toolCallId ?? ""}\u0000${approvalKey}\u0000${askId ?? ""}`;
}

const AssistantChatInner = forwardRef<
  AssistantChatHandle,
  AssistantChatProps & { apiUrl: string }
>(function AssistantChatInner(
  {
    emptyStateText,
    suggestions,
    dynamicSuggestions,
    suggestionPlacement = "empty-state",
    suggestionVisibility = "always",
    threadContentSlot,
    threadFooterSlot,
    emptyStateFooter,
    emptyStateAddon,
    showHeader = true,
    onSwitchToCli,
    className,
    apiUrl,
    tabId,
    browserTabId,
    threadId,
    contextScope,
    chatHistory,
    isolateHistoryByScope = false,
    contextNamespace,
    isActiveComposer = true,
    onMessageCountChange,
    onSaveThread,
    onGenerateTitle,
    composerSlot,
    onComposerTextChange,
    composerAreaClassName,
    composerPlaceholder,
    missingApiKeySetupLayout = "default",
    composerLayoutVariant = "default",
    centerComposerWhenEmpty = false,
    emptyStateDisplay = "default",
    composerToolbarSlot,
    composerExtraActionButton,
    showModelSelector = true,
    composerDisabled = false,
    composerDisabledPlaceholder,
    isNewThread,
    isThreadStateLoading,
    onSlashCommand,
    execMode,
    onExecModeChange,
    approvalActions,
    planModeDisabled,
    planModeDisabledReason,
    selectedModel,
    defaultModel,
    selectedEngine,
    selectedEffort,
    availableModels,
    modelListLoading,
    onModelChange,
    onEffortChange,
    availableAgents,
    selectedAgent,
    hostedHarness,
    onAgentChange,
    imageModelMenu,
    onForkChat,
    onConnectProvider,
    onConnectLocalRuntime,
    plusMenuMode = "full",
    providerStatusChecksEnabled = true,
    loadHistoryRepository,
    historyReloadKey,
    externalStreaming = false,
    externalUserStopped = false,
    onStop,
    agentChatSurface = "app",
    desktopIdentityUnauthenticated = false,
    desktopIdentityAuthenticated = false,
    onThreadRestoreNotFound,
    suppressInlineOpenApp = false,
  },
  ref,
) {
  const t = useT();
  const thread = useThread();
  const threadRuntime = useThreadRuntime();
  const composerRuntime = useComposerRuntime();
  const isRuntimeRunning = thread.isRunning;
  const isRuntimeRunningRef = useRef(isRuntimeRunning);
  isRuntimeRunningRef.current = isRuntimeRunning;
  const messages = thread.messages;
  const showSuggestions = shouldShowAssistantChatSuggestions(
    suggestionVisibility,
    messages.some((message) => message.role === "assistant"),
  );
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const staticSuggestionPrompts = useMemo(
    () => suggestions?.map(agentSuggestionPrompt),
    [suggestions],
  );
  const { suggestions: resolvedSuggestions } = useAgentDynamicSuggestionsResult(
    {
      staticSuggestions: staticSuggestionPrompts,
      dynamicSuggestions,
      browserTabId,
      scope: contextScope,
      enabled: suggestionPlacement === "context-chips" || messages.length === 0,
    },
  );
  const resolvedSuggestionInputs = useMemo(
    () =>
      resolveAssistantChatSuggestionInputs(resolvedSuggestions, suggestions),
    [resolvedSuggestions, suggestions],
  );
  const messageListResetKey = useMemo(
    () => assistantUiMessageListStructureKey(messages),
    [messages],
  );
  const threadScopeQuery = useMemo(() => {
    if (!isolateHistoryByScope || !contextScope) return "";
    const params = new URLSearchParams();
    appendChatThreadScopeParams(params, contextScope);
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [contextScope?.id, contextScope?.type, isolateHistoryByScope]);

  const [dropActive, setDropActive] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const composerDraftScope = tabId || threadId;
  const initialComposerText = useMemo(
    () => readAssistantChatComposerDraft(composerDraftScope),
    [composerDraftScope],
  );
  useEffect(() => {
    const restoredText = initialComposerText ?? "";
    if (!isActiveComposer) return;
    onComposerTextChange?.(restoredText);
  }, [initialComposerText, isActiveComposer, onComposerTextChange]);
  const handleComposerTextChange = useCallback(
    (text: string) => {
      writeAssistantChatComposerDraft(composerDraftScope, text);
      onComposerTextChange?.(text);
    },
    [composerDraftScope, onComposerTextChange],
  );
  const dropDepthRef = useRef(0);
  const handleChatDragEnter = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    e.preventDefault();
    dropDepthRef.current += 1;
    setDropActive(true);
  }, []);
  const handleChatDragOver = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }, []);
  const handleChatDragLeave = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
    if (dropDepthRef.current === 0) setDropActive(false);
  }, []);
  const handleChatDropCapture = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    dropDepthRef.current = 0;
    setDropActive(false);
  }, []);
  const handleChatDrop = useCallback(
    (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      dropDepthRef.current = 0;
      setDropActive(false);
      if (e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      const attachments = files.map((file) => {
        if (!file.type.startsWith("image/")) return file;
        const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;
        return new File([file], uniqueName, { type: file.type });
      });
      void Promise.all(
        attachments.map((file) => composerRuntime.addAttachment(file)),
      ).catch((error) => {
        const msg = formatAttachmentError(
          error,
          t("agentChat.composer.droppedFileError"),
        );
        setComposerError(msg);
      });
    },
    [composerRuntime, setComposerError, t],
  );

  useEffect(
    () => installAssistantUiMessageRepositoryRecovery(threadRuntime),
    [threadRuntime],
  );
  const agentEngineConfigured = useAgentEngineConfigured(
    providerStatusChecksEnabled,
    { tabId, threadId },
  );
  const modelCatalogMissing = modelCatalogConfirmsMissing(
    availableModels,
    modelListLoading,
  );
  const missingApiKey =
    agentEngineConfigured.state !== "configured" &&
    (agentEngineConfigured.missing || modelCatalogMissing);
  const engineSetupRequired =
    providerStatusChecksEnabled &&
    agentEngineConfigured.state === "missing" &&
    missingApiKey;
  const isComposerDisabled = composerDisabled;
  const [authError, setAuthError] = useState<{
    sessionExpired?: boolean;
  } | null>(null);
  const [authSessionAvailable, setAuthSessionAvailable] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const [queueWakeVersion, setQueueWakeVersion] = useState(0);
  const queuedMessagesRef = useRef<QueuedMessage[]>([]);
  const queueDirtyRef = useRef(false);
  const queueMutationVersionRef = useRef(0);
  const dequeueInFlightRef = useRef(false);
  const queueStopVersionRef = useRef(0);
  const [composerContextItems, setComposerContextItems] = useState<
    AgentChatContextItem[]
  >([]);
  const composerContextItemsRef = useRef<AgentChatContextItem[]>([]);
  const isActiveComposerRef = useRef(isActiveComposer);
  isActiveComposerRef.current = isActiveComposer;
  const normalizedContextNamespace = contextNamespace?.trim() || undefined;
  const publishComposerContextItems = useCallback(
    (items: AgentChatContextItem[]) => {
      if (!isActiveComposerRef.current) return;
      const hiddenItems = normalizedContextNamespace
        ? getAgentChatContextState().items.filter((item) => {
            const itemNamespace = item.contextNamespace?.trim();
            return (
              itemNamespace && itemNamespace !== normalizedContextNamespace
            );
          })
        : [];
      publishAgentChatContextItems([...hiddenItems, ...items]);
    },
    [normalizedContextNamespace],
  );
  const updateComposerContextItems = useCallback(
    (updater: (previous: AgentChatContextItem[]) => AgentChatContextItem[]) => {
      setComposerContextItems((previous) => {
        const next = updater(previous);
        composerContextItemsRef.current = next;
        return next;
      });
      queueMicrotask(() => {
        publishComposerContextItems(composerContextItemsRef.current);
      });
    },
    [publishComposerContextItems],
  );
  const stageComposerContextItem = useCallback(
    (rawItem: AgentChatContextItem) => {
      const item = normalizeAgentChatContextItem(rawItem);
      if (!item) return;
      if (
        filterAgentChatContextItems([item], normalizedContextNamespace)
          .length === 0
      ) {
        return;
      }
      updateComposerContextItems((previous) => {
        const index = previous.findIndex((current) => current.key === item.key);
        if (index === -1) return [...previous, item];
        return previous.map((current, currentIndex) =>
          currentIndex === index ? item : current,
        );
      });
    },
    [updateComposerContextItems],
  );
  const removeComposerContextItem = useCallback(
    (key: string) => {
      updateComposerContextItems((previous) =>
        previous.filter((item) => item.key !== key),
      );
    },
    [updateComposerContextItems],
  );
  const buildComposerContextSubmission = useCallback((text: string) => {
    const context = formatAgentChatContextItemsForPrompt(
      composerContextItemsRef.current,
    );
    if (!context) return { text, includesContext: false };
    return {
      text: appendAgentChatContextToMessage(text, context),
      includesContext: true,
    };
  }, []);

  useEffect(() => {
    queuedMessagesRef.current = queuedMessages;
  }, [queuedMessages]);

  const applyLocalQueuedMessages = useCallback(
    (updater: (previous: QueuedMessage[]) => QueuedMessage[]) => {
      setQueuedMessages((previous) => {
        const next = updater(previous);
        queuedMessagesRef.current = next;
        queueDirtyRef.current = true;
        queueMutationVersionRef.current += 1;
        return next;
      });
    },
    [],
  );

  useBrowserLayoutEffect(() => {
    if (!isActiveComposer) return;
    let cancelled = false;
    const applyVisibleItems = (
      state: ReturnType<typeof getAgentChatContextState>,
    ) => {
      if (cancelled || !isActiveComposerRef.current) return;
      const visibleItems = filterAgentChatContextItems(
        state.items,
        normalizedContextNamespace,
      );
      composerContextItemsRef.current = visibleItems;
      setComposerContextItems(visibleItems);
    };
    applyVisibleItems(getAgentChatContextState());
    void refreshAgentChatContext().then(applyVisibleItems);
    const unsubscribe = subscribeAgentChatContext(() => {
      if (cancelled || !isActiveComposerRef.current) return;
      const state = getAgentChatContextState();
      const visibleItems = filterAgentChatContextItems(
        state.items,
        normalizedContextNamespace,
      );
      composerContextItemsRef.current = visibleItems;
      setComposerContextItems(visibleItems);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isActiveComposer, normalizedContextNamespace]);
  const visibleComposerContextItems = useMemo(
    () =>
      filterAgentChatContextItems(
        composerContextItems,
        normalizedContextNamespace,
      ),
    [composerContextItems, normalizedContextNamespace],
  );
  const lastPersistedQueueRef = useRef<string>("[]");
  const lastImportedSignatureRef = useRef<string | null>(null);
  const lastImportedRepoRef = useRef<any>(null);
  const [showContinue, setShowContinue] = useState(false);
  const [loopLimitInfo, setLoopLimitInfo] = useState<LoopLimitInfo | null>(
    null,
  );
  const [runErrorInfo, setRunErrorInfo] = useState<RunErrorInfo | null>(null);
  const [dismissedRunErrorKey, setDismissedRunErrorKey] = useState<
    string | null
  >(null);
  const [dismissedProviderAuthErrorKey, setDismissedProviderAuthErrorKey] =
    useState<string | null>(null);
  const userStoppedRunRef = useRef<{
    runId?: string;
    threadId?: string;
    turnId?: string;
  } | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [optimisticRunning, setOptimisticRunning] = useState(false);
  const [runningActivityLabel, setRunningActivityLabel] = useState<
    string | null
  >(null);
  const [runningActivityTool, setRunningActivityTool] = useState<string | null>(
    null,
  );
  const activityLabelTimerRef = useRef<number | null>(null);
  const latestActivityLabelRef = useRef<string | null>(null);
  const activityLabelSurfacedRef = useRef(false);
  const resetRunningActivity = useCallback(() => {
    if (activityLabelTimerRef.current !== null) {
      window.clearTimeout(activityLabelTimerRef.current);
      activityLabelTimerRef.current = null;
    }
    latestActivityLabelRef.current = null;
    activityLabelSurfacedRef.current = false;
    setRunningActivityLabel(null);
    setRunningActivityTool(null);
    updateActiveRunActivity(null);
  }, []);
  const [reconnectContent, setReconnectContent] = useState<ContentPart[]>([]);
  const [reconnectFrozen, setReconnectFrozen] = useState(false);
  const reconnectRunIdRef = useRef<string | null>(null);
  const reconnectTurnIdRef = useRef<string | null>(null);
  const reconnectTailOnlyRef = useRef(false);
  const reconnectCanMaterializeRef = useRef(false);
  const reconnectAbortRef = useRef<AbortController | null>(null);
  const reconnectOwnershipTokenRef = useRef<symbol | null>(null);
  const reconnectAutoRecoveryCountRef = useRef(0);
  const releaseReconnectOwnership = useCallback(
    (ownerThreadId?: string | null) => {
      const releaseThreadId =
        ownerThreadId === undefined ? threadId : ownerThreadId;
      const runId = reconnectRunIdRef.current;
      const token = reconnectOwnershipTokenRef.current;
      if (releaseThreadId && runId && token) {
        releaseRunStream(
          releaseThreadId,
          runId,
          token,
          reconnectTurnIdRef.current ?? undefined,
        );
      }
      reconnectOwnershipTokenRef.current = null;
    },
    [threadId],
  );
  const reconnectOwnerMountedRef = useReconnectReaderOwner(
    reconnectRunIdRef,
    reconnectAbortRef,
    releaseReconnectOwnership,
    threadId,
  );
  const [pendingReconnectRecovery, setPendingReconnectRecovery] =
    useState<PendingReconnectRecovery | null>(null);
  const clearReconnectReaderForTerminalError = useCallback(() => {
    releaseReconnectOwnership();
    reconnectAbortRef.current?.abort();
    reconnectAbortRef.current = null;
    reconnectRunIdRef.current = null;
    reconnectTurnIdRef.current = null;
    reconnectTailOnlyRef.current = false;
    reconnectCanMaterializeRef.current = false;
    setIsReconnecting(false);
    setReconnectFrozen(false);
    setReconnectContent([]);
    setPendingReconnectRecovery(null);
    resetRunningActivity();
  }, [releaseReconnectOwnership, resetRunningActivity]);
  const [forceStopped, setForceStopped] = useState(false);
  const { isAutoResuming, clearAutoResume } = useAutoResumeStatus(
    tabId,
    forceStopped,
  );
  const isAutoResumingRef = useRef(isAutoResuming);
  isAutoResumingRef.current = isAutoResuming;
  const [hasActiveServerRun, setHasActiveServerRun] = useState(() =>
    activeRunMatchesThread(getActiveRun(), threadId),
  );
  const trackStoppedRun = useAgentChatLifecycleTracking({
    surface: agentChatSurface,
    threadId,
    tabId,
    onActiveRunChange: setHasActiveServerRun,
  });
  const serverRunState = useRunStuckDetection({
    threadId: threadId ?? null,
    enabled: isActiveComposer,
    apiUrl,
  });
  const serverRunActive =
    serverRunState.runId != null && serverRunState.status === "running";
  const { isRunning, showRunningInUI } = resolveAssistantChatRunningState({
    forceStopped,
    isRuntimeRunning,
    isReconnecting,
    optimisticRunning,
    isAutoResuming,
    hasActiveServerRun: hasActiveServerRun || serverRunActive,
    hasTerminalRunError: runErrorInfo !== null,
  });
  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;
  const submissionInFlightRef = useRef(0);
  const submissionTailRef = useRef(Promise.resolve());
  const chatHistoryListQuery = useActionQuery<unknown>(
    (chatHistory?.list.action ?? "list-resource-versions") as never,
    (typeof chatHistory?.list.args === "function"
      ? chatHistory.list.args(threadId)
      : chatHistory?.list.args) as never,
    { enabled: chatHistory !== undefined },
  );
  const chatHistoryVersions = useMemo(() => {
    if (!chatHistory || chatHistoryListQuery.data == null) return [];
    const versions = chatHistory.list.getVersions(chatHistoryListQuery.data);
    return Array.isArray(versions)
      ? versions.filter(isAssistantChatHistoryVersion)
      : [];
  }, [chatHistory, chatHistoryListQuery.data]);
  const chatHistoryRestoreMutation = useActionMutation<
    unknown,
    Record<string, unknown>
  >((chatHistory?.restore.action ?? "restore-resource-version") as never);
  const chatHistoryCreateMutation = useActionMutation<
    unknown,
    Record<string, unknown>
  >((chatHistory?.createVersion?.action ?? "create-resource-version") as never);
  const refetchChatHistory = chatHistoryListQuery.refetch;
  const restoreHistory = chatHistoryRestoreMutation.mutateAsync;
  const createHistoryVersion = chatHistoryCreateMutation.mutateAsync;
  const [isChatHistoryRestoring, setIsChatHistoryRestoring] = useState(false);
  const chatHistoryRestoreInFlightRef = useRef(false);
  const chatHistoryRestoreWaitRef = useRef<Promise<void> | null>(null);
  const waitForChatHistoryRestore = useCallback(async () => {
    let restoreWait = chatHistoryRestoreWaitRef.current;
    while (restoreWait) {
      await restoreWait;
      restoreWait = chatHistoryRestoreWaitRef.current;
    }
  }, []);
  const restoreChatHistoryVersion = useCallback(
    async (version: AssistantChatHistoryVersion) => {
      if (!chatHistory) return;
      if (chatHistoryRestoreInFlightRef.current) {
        throw new Error("A chat history restore is already in progress.");
      }
      if (submissionInFlightRef.current > 0) {
        throw new Error("A chat submission is already in progress.");
      }
      let finishRestore!: () => void;
      const restoreWait = new Promise<void>((resolve) => {
        finishRestore = resolve;
      });
      chatHistoryRestoreWaitRef.current = restoreWait;
      chatHistoryRestoreInFlightRef.current = true;
      setIsChatHistoryRestoring(true);
      try {
        await restoreAssistantChatHistoryVersion({
          history: chatHistory,
          version,
          restore: restoreHistory,
          refetch: refetchChatHistory,
          onRefetchError: (error) =>
            captureError(error, {
              tags: {
                source: "agent-chat-client",
                phase: "chat-history-refetch-after-restore",
              },
            }),
        });
      } finally {
        chatHistoryRestoreInFlightRef.current = false;
        setIsChatHistoryRestoring(false);
        if (chatHistoryRestoreWaitRef.current === restoreWait) {
          chatHistoryRestoreWaitRef.current = null;
        }
        finishRestore();
      }
    },
    [chatHistory, refetchChatHistory, restoreHistory],
  );
  const chatHistoryContext = useMemo(
    () =>
      chatHistory
        ? {
            beginningVersion: findAssistantChatHistoryBeginningVersion(
              chatHistoryVersions,
              threadId,
              chatHistory.isEditable,
            ),
            isRestoring: isChatHistoryRestoring,
            findVersion: (message: AssistantChatHistoryMessage) =>
              findMatchingAssistantChatHistoryVersion(
                chatHistoryVersions,
                message,
                {
                  isEditable: chatHistory.isEditable,
                  scope: chatHistory.scope ?? contextScope ?? undefined,
                  matchVersion: chatHistory.matchVersion,
                },
              ),
            restoreVersion: restoreChatHistoryVersion,
          }
        : null,
    [
      chatHistory,
      chatHistoryVersions,
      isChatHistoryRestoring,
      restoreChatHistoryVersion,
      threadId,
    ],
  );
  const chatHistoryRunObservedRef = useRef(false);
  const chatHistoryCreateKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chatHistory) {
      chatHistoryRunObservedRef.current = false;
      return;
    }
    if (isRunning) {
      chatHistoryRunObservedRef.current = true;
      return;
    }
    if (!chatHistoryRunObservedRef.current) return;
    chatHistoryRunObservedRef.current = false;

    const latestAssistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (
      !latestAssistantMessage ||
      !assistantMessageHasCompletedSideEffect(latestAssistantMessage)
    ) {
      void refetchChatHistory().catch((error) =>
        captureError(error, {
          tags: {
            source: "agent-chat-client",
            phase: "chat-history-refetch-after-run",
          },
        }),
      );
      return;
    }

    const historyMessage: AssistantChatHistoryMessage = {
      id: latestAssistantMessage.id,
      createdAt: latestAssistantMessage.createdAt,
      hasCompletedSideEffect: true,
    };
    if (chatHistoryCreateKeyRef.current === historyMessage.id) {
      void refetchChatHistory();
      return;
    }
    chatHistoryCreateKeyRef.current = historyMessage.id;

    void (async () => {
      try {
        if (chatHistory.createVersion) {
          const args =
            typeof chatHistory.createVersion.args === "function"
              ? chatHistory.createVersion.args(historyMessage)
              : chatHistory.createVersion.args;
          await createHistoryVersion(args as Record<string, unknown>);
        }
      } catch (error) {
        captureError(error, {
          tags: {
            source: "agent-chat-client",
            phase: "chat-history-create-version",
          },
        });
      }
      try {
        await refetchChatHistory();
      } catch (error) {
        captureError(error, {
          tags: {
            source: "agent-chat-client",
            phase: "chat-history-refetch-after-run",
          },
        });
      }
    })();
  }, [
    chatHistory,
    createHistoryVersion,
    isRunning,
    messages,
    refetchChatHistory,
  ]);
  const textStreaming = showRunningInUI || externalStreaming;
  const storedActiveRun = getActiveRun();
  const activeChatRunId =
    (serverRunState.status === "running" ? serverRunState.runId : null) ??
    (activeRunMatchesThread(storedActiveRun, threadId)
      ? (storedActiveRun?.runId ?? null)
      : null);
  const activeChatTurnId =
    (activeRunMatchesThread(storedActiveRun, threadId)
      ? storedActiveRun?.turnId
      : undefined) ?? (showRunningInUI ? reconnectTurnIdRef.current : null);
  const textStreamingThreadId = threadId ?? null;
  const [retainedTextStreamingState, setRetainedTextStreamingState] = useState<{
    threadId: string | null;
    identity: { runId: string | null; turnId: string | null } | null;
  }>(() => ({ threadId: textStreamingThreadId, identity: null }));
  useEffect(() => {
    setRetainedTextStreamingState((current) => {
      if (activeChatRunId || activeChatTurnId) {
        return {
          threadId: textStreamingThreadId,
          identity: { runId: activeChatRunId, turnId: activeChatTurnId },
        };
      }
      return current.threadId === textStreamingThreadId
        ? current
        : { threadId: textStreamingThreadId, identity: null };
    });
  }, [activeChatRunId, activeChatTurnId, textStreamingThreadId]);
  const activeTextStreamingIdentity =
    retainedTextStreamingState.threadId === textStreamingThreadId
      ? retainedTextStreamingState.identity
      : null;
  const visibleSubmitSequenceRef = useRef(0);
  const latestAcceptedVisibleSubmitSequenceRef = useRef(0);
  const resetRetainedTextStreamingState = useCallback(
    (turnId?: string) => {
      setRetainedTextStreamingState({
        threadId: textStreamingThreadId,
        identity: turnId ? { runId: null, turnId } : null,
      });
    },
    [textStreamingThreadId],
  );
  const chatRunStartedAtRef = useRef<number | null>(null);
  const chatRunTurnIdRef = useRef<string | null>(null);
  const [lastChatRunDurationMs, setLastChatRunDurationMs] = useState<
    number | null
  >(null);
  useEffect(() => {
    if (showRunningInUI) {
      const startedForDifferentTurn =
        chatRunStartedAtRef.current != null &&
        chatRunTurnIdRef.current != null &&
        activeChatTurnId != null &&
        activeChatTurnId !== chatRunTurnIdRef.current;
      if (chatRunStartedAtRef.current == null || startedForDifferentTurn) {
        chatRunStartedAtRef.current = Date.now();
        chatRunTurnIdRef.current = activeChatTurnId ?? null;
        setLastChatRunDurationMs(null);
      } else if (chatRunTurnIdRef.current == null && activeChatTurnId != null) {
        chatRunTurnIdRef.current = activeChatTurnId;
      }
      return;
    }
    if (chatRunStartedAtRef.current != null) {
      setLastChatRunDurationMs(
        Math.max(0, Date.now() - chatRunStartedAtRef.current),
      );
      chatRunStartedAtRef.current = null;
      chatRunTurnIdRef.current = null;
    }
  }, [activeChatTurnId, showRunningInUI]);
  const runningStatusLabel = resolveAssistantChatRunningStatusLabel({
    runningActivityLabel,
    runningActivityTool,
    isAutoResuming,
    isReconnecting,
    hasReconnectContent: reconnectContent.length > 0,
    labels: {
      thinking: t("agentChat.status.thinking"),
      resuming: t("agentChat.status.resuming"),
      stillWorking: t("agentChat.status.stillWorking"),
      working: t("agentChat.status.working"),
      contactingModel: t("agentChat.status.contactingModel"),
      starting: (activity) => t("agentChat.status.starting", { activity }),
      preparing: (activity) => t("agentChat.status.preparing", { activity }),
      writing: (activity) => t("agentChat.status.writing", { activity }),
      stillGenerating: (activity) =>
        t("agentChat.status.stillGenerating", { activity }),
      runningTool: (toolName) =>
        t("agentChat.status.runningTool", {
          activity: toolLabel(t, toolName),
        }),
      toolDisplayName: (toolName) => toolLabel(t, toolName),
    },
  });
  const reconnectActivityContent = useMemo(
    () =>
      isReconnecting || reconnectFrozen
        ? reconnectActivityFallbackContent(runningActivityTool)
        : [],
    [isReconnecting, reconnectFrozen, runningActivityTool],
  );
  const lastBroadcastRunningRef = useRef(isRunning);
  const tiptapRef = useRef<TiptapComposerHandle>(null);
  const focusComposerAfterConnectRef = useRef(false);
  const stopActiveRunRef = useRef<
    (options?: { preserveQueuedMessages?: boolean }) => void
  >(() => {});
  const resumeFollowingRef = useRef<() => void>(() => {});

  const markOptimisticRunning = useCallback(() => {
    isRunningRef.current = true;
    setOptimisticRunning(true);
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: { isRunning: true, tabId: tabId || threadId },
      }),
    );
  }, [tabId, threadId]);

  useEffect(() => {
    if (lastBroadcastRunningRef.current === isRunning) return;
    lastBroadcastRunningRef.current = isRunning;
    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: { isRunning, tabId: tabId || threadId },
      }),
    );
  }, [isRunning, tabId, threadId]);

  useEffect(() => {
    if (!optimisticRunning) return;
    if (!forceStopped && !isRuntimeRunning && !isReconnecting) return;
    setOptimisticRunning(false);
  }, [forceStopped, isReconnecting, isRuntimeRunning, optimisticRunning]);

  useEffect(() => {
    if (!optimisticRunning) return;
    const timer = window.setTimeout(() => {
      setOptimisticRunning(false);
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [optimisticRunning]);

  const hasRestoredRef = useRef(false);
  const [threadRestoreError, setThreadRestoreError] =
    useState<ThreadRestoreErrorKind | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [initialCachedThreadSnapshot] = useState(() =>
    readCachedThreadSnapshot(apiUrl, threadId),
  );
  const hasImportedInitialCachedSnapshotRef = useRef(false);
  const [isRestoring, setIsRestoring] = useState(
    !!(threadId || loadHistoryRepository) &&
      !isNewThread &&
      !initialCachedThreadSnapshot,
  );
  const retryThreadRestore = useCallback(() => {
    if (!threadId || isNewThread) return;
    hasRestoredRef.current = false;
    setThreadRestoreError(null);
    setIsRestoring(true);
    setRestoreAttempt((attempt) => attempt + 1);
  }, [isNewThread, threadId]);

  const missingThreadNotifiedRef = useRef<string | null>(null);
  const desktopIdentityAuthenticatedRef = useRef(desktopIdentityAuthenticated);
  const desktopIdentityRestoreRetryPendingRef = useRef(false);

  useEffect(() => {
    if (!desktopIdentityUnauthenticated) return;
    setThreadRestoreError((current) =>
      current === "not-found" ? null : current,
    );
  }, [desktopIdentityUnauthenticated]);

  useEffect(() => {
    const becameAuthenticated =
      desktopIdentityAuthenticated && !desktopIdentityAuthenticatedRef.current;
    desktopIdentityAuthenticatedRef.current = desktopIdentityAuthenticated;
    if (
      !becameAuthenticated ||
      agentChatSurface !== "desktop" ||
      !threadId ||
      isNewThread
    ) {
      return;
    }
    desktopIdentityRestoreRetryPendingRef.current = true;
    retryThreadRestore();
  }, [
    agentChatSurface,
    desktopIdentityAuthenticated,
    isNewThread,
    retryThreadRestore,
    threadId,
  ]);

  useEffect(() => {
    if (threadRestoreError !== "not-found") {
      desktopIdentityRestoreRetryPendingRef.current = false;
      return;
    }
    if (
      !threadId ||
      !onThreadRestoreNotFound ||
      missingThreadNotifiedRef.current === threadId ||
      (agentChatSurface === "desktop" &&
        (!desktopIdentityAuthenticated ||
          desktopIdentityUnauthenticated ||
          desktopIdentityRestoreRetryPendingRef.current))
    ) {
      return;
    }
    missingThreadNotifiedRef.current = threadId;
    onThreadRestoreNotFound();
  }, [
    agentChatSurface,
    desktopIdentityAuthenticated,
    desktopIdentityUnauthenticated,
    onThreadRestoreNotFound,
    threadId,
    threadRestoreError,
  ]);
  const onSaveThreadRef = useRef(onSaveThread);
  onSaveThreadRef.current = onSaveThread;
  const onGenerateTitleRef = useRef(onGenerateTitle);
  onGenerateTitleRef.current = onGenerateTitle;
  const titleGeneratedRef = useRef(false);

  const importThreadData = useCallback(
    (threadData: unknown, options?: { markTitleGenerated?: boolean }): any => {
      const signature =
        typeof threadData === "string"
          ? threadData
          : (() => {
              try {
                return JSON.stringify(threadData);
              } catch {
                return null;
              }
            })();
      if (
        signature !== null &&
        signature === lastImportedSignatureRef.current
      ) {
        if (options?.markTitleGenerated) {
          titleGeneratedRef.current = true;
        }
        return lastImportedRepoRef.current;
      }

      const repo = normalizeThreadRepository(
        typeof threadData === "string" ? JSON.parse(threadData) : threadData,
      );
      let settled = true;
      let settledRepo = repo;
      if (repo?.messages?.length > 0) {
        let shouldImport = true;
        if (isRuntimeRunningRef.current || isAutoResumingRef.current) {
          shouldImport = false;
        } else {
          try {
            shouldImport = shouldImportServerThreadData(
              normalizeThreadRepository(threadRuntime.export()),
              repo,
            );
          } catch {
            shouldImport = false;
          }
        }
        if (shouldImport) {
          if (options?.markTitleGenerated) {
            titleGeneratedRef.current = true;
          }
          const importRepo = ensureMessageMetadata(repo);
          threadRuntime.import(importRepo);
          settledRepo = importRepo;
        } else {
          settled = false;
        }
      }
      if (settled && Array.isArray(repo?.queuedMessages)) {
        const incomingQueue = repo.queuedMessages as QueuedMessage[];
        const incomingSerialized = JSON.stringify(incomingQueue);
        const currentSerialized = JSON.stringify(queuedMessagesRef.current);
        if (
          !queueDirtyRef.current ||
          incomingSerialized === currentSerialized
        ) {
          queuedMessagesRef.current = incomingQueue;
          setQueuedMessages(incomingQueue);
          lastPersistedQueueRef.current = incomingSerialized;
          queueDirtyRef.current = false;
        }
      }
      if (settled && signature !== null) {
        lastImportedSignatureRef.current = signature;
        lastImportedRepoRef.current = settledRepo;
      }
      return repo;
    },
    [threadRuntime],
  );

  const refreshThreadFromServer = useCallback(
    async (signal?: AbortSignal): Promise<any> => {
      if (loadHistoryRepository) {
        try {
          const repo = await loadHistoryRepository();
          if (!repo) return null;
          return importThreadData(repo);
        } catch {
          // coercion-ok: callers treat null as "keep the thread already
          return null;
        }
      }
      if (!threadId) return null;
      const ownAbort =
        !signal && typeof AbortController !== "undefined"
          ? new AbortController()
          : null;
      const ownAbortTimer = ownAbort
        ? setTimeout(() => ownAbort.abort(), getPollAbortMs(2000))
        : null;
      try {
        const refreshRes = await fetch(
          `${apiUrl}/threads/${encodeURIComponent(threadId)}${threadScopeQuery}`,
          { signal: signal ?? ownAbort?.signal },
        );
        if (!refreshRes.ok) return null;
        const refreshData = await refreshRes.json();
        if (!refreshData.threadData) return null;
        return importThreadData(refreshData.threadData);
      } catch {
        // coercion-ok: an aborted or failed refresh keeps the thread already
        return null;
      } finally {
        if (ownAbortTimer) clearTimeout(ownAbortTimer);
      }
    },
    [
      apiUrl,
      importThreadData,
      loadHistoryRepository,
      threadId,
      threadScopeQuery,
    ],
  );

  const exportCleanThreadRepo = useCallback(
    () =>
      ensureMessageMetadata(normalizeThreadRepository(threadRuntime.export())),
    [threadRuntime],
  );
  const exportPersistableThreadRepo = useCallback(
    () =>
      withLastAssistantRunDuration(
        exportCleanThreadRepo(),
        showRunningInUI ? null : lastChatRunDurationMs,
      ),
    [exportCleanThreadRepo, lastChatRunDurationMs, showRunningInUI],
  );
  useEffect(() => {
    if (showRunningInUI || lastChatRunDurationMs == null) return;
    const repo = exportCleanThreadRepo();
    const persisted = withLastAssistantRunDuration(repo, lastChatRunDurationMs);
    if (persisted === repo) return;
    threadRuntime.import(ensureMessageMetadata(persisted));
  }, [
    exportCleanThreadRepo,
    lastChatRunDurationMs,
    showRunningInUI,
    threadRuntime,
  ]);

  const appendRealtimeVoiceTranscript = useCallback(
    (
      transcript: Parameters<typeof realtimeVoiceTranscriptRegistry.publish>[0],
    ) => {
      if (isRestoring || isRunning) return false;
      const result = appendRealtimeVoiceTranscriptToRepository(
        exportCleanThreadRepo(),
        transcript,
      );
      if (!result.appended) return true;
      threadRuntime.import(ensureMessageMetadata(result.repository));
      return true;
    },
    [exportCleanThreadRepo, isRestoring, isRunning, threadRuntime],
  );

  useEffect(() => {
    const transcriptThreadId = threadId ?? tabId;
    if (!transcriptThreadId) return;
    return realtimeVoiceTranscriptRegistry.register({
      threadId: transcriptThreadId,
      active: isActiveComposer,
      append: appendRealtimeVoiceTranscript,
    });
  }, [appendRealtimeVoiceTranscript, isActiveComposer, tabId, threadId]);

  const appendThreadMessage = useCallback(
    (message: Parameters<typeof threadRuntime.append>[0]) => {
      try {
        threadRuntime.append(message);
        return;
      } catch (error) {
        if (!isAssistantUiDuplicateMessageIdError(error)) throw error;
      }

      try {
        threadRuntime.import(exportCleanThreadRepo());
      } catch {
        // Best effort cleanup; retry below handles the still-duplicated case.
      }

      try {
        threadRuntime.append(message);
      } catch (retryError) {
        if (isAssistantUiDuplicateMessageIdError(retryError)) return;
        throw retryError;
      }
    },
    [exportCleanThreadRepo, threadRuntime],
  );

  const cacheCurrentThreadSnapshot = useCallback(() => {
    if (!threadId || messages.length === 0) return;
    const repo = exportPersistableThreadRepo();
    const threadData = JSON.stringify(stripBase64FromRepo(repo));
    const { title, preview } = extractThreadMeta(repo);
    writeCachedThreadSnapshot(apiUrl, threadId, {
      threadData,
      title,
      preview,
      messageCount: messages.length,
    });
  }, [apiUrl, exportPersistableThreadRepo, messages.length, threadId]);

  useBrowserLayoutEffect(() => {
    if (hasImportedInitialCachedSnapshotRef.current) return;
    if (!initialCachedThreadSnapshot) return;
    hasImportedInitialCachedSnapshotRef.current = true;
    try {
      importThreadData(initialCachedThreadSnapshot.threadData, {
        markTitleGenerated: Boolean(initialCachedThreadSnapshot.title),
      });
    } finally {
      setIsRestoring(false);
    }
  }, [importThreadData, initialCachedThreadSnapshot]);

  useEffect(() => {
    window.addEventListener(
      AGENT_CHAT_VIEW_TRANSITION_PREPARE_EVENT,
      cacheCurrentThreadSnapshot,
    );
    return () => {
      window.removeEventListener(
        AGENT_CHAT_VIEW_TRANSITION_PREPARE_EVENT,
        cacheCurrentThreadSnapshot,
      );
    };
  }, [cacheCurrentThreadSnapshot]);

  const wasUserStoppedRun = useCallback(
    (runId?: string, turnId?: string): boolean =>
      matchesUserStoppedRun(userStoppedRunRef.current, threadId, runId, turnId),
    [threadId],
  );
  const startReconnectToRun = useCallback(
    (runInfo: ActiveRunLookup): boolean => {
      if (
        !reconnectOwnerMountedRef.current ||
        !threadId ||
        !runInfo.runId ||
        (runInfo.status !== "running" && !isReplayableTerminalRun(runInfo))
      ) {
        return false;
      }
      const runId = String(runInfo.runId);
      if (wasUserStoppedRun(runId, runInfo.turnId)) return false;
      const logicalTurnId =
        typeof runInfo.turnId === "string" && runInfo.turnId.length > 0
          ? runInfo.turnId
          : getActiveRun()?.runId === runId
            ? (getActiveRun()?.turnId ?? undefined)
            : undefined;
      const reconnectEventIdentity = {
        runId,
        ...(logicalTurnId ? { turnId: logicalTurnId } : {}),
      };
      if (reconnectRunIdRef.current === runId) return true;
      if (isRuntimeRunningRef.current || isAutoResumingRef.current) {
        return false;
      }
      const previousReconnectRunId = reconnectRunIdRef.current;
      const previousReconnectTurnId = reconnectTurnIdRef.current ?? undefined;
      const previousOwnershipToken = reconnectOwnershipTokenRef.current;
      if (reconnectAbortRef.current) {
        try {
          reconnectAbortRef.current.abort();
        } catch {
          // Already aborted / detached — nothing to unwind.
        }
        reconnectAbortRef.current = null;
      }
      if (previousReconnectRunId && previousOwnershipToken) {
        releaseRunStream(
          threadId,
          previousReconnectRunId,
          previousOwnershipToken,
          previousReconnectTurnId,
        );
        if (reconnectOwnershipTokenRef.current === previousOwnershipToken) {
          reconnectOwnershipTokenRef.current = null;
        }
      }

      const ownershipToken = createRunStreamToken(`reconnect:${runId}`);
      if (!claimRunStream(threadId, runId, ownershipToken, logicalTurnId)) {
        if (reconnectRunIdRef.current === previousReconnectRunId) {
          reconnectRunIdRef.current = null;
          reconnectTurnIdRef.current = null;
          reconnectOwnershipTokenRef.current = null;
          setIsReconnecting(false);
          setReconnectFrozen(false);
          setReconnectContent([]);
          reconnectCanMaterializeRef.current = false;
          reconnectTailOnlyRef.current = false;
        }
        return false;
      }

      reconnectRunIdRef.current = runId;
      reconnectTurnIdRef.current = logicalTurnId ?? null;
      reconnectOwnershipTokenRef.current = ownershipToken;
      const afterSeq = resolveReconnectAfterSeq(threadId, runId);
      reconnectTailOnlyRef.current = afterSeq > 0;
      reconnectCanMaterializeRef.current = afterSeq === 0;
      const storedActivityTool = getActiveRunActivityTool(threadId, runId);
      setRunningActivityTool(storedActivityTool);
      setActiveRun({
        threadId,
        runId,
        ...(tabId ? { tabId } : {}),
        ...(reconnectTurnIdRef.current
          ? { turnId: reconnectTurnIdRef.current }
          : {}),
        lastSeq: afterSeq > 0 ? afterSeq - 1 : -1,
        ...(storedActivityTool ? { activityTool: storedActivityTool } : {}),
      });
      setIsReconnecting(true);
      setReconnectFrozen(false);
      setReconnectContent([]);
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: true,
            tabId: tabId || threadId,
            ...reconnectEventIdentity,
          },
        }),
      );

      const abortCtrl = new AbortController();
      reconnectAbortRef.current = abortCtrl;
      let reconnectTerminalReason: AgentAutoContinueSignal["reason"] | null =
        null;
      const reconnectStuckThresholdMs = activeRunStuckThresholdMs(runInfo);

      const watchdog = createPollEngine(
        async (signal) => {
          if (document.hidden) return;
          const res = await fetch(
            `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
            { signal },
          );
          if (!res.ok) {
            abortCtrl.abort();
            watchdog.stop();
            return;
          }
          const info = (await res.json()) as ActiveRunLookup;
          if (isRuntimeRunningRef.current) {
            abortCtrl.abort();
            watchdog.stop();
            return;
          }
          if (isReplayableTerminalRun(info)) {
            return;
          }
          if (info.status !== "running" || activeRunLooksStale(info)) {
            abortCtrl.abort();
            watchdog.stop();
          }
        },
        { intervalMs: 1000 },
      );
      watchdog.start();

      let reconnectTimedOut = false;
      let lastReconnectProgressAt = Date.now();
      const markReconnectProgress = () => {
        lastReconnectProgressAt = Date.now();
      };
      const idleCheck = setInterval(() => {
        if (reconnectTerminalReason !== null) return;
        if (
          !reconnectProgressTimedOut({
            lastProgressAt: lastReconnectProgressAt,
            now: Date.now(),
            thresholdMs: reconnectStuckThresholdMs,
          })
        ) {
          return;
        }
        reconnectTimedOut = true;
        abortCtrl.abort();
        watchdog.stop();
        clearInterval(idleCheck);
      }, 1000);

      const streamReconnect = async () => {
        let noProgressDuringReconnect = false;
        let latestContent: ContentPart[] = [];
        const preparingActionState: PreparingActionState = {};
        const seenEventSeqs = new Set<number>();
        const seenEventIds = new Set<string>();
        let reconnectRetryCount = 0;
        const backoffRetryDelay = () => {
          const ms = Math.min(250 * 2 ** reconnectRetryCount, 5000);
          reconnectRetryCount += 1;
          return new Promise((resolve) => window.setTimeout(resolve, ms));
        };
        const sameRunStillActive = async (): Promise<
          "active" | "inactive" | "unknown"
        > => {
          try {
            const res = await fetch(
              `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
              { signal: abortCtrl.signal },
            );
            if (!res.ok) return "unknown";
            const info = (await res.json()) as ActiveRunLookup;
            return info.active === true &&
              String(info.runId ?? "") === runId &&
              info.status === "running" &&
              !activeRunLooksStale(info)
              ? "active"
              : "inactive";
          } catch {
            return "unknown";
          }
        };
        const threadPollEngine =
          afterSeq > 0
            ? createPollEngine(
                async (signal) => {
                  if (document.hidden) return;
                  if (reconnectRunIdRef.current !== runId) return;
                  // Adapter took over mid-poll — skip imports that would race
                  if (
                    isRuntimeRunningRef.current ||
                    isAutoResumingRef.current
                  ) {
                    return;
                  }
                  await refreshThreadFromServer(signal);
                },
                { intervalMs: 2000, leading: false },
              )
            : undefined;
        threadPollEngine?.start();
        try {
          const content: ContentPart[] = [];
          latestContent = content;
          const toolCallCounter = { value: 0 };

          while (
            reconnectRunIdRef.current === runId &&
            !abortCtrl.signal.aborted
          ) {
            const reconnectAfterSeq = resolveReconnectAfterSeq(threadId, runId);
            reconnectTailOnlyRef.current = reconnectAfterSeq > 0;
            const sseRes = await fetch(
              `${apiUrl}/runs/${encodeURIComponent(runId)}/events?after=${reconnectAfterSeq}`,
              { signal: abortCtrl.signal },
            );
            if (!sseRes.ok || !sseRes.body) {
              const activeState = await sameRunStillActive();
              if (activeState !== "inactive") {
                await backoffRetryDelay();
                continue;
              }
              break;
            }
            let rafPending = false;
            let latestSnapshot: ContentPart[] = [];
            const scheduleUpdate = (snapshot: ContentPart[]) => {
              latestSnapshot = snapshot;
              if (rafPending) return;
              rafPending = true;
              requestAnimationFrame(() => {
                rafPending = false;
                if (
                  !reconnectOwnerMountedRef.current ||
                  reconnectRunIdRef.current !== runId ||
                  !ownsRunStream(threadId, runId, ownershipToken, logicalTurnId)
                ) {
                  return;
                }
                setReconnectContent(latestSnapshot);
              });
            };

            try {
              await readSSEStreamRaw(
                sseRes.body,
                content,
                toolCallCounter,
                tabId,
                scheduleUpdate,
                (seq, isProgress) => {
                  if (
                    !ownsRunStream(
                      threadId,
                      runId,
                      ownershipToken,
                      logicalTurnId,
                    )
                  ) {
                    return;
                  }
                  markReconnectProgress();
                  reconnectRetryCount = 0;
                  updateActiveRunSeq(threadId, runId, seq, isProgress);
                },
                {
                  preparingActionState,
                  runId,
                  turnId: logicalTurnId,
                  seenEventSeqs,
                  seenEventIds,
                },
              );
              if (reconnectAfterSeq === 0) {
                setReconnectContent([...content]);
              }
              break;
            } catch (err) {
              if (
                err instanceof AgentAutoContinueSignal &&
                err.reason === "stream_ended"
              ) {
                if (reconnectAfterSeq === 0) {
                  setReconnectContent([...content]);
                }
                const activeState = await sameRunStillActive();
                if (activeState !== "inactive") {
                  await backoffRetryDelay();
                  continue;
                }
              }
              throw err;
            }
          }
          if (reconnectTimedOut && abortCtrl.signal.aborted) {
            const timeoutError = new Error("Reconnect timed out");
            timeoutError.name = "AbortError";
            throw timeoutError;
          }
        } catch (err) {
          if (
            err instanceof AgentAutoContinueSignal &&
            err.reason === "no_progress"
          ) {
            noProgressDuringReconnect = true;
            reconnectTerminalReason = err.reason;
          } else if (err instanceof AgentAutoContinueSignal) {
            noProgressDuringReconnect = true;
            reconnectTerminalReason = err.reason;
          } else if (
            reconnectTimedOut &&
            err instanceof Error &&
            err.name === "AbortError"
          ) {
            noProgressDuringReconnect = true;
          }
        } finally {
          threadPollEngine?.stop();
          watchdog.stop();
          clearInterval(idleCheck);
          const retainReconnectOwnership =
            reconnectCanMaterializeRef.current && latestContent.length > 0;
          if (!retainReconnectOwnership) {
            releaseRunStream(threadId, runId, ownershipToken, logicalTurnId);
            if (reconnectOwnershipTokenRef.current === ownershipToken) {
              reconnectOwnershipTokenRef.current = null;
            }
          }
        }

        if (reconnectRunIdRef.current !== runId) return;

        if (noProgressDuringReconnect && reconnectRunIdRef.current === runId) {
          const reconnectErrorCode =
            reconnectTerminalReason === "run_timeout"
              ? "run_timeout"
              : reconnectTerminalReason === "stream_ended"
                ? "reconnect_stream_ended"
                : "reconnect_no_progress";
          captureError(new Error(`agent-chat:${reconnectErrorCode}`), {
            tags: {
              context: "agent-native-chat",
              errorCode: reconnectErrorCode,
              reconnectTimedOut: String(reconnectTimedOut),
              reconnectTerminalReason: reconnectTerminalReason ?? undefined,
            },
            extra: {
              runId,
              threadId: threadId ?? null,
              tabId: tabId ?? null,
              contentLength: latestContent.length,
            },
          });
          if (
            reconnectTerminalReason !== "run_timeout" &&
            !(await activeRunLooksAlive({
              apiUrl,
              threadId,
              runId,
              content: latestContent,
            }))
          ) {
            try {
              await fetch(`${apiUrl}/runs/${encodeURIComponent(runId)}/abort`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason: "no_progress" }),
              });
            } catch {
              // Best effort — the important part is unwinding the UI.
            }
          }
          if (afterSeq > 0) {
            await refreshThreadFromServer();
            setReconnectContent([]);
            setReconnectFrozen(false);
            reconnectTailOnlyRef.current = false;
          } else {
            settleInterruptedToolCalls(latestContent);
            setReconnectContent([...latestContent]);
            setReconnectFrozen(latestContent.length > 0);
            reconnectCanMaterializeRef.current = latestContent.length > 0;
          }
          const canAutoRecoverReconnect =
            reconnectAutoRecoveryCountRef.current <
            MAX_RECONNECT_AUTO_RECOVERIES;
          if (canAutoRecoverReconnect) {
            reconnectAutoRecoveryCountRef.current += 1;
            const reconnectTurnId = reconnectTurnIdRef.current ?? undefined;
            setRunErrorInfo(null);
            setDismissedRunErrorKey(null);
            clearActiveRunIfMatches(threadId, runId);
            reconnectAbortRef.current = null;
            setIsReconnecting(false);
            const keepFrozenReconnectOwner = reconnectCanMaterializeRef.current;
            if (!keepFrozenReconnectOwner) {
              releaseReconnectOwnership();
              reconnectRunIdRef.current = null;
              reconnectTurnIdRef.current = null;
            }
            reconnectTailOnlyRef.current = false;
            if (afterSeq > 0) {
              reconnectCanMaterializeRef.current = false;
            }
            window.dispatchEvent(
              new CustomEvent("agent-chat:auto-continue", {
                detail: { tabId: tabId || threadId },
              }),
            );
            setPendingReconnectRecovery({
              id: Date.now(),
              ...(reconnectTurnId ? { turnId: reconnectTurnId } : {}),
              message:
                latestContent.length > 0
                  ? RECONNECT_NO_PROGRESS_CONTINUE_MESSAGE
                  : RECONNECT_EMPTY_RETRY_MESSAGE,
            });
            window.dispatchEvent(
              new CustomEvent("agentNative.chatRunning", {
                detail: {
                  isRunning: false,
                  tabId: tabId || threadId,
                  ...reconnectEventIdentity,
                },
              }),
            );
            return;
          }
          setRunErrorInfo({
            message:
              reconnectErrorCode === "run_timeout"
                ? t("agentChat.recovery.backgroundTimeout")
                : reconnectErrorCode === "reconnect_stream_ended"
                  ? t("agentChat.recovery.streamEnded")
                  : t("agentChat.recovery.noProgress"),
            errorCode: reconnectErrorCode,
            recoverable: true,
            runId,
            ...(reconnectTurnIdRef.current
              ? { turnId: reconnectTurnIdRef.current }
              : {}),
          });
          setDismissedRunErrorKey(null);
          clearActiveRunIfMatches(threadId, runId);
          reconnectAbortRef.current = null;
          setIsReconnecting(false);
          const keepFrozenReconnectOwner = reconnectCanMaterializeRef.current;
          if (!keepFrozenReconnectOwner) {
            releaseReconnectOwnership();
            reconnectRunIdRef.current = null;
            reconnectTurnIdRef.current = null;
          }
          reconnectTailOnlyRef.current = false;
          if (afterSeq > 0) {
            reconnectCanMaterializeRef.current = false;
          }
          window.dispatchEvent(
            new CustomEvent("agentNative.chatRunning", {
              detail: {
                isRunning: false,
                tabId: tabId || threadId,
                reason: "failed",
                ...reconnectEventIdentity,
              },
            }),
          );
          return;
        }

        setReconnectFrozen(afterSeq === 0);
        let loaded = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          await new Promise((r) => setTimeout(r, 500));
          if (reconnectRunIdRef.current !== runId) break;
          const repo = await refreshThreadFromServer();
          if (repoHasAssistantMessage(repo)) {
            setReconnectContent([]);
            setReconnectFrozen(false);
            reconnectCanMaterializeRef.current = false;
            loaded = true;
            break;
          }
        }

        if (reconnectRunIdRef.current === runId) {
          if (afterSeq > 0) {
            setReconnectContent([]);
            setReconnectFrozen(false);
          }
          clearActiveRunIfMatches(threadId, runId);
          reconnectAbortRef.current = null;
          setIsReconnecting(false);
          if (loaded || afterSeq > 0 || latestContent.length === 0) {
            reconnectCanMaterializeRef.current = false;
          }
          if (!reconnectCanMaterializeRef.current) {
            releaseReconnectOwnership();
            reconnectRunIdRef.current = null;
            reconnectTurnIdRef.current = null;
          }
          reconnectTailOnlyRef.current = false;
          if (loaded) {
            reconnectAutoRecoveryCountRef.current = 0;
          }
          window.dispatchEvent(
            new CustomEvent("agentNative.chatRunning", {
              detail: {
                isRunning: false,
                tabId: tabId || threadId,
                ...reconnectEventIdentity,
              },
            }),
          );
        }
        if (!loaded && !isRuntimeRunningRef.current) {
          const repo = await refreshThreadFromServer();
          if (afterSeq > 0 || repoHasAssistantMessage(repo)) {
            setReconnectContent([]);
            setReconnectFrozen(false);
            reconnectCanMaterializeRef.current = false;
            releaseReconnectOwnership();
            reconnectRunIdRef.current = null;
            reconnectTurnIdRef.current = null;
          }
        }
      };

      void streamReconnect();
      return true;
    },
    [
      apiUrl,
      refreshThreadFromServer,
      releaseReconnectOwnership,
      t,
      tabId,
      threadId,
      wasUserStoppedRun,
    ],
  );

  const reconnectActiveRunForThread =
    useCallback(async (): Promise<boolean> => {
      if (!threadId) return false;
      if (isRuntimeRunningRef.current || isAutoResumingRef.current) {
        return false;
      }
      const storedActiveRun = getActiveRun();
      let runRes: Response | null = null;
      for (let attempt = 0; ; attempt += 1) {
        try {
          const res = await fetch(
            `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
          );
          if (res.ok) {
            runRes = res;
            break;
          }
        } catch {
          // Fall through to the retry/give-up path below.
        }
        const retryDelayMs = ACTIVE_RUN_PROBE_RETRY_DELAYS_MS[attempt];
        if (retryDelayMs === undefined) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }

      if (!runRes) {
        if (storedActiveRun?.threadId === threadId) {
          clearActiveRunIfMatches(threadId, storedActiveRun.runId);
          window.dispatchEvent(
            new CustomEvent("agent-chat:run-error", {
              detail: {
                message: t("agentChat.recovery.statusCheckFailed"),
                errorCode: "run_status_unavailable",
                recoverable: true,
                ...(storedActiveRun.runId
                  ? { runId: storedActiveRun.runId }
                  : {}),
                ...(tabId ? { tabId } : {}),
              },
            }),
          );
        }
        return false;
      }

      try {
        const runInfo = (await runRes.json()) as ActiveRunLookup;
        if (
          !runInfo.active ||
          (runInfo.status !== "running" && !isReplayableTerminalRun(runInfo)) ||
          activeRunLooksStale(runInfo)
        ) {
          if (storedActiveRun?.threadId === threadId) {
            clearActiveRunIfMatches(threadId, storedActiveRun.runId);
          } else if (runInfo.runId) {
            clearActiveRunIfMatches(threadId, String(runInfo.runId));
          }
          await refreshThreadFromServer();
          return false;
        }
        return startReconnectToRun(runInfo);
      } catch {
        return false;
      }
    }, [
      apiUrl,
      refreshThreadFromServer,
      startReconnectToRun,
      t,
      tabId,
      threadId,
    ]);

  useEffect(() => {
    if (!threadId || !isNewThread) return;
    setThreadRestoreError(null);
    setIsRestoring(false);
  }, [isNewThread, threadId]);

  useEffect(() => {
    if (isThreadStateLoading) return;
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    if (loadHistoryRepository) {
      let cancelled = false;
      void (async () => {
        try {
          const repo = await loadHistoryRepository();
          if (cancelled) return;
          if (repo) {
            importThreadData(repo, { markTitleGenerated: true });
          }
          titleGeneratedRef.current = true;
          setThreadRestoreError(null);
        } catch {
          if (!cancelled) setThreadRestoreError("unavailable");
        } finally {
          if (!cancelled) setIsRestoring(false);
        }
      })();
      return () => {
        cancelled = true;
        hasRestoredRef.current = false;
      };
    } else if (threadId && isNewThread) {
      setThreadRestoreError(null);
      setIsRestoring(false);
    } else if (threadId) {
      let cancelled = false;
      void (async () => {
        let canReconnect = false;
        try {
          const res = await fetch(
            `${apiUrl}/threads/${encodeURIComponent(threadId)}${threadScopeQuery}`,
          );
          if (!res.ok) {
            if (!cancelled) {
              setThreadRestoreError(
                shouldSuppressUnauthenticatedDesktopThreadRestore(
                  agentChatSurface,
                  res.status,
                  desktopIdentityUnauthenticated,
                )
                  ? null
                  : res.status === 404
                    ? "not-found"
                    : "unavailable",
              );
            }
            return;
          }

          const data = await res.json();
          if (cancelled || !data || typeof data !== "object") {
            if (!cancelled) setThreadRestoreError("unavailable");
            return;
          }

          if (!data.threadData) {
            if (!cancelled) setThreadRestoreError("unavailable");
            return;
          }

          if (data.threadData) {
            const repo = importThreadData(data.threadData, {
              markTitleGenerated: true,
            });
            if (repo) {
              let shouldCacheServerSnapshot = true;
              try {
                shouldCacheServerSnapshot = shouldImportServerThreadData(
                  normalizeThreadRepository(threadRuntime.export()),
                  repo,
                );
              } catch {
                shouldCacheServerSnapshot = false;
              }
              if (shouldCacheServerSnapshot) {
                const { title, preview } = extractThreadMeta(repo);
                writeCachedThreadSnapshot(apiUrl, threadId, {
                  threadData:
                    typeof data.threadData === "string"
                      ? data.threadData
                      : JSON.stringify(data.threadData),
                  title: data.title || title,
                  preview,
                  messageCount: Array.isArray(repo.messages)
                    ? repo.messages.length
                    : 0,
                });
              }
            }
            if (data.title) {
              titleGeneratedRef.current = true;
            }
            if (!cancelled) {
              setThreadRestoreError(null);
              canReconnect = true;
            }
          }
        } catch {
          if (!cancelled) setThreadRestoreError("unavailable");
        } finally {
          if (!cancelled) setIsRestoring(false);
        }
        if (cancelled || !canReconnect) return;
        try {
          await reconnectActiveRunForThread();
        } catch {
          // No active run to reconnect to.
        }
      })();
      return () => {
        cancelled = true;
        hasRestoredRef.current = false;
      };
    } else {
      const storageKey = `${CHAT_STORAGE_PREFIX}${tabId || "default"}`;
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) {
          const repo = JSON.parse(saved);
          if (repo?.messages?.length > 0) {
            threadRuntime.import(ensureMessageMetadata(repo));
          }
        }
      } catch {}
      setIsRestoring(false);
    }
  }, [
    threadId,
    tabId,
    apiUrl,
    threadRuntime,
    importThreadData,
    reconnectActiveRunForThread,
    loadHistoryRepository,
    isNewThread,
    isThreadStateLoading,
    desktopIdentityUnauthenticated,
    restoreAttempt,
    threadScopeQuery,
  ]);

  useEffect(() => {
    if (
      !loadHistoryRepository ||
      !hasRestoredRef.current ||
      isRestoring ||
      isRunning ||
      isAutoResuming
    ) {
      return;
    }
    let cancelled = false;
    void loadHistoryRepository()
      .then((repo) => {
        if (cancelled || !repo) return;
        importThreadData(repo, { markTitleGenerated: true });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    historyReloadKey,
    importThreadData,
    isAutoResuming,
    isRestoring,
    isRunning,
    loadHistoryRepository,
  ]);

  const prevRuntimeRunningForReconnectRef = useRef(isRuntimeRunning);
  useEffect(() => {
    const wasRuntimeRunning = prevRuntimeRunningForReconnectRef.current;
    prevRuntimeRunningForReconnectRef.current = isRuntimeRunning;
    if (
      !wasRuntimeRunning ||
      isRuntimeRunning ||
      !threadId ||
      forceStopped ||
      isReconnecting ||
      runErrorInfo ||
      wasUserStoppedRun(
        activeChatRunId ?? undefined,
        activeChatTurnId ?? undefined,
      )
    ) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        void reconnectActiveRunForThread();
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    forceStopped,
    isReconnecting,
    isRuntimeRunning,
    reconnectActiveRunForThread,
    runErrorInfo,
    threadId,
    wasUserStoppedRun,
  ]);

  useEffect(() => {
    if (!hasRestoredRef.current) return;
    if (titleGeneratedRef.current) return;
    if (messages.length === 0) return;

    const firstUserMsg = messages.find((m) => m.role === "user");
    if (!firstUserMsg) return;

    const text =
      "content" in firstUserMsg
        ? Array.isArray(firstUserMsg.content)
          ? firstUserMsg.content
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join(" ")
          : typeof firstUserMsg.content === "string"
            ? firstUserMsg.content
            : ""
        : "";

    if (!text.trim()) return;
    titleGeneratedRef.current = true;
    if (threadId) {
      onGenerateTitleRef.current?.(threadId, text.trim());
    }
  }, [messages, threadId]);

  const savedTitleRef = useRef("");
  const lastSaveTimeRef = useRef(0);
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    if (!isRunning) return;
    if (messages.length === 0) return;
    if (!threadId || !onSaveThreadRef.current) return;

    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTimeRef.current;
    if (timeSinceLastSave < 5000) return;

    const repo = exportPersistableThreadRepo();
    const { title, preview } = extractThreadMeta(repo);
    const threadData = JSON.stringify(stripBase64FromRepo(repo));
    const snapshot = {
      threadData,
      title,
      preview,
      messageCount: messages.length,
    };

    lastSaveTimeRef.current = now;
    savedTitleRef.current = title;
    writeCachedThreadSnapshot(apiUrl, threadId, snapshot);
    onSaveThreadRef.current(threadId, snapshot);
  }, [apiUrl, exportPersistableThreadRepo, messages, isRunning, threadId]);

  useEffect(() => {
    if (!hasRestoredRef.current) return;
    if (isRunning) return;
    if (messages.length === 0) return;

    const repo = exportPersistableThreadRepo();

    if (threadId && onSaveThreadRef.current) {
      const { title, preview } = extractThreadMeta(repo);
      const threadData = JSON.stringify(stripBase64FromRepo(repo));
      const snapshot = {
        threadData,
        title,
        preview,
        messageCount: messages.length,
      };
      savedTitleRef.current = title;
      writeCachedThreadSnapshot(apiUrl, threadId, snapshot);
      onSaveThreadRef.current(threadId, snapshot);
    } else {
      const storageKey = `${CHAT_STORAGE_PREFIX}${tabId || "default"}`;
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(repo));
      } catch {}
    }
  }, [
    apiUrl,
    exportPersistableThreadRepo,
    messages,
    isRunning,
    threadId,
    tabId,
  ]);

  useEffect(() => {
    onMessageCountChange?.(messages.length);
  }, [messages.length, onMessageCountChange]);

  useEffect(() => {
    if (!threadId) return;
    if (!hasRestoredRef.current) return;
    const serialized = JSON.stringify(queuedMessages);
    if (serialized === lastPersistedQueueRef.current) return;
    const queueVersion = queueMutationVersionRef.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `${apiUrl}/threads/${encodeURIComponent(threadId)}/queued${threadScopeQuery}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ queuedMessages }),
            },
          );
          if (res.ok) {
            lastPersistedQueueRef.current = serialized;
            if (queueMutationVersionRef.current === queueVersion) {
              queueDirtyRef.current = false;
            }
          }
        } catch {
          // Best-effort — next queue change will retry.
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [queuedMessages, threadId, apiUrl, threadScopeQuery]);

  const handleBuilderConnected = useCallback(() => {
    focusComposerAfterConnectRef.current = true;
    window.dispatchEvent(new Event("agent-engine:configured-changed"));
  }, []);
  useEffect(() => {
    if (
      agentEngineConfigured.state !== "configured" ||
      !focusComposerAfterConnectRef.current
    ) {
      return;
    }
    focusComposerAfterConnectRef.current = false;
    const timer = window.setTimeout(() => tiptapRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [agentEngineConfigured.state]);

  const checkAuthSession =
    useCallback(async (): Promise<AuthSessionCheckResult> => {
      try {
        const res = await fetch(
          agentNativePath("/_agent-native/auth/session"),
          {
            cache: "no-store",
          },
        );
        if (!res.ok) {
          return res.status === 401 || res.status === 403
            ? "missing"
            : "unknown";
        }
        const data = await res.json().catch(() => null);
        const hasSession = !!data && !data.error;
        setAuthSessionAvailable(hasSession);
        if (hasSession) {
          setAuthError(null);
        }
        return hasSession ? "available" : "missing";
      } catch {
        return "unknown";
      }
    }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | {
            reason?: string;
            tabId?: string;
            threadId?: string;
          }
        | undefined;
      const eventTabId =
        typeof detail?.tabId === "string" ? detail.tabId : null;
      const eventThreadId =
        typeof detail?.threadId === "string" ? detail.threadId : null;
      if (
        (eventTabId || eventThreadId) &&
        eventTabId !== tabId &&
        eventThreadId !== threadId
      ) {
        return;
      }
      void (async () => {
        const sessionState = await checkAuthSession();
        if (sessionState !== "missing") return;
        setAuthSessionAvailable(false);
        setAuthError({ sessionExpired: detail?.reason === "session-expired" });
      })();
    };
    window.addEventListener("agent-chat:auth-error", handler);
    return () => window.removeEventListener("agent-chat:auth-error", handler);
  }, [checkAuthSession, tabId, threadId]);

  useEffect(() => {
    if (!authError) return;
    const shouldCaptureStuckAuthCard =
      authSessionAvailable || authError.sessionExpired;
    const stuckCapture = window.setTimeout(() => {
      void (async () => {
        const sessionState = await checkAuthSession();
        if (sessionState === "available") return;
        if (sessionState !== "missing") return;
        if (!shouldCaptureStuckAuthCard) return;
        captureError(new Error("agent-chat:auth_error_card_stuck"), {
          tags: {
            context: "agent-native-chat",
            errorCode: "auth_error_card",
            sessionAvailable: String(authSessionAvailable),
            sessionExpired: String(!!authError.sessionExpired),
          },
          extra: {
            threadId: threadId ?? null,
            tabId: tabId ?? null,
          },
        });
      })();
    }, 3000);
    const handler = () => void checkAuthSession();
    const timer = window.setTimeout(handler, 250);
    window.addEventListener("focus", handler);
    window.addEventListener("agent-engine:configured-changed", handler);
    return () => {
      window.clearTimeout(stuckCapture);
      window.clearTimeout(timer);
      window.removeEventListener("focus", handler);
      window.removeEventListener("agent-engine:configured-changed", handler);
    };
  }, [authError, authSessionAvailable, checkAuthSession, tabId, threadId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!tabId || detail?.tabId === tabId) {
        setLoopLimitInfo({
          ...(typeof detail?.maxIterations === "number"
            ? { maxIterations: detail.maxIterations }
            : {}),
        });
        setShowContinue(true);
      }
    };
    window.addEventListener("agent-chat:loop-limit", handler);
    return () => window.removeEventListener("agent-chat:loop-limit", handler);
  }, [tabId]);

  const latestAssistantRunId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role !== "assistant") continue;
      const runId = assistantMessageRunId(message);
      if (runId) return runId;
    }
    return undefined;
  }, [messages]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as RunErrorInfo & {
        tabId?: string;
      };
      if (tabId && detail?.tabId && detail.tabId !== tabId) return;
      if (!detail?.message) return;
      const activeRun = getActiveRun();
      const activeRunId = activeRunMatchesThread(activeRun, threadId)
        ? activeRun?.runId
        : undefined;
      if (
        !shouldAcceptRunError({
          errorRunId: detail.runId,
          activeRunId,
          latestAssistantRunId,
        })
      ) {
        return;
      }
      const stopped = userStoppedRunRef.current;
      if (
        matchesUserStoppedRun(stopped, threadId, detail.runId, detail.turnId) ||
        (forceStopped && stopped?.threadId === threadId)
      ) {
        return;
      }
      clearReconnectReaderForTerminalError();
      setRunErrorInfo({
        message:
          detail.errorCode === "request_too_large"
            ? t("agentChat.composer.requestTooLarge")
            : detail.message,
        ...(detail.details ? { details: detail.details } : {}),
        ...(detail.errorCode ? { errorCode: detail.errorCode } : {}),
        ...(detail.runId ? { runId: detail.runId } : {}),
        ...(detail.turnId ? { turnId: detail.turnId } : {}),
        ...(detail.recoverable ? { recoverable: detail.recoverable } : {}),
      });
      setDismissedRunErrorKey(null);
      setDismissedProviderAuthErrorKey(null);
      clearAutoResume();
    };
    window.addEventListener("agent-chat:run-error", handler);
    return () => window.removeEventListener("agent-chat:run-error", handler);
  }, [
    clearAutoResume,
    clearReconnectReaderForTerminalError,
    forceStopped,
    latestAssistantRunId,
    t,
    tabId,
    threadId,
  ]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        label?: string;
        tool?: string;
        tabId?: string;
      };
      if (tabId && detail?.tabId && detail.tabId !== tabId) return;
      const label =
        typeof detail?.label === "string" ? detail.label.trim() : "";
      if (!label) return;
      const tool = typeof detail?.tool === "string" ? detail.tool.trim() : "";
      clearAutoResume();
      setRunningActivityTool(tool || null);
      updateActiveRunActivity(tool || null);
      latestActivityLabelRef.current = label;
      if (activityLabelSurfacedRef.current) {
        setRunningActivityLabel(label);
        return;
      }
      if (activityLabelTimerRef.current === null) {
        activityLabelTimerRef.current = window.setTimeout(() => {
          activityLabelTimerRef.current = null;
          activityLabelSurfacedRef.current = true;
          if (latestActivityLabelRef.current) {
            setRunningActivityLabel(latestActivityLabelRef.current);
          }
        }, ACTIVITY_LABEL_REVEAL_DELAY_MS);
      }
    };
    const clear = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tabId?: string };
      if (tabId && detail?.tabId && detail.tabId !== tabId) return;
      resetRunningActivity();
    };
    window.addEventListener("agent-chat:activity", handler);
    window.addEventListener("agent-chat:activity-clear", clear);
    return () => {
      window.removeEventListener("agent-chat:activity", handler);
      window.removeEventListener("agent-chat:activity-clear", clear);
    };
  }, [clearAutoResume, resetRunningActivity, tabId]);

  useEffect(() => {
    if (!isRunning && !isAutoResuming) {
      resetRunningActivity();
    }
  }, [isAutoResuming, isRunning, resetRunningActivity]);

  useEffect(() => {
    if (
      isRestoring ||
      isChatHistoryRestoring ||
      engineSetupRequired ||
      isRunning ||
      queuedMessages.length === 0
    ) {
      return;
    }
    if (dequeueInFlightRef.current) return;

    const next = queuedMessages[0];
    if (!next) return;
    const stopVersion = queueStopVersionRef.current;

    dequeueInFlightRef.current = true;
    let cancelled = false;
    let started = false;
    let retryTimer: number | null = null;
    const timer = window.setTimeout(() => {
      started = true;
      void (async () => {
        let removedForAppend = false;
        let appended = false;
        try {
          const runCleared = await waitForThreadRunToClear(apiUrl, threadId);
          if (cancelled || chatHistoryRestoreInFlightRef.current) return;
          if (!runCleared) {
            retryTimer = window.setTimeout(() => {
              if (!cancelled) {
                setQueueWakeVersion((version) => version + 1);
              }
            }, ACTIVE_RUN_CLEAR_RETRY_DELAY_MS);
            return;
          }

          const currentNext = queuedMessagesRef.current[0];
          if (
            queueStopVersionRef.current !== stopVersion ||
            !currentNext ||
            currentNext.id !== next.id
          ) {
            return;
          }

          if (!currentNext.hideUserMessage) {
            resetRetainedTextStreamingState(currentNext.turnId);
          }
          if (currentNext.promoted) {
            const promotedMessage = threadRuntime
              .getState()
              .messages.find(
                (message) =>
                  message.role === "user" &&
                  message.metadata?.custom?.agentNativeQueuedMessageId ===
                    currentNext.id,
              );
            if (!promotedMessage) return;
            threadRuntime.startRun({
              parentId: promotedMessage.id,
              runConfig:
                createUserMessageRunConfig(
                  currentNext.references,
                  currentNext.requestMode,
                  currentNext.recoveryAction,
                  currentNext.trackInRunsTray,
                  currentNext.approvedToolCalls,
                  currentNext.id,
                  currentNext.hideUserMessage,
                  {
                    model: currentNext.model,
                    engine: currentNext.engine,
                    effort: currentNext.effort,
                  },
                  currentNext.turnId,
                  currentNext.usageLabel,
                  currentNext.actionScope,
                ).runConfig ?? {},
            });
            applyLocalQueuedMessages((prev) =>
              prev.filter((message) => message.id !== currentNext.id),
            );
          } else {
            applyLocalQueuedMessages((prev) =>
              prev.filter((message) => message.id !== currentNext.id),
            );
            removedForAppend = true;

            const imageAttachments = createAgentImageAttachments(
              currentNext.images,
            );
            const messageAttachments =
              currentNext.attachments && currentNext.attachments.length > 0
                ? currentNext.attachments
                : (imageAttachments ?? []);
            appendThreadMessage({
              role: "user",
              content: [{ type: "text", text: currentNext.text }],
              ...(messageAttachments.length > 0
                ? { attachments: messageAttachments }
                : {}),
              ...createUserMessageRunConfig(
                currentNext.references,
                currentNext.requestMode,
                currentNext.recoveryAction,
                currentNext.trackInRunsTray,
                currentNext.approvedToolCalls,
                currentNext.id,
                currentNext.hideUserMessage,
                {
                  model: currentNext.model,
                  engine: currentNext.engine,
                  effort: currentNext.effort,
                },
                currentNext.turnId,
                currentNext.usageLabel,
                currentNext.actionScope,
              ),
            } as Parameters<typeof threadRuntime.append>[0]);
          }
          appended = true;
        } catch (err) {
          if (
            removedForAppend &&
            queueStopVersionRef.current === stopVersion &&
            !queuedMessagesRef.current.some((message) => message.id === next.id)
          ) {
            applyLocalQueuedMessages((prev) => [next, ...prev]);
          }
          captureError(err, {
            tags: {
              source: "agent-chat-client",
              phase: "dequeue-message",
            },
            extra: {
              threadId: threadId ?? null,
              queuedMessageId: next.id,
            },
          });
        } finally {
          if (appended) {
            window.setTimeout(() => {
              dequeueInFlightRef.current = false;
              setQueueWakeVersion((version) => version + 1);
            }, 500);
          } else {
            dequeueInFlightRef.current = false;
          }
        }
      })();
    }, 100);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (!started) {
        dequeueInFlightRef.current = false;
      }
    };
  }, [
    apiUrl,
    appendThreadMessage,
    applyLocalQueuedMessages,
    isChatHistoryRestoring,
    isRestoring,
    isRunning,
    engineSetupRequired,
    queueWakeVersion,
    queuedMessages,
    resetRetainedTextStreamingState,
    threadId,
  ]);

  const prevIsRuntimeRunningRef = useRef(isRuntimeRunning);
  useEffect(() => {
    const wasRunning = prevIsRuntimeRunningRef.current;
    prevIsRuntimeRunningRef.current = isRuntimeRunning;
    if (isRuntimeRunning && !wasRunning) {
      if (reconnectRunIdRef.current !== null) {
        reconnectAbortRef.current?.abort();
        releaseReconnectOwnership();
        reconnectAbortRef.current = null;
        reconnectRunIdRef.current = null;
        reconnectTurnIdRef.current = null;
        setIsReconnecting(false);
        setReconnectFrozen(false);
        reconnectCanMaterializeRef.current = false;
        reconnectTailOnlyRef.current = false;
        setReconnectContent([]);
      } else if (reconnectFrozen) {
        setReconnectFrozen(false);
        setReconnectContent([]);
        reconnectCanMaterializeRef.current = false;
      }
      if (forceStopped) {
        setForceStopped(false);
      }
    }
  }, [
    isRuntimeRunning,
    reconnectFrozen,
    forceStopped,
    releaseReconnectOwnership,
  ]);

  const prevIsReconnectingRef = useRef(isReconnecting);
  useEffect(() => {
    const wasReconnecting = prevIsReconnectingRef.current;
    prevIsReconnectingRef.current = isReconnecting;
    if (isReconnecting && !wasReconnecting && forceStopped) {
      setForceStopped(false);
    }
  }, [isReconnecting, forceStopped]);

  const materializeFrozenReconnectContent = useCallback(() => {
    if (!reconnectFrozen || reconnectContent.length === 0) return;
    if (!reconnectCanMaterializeRef.current) {
      releaseReconnectOwnership();
      reconnectRunIdRef.current = null;
      reconnectTurnIdRef.current = null;
      reconnectAbortRef.current = null;
      setReconnectFrozen(false);
      setReconnectContent([]);
      return;
    }
    try {
      const frozenContent = cloneContentParts(reconnectContent);
      settleInterruptedToolCalls(frozenContent, undefined, {
        includeActivity: true,
      });
      const repo = normalizeThreadRepository(threadRuntime.export());
      const messages = getRepoMessages(repo);
      const lastEntry = messages[messages.length - 1];
      const lastMessage = getRepoMessage(lastEntry);
      const parentId =
        typeof repo.headId === "string"
          ? repo.headId
          : typeof lastMessage?.id === "string"
            ? lastMessage.id
            : null;
      const runId = runErrorInfo?.runId ?? reconnectRunIdRef.current;
      const turnId =
        runErrorInfo?.turnId ??
        reconnectTurnIdRef.current ??
        getActiveRun()?.turnId;
      const id = `reconnect-${runId ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      repo.messages = [
        ...messages,
        {
          parentId,
          message: {
            id,
            role: "assistant",
            createdAt: new Date(),
            content: frozenContent,
            status: { type: "complete", reason: "stop" },
            metadata: {
              custom: {
                reconnectFrozen: true,
                ...(runId ? { runId } : {}),
                ...(turnId ? { turnId } : {}),
              },
            },
          },
        },
      ];
      repo.headId = id;

      threadRuntime.import(ensureMessageMetadata(repo));
      releaseReconnectOwnership();
      reconnectRunIdRef.current = null;
      reconnectTurnIdRef.current = null;
      reconnectAbortRef.current = null;
      setReconnectFrozen(false);
      setReconnectContent([]);
      reconnectCanMaterializeRef.current = false;
    } catch (err) {
      captureError(err, {
        tags: {
          source: "agent-chat-client",
          phase: "materialize-reconnect-content",
        },
        extra: {
          threadId: threadId ?? null,
          tabId: tabId ?? null,
          reconnectParts: reconnectContent.length,
        },
      });
    }
  }, [
    reconnectFrozen,
    reconnectContent,
    releaseReconnectOwnership,
    runErrorInfo?.runId,
    runErrorInfo?.turnId,
    tabId,
    threadId,
    threadRuntime,
  ]);

  const settleVisibleInterruptedTools = useCallback(
    (runId?: string, turnId?: string) => {
      if (!runId && !turnId) return;
      try {
        const repo = normalizeThreadRepository(threadRuntime.export());
        const settled = settleInterruptedAssistantToolCallsInRepo(repo, {
          userStopped: true,
          ...(runId ? { runId } : {}),
          ...(turnId ? { turnId } : {}),
        });
        if (settled.changed) {
          threadRuntime.import(ensureMessageMetadata(settled.repo));
        }
      } catch (err) {
        captureError(err, {
          tags: {
            source: "agent-chat-client",
            phase: "settle-stopped-tool-calls",
          },
          extra: {
            threadId: threadId ?? null,
            tabId: tabId ?? null,
          },
        });
      }
    },
    [tabId, threadId, threadRuntime],
  );

  const markVisibleRunStopped = useCallback(
    (runId?: string, turnId?: string) => {
      if (!runId && !turnId) return;
      try {
        const repo = normalizeThreadRepository(threadRuntime.export());
        const messages = getRepoMessages(repo);
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const entry = messages[index];
          const message = getRepoMessage(entry);
          if (message?.role !== "assistant") continue;
          if (
            !(
              (runId !== undefined &&
                assistantMessageRunId(message) === runId) ||
              (turnId !== undefined &&
                assistantMessageTurnId(message) === turnId)
            )
          ) {
            continue;
          }
          const metadata = message.metadata ?? {};
          const custom =
            metadata.custom && typeof metadata.custom === "object"
              ? (metadata.custom as Record<string, unknown>)
              : {};
          if (custom.userStopped === true) return;
          const nextMessage = {
            ...message,
            status: { type: "complete", reason: "stop" },
            metadata: {
              ...metadata,
              custom: { ...custom, userStopped: true },
            },
          };
          const nextMessages = messages.slice();
          nextMessages[index] =
            entry.message === undefined
              ? { ...entry, ...nextMessage }
              : { ...entry, message: nextMessage };
          threadRuntime.import(
            ensureMessageMetadata({ ...repo, messages: nextMessages }),
          );
          return;
        }
      } catch (err) {
        captureError(err, {
          tags: {
            source: "agent-chat-client",
            phase: "mark-user-stopped-run",
          },
          extra: {
            threadId: threadId ?? null,
            tabId: tabId ?? null,
          },
        });
      }
    },
    [tabId, threadId, threadRuntime],
  );

  const stopActiveRun = useCallback(
    (options?: { preserveQueuedMessages?: boolean }) => {
      setForceStopped(true);
      isRunningRef.current = false;
      setOptimisticRunning(false);
      setHasActiveServerRun(false);
      setPendingReconnectRecovery(null);
      clearAutoResume();
      resetRunningActivity();
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("agentNative.chatRunning", {
            detail: {
              isRunning: false,
              tabId: tabId || threadId,
              reason: "stopped",
            },
          }),
        );
      }
      if (!options?.preserveQueuedMessages) {
        queueStopVersionRef.current += 1;
        dequeueInFlightRef.current = false;
        applyLocalQueuedMessages(() => []);
      }
      const activeRun = getActiveRun();
      const runIdToAbort = reconnectRunIdRef.current ?? activeRun?.runId;
      const pendingTurn = threadId ? getPendingTurn(threadId) : null;
      const turnIdToAbort =
        pendingTurn?.turnId ??
        reconnectTurnIdRef.current ??
        (activeRun?.runId === runIdToAbort ? activeRun?.turnId : undefined);
      userStoppedRunRef.current = {
        ...(threadId ? { threadId } : {}),
        ...(runIdToAbort ? { runId: runIdToAbort } : {}),
        ...(turnIdToAbort ? { turnId: turnIdToAbort } : {}),
      };
      trackStoppedRun(runIdToAbort);
      setRunErrorInfo(null);
      setDismissedRunErrorKey(null);
      if (runIdToAbort) {
        if (threadId) clearActiveRunIfMatches(threadId, runIdToAbort);
        fetch(`${apiUrl}/runs/${encodeURIComponent(runIdToAbort)}/abort`, {
          method: "POST",
        }).catch(() => {});
      } else if (pendingTurn && threadId) {
        clearPendingTurnIfMatches(threadId, pendingTurn.turnId);
        fetch(
          `${apiUrl}/runs/turn/${encodeURIComponent(pendingTurn.turnId)}/abort`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ threadId }),
          },
        ).catch(() => {});
      }
      if (isReconnecting || reconnectRunIdRef.current !== null) {
        reconnectAbortRef.current?.abort();
        releaseReconnectOwnership();
        reconnectAbortRef.current = null;
        reconnectRunIdRef.current = null;
        reconnectTurnIdRef.current = null;
        setIsReconnecting(false);
        setReconnectFrozen(false);
        setReconnectContent([]);
        reconnectCanMaterializeRef.current = false;
        reconnectTailOnlyRef.current = false;
      }
      settleVisibleInterruptedTools(runIdToAbort, turnIdToAbort);
      markVisibleRunStopped(runIdToAbort, turnIdToAbort);
      threadRuntime.cancelRun();
    },
    [
      apiUrl,
      applyLocalQueuedMessages,
      clearAutoResume,
      isReconnecting,
      markVisibleRunStopped,
      resetRunningActivity,
      releaseReconnectOwnership,
      reconnectContent,
      settleVisibleInterruptedTools,
      tabId,
      threadId,
      threadRuntime,
      trackStoppedRun,
    ],
  );
  stopActiveRunRef.current = stopActiveRun;

  const handleComposerStop = useCallback(async () => {
    let hostStopSucceeded = true;
    if (onStop) {
      try {
        hostStopSucceeded = (await onStop()) !== false;
      } catch {
        hostStopSucceeded = false;
      }
    }
    if (!hostStopSucceeded) return;
    stopActiveRun({ preserveQueuedMessages: true });
  }, [onStop, stopActiveRun]);

  const sendQueuedMessageNow = useCallback(
    async (id: string) => {
      await waitForChatHistoryRestore();
      const message = queuedMessagesRef.current.find(
        (candidate) => candidate.id === id,
      );
      if (!message || message.promoted) return;
      try {
        const imageAttachments = createAgentImageAttachments(message.images);
        const messageAttachments =
          message.attachments && message.attachments.length > 0
            ? message.attachments
            : (imageAttachments ?? []);
        appendThreadMessage({
          role: "user",
          content: [{ type: "text", text: message.text }],
          ...(messageAttachments.length > 0
            ? { attachments: messageAttachments }
            : {}),
          ...createUserMessageRunConfig(
            message.references,
            message.requestMode,
            message.recoveryAction,
            message.trackInRunsTray,
            message.approvedToolCalls,
            message.id,
            message.hideUserMessage,
            {
              model: message.model,
              engine: message.engine,
              effort: message.effort,
            },
            message.turnId,
            message.usageLabel,
            message.actionScope,
          ),
          startRun: false,
        } as Parameters<typeof threadRuntime.append>[0]);
      } catch (error) {
        captureError(error, {
          tags: {
            source: "agent-chat-client",
            phase: "promote-queued-message",
          },
          extra: { threadId: threadId ?? null, queuedMessageId: id },
        });
        return;
      }
      applyLocalQueuedMessages((prev) => promoteQueuedMessage(prev, id));
    },
    [
      appendThreadMessage,
      applyLocalQueuedMessages,
      threadId,
      threadRuntime,
      waitForChatHistoryRestore,
    ],
  );

  const visibleQueuedMessages = useMemo(
    () =>
      queuedMessages.filter(
        (message) => !message.hideUserMessage && !message.promoted,
      ),
    [queuedMessages],
  );

  const addToQueue = useCallback(
    async (
      text: string,
      images?: string[],
      references?: Reference[],
      attachments?: ReadonlyArray<unknown>,
      requestMode?: AgentRequestMode,
      intent: ComposerSubmitIntent = "queued",
      recoveryAction?: AgentRecoveryAction,
      includeComposerContext = false,
      trackInRunsTray = false,
      preserveReconnectAutoRecoveryBudget = false,
      hideUserMessage = false,
      submitMessageId?: string,
      approvedToolCalls?: string[],
      continuationTurnId?: string,
      usageLabel?: string,
      actionScope?: AgentActionScope,
    ) => {
      if (isAgentChatSubmitCancelled(submitMessageId)) return false;
      await waitForChatHistoryRestore();
      if (isAgentChatSubmitCancelled(submitMessageId)) return false;
      const wasSubmissionInFlight = submissionInFlightRef.current > 0;
      submissionInFlightRef.current += 1;
      const previousSubmission = submissionTailRef.current;
      let releaseSubmission!: () => void;
      const currentSubmission = new Promise<void>((resolve) => {
        releaseSubmission = resolve;
      });
      submissionTailRef.current = previousSubmission.then(
        () => currentSubmission,
      );
      await previousSubmission;
      try {
        const visibleSubmitSequence = hideUserMessage
          ? null
          : ++visibleSubmitSequenceRef.current;
        const runningAtSubmitStart = isRunning;
        const activeRunAtSubmitStart = getActiveRun();
        const activeRunIdAtSubmitStart = activeRunMatchesThread(
          activeRunAtSubmitStart,
          threadId,
        )
          ? (activeRunAtSubmitStart?.runId ?? null)
          : null;
        const stoppedRunAtSubmitStart = userStoppedRunRef.current;
        if (!preserveReconnectAutoRecoveryBudget) {
          reconnectAutoRecoveryCountRef.current = 0;
        }
        materializeFrozenReconnectContent();
        setShowContinue(false);
        setLoopLimitInfo(null);
        setRunErrorInfo(null);
        setDismissedRunErrorKey(null);
        setDismissedProviderAuthErrorKey(null);
        setComposerError(null);
        clearPendingSelection();
        const submitted = includeComposerContext
          ? buildComposerContextSubmission(text)
          : { text, includesContext: false };
        const submittedText = submitted.text;
        let queuedAttachments: Awaited<
          ReturnType<typeof serializeQueuedAttachments>
        >;
        try {
          queuedAttachments = await serializeQueuedAttachments(attachments);
        } catch (err) {
          const msg = formatAttachmentError(
            err,
            t("agentChat.composer.attachmentError"),
          );
          setComposerError(msg);
          reportAgentChatSubmitResult(
            submitMessageId,
            false,
            "attachment-error",
          );
          return false;
        }
        if (isAgentChatSubmitCancelled(submitMessageId)) return false;
        const imageAttachments = createAgentImageAttachments(images);
        const allAttachments = [
          ...(queuedAttachments ?? []),
          ...(imageAttachments ?? []),
        ];

        let messageAttachments = allAttachments;
        {
          const promptPayloadStrings = getSubmittedPromptBodyStrings(
            submittedText,
            continuationTurnId !== undefined,
          );
          const allPayloadStrings = [
            ...getAttachmentBodyStrings(allAttachments),
            ...promptPayloadStrings,
          ];
          if (
            measureJsonStringBytes(allPayloadStrings) > MAX_ESTIMATED_BODY_BYTES
          ) {
            const recompressed: typeof allAttachments = [];
            for (const att of allAttachments) {
              if (
                att.type === "image" &&
                att.content.length === 1 &&
                att.content[0].type === "image"
              ) {
                const rawAtt = (attachments ?? []).find(
                  (r) => (r as any).id === att.id,
                ) as { file?: File } | undefined;
                const rawFile = rawAtt?.file;
                if (rawFile && typeof document !== "undefined") {
                  try {
                    const recompressedUrl = await transcodeImageToDataURL(
                      rawFile,
                      {
                        maxDimension: AGGRESSIVE_MAX_IMAGE_DIMENSION,
                        jpegQuality: AGGRESSIVE_JPEG_QUALITY,
                      },
                    );
                    recompressed.push({
                      ...att,
                      content: [{ type: "image", image: recompressedUrl }],
                    });
                    continue;
                  } catch {
                    // coercion-ok: recompression is best-effort; the final size check
                    // rejects the original when it still does not fit.
                    // Could not recompress — keep the original and let the
                    // final size estimate decide whether it still fits.
                  }
                }
              }
              recompressed.push(att);
            }
            const recompressedPayloadStrings = [
              ...getAttachmentBodyStrings(recompressed),
              ...promptPayloadStrings,
            ];
            if (
              measureJsonStringBytes(recompressedPayloadStrings) >
              MAX_ESTIMATED_BODY_BYTES
            ) {
              setComposerError(t("agentChat.composer.requestTooLarge"));
              reportAgentChatSubmitResult(
                submitMessageId,
                false,
                "attachment-too-large",
              );
              return false;
            }
            messageAttachments = recompressed;
          }
        }
        if (isAgentChatSubmitCancelled(submitMessageId)) return false;
        const acceptedVisibleSubmit =
          visibleSubmitSequence !== null &&
          visibleSubmitSequence >=
            latestAcceptedVisibleSubmitSequenceRef.current;
        if (visibleSubmitSequence !== null && acceptedVisibleSubmit) {
          latestAcceptedVisibleSubmitSequenceRef.current =
            visibleSubmitSequence;
        }
        const effectiveRequestMode: AgentRequestMode | undefined =
          requestMode ??
          (execMode === "plan"
            ? "plan"
            : execMode === "build"
              ? "act"
              : undefined);
        const modelSnapshot = {
          model: selectedModel,
          engine: selectedEngine,
          effort: selectedEffort,
        };
        const effectiveContinuationTurnId =
          continuationTurnId ??
          (actionScope ? generateAgentChatTurnId() : undefined);
        const liveIsRunning = isRunningRef.current;
        const activeRunNow = getActiveRun();
        const sameActiveRun =
          activeRunIdAtSubmitStart !== null &&
          activeRunMatchesThread(activeRunNow, threadId) &&
          activeRunNow?.runId === activeRunIdAtSubmitStart;
        const interruptActiveRun =
          !wasSubmissionInFlight &&
          runningAtSubmitStart &&
          liveIsRunning &&
          intent === "immediate" &&
          sameActiveRun;
        const queueForActiveRun =
          wasSubmissionInFlight ||
          (liveIsRunning && (intent === "immediate" || intent === "queued"));
        if (acceptedVisibleSubmit && !liveIsRunning && !engineSetupRequired) {
          resetRetainedTextStreamingState(effectiveContinuationTurnId);
        }
        if (interruptActiveRun) {
          applyLocalQueuedMessages((prev) => [
            ...prev,
            {
              id:
                typeof crypto !== "undefined" && crypto.randomUUID
                  ? crypto.randomUUID()
                  : `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              text: submittedText,
              images,
              attachments:
                messageAttachments.length > 0 ? messageAttachments : undefined,
              references,
              requestMode: effectiveRequestMode,
              recoveryAction,
              trackInRunsTray,
              hideUserMessage,
              approvedToolCalls,
              ...(effectiveContinuationTurnId
                ? { turnId: effectiveContinuationTurnId }
                : {}),
              ...(usageLabel ? { usageLabel } : {}),
              ...(actionScope ? { actionScope } : {}),
              ...modelSnapshot,
            },
          ]);
          stopActiveRunRef.current({ preserveQueuedMessages: true });
        } else if (engineSetupRequired || queueForActiveRun) {
          applyLocalQueuedMessages((prev) => [
            ...prev,
            {
              id:
                typeof crypto !== "undefined" && crypto.randomUUID
                  ? crypto.randomUUID()
                  : `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              text: submittedText,
              images,
              attachments:
                messageAttachments.length > 0 ? messageAttachments : undefined,
              references,
              requestMode: effectiveRequestMode,
              recoveryAction,
              trackInRunsTray,
              hideUserMessage,
              approvedToolCalls,
              ...(effectiveContinuationTurnId
                ? { turnId: effectiveContinuationTurnId }
                : {}),
              ...(usageLabel ? { usageLabel } : {}),
              ...(actionScope ? { actionScope } : {}),
              ...modelSnapshot,
            },
          ]);
        } else {
          try {
            await chatHistory?.beforeStart?.();
          } catch (error) {
            setComposerError(String(error));
            reportAgentChatSubmitResult(
              submitMessageId,
              false,
              "editor-save-failed",
            );
            return false;
          }
          if (isAgentChatSubmitCancelled(submitMessageId)) return false;
          markOptimisticRunning();
          try {
            appendThreadMessage({
              role: "user",
              content: [{ type: "text", text: submittedText }],
              ...(messageAttachments.length > 0
                ? { attachments: messageAttachments }
                : {}),
              ...createUserMessageRunConfig(
                references,
                effectiveRequestMode,
                recoveryAction,
                trackInRunsTray,
                approvedToolCalls,
                undefined,
                hideUserMessage,
                undefined,
                effectiveContinuationTurnId,
                usageLabel,
                actionScope,
              ),
            } as Parameters<typeof threadRuntime.append>[0]);
          } catch (error) {
            setOptimisticRunning(false);
            reportAgentChatSubmitResult(
              submitMessageId,
              false,
              "append-failed",
            );
            throw error;
          }
        }
        if (!hideUserMessage) resumeFollowingRef.current();
        reportAgentChatSubmitResult(submitMessageId, true);
        if (userStoppedRunRef.current === stoppedRunAtSubmitStart) {
          userStoppedRunRef.current = null;
        }
        if (submitted.includesContext) {
          updateComposerContextItems(() => []);
        }
        return true;
      } finally {
        releaseSubmission();
        submissionInFlightRef.current -= 1;
      }
    },
    [
      applyLocalQueuedMessages,
      buildComposerContextSubmission,
      execMode,
      isRunning,
      materializeFrozenReconnectContent,
      markOptimisticRunning,
      resetRetainedTextStreamingState,
      engineSetupRequired,
      appendThreadMessage,
      selectedEffort,
      selectedEngine,
      selectedModel,
      t,
      threadId,
      updateComposerContextItems,
      waitForChatHistoryRestore,
      chatHistory,
    ],
  );

  const mcpResumeTimerRef = useRef<number | null>(null);
  const scheduleMcpConnectionResume = useCallback(
    (request: McpConnectionResumeRequest) => {
      if (mcpResumeTimerRef.current !== null) {
        window.clearTimeout(mcpResumeTimerRef.current);
      }
      mcpResumeTimerRef.current = window.setTimeout(() => {
        mcpResumeTimerRef.current = null;
        const continuation = latestProtocolContinuationContext(
          messagesRef.current,
        );
        void addToQueue(
          request.message,
          undefined,
          undefined,
          undefined,
          undefined,
          "queued",
          undefined,
          false,
          false,
          false,
          false,
          undefined,
          undefined,
          continuation.turnId,
          undefined,
          continuation.actionScope,
        );
      }, 0);
    },
    [addToQueue],
  );

  useEffect(() => {
    const pending = consumeMcpConnectionResume();
    if (pending) scheduleMcpConnectionResume(pending);

    return addMcpConnectionCompleteListener(() => {
      const completed = consumeMcpConnectionResume();
      if (completed) scheduleMcpConnectionResume(completed);
    });
  }, [scheduleMcpConnectionResume]);

  useEffect(
    () => () => {
      if (mcpResumeTimerRef.current !== null) {
        window.clearTimeout(mcpResumeTimerRef.current);
        mcpResumeTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!pendingReconnectRecovery) return;
    const recovery = pendingReconnectRecovery;
    const timer = window.setTimeout(() => {
      setPendingReconnectRecovery((current) =>
        current?.id === recovery.id ? null : current,
      );
      const continuation = recovery.turnId
        ? protocolContinuationContext(messagesRef.current, recovery.turnId)
        : latestProtocolContinuationContext(messagesRef.current);
      void addToQueue(
        recovery.message,
        undefined,
        undefined,
        undefined,
        undefined,
        "queued",
        "continue",
        false,
        false,
        true,
        true,
        undefined,
        undefined,
        continuation.turnId,
        undefined,
        continuation.actionScope,
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [addToQueue, pendingReconnectRecovery]);

  const latestMessage = messages[messages.length - 1];
  const latestMessageRole = latestMessage?.role;
  const latestAssistantWasPlan =
    latestMessageRole === "assistant" &&
    getRequestModeMetadata(latestMessage) === "plan";
  const showPlanModeCallout =
    execMode === "plan" &&
    !planModeDisabled &&
    !isComposerDisabled &&
    !showRunningInUI;
  const canImplementPlan = showPlanModeCallout && latestAssistantWasPlan;
  const handleImplementPlan = useCallback(() => {
    if (!canImplementPlan) return false;
    onExecModeChange?.("build");
    const continuation = latestProtocolContinuationContext(messagesRef.current);
    void addToQueue(
      "Implement the plan.",
      undefined,
      undefined,
      undefined,
      "act",
      "queued",
      undefined,
      false,
      false,
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      continuation.actionScope,
    );
    return true;
  }, [addToQueue, canImplementPlan, onExecModeChange]);
  const handleSwitchToAct = useCallback(() => {
    onExecModeChange?.("build");
  }, [onExecModeChange]);

  useImperativeHandle(
    ref,
    () => ({
      sendMessage(
        text: string,
        images?: string[],
        options?: AssistantChatSendOptions,
      ) {
        void addToQueue(
          text,
          images,
          undefined,
          options?.attachments,
          options?.requestMode,
          "queued",
          undefined,
          false,
          options?.trackInRunsTray === true,
          false,
          options?.hideUserMessage === true,
          options?.submitMessageId,
          options?.approvedToolCalls,
          undefined,
          options?.usageLabel,
          options?.actionScope,
        );
      },
      implementPlan() {
        return handleImplementPlan();
      },
      prefillMessage(text: string) {
        tiptapRef.current?.setText(text);
        tiptapRef.current?.focus();
      },
      setComposerContextItem(
        item: AgentChatContextItem,
        options?: { focus?: boolean },
      ) {
        stageComposerContextItem(item);
        if (options?.focus !== false) tiptapRef.current?.focus();
      },
      removeComposerContextItem(key: string) {
        removeComposerContextItem(key);
      },
      clearComposerContextItems() {
        updateComposerContextItems(() => []);
      },
      sendRecoveryMessage(
        text: string,
        recoveryAction: AgentRecoveryAction,
        images?: string[],
      ) {
        const continuation = latestProtocolContinuationContext(
          messagesRef.current,
        );
        void addToQueue(
          text,
          images,
          undefined,
          undefined,
          undefined,
          "queued",
          recoveryAction,
          false,
          false,
          false,
          false,
          undefined,
          undefined,
          continuation.turnId,
          undefined,
          continuation.actionScope,
        );
      },
      queueMessage(text: string, images?: string[]) {
        void addToQueue(text, images);
      },
      isRunning() {
        return isRunning;
      },
      hasInFlightWork() {
        const current = messagesRef.current;
        const last = current[current.length - 1] as
          | { role?: unknown; content?: unknown }
          | undefined;
        if (
          !last ||
          last.role !== "assistant" ||
          !Array.isArray(last.content)
        ) {
          return false;
        }
        return hasInFlightToolCall(last.content as ContentPart[]);
      },
      focusComposer() {
        tiptapRef.current?.focus();
      },
      exportThreadSnapshot() {
        if (messages.length === 0) return null;
        const repo = exportPersistableThreadRepo();
        const { title, preview } = extractThreadMeta(repo);
        return {
          threadData: JSON.stringify(stripBase64FromRepo(repo)),
          title,
          preview,
          messageCount: messages.length,
        };
      },
    }),
    [
      addToQueue,
      exportPersistableThreadRepo,
      handleImplementPlan,
      isRunning,
      messages.length,
      stageComposerContextItem,
    ],
  );

  const visibleReconnectContent = dedupeReconnectContentAgainstMessages(
    reconnectContent,
    messages,
    {
      suppressToolRepeats: isReconnecting || reconnectFrozen,
      trimTailTextOverlap: reconnectTailOnlyRef.current,
    },
  );
  const showReconnectOverlay = shouldShowReconnectOverlay({
    isRuntimeRunning,
    isReconnecting,
    reconnectFrozen,
    reconnectOwnsStream:
      isReconnecting || reconnectFrozen
        ? Boolean(
            threadId &&
            reconnectRunIdRef.current &&
            reconnectOwnershipTokenRef.current &&
            ownsRunStream(
              threadId,
              reconnectRunIdRef.current,
              reconnectOwnershipTokenRef.current,
              reconnectTurnIdRef.current ?? undefined,
            ),
          )
        : undefined,
  });
  const reconnectStatusContent =
    visibleReconnectContent.length > 0
      ? visibleReconnectContent
      : reconnectContent.length === 0
        ? reconnectActivityContent
        : [];
  const showGlobalRunningStatus = shouldShowGlobalRunningStatus({
    showRunningInUI,
    runningActivityLabel,
    runningActivityTool,
    latestMessage,
    reconnectContent: reconnectStatusContent,
  });
  const chatScrollResetKey = `${tabId ?? ""}:${threadId ?? ""}`;

  const { isDevMode: cpDevMode } = useDevMode(apiUrl);
  const [checkpointRunIds, setCheckpointRunIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  useEffect(() => {
    if (!cpDevMode || !threadId || messages.length === 0) {
      setCheckpointRunIds(new Set<string>());
      return;
    }
    if (isRunning) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${apiUrl}/checkpoints?threadId=${encodeURIComponent(threadId)}`,
        );
        if (!res.ok) throw new Error(String(res.status));
        const rows: unknown = await res.json();
        if (cancelled) return;
        const runIds = Array.isArray(rows)
          ? rows
              .map((row) => (row as { runId?: unknown })?.runId)
              .filter((id): id is string => typeof id === "string" && !!id)
          : [];
        setCheckpointRunIds(new Set(runIds));
      } catch {
        if (!cancelled) setCheckpointRunIds(new Set<string>());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, cpDevMode, threadId, isRunning, messages.length]);
  const checkpointCtx = useMemo(
    () => ({ apiUrl, devMode: cpDevMode, threadId, checkpointRunIds }),
    [apiUrl, cpDevMode, threadId, checkpointRunIds],
  );
  const lastMessageLoopLimit = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return null;
    return getLoopLimitMetadata(last);
  }, [messages]);
  const lastMessageRunError = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return null;
    return getRunErrorMetadata(last);
  }, [messages]);
  const lastUserText = useMemo(
    () => latestNonRecoveryUserMessageText(messages),
    [messages],
  );
  const retryAfterRunError = useCallback(() => {
    setRunErrorInfo(null);
    const failedTurnId = runErrorInfo?.turnId ?? lastMessageRunError?.turnId;
    const continuation = failedTurnId
      ? protocolContinuationContext(messagesRef.current, failedTurnId)
      : latestProtocolContinuationContext(messagesRef.current);
    void addToQueue(
      lastUserText
        ? `Retry the previous request from a clean approach. Do not rerun the exact same failed tool input unless the failure was transient or the user explicitly asked for an exact rerun. If a provider query failed because of schema, syntax, or type mismatch, diagnose the error and adjust the query first.\n\nOriginal request:\n\n${lastUserText}`
        : "Retry the previous request from a clean approach. Do not rerun the exact same failed tool input unless the failure was transient or the user explicitly asked for an exact rerun. If a provider query failed because of schema, syntax, or type mismatch, diagnose the error and adjust the query first.",
      undefined,
      undefined,
      undefined,
      undefined,
      "queued",
      "retry",
      false,
      false,
      false,
      false,
      undefined,
      undefined,
      continuation.turnId,
      undefined,
      continuation.actionScope,
    );
  }, [addToQueue, lastMessageRunError?.turnId, lastUserText, runErrorInfo]);
  const [missingKeyBouncePulse, setMissingKeyBouncePulse] = useState(0);
  const bounceMissingKeySetup = useCallback(() => {
    setMissingKeyBouncePulse((pulse) => pulse + 1);
  }, []);
  const visibleLoopLimit = showContinue
    ? (loopLimitInfo ?? lastMessageLoopLimit ?? {})
    : lastMessageLoopLimit;
  const visibleRunError = runErrorInfo ?? lastMessageRunError;
  const visibleRunErrorKey = visibleRunError
    ? runErrorKey(visibleRunError)
    : null;
  const providerAuthErrorKey =
    visibleRunError &&
    !isBuilderReconnectRunError(visibleRunError) &&
    isProviderAuthenticationError(
      [visibleRunError.message, visibleRunError.details]
        .filter(Boolean)
        .join("\n"),
      visibleRunError.errorCode,
    )
      ? visibleRunErrorKey
      : null;
  const showProviderAuthSetup =
    providerAuthErrorKey !== null &&
    providerAuthErrorKey !== dismissedProviderAuthErrorKey &&
    !authError;
  const shouldShowRunError =
    !!visibleRunError &&
    !showRunningInUI &&
    !forceStopped &&
    visibleRunErrorKey !== dismissedRunErrorKey &&
    !showProviderAuthSetup &&
    !matchesUserStoppedRun(
      userStoppedRunRef.current,
      threadId,
      visibleRunError.runId,
      visibleRunError.turnId,
    );
  const showMissingKeySetup =
    (engineSetupRequired || showProviderAuthSetup) && !authError;
  const handleProviderSetupDismiss = useCallback(() => {
    if (providerAuthErrorKey === null) return;
    setDismissedProviderAuthErrorKey(providerAuthErrorKey);
    setDismissedRunErrorKey(providerAuthErrorKey);
    setRunErrorInfo(null);
  }, [providerAuthErrorKey]);
  const handleProviderSetupConnected = useCallback(() => {
    handleBuilderConnected();
    if (providerAuthErrorKey === null) return;
    setDismissedProviderAuthErrorKey(providerAuthErrorKey);
    setDismissedRunErrorKey(providerAuthErrorKey);
    setRunErrorInfo(null);
    retryAfterRunError();
  }, [handleBuilderConnected, providerAuthErrorKey, retryAfterRunError]);
  const messageActionsCtx = useMemo(
    () => ({
      onForkChat,
      onRetryRunError: retryAfterRunError,
      bannerRunErrorKey: shouldShowRunError ? visibleRunErrorKey : null,
    }),
    [onForkChat, retryAfterRunError, shouldShowRunError, visibleRunErrorKey],
  );
  const hasActiveChatWork =
    showRunningInUI ||
    isAutoResuming ||
    queuedMessages.length > 0 ||
    reconnectContent.length > 0;
  const resolvedThreadFooterSlot =
    typeof threadFooterSlot === "function"
      ? threadFooterSlot({
          threadId: threadId ?? null,
          tabId: tabId ?? null,
        })
      : threadFooterSlot;
  const resolvedThreadContentSlot =
    typeof threadContentSlot === "function"
      ? threadContentSlot({
          threadId: threadId ?? null,
          tabId: tabId ?? null,
        })
      : threadContentSlot;
  const hasThreadContentSlot = Boolean(resolvedThreadContentSlot);
  const hasThreadFooterSlot = Boolean(resolvedThreadFooterSlot);
  const isFreshEmptyChat =
    messages.length === 0 &&
    !hasThreadContentSlot &&
    !hasActiveChatWork &&
    !isRestoring &&
    !isReconnecting &&
    !authError;
  const centeredRestoringState =
    centerComposerWhenEmpty &&
    messages.length === 0 &&
    !hasActiveChatWork &&
    isRestoring &&
    !isReconnecting &&
    !authError;
  const centeredEmptyState =
    centerComposerWhenEmpty && (isFreshEmptyChat || centeredRestoringState);
  const showEmptyState =
    messages.length === 0 &&
    !hasThreadContentSlot &&
    !isReconnecting &&
    !hasActiveChatWork;
  const showInlineEmptyThreadFooterSlot =
    showEmptyState &&
    !centeredEmptyState &&
    !isRestoring &&
    hasThreadFooterSlot;
  const showCenteredEmptyThreadFooterSlot =
    centeredEmptyState && !isRestoring && hasThreadFooterSlot;
  const showComposerSlot =
    Boolean(composerSlot) && (!centerComposerWhenEmpty || centeredEmptyState);
  const compactMissingKeyEmptyState =
    missingApiKeySetupLayout === "sidebar" &&
    engineSetupRequired &&
    !authError &&
    showEmptyState &&
    !isRestoring;
  const threadRestoreErrorSurface = threadRestoreError ? (
    <div
      role="alert"
      className="flex max-w-[320px] flex-col items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-center"
    >
      <IconRefresh className="h-5 w-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {threadRestoreError === "not-found"
          ? t("agentChat.message.threadNotFound")
          : t("agentChat.message.restoreRequestFailed")}
      </p>
      <button
        type="button"
        onClick={retryThreadRestore}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
      >
        {t("agentChat.common.retry")}
      </button>
    </div>
  ) : null;

  const {
    questions: guidedQuestions,
    title: guidedQuestionsTitle,
    description: guidedQuestionsDescription,
    skipLabel: guidedQuestionsSkipLabel,
    submitLabel: guidedQuestionsSubmitLabel,
    handleSubmit: handleGuidedQuestionsSubmit,
    handleSkip: handleGuidedQuestionsSkip,
  } = useGuidedQuestionFlow({
    stateKey: "guided-questions",
    queryKey: ["guided-questions"],
    ...(browserTabId ? { browserTabId } : {}),
    ...(threadId ? { threadId } : {}),
  });
  const hasComposerAccessoryAboveStack = Boolean(
    composerError ||
    showComposerSlot ||
    showCenteredEmptyThreadFooterSlot ||
    (guidedQuestions && guidedQuestions.length > 0) ||
    visibleComposerContextItems.length > 0 ||
    visibleQueuedMessages.length > 0 ||
    showPlanModeCallout ||
    showMissingKeySetup,
  );

  const approvalResolutionScope = threadId ?? tabId ?? "default";
  const [approvalResolutionState, setApprovalResolutionState] = useState<{
    scope: string;
    byIdentity: Map<string, ApprovalResolution>;
  }>(() => ({
    scope: approvalResolutionScope,
    byIdentity: new Map(),
  }));
  const getApprovalResolution = useCallback(
    (approvalKey: string, toolCallId?: string, askId?: string) => {
      if (approvalResolutionState.scope !== approvalResolutionScope) {
        return null;
      }
      return (
        approvalResolutionState.byIdentity.get(
          approvalResolutionIdentity(approvalKey, toolCallId, askId),
        ) ?? null
      );
    },
    [approvalResolutionScope, approvalResolutionState],
  );
  const recordApprovalResolution = useCallback(
    (
      approvalKey: string,
      resolution: ApprovalResolution,
      toolCallId?: string,
      askId?: string,
    ) => {
      setApprovalResolutionState((previous) => {
        const byIdentity =
          previous.scope === approvalResolutionScope
            ? previous.byIdentity
            : new Map<string, ApprovalResolution>();
        const next = new Map(byIdentity);
        next.set(
          approvalResolutionIdentity(approvalKey, toolCallId, askId),
          resolution,
        );
        return { scope: approvalResolutionScope, byIdentity: next };
      });
    },
    [approvalResolutionScope],
  );

  const approveToolCall = useCallback(
    (approvalKey: string) => {
      const continuation = approvalProtocolContinuationContext(
        messagesRef.current,
        approvalKey,
      );
      void addToQueue(
        "Approved. Go ahead and run the requested action.", // i18n-ignore -- stable hidden agent instruction, not UI copy.
        undefined,
        undefined,
        undefined,
        undefined,
        "queued",
        undefined,
        false,
        false,
        false,
        true, // hideUserMessage: this is a protocol continuation, not a new prompt
        undefined,
        [approvalKey],
        continuation.turnId,
        undefined,
        continuation.actionScope,
      );
    },
    [addToQueue],
  );
  const alwaysAllowToolCall = useCallback(
    (approvalKey: string, toolName: string) => {
      if (approvalActions?.onAlwaysAllow) {
        return approvalActions.onAlwaysAllow(approvalKey, toolName);
      }
      return callAction("set-tool-approval-policy", {
        toolName,
        enabled: true,
      }).then(() => approveToolCall(approvalKey));
    },
    [approvalActions, approveToolCall],
  );
  const showActionTypeApprovalPolicy =
    approvalActions?.alwaysAllowScope !== "exact-command";
  const approvalCtx = useMemo<ApprovalContextValue>(
    () => ({
      getApprovalResolution,
      onApprovalResolved: recordApprovalResolution,
      onApprove: approveToolCall,
      ...(showActionTypeApprovalPolicy
        ? { onAlwaysAllow: alwaysAllowToolCall }
        : {}),
      ...(approvalActions?.onDeny ? { onDeny: approvalActions.onDeny } : {}),
    }),
    [
      alwaysAllowToolCall,
      approvalActions,
      approveToolCall,
      getApprovalResolution,
      recordApprovalResolution,
      showActionTypeApprovalPolicy,
    ],
  );

  return (
    <SuppressInlineOpenAppContext.Provider value={suppressInlineOpenApp}>
      <CheckpointContext.Provider value={checkpointCtx}>
        <MessageActionsContext.Provider value={messageActionsCtx}>
          <ApprovalContext.Provider value={approvalCtx}>
            <ChatRunDurationContext.Provider
              value={showRunningInUI ? null : lastChatRunDurationMs}
            >
              <ServerRunActiveContext.Provider value={serverRunActive}>
                <ChatRunningRunIdContext.Provider value={activeChatRunId}>
                  <ChatRunningTurnIdContext.Provider value={activeChatTurnId}>
                    <ChatRunningContext.Provider
                      value={showRunningInUI || runErrorInfo !== null}
                    >
                      <AgentTextStreamingProvider
                        identity={activeTextStreamingIdentity}
                        streaming={textStreaming}
                        runActive={showRunningInUI}
                      >
                        <div
                          data-agent-empty-state={
                            centeredEmptyState
                              ? "centered"
                              : compactMissingKeyEmptyState
                                ? "compact-setup"
                                : undefined
                          }
                          className={cn(
                            "relative flex flex-1 flex-col h-full min-h-0 text-foreground",
                            className,
                          )}
                          onDragEnter={handleChatDragEnter}
                          onDragOver={handleChatDragOver}
                          onDragLeave={handleChatDragLeave}
                          onDropCapture={handleChatDropCapture}
                          onDrop={handleChatDrop}
                        >
                          {dropActive && (
                            <div
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-md border-2 border-dashed border-primary/70 bg-primary/5 backdrop-blur-[1px]"
                            >
                              <span className="rounded-md bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
                                {t("agentChat.composer.dropToAttach")}
                              </span>
                            </div>
                          )}
                          {showHeader && (
                            <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
                              <span className="text-[13px] font-medium text-muted-foreground">
                                Agent
                              </span>
                              <div className="flex items-center gap-1">
                                {onSwitchToCli && (
                                  <TooltipProvider delayDuration={200}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          onClick={onSwitchToCli}
                                          aria-label={t(
                                            "agentChat.header.switchToCli",
                                          )}
                                          className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent"
                                        >
                                          <IconTerminal className="h-3.5 w-3.5" />
                                          CLI
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {t("agentChat.header.switchToCli")}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Messages area */}
                          <MessageScrollerProvider
                            key={chatScrollResetKey}
                            autoScroll
                          >
                            <AssistantChatScrollerControls
                              resumeFollowingRef={resumeFollowingRef}
                            />
                            <MessageScroller className="agent-chat-scroll">
                              <MessageScrollerViewport>
                                {authError ? (
                                  <div className="flex flex-col items-center justify-center h-full px-4 gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                                      {authSessionAvailable ? (
                                        <IconRefresh className="h-5 w-5 text-muted-foreground" />
                                      ) : (
                                        <IconMessage className="h-5 w-5 text-muted-foreground" />
                                      )}
                                    </div>
                                    <div className="text-center max-w-[280px]">
                                      <p className="text-sm font-medium text-foreground mb-1">
                                        {authSessionAvailable
                                          ? t("agentChat.auth.refreshTitle")
                                          : authError.sessionExpired
                                            ? t("agentChat.auth.expiredTitle")
                                            : t("agentChat.auth.requiredTitle")}
                                      </p>
                                      <p className="text-xs text-muted-foreground leading-relaxed">
                                        {authSessionAvailable
                                          ? t(
                                              "agentChat.auth.refreshDescription",
                                            )
                                          : authError.sessionExpired
                                            ? t(
                                                "agentChat.auth.expiredDescription",
                                              )
                                            : t(
                                                "agentChat.auth.requiredDescription",
                                              )}
                                      </p>
                                    </div>
                                    <div className="flex gap-2">
                                      {!authError.sessionExpired &&
                                        !authSessionAvailable && (
                                          <button
                                            onClick={() => {
                                              window.location.href =
                                                buildSignInReturnHref();
                                            }}
                                            className="text-xs text-background bg-foreground hover:opacity-90 px-3 py-1.5 rounded-md"
                                          >
                                            {t("agentChat.auth.logIn")}
                                          </button>
                                        )}
                                      {authError.sessionExpired &&
                                        !authSessionAvailable && (
                                          <button
                                            onClick={() => {
                                              void signOut();
                                            }}
                                            className="text-xs text-destructive hover:text-destructive/80 px-3 py-1.5 rounded-md border border-destructive/30 hover:bg-destructive/10"
                                          >
                                            {t("agentChat.auth.logOut")}
                                          </button>
                                        )}
                                      <button
                                        onClick={() => {
                                          setAuthError(null);
                                          window.location.reload();
                                        }}
                                        className={
                                          authSessionAvailable
                                            ? "text-xs text-background bg-foreground hover:opacity-90 px-3 py-1.5 rounded-md"
                                            : "text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-border hover:bg-accent"
                                        }
                                      >
                                        {t("agentChat.auth.refreshChat")}
                                      </button>
                                    </div>
                                  </div>
                                ) : isRestoring && centeredRestoringState ? (
                                  <div
                                    className={cn(
                                      "agent-empty-state",
                                      emptyStateDisplay === "hidden"
                                        ? "sr-only"
                                        : "flex h-full flex-col items-center justify-center gap-3 px-4 py-16",
                                    )}
                                    aria-busy="true"
                                  >
                                    <IconMessage className="h-5 w-5 text-muted-foreground/60" />
                                    <p className="sr-only">
                                      {emptyStateText ??
                                        t("agentChat.empty.loadingChat")}
                                    </p>
                                  </div>
                                ) : isRestoring ? (
                                  <div className="flex flex-col gap-3 p-4">
                                    <div className="flex justify-end">
                                      <div className="h-8 w-32 rounded-lg bg-muted animate-pulse" />
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                      <div className="h-4 w-48 rounded bg-muted animate-pulse" />
                                      <div className="h-4 w-64 rounded bg-muted animate-pulse" />
                                      <div className="h-4 w-40 rounded bg-muted animate-pulse" />
                                    </div>
                                  </div>
                                ) : threadRestoreError &&
                                  messages.length === 0 ? (
                                  <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-16">
                                    {threadRestoreErrorSurface}
                                  </div>
                                ) : showEmptyState ? (
                                  <div
                                    className={cn(
                                      "agent-empty-state",
                                      emptyStateDisplay === "hidden"
                                        ? "sr-only"
                                        : "flex h-full flex-col items-center justify-center gap-3 px-4 py-16",
                                    )}
                                  >
                                    <IconMessage className="h-5 w-5 text-muted-foreground/60" />
                                    <p className="sr-only">
                                      {emptyStateText ??
                                        t("agentChat.empty.prompt")}
                                    </p>
                                    {emptyStateAddon}
                                    {showSuggestions &&
                                    suggestionPlacement === "empty-state" &&
                                    resolvedSuggestions &&
                                    resolvedSuggestions.length > 0 ? (
                                      <div className="flex w-full max-w-[320px] flex-col gap-1.5">
                                        {resolvedSuggestions.map(
                                          (suggestion) => (
                                            <button
                                              key={suggestion}
                                              type="button"
                                              onClick={() => {
                                                if (engineSetupRequired) return;
                                                void addToQueue(suggestion);
                                              }}
                                              className="agent-empty-suggestion w-full rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 text-left text-[13px] text-muted-foreground shadow-sm transition-[border-color,background-color,color,transform] hover:-translate-y-px hover:border-border hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                            >
                                              {suggestion}
                                            </button>
                                          ),
                                        )}
                                      </div>
                                    ) : null}
                                    {showInlineEmptyThreadFooterSlot ? (
                                      <div className="agent-thread-footer-slot agent-thread-footer-slot--empty">
                                        {resolvedThreadFooterSlot}
                                      </div>
                                    ) : null}
                                    {emptyStateFooter ? (
                                      <div className="agent-empty-state-footer">
                                        {emptyStateFooter}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : (
                                  <MessageScrollerContent className="agent-thread-content gap-4 px-4 py-4">
                                    {resolvedThreadContentSlot ? (
                                      <MessageScrollerItem>
                                        <div className="agent-thread-content-slot">
                                          {resolvedThreadContentSlot}
                                        </div>
                                      </MessageScrollerItem>
                                    ) : null}
                                    {threadRestoreErrorSurface ? (
                                      <MessageScrollerItem>
                                        {threadRestoreErrorSurface}
                                      </MessageScrollerItem>
                                    ) : null}
                                    <AssistantMessageListErrorBoundary
                                      resetKey={messageListResetKey}
                                    >
                                      <UserStoppedRunContext.Provider
                                        value={wasUserStoppedRun}
                                      >
                                        <ExternalUserStoppedRunContext.Provider
                                          value={externalUserStopped}
                                        >
                                          <ExternalTextStreamingContext.Provider
                                            value={externalStreaming}
                                          >
                                            <AssistantChatHistoryContext.Provider
                                              value={chatHistoryContext}
                                            >
                                              {chatHistoryContext?.beginningVersion ? (
                                                <MessageScrollerItem>
                                                  <AssistantChatHistoryBeginningRevertButton />
                                                </MessageScrollerItem>
                                              ) : null}
                                              <ThreadPrimitive.Messages
                                                components={{
                                                  UserMessage:
                                                    AssistantChatUserMessageItem,
                                                  AssistantMessage:
                                                    AssistantChatAssistantMessageItem,
                                                }}
                                              />
                                            </AssistantChatHistoryContext.Provider>
                                          </ExternalTextStreamingContext.Provider>
                                        </ExternalUserStoppedRunContext.Provider>
                                      </UserStoppedRunContext.Provider>
                                    </AssistantMessageListErrorBoundary>
                                    {visibleLoopLimit && !showRunningInUI && (
                                      <MessageScrollerItem>
                                        <LoopLimitContinueCard
                                          info={visibleLoopLimit}
                                          onContinue={() => {
                                            setShowContinue(false);
                                            setLoopLimitInfo(null);
                                            const continuation =
                                              latestProtocolContinuationContext(
                                                messagesRef.current,
                                              );
                                            void addToQueue(
                                              "Continue from where you left off.",
                                              undefined,
                                              undefined,
                                              undefined,
                                              undefined,
                                              "queued",
                                              "continue",
                                              false,
                                              false,
                                              false,
                                              false,
                                              undefined,
                                              undefined,
                                              continuation.turnId,
                                              undefined,
                                              continuation.actionScope,
                                            );
                                          }}
                                        />
                                      </MessageScrollerItem>
                                    )}
                                    {shouldShowRunError && visibleRunError && (
                                      <MessageScrollerItem>
                                        <RunErrorRecoveryCard
                                          info={visibleRunError}
                                          onContinue={() => {
                                            setRunErrorInfo(null);
                                            const continuation =
                                              visibleRunError.turnId
                                                ? protocolContinuationContext(
                                                    messagesRef.current,
                                                    visibleRunError.turnId,
                                                  )
                                                : latestProtocolContinuationContext(
                                                    messagesRef.current,
                                                  );
                                            void addToQueue(
                                              RECONNECT_NO_PROGRESS_CONTINUE_MESSAGE,
                                              undefined,
                                              undefined,
                                              undefined,
                                              undefined,
                                              "queued",
                                              "continue",
                                              false,
                                              false,
                                              false,
                                              false,
                                              undefined,
                                              undefined,
                                              continuation.turnId,
                                              undefined,
                                              continuation.actionScope,
                                            );
                                          }}
                                          onRetry={retryAfterRunError}
                                          onFork={onForkChat}
                                          onProviderConnected={
                                            handleBuilderConnected
                                          }
                                          onDismiss={() => {
                                            if (visibleRunErrorKey) {
                                              setDismissedRunErrorKey(
                                                visibleRunErrorKey,
                                              );
                                            }
                                            setRunErrorInfo(null);
                                          }}
                                        />
                                      </MessageScrollerItem>
                                    )}
                                    {showReconnectOverlay &&
                                      visibleReconnectContent.length > 0 && (
                                        <MessageScrollerItem>
                                          <ReconnectStreamMessage
                                            content={visibleReconnectContent}
                                            allowActivitySpinner={
                                              !reconnectFrozen
                                            }
                                          />
                                        </MessageScrollerItem>
                                      )}
                                    {showReconnectOverlay &&
                                      visibleReconnectContent.length === 0 &&
                                      reconnectContent.length === 0 &&
                                      reconnectActivityContent.length > 0 && (
                                        <MessageScrollerItem>
                                          <ReconnectStreamMessage
                                            content={reconnectActivityContent}
                                            allowActivitySpinner={
                                              !reconnectFrozen
                                            }
                                          />
                                        </MessageScrollerItem>
                                      )}
                                    {showGlobalRunningStatus && (
                                      <MessageScrollerItem>
                                        <AgentActivityTrace
                                          items={[
                                            {
                                              id:
                                                runningActivityTool ??
                                                "working",
                                              label:
                                                runningActivityTool ??
                                                "Working on your request",
                                              variant: runningActivityTool
                                                ?.toLowerCase()
                                                .includes("search")
                                                ? "search"
                                                : "steps",
                                              status: "running",
                                            },
                                          ]}
                                          summary={
                                            runningActivityLabel === "Thinking"
                                              ? t("agentChat.status.working")
                                              : runningStatusLabel
                                          }
                                          activeSummary={
                                            runningActivityLabel === "Thinking"
                                              ? t("agentChat.status.working")
                                              : runningStatusLabel
                                          }
                                          running
                                        />
                                      </MessageScrollerItem>
                                    )}
                                    {resolvedThreadFooterSlot ? (
                                      <MessageScrollerItem>
                                        <div className="agent-thread-footer-slot">
                                          {resolvedThreadFooterSlot}
                                        </div>
                                      </MessageScrollerItem>
                                    ) : null}
                                  </MessageScrollerContent>
                                )}
                              </MessageScrollerViewport>
                              {!authError && !isRestoring && !showEmptyState ? (
                                <MessageScrollerButton />
                              ) : null}
                            </MessageScroller>
                          </MessageScrollerProvider>

                          {showComposerSlot ? composerSlot : null}
                          {showCenteredEmptyThreadFooterSlot ? (
                            <div className="agent-thread-footer-slot agent-thread-footer-slot--centered-empty">
                              {resolvedThreadFooterSlot}
                            </div>
                          ) : null}
                          {guidedQuestions && guidedQuestions.length > 0 && (
                            <div className="shrink-0 px-3 pb-2">
                              <GuidedQuestionFlow
                                questions={guidedQuestions}
                                onSubmit={handleGuidedQuestionsSubmit}
                                onSkip={handleGuidedQuestionsSkip}
                                {...(guidedQuestionsTitle
                                  ? { title: guidedQuestionsTitle }
                                  : {})}
                                {...(guidedQuestionsDescription
                                  ? {
                                      description: guidedQuestionsDescription,
                                    }
                                  : {})}
                                {...(guidedQuestionsSkipLabel
                                  ? { skipLabel: guidedQuestionsSkipLabel }
                                  : {})}
                                {...(guidedQuestionsSubmitLabel
                                  ? {
                                      submitLabel: guidedQuestionsSubmitLabel,
                                    }
                                  : {})}
                                className="h-auto items-stretch justify-stretch bg-transparent"
                              />
                            </div>
                          )}
                          {/* Inline attachment / body-size error */}
                          {composerError && (
                            <div
                              role="alert"
                              className="mx-3 mb-1.5 flex shrink-0 items-start gap-2 rounded-md border border-border bg-muted/70 px-3 py-2 text-xs text-foreground shadow-sm"
                            >
                              <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="flex-1 leading-snug">
                                {composerError}
                              </span>
                              <button
                                type="button"
                                aria-label={t("agentChat.common.dismissError")}
                                onClick={() => setComposerError(null)}
                                className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <IconX className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                          {showSuggestions &&
                          suggestionPlacement === "context-chips" &&
                          resolvedSuggestionInputs &&
                          resolvedSuggestionInputs.length > 0 ? (
                            <AgentSuggestionBar
                              ariaLabel={t(
                                "agentChat.composer.suggestedPrompts",
                              )}
                              suggestions={resolvedSuggestionInputs}
                              onSelect={(suggestion) => {
                                if (engineSetupRequired) return;
                                void addToQueue(
                                  agentSuggestionPrompt(suggestion),
                                );
                              }}
                            />
                          ) : null}
                          <div
                            className="agent-composer-stack"
                            data-agent-composer-adjacent-ui={
                              hasComposerAccessoryAboveStack
                                ? "true"
                                : undefined
                            }
                          >
                            <SelectionAttachedPill />
                            {showPlanModeCallout && (
                              <PlanModeCallout
                                canImplementPlan={canImplementPlan}
                                onImplementPlan={handleImplementPlan}
                                onSwitchToAct={handleSwitchToAct}
                              />
                            )}
                            {showMissingKeySetup ? (
                              <BuilderSetupCard
                                key={providerAuthErrorKey ?? "missing-provider"}
                                fullWidth
                                attached
                                bouncePulse={missingKeyBouncePulse}
                                layout={missingApiKeySetupLayout}
                                onDismiss={
                                  providerAuthErrorKey !== null
                                    ? handleProviderSetupDismiss
                                    : undefined
                                }
                                onConnected={handleProviderSetupConnected}
                                onRetry={
                                  providerAuthErrorKey !== null
                                    ? retryAfterRunError
                                    : undefined
                                }
                              />
                            ) : null}
                            {/* Input area */}
                            <PromptBar mode="inline" className="contents">
                              <AgentComposerFrame
                                attachedAccessory={
                                  <MessageQueueDrawer
                                    variant="recessed"
                                    items={visibleQueuedMessages.map(
                                      (message) => ({
                                        id: message.id,
                                        text: displayableUserMessageText(
                                          message.text,
                                        ),
                                        images:
                                          queuedMessageImageSources(message),
                                      }),
                                    )}
                                    labels={{
                                      region: t("agentChat.queue.count", {
                                        count: visibleQueuedMessages.length,
                                      }),
                                      steer: t("agentChat.queue.steer"),
                                      steerHint: t("agentChat.queue.steerHint"),
                                      remove: t("agentChat.queue.remove"),
                                      moreActions: t(
                                        "agentChat.queue.moreActions",
                                      ),
                                    }}
                                    onSteer={(item) =>
                                      sendQueuedMessageNow(item.id)
                                    }
                                    onRemove={(item) =>
                                      applyLocalQueuedMessages((previous) =>
                                        previous.filter(
                                          (message) => message.id !== item.id,
                                        ),
                                      )
                                    }
                                    getItemActions={(item) => [
                                      {
                                        id: "move-to-top",
                                        label: t("agentChat.queue.moveToTop"),
                                        icon: (
                                          <IconArrowUp
                                            aria-hidden="true"
                                            className="size-3.5"
                                          />
                                        ),
                                        onSelect: () =>
                                          applyLocalQueuedMessages((previous) =>
                                            hoistQueuedMessageToFront(
                                              previous,
                                              item.id,
                                            ),
                                          ),
                                      },
                                    ]}
                                  />
                                }
                                layoutVariant={composerLayoutVariant}
                                className={cn(
                                  composerAreaClassName,
                                  showMissingKeySetup &&
                                    "agent-composer-area--attached-above",
                                  isComposerDisabled &&
                                    !showMissingKeySetup &&
                                    "opacity-70",
                                )}
                                onClick={
                                  showMissingKeySetup
                                    ? bounceMissingKeySetup
                                    : undefined
                                }
                              >
                                <>
                                  <ComposerAttachmentPreviewStrip />
                                  <TiptapComposer
                                    focusRef={tiptapRef}
                                    maxDocumentAttachmentBytes={MAX_PDF_BYTES}
                                    initialText={
                                      initialComposerText ?? undefined
                                    }
                                    initialTextKey={composerDraftScope}
                                    onTextChange={
                                      isActiveComposer
                                        ? handleComposerTextChange
                                        : undefined
                                    }
                                    disabled={
                                      isComposerDisabled ||
                                      showMissingKeySetup ||
                                      isChatHistoryRestoring
                                    }
                                    placeholder={
                                      showMissingKeySetup
                                        ? t(
                                            "agentChat.setup.connectPlaceholder",
                                          )
                                        : engineSetupRequired
                                          ? t(
                                              "agentChat.setup.connectPlaceholder",
                                            )
                                          : composerDisabled
                                            ? (composerDisabledPlaceholder ??
                                              t(
                                                "agentChat.composer.openDesktop",
                                              ))
                                            : isRunning
                                              ? queuedMessages.length > 0
                                                ? t(
                                                    "agentChat.queue.followUpWithCount",
                                                    {
                                                      count:
                                                        queuedMessages.length,
                                                    },
                                                  )
                                                : t("agentChat.queue.followUp")
                                              : resolveAssistantChatComposerPlaceholder(
                                                  composerPlaceholder,
                                                )
                                    }
                                    onSubmit={async (
                                      text,
                                      references,
                                      attachments,
                                      options,
                                    ) => {
                                      const accepted = await addToQueue(
                                        text,
                                        undefined,
                                        references.length > 0
                                          ? references
                                          : undefined,
                                        attachments,
                                        undefined,
                                        resolveAssistantChatSubmitIntent({
                                          isRunning:
                                            isRunning ||
                                            isRunningRef.current ||
                                            isRuntimeRunningRef.current ||
                                            isAutoResumingRef.current ||
                                            activeRunMatchesThread(
                                              getActiveRun(),
                                              threadId,
                                            ),
                                          isSubmissionInFlight:
                                            submissionInFlightRef.current > 0,
                                          requestedIntent: options?.intent,
                                        }),
                                        undefined,
                                        true,
                                      );
                                      if (!accepted) {
                                        throw new Error(
                                          "Attachment submission was not accepted",
                                        );
                                      }
                                    }}
                                    willQueue={
                                      engineSetupRequired ||
                                      isRunning ||
                                      isChatHistoryRestoring ||
                                      submissionInFlightRef.current > 0
                                    }
                                    onSlashCommand={onSlashCommand}
                                    execMode={execMode}
                                    onExecModeChange={onExecModeChange}
                                    planModeDisabled={planModeDisabled}
                                    planModeDisabledReason={
                                      planModeDisabledReason
                                    }
                                    selectedModel={
                                      selectedModel ?? defaultModel
                                    }
                                    selectedEffort={selectedEffort}
                                    availableModels={availableModels}
                                    availableAgents={availableAgents}
                                    selectedAgent={selectedAgent}
                                    hostedHarness={hostedHarness}
                                    modelListLoading={modelListLoading}
                                    onModelChange={
                                      shouldShowAssistantChatModelSelector(
                                        showModelSelector,
                                      )
                                        ? onModelChange
                                        : undefined
                                    }
                                    onEffortChange={onEffortChange}
                                    onAgentChange={onAgentChange}
                                    imageModelMenu={imageModelMenu}
                                    onConnectProvider={onConnectProvider}
                                    onConnectLocalRuntime={
                                      onConnectLocalRuntime
                                    }
                                    toolbarSlot={composerToolbarSlot}
                                    contextItems={visibleComposerContextItems}
                                    onRemoveContextItem={
                                      removeComposerContextItem
                                    }
                                    plusMenuMode={plusMenuMode}
                                    layoutVariant={composerLayoutVariant}
                                    providerConnectStatusEnabled={
                                      providerStatusChecksEnabled
                                    }
                                    voiceEnabled
                                    draftScope={composerDraftScope}
                                    interceptBuildRequestsForBuilder
                                    onAttachmentError={setComposerError}
                                    extraActionButton={
                                      composerExtraActionButton
                                    }
                                    stopButton={
                                      showRunningInUI ? (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              type="button"
                                              onClick={handleComposerStop}
                                              aria-label={t(
                                                "agentChat.composer.stopResponse",
                                              )}
                                              data-agent-composer-slot="stop-button"
                                              className="shrink-0 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                            >
                                              <IconPlayerStopFilled className="h-3 w-3" />
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            {t(
                                              "agentChat.composer.stopResponse",
                                            )}
                                          </TooltipContent>
                                        </Tooltip>
                                      ) : undefined
                                    }
                                  />
                                </>
                              </AgentComposerFrame>
                            </PromptBar>
                          </div>
                        </div>
                      </AgentTextStreamingProvider>
                    </ChatRunningContext.Provider>
                  </ChatRunningTurnIdContext.Provider>
                </ChatRunningRunIdContext.Provider>
              </ServerRunActiveContext.Provider>
            </ChatRunDurationContext.Provider>
          </ApprovalContext.Provider>
        </MessageActionsContext.Provider>
      </CheckpointContext.Provider>
    </SuppressInlineOpenAppContext.Provider>
  );
});

export const AssistantChat = forwardRef<
  AssistantChatHandle,
  AssistantChatProps
>(function AssistantChat(
  {
    apiUrl = agentNativePath("/_agent-native/agent-chat"),
    tabId,
    browserTabId,
    threadId,
    contextScope,
    contextNamespace,
    isActiveComposer,
    ...props
  },
  ref,
) {
  const resolvedBrowserTabId =
    browserTabId ??
    (typeof window === "undefined" ? undefined : getBrowserTabId());
  const modelRef = useRef<string | undefined>(props.selectedModel);
  modelRef.current = props.selectedModel;
  const engineRef = useRef<string | undefined>(props.selectedEngine);
  engineRef.current = props.selectedEngine;
  const effortRef = useRef<ReasoningEffort | undefined>(props.selectedEffort);
  effortRef.current = props.selectedEffort;
  const harnessRef = useRef<string | undefined>(
    props.hostedHarness ? props.selectedAgent : undefined,
  );
  harnessRef.current = props.hostedHarness ? props.selectedAgent : undefined;
  const hostedHarnessRef = useRef(props.hostedHarness === true);
  hostedHarnessRef.current = props.hostedHarness === true;
  const execModeRef = useRef<"build" | "plan" | undefined>(props.execMode);
  execModeRef.current = props.execMode;
  const scopeRef = useRef<ChatThreadScope | null | undefined>(contextScope);
  scopeRef.current = contextScope;
  const surface = props.agentChatSurface ?? "app";
  const createAdapterRef = useRef(props.createAdapter);
  createAdapterRef.current = props.createAdapter;
  const runtimeRef = useRef(props.runtime);
  runtimeRef.current = props.runtime;

  const adapter = useMemo(
    () => {
      const context: AssistantChatAdapterContext = {
        apiUrl,
        streamingUrl: props.streamingUrl,
        tabId,
        threadId,
        modelRef,
        engineRef,
        effortRef,
        harnessRef,
        hostedHarnessRef,
        execModeRef,
        browserTabId: resolvedBrowserTabId,
        scopeRef,
        surface,
      };
      const createAdapter = createAdapterRef.current;
      if (createAdapter) return createAdapter(context);
      const runtime = runtimeRef.current;
      if (runtime) {
        return createAgentChatRuntimeAdapter(runtime, {
          sessionId: threadId ?? tabId,
          threadId,
          modelRef,
          effortRef,
        });
      }
      return createAgentChatAdapter(context);
    },
    [
      apiUrl,
      tabId,
      threadId,
      resolvedBrowserTabId,
      surface,
      props.streamingUrl,
      props.runtime,
      props.adapterReloadKey,
    ],
  );
  const attachmentAdapter = useMemo(
    () =>
      new CompositeAttachmentAdapter([
        new DownscalingImageAttachmentAdapter(),
        new BinaryDocumentAttachmentAdapter(),
        new TextAttachmentAdapter(),
      ]),
    [],
  );
  const runtime = useLocalRuntime(adapter, {
    adapters: { attachments: attachmentAdapter },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThinkingDisplayProvider value={props.thinkingDisplay}>
        <TooltipProvider delayDuration={200}>
          <ThreadPrimitive.Root className="flex flex-1 flex-col h-full min-h-0 overflow-x-hidden">
            <AssistantUiStaleIndexErrorBoundary
              resetKey={`${tabId ?? ""}:${threadId ?? ""}`}
              componentName="AssistantChat"
            >
              <AssistantChatInner
                ref={ref}
                {...props}
                browserTabId={resolvedBrowserTabId}
                contextScope={contextScope}
                contextNamespace={contextNamespace}
                isActiveComposer={isActiveComposer}
                apiUrl={apiUrl}
                tabId={tabId}
                threadId={threadId}
              />
            </AssistantUiStaleIndexErrorBoundary>
          </ThreadPrimitive.Root>
        </TooltipProvider>
      </ThinkingDisplayProvider>
    </AssistantRuntimeProvider>
  );
});
