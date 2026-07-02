import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useThreadRuntime,
  useThread,
  useAui,
  useComposer,
  useComposerRuntime,
  ThreadPrimitive,
} from "@assistant-ui/react";
import type {
  Attachment,
  ChatModelAdapter,
  ExportedMessageRepository,
} from "@assistant-ui/react";
import { CompositeAttachmentAdapter } from "@assistant-ui/react";
import {
  IconMessage,
  IconX,
  IconPlayerStop,
  IconChevronDown,
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

import { LLM_MISSING_CREDENTIALS_MESSAGE } from "../agent/engine/credential-errors.js";
import type { ReasoningEffort } from "../shared/reasoning-effort.js";
import {
  ACTIVE_RUN_STATE_EVENT,
  clearActiveRunIfMatches,
  getActiveRunActivityTool,
  getActiveRun,
  resolveReconnectAfterSeq,
  setActiveRun,
  type ActiveRunState,
  updateActiveRunActivity,
  updateActiveRunSeq,
} from "./active-run-state.js";
import {
  createAgentChatAdapter,
  type AgentChatSurfaceKind,
} from "./agent-chat-adapter.js";
import {
  appendAgentChatContextToMessage,
  formatAgentChatContextItemsForPrompt,
  getAgentChatContextState,
  normalizeAgentChatContextItem,
  publishAgentChatContextItems,
  refreshAgentChatContext,
  subscribeAgentChatContext,
  type AgentChatContextItem,
} from "./agent-chat.js";
import { captureError } from "./analytics.js";
import { agentNativePath } from "./api-path.js";
import {
  AssistantMessageListErrorBoundary,
  AssistantUiStaleIndexErrorBoundary,
} from "./assistant-ui-recovery.js";
import { AGENT_CHAT_VIEW_TRANSITION_PREPARE_EVENT } from "./chat-view-transition.js";
// ─── chat/ module imports ─────────────────────────────────────────────────────
import {
  DownscalingImageAttachmentAdapter,
  BinaryDocumentAttachmentAdapter,
  MAX_ESTIMATED_BODY_BYTES,
  AGGRESSIVE_MAX_IMAGE_DIMENSION,
  AGGRESSIVE_JPEG_QUALITY,
  transcodeImageToDataURL,
  createAgentImageAttachments,
  serializeQueuedAttachments,
  estimateAttachmentBodyBytes,
  type QueuedAttachment,
} from "./chat/attachment-adapters.js";
import { TextStreamingContext } from "./chat/markdown-renderer.js";
import {
  CheckpointContext,
  MessageActionsContext,
  UserMessage,
  AssistantMessage,
  SelectionAttachedPill,
  RunningActivityStatus,
} from "./chat/message-components.js";
import {
  repoHasAssistantMessage,
  getRepoMessages,
  getRepoMessage,
  shouldImportServerThreadData,
  dedupeRepoMessagesById,
  dropEmptyAssistantMessages,
} from "./chat/repo-helpers.js";
import {
  BuilderSetupCard,
  LoopLimitContinueCard,
  RunErrorRecoveryCard,
  PlanModeCallout,
  getLoopLimitMetadata,
  getRunErrorMetadata,
  getRequestModeMetadata,
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
  ApprovalContext,
  type ApprovalContextValue,
  ReconnectStreamMessage,
} from "./chat/tool-call-display.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip.js";
import { AgentComposerFrame } from "./composer/AgentComposerFrame.js";
import { TextAttachmentAdapter } from "./composer/attachment-accept.js";
import { isPastedTextAttachmentName } from "./composer/pasted-text.js";
import { PastedTextChip } from "./composer/PastedTextChip.js";
import {
  TiptapComposer,
  type ComposerSubmitIntent,
  type ComposerImageModelMenu,
  type TiptapComposerHandle,
} from "./composer/TiptapComposer.js";
import type {
  AgentComposerLayoutVariant,
  Reference,
} from "./composer/types.js";
import { ContextMeter } from "./context-xray/ContextMeter.js";
import { useNearBottomAutoscroll } from "./conversation/index.js";
import {
  useAgentDynamicSuggestionsResult,
  type AgentDynamicSuggestionsOption,
} from "./dynamic-suggestions.js";
import {
  GuidedQuestionFlow,
  useGuidedQuestionFlow,
} from "./guided-questions.js";
import {
  AgentAutoContinueSignal,
  type ContentPart,
  type PreparingActionState,
  readSSEStreamRaw,
  settleInterruptedToolCalls,
} from "./sse-event-processor.js";
import {
  fetchAgentEngineConfiguredState,
  useAgentEngineConfigured,
} from "./use-agent-engine-configured.js";
import type {
  ChatThreadScope,
  ChatThreadSnapshot,
} from "./use-chat-threads.js";
import { useDevMode } from "./use-dev-mode.js";
import { cn } from "./utils.js";

export {
  AssistantMessageListErrorBoundary,
  AssistantUiStaleIndexErrorBoundary,
  assistantUiRecoverableRenderErrorKind,
  isAssistantUiRecoverableRenderError,
  isAssistantUiStaleIndexError,
} from "./assistant-ui-recovery.js";

export { displayableUserMessageText } from "./chat/message-components.js";

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export type AgentRequestMode = "act" | "plan";
export type AgentRecoveryAction = "continue" | "retry";
export interface AssistantChatSendOptions {
  trackInRunsTray?: boolean;
  requestMode?: AgentRequestMode;
}

function createUserMessageRunConfig(
  references?: Reference[],
  requestMode?: AgentRequestMode,
  recoveryAction?: AgentRecoveryAction,
  trackInRunsTray?: boolean,
  approvedToolCalls?: string[],
  queuedMessageId?: string,
) {
  const custom: {
    references?: Reference[];
    requestMode?: AgentRequestMode;
    trackInRunsTray?: boolean;
    agentNativeQueuedMessageId?: string;
    approvedToolCalls?: string[];
  } = {};
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
  const options: {
    runConfig?: { custom: typeof custom };
    metadata?: { custom: { agentNativeRecoveryAction: AgentRecoveryAction } };
  } = {};
  if (Object.keys(custom).length > 0) {
    options.runConfig = { custom };
  }
  if (recoveryAction) {
    options.metadata = {
      custom: { agentNativeRecoveryAction: recoveryAction },
    };
  }
  return options;
}

const PENDING_SELECTION_KEY = "pending-selection-context";
const ACTIVE_RUN_CLEAR_TIMEOUT_MS = 5_000;
const ACTIVE_RUN_STUCK_THRESHOLD_MS = 90_000;
const ACTIVE_RUN_POLL_INTERVAL_MS = 150;
const AUTO_RESUME_STATUS_TIMEOUT_MS = 30_000;
// How long a single activity (model call, tool prep, long tool) must stay
// in-flight before its label is surfaced in the running indicator. Below this
// the indicator stays a steady "Thinking" so normal fast turns don't flicker
// through transient labels ("Contacting model", "Preparing X action"); past it
// the live label appears so a genuinely slow step reads as working, not hung.
const ACTIVITY_LABEL_REVEAL_DELAY_MS = 6_000;
const SUBMIT_ENGINE_STATUS_TIMEOUT_MS = 1000;

type ActiveRunLookup = {
  active?: boolean;
  runId?: string;
  threadId?: string;
  status?: string;
  heartbeatAt?: number | null;
  lastProgressAt?: number | null;
  serverNow?: number;
};

function activeRunLooksStale(runInfo: ActiveRunLookup): boolean {
  const lastProgressAt =
    typeof runInfo.lastProgressAt === "number" ? runInfo.lastProgressAt : null;
  const nowMs =
    typeof runInfo.serverNow === "number" ? runInfo.serverNow : Date.now();
  return (
    runInfo.status === "running" &&
    lastProgressAt != null &&
    nowMs - lastProgressAt > ACTIVE_RUN_STUCK_THRESHOLD_MS
  );
}

/**
 * Decide whether a reconnect should give up with "no progress". The signal is
 * *time since the last streamed event*, NOT total reconnect duration: a healthy
 * long-running tool (e.g. image generation, which emits `activity` heartbeats
 * every few seconds) makes continuous progress and must never be aborted just
 * for running longer than the threshold. Only genuine silence for the full
 * stuck threshold counts as stuck. Pure + exported so the decision is unit
 * testable without driving the whole reconnect lifecycle.
 */
export function reconnectProgressTimedOut(args: {
  lastProgressAt: number;
  now: number;
  thresholdMs?: number;
}): boolean {
  const threshold = args.thresholdMs ?? ACTIVE_RUN_STUCK_THRESHOLD_MS;
  return args.now - args.lastProgressAt >= threshold;
}

function activeRunMatchesThread(
  state: ActiveRunState | null,
  threadId: string | undefined,
): boolean {
  return Boolean(threadId && state?.threadId === threadId && state.runId);
}

function isAssistantUiDuplicateMessageIdError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("MessageRepository") &&
    message.includes("same id already exists")
  );
}

function cloneContentParts(content: ContentPart[]): ContentPart[] {
  return content.map((part) =>
    part.type === "text"
      ? { ...part }
      : {
          ...part,
          args: { ...part.args },
          ...(part.mcpApp ? { mcpApp: { ...part.mcpApp } } : {}),
          ...(part.chatUI ? { chatUI: { ...part.chatUI } } : {}),
        },
  );
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

// Thread ids the server has already told us don't exist (a prior mount's
// /threads/:id probe returned 404). Module-scoped so it survives remounts:
// re-probing a known-absent thread on every navigation just re-spams DevTools
// with 404s for a thread that has no server row yet (e.g. a freshly created,
// not-yet-sent chat). Reset on a full page reload.
const knownAbsentThreadIds = new Set<string>();

async function waitForThreadRunToClear(apiUrl: string, threadId?: string) {
  if (!threadId) return;
  const deadline = Date.now() + ACTIVE_RUN_CLEAR_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
      );
      if (res.ok) {
        const info = (await res.json()) as ActiveRunLookup;
        if (
          !info?.active ||
          info?.status !== "running" ||
          activeRunLooksStale(info)
        )
          return;
      }
    } catch {
      // Transient poll failure — try again until the short grace period ends.
    }

    await new Promise((resolve) =>
      window.setTimeout(resolve, ACTIVE_RUN_POLL_INTERVAL_MS),
    );
  }
}

// ─── Composer Attachment Preview ─────────────────────────────────────────────

function getImageAttachmentSrc(attachment: Attachment): string | null {
  if (attachment.type !== "image") return null;

  // Prefer the hosted URL when the server already uploaded this attachment.
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
          : "inline-flex max-w-[220px] items-center gap-2 rounded-lg px-2.5 py-2 text-xs",
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
          <div className="min-w-0">
            <div className="truncate font-medium">{attachment.name}</div>
            <div className="text-[11px] text-muted-foreground">
              {attachment.contentType || attachment.type}
            </div>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        className={cn(
          "absolute flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-background/95 text-muted-foreground shadow-sm transition hover:text-foreground",
          isImage
            ? "end-1.5 top-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100"
            : "end-1.5 top-1.5",
        )}
        aria-label={`Remove ${attachment.name}`}
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
    return content
      .filter((p: any) => p?.type === "text" && typeof p.text === "string")
      .map((p: any) => p.text)
      .join("\n")
      .trim();
  }
  return typeof content === "string" ? content.trim() : "";
}

function contentPartFollowKey(part: any): string {
  const type = typeof part?.type === "string" ? part.type : "unknown";
  if (type === "text") return `t:${String(part.text ?? "").length}`;
  if (type === "tool-call") {
    return [
      "tool",
      part.toolCallId ?? "",
      part.toolName ?? "",
      part.status?.type ?? "",
      String(part.argsText ?? "").length,
      String(part.result ?? "").length,
      part.mcpApp ? 1 : 0,
      part.chatUI?.renderer ?? "",
    ].join(":");
  }
  if (type === "image") return `image:${String(part.image ?? "").length}`;
  return `${type}:${String(part.text ?? part.result ?? "").length}`;
}

function contentFollowKey(content: unknown): string {
  if (typeof content === "string") return `t:${content.length}`;
  if (Array.isArray(content))
    return content.map(contentPartFollowKey).join("|");
  return "";
}

function messageFollowKey(message: unknown): string {
  const msg = ((message as { message?: unknown })?.message ?? message) as {
    id?: unknown;
    role?: unknown;
    status?: { type?: unknown; reason?: unknown };
    content?: unknown;
  };
  return [
    String(msg?.id ?? ""),
    String(msg?.role ?? ""),
    String(msg?.status?.type ?? ""),
    String(msg?.status?.reason ?? ""),
    contentFollowKey(msg?.content),
  ].join(",");
}

function queuedMessageFollowKey(message: {
  id: string;
  text: string;
  images?: string[];
  attachments?: QueuedAttachment[];
  references?: Reference[];
  requestMode?: AgentRequestMode;
  recoveryAction?: AgentRecoveryAction;
}): string {
  return [
    message.id,
    message.text.length,
    message.images?.length ?? 0,
    message.attachments?.length ?? 0,
    message.references?.length ?? 0,
    message.requestMode ?? "",
    message.recoveryAction ?? "",
  ].join(":");
}

function reconnectContentFollowKey(content: ContentPart[]): string {
  return content.map(contentPartFollowKey).join("|");
}

export function reconnectActivityFallbackContent(
  toolName: string | null | undefined,
): ContentPart[] {
  const tool = toolName?.trim();
  if (!tool) return [];
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

const RECOVERY_USER_MESSAGE_PREFIXES = [
  "Continue from where you left off",
  "Continue from where you stopped",
  "Retry the previous request from a clean approach",
];

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

export function resolveAssistantChatSubmitIntent({
  isRunning,
  requestedIntent,
}: {
  isRunning: boolean;
  requestedIntent?: ComposerSubmitIntent;
}): ComposerSubmitIntent {
  if (isRunning) return "queued";
  return requestedIntent ?? "immediate";
}

export function resolveAssistantChatRunningState({
  forceStopped,
  isRuntimeRunning,
  isReconnecting,
  optimisticRunning,
  isAutoResuming,
  hasActiveServerRun,
}: {
  forceStopped: boolean;
  isRuntimeRunning: boolean;
  isReconnecting: boolean;
  optimisticRunning: boolean;
  isAutoResuming: boolean;
  hasActiveServerRun?: boolean;
}): { isRunning: boolean; showRunningInUI: boolean } {
  const isRunning =
    !forceStopped &&
    (isRuntimeRunning ||
      isReconnecting ||
      optimisticRunning ||
      Boolean(hasActiveServerRun));
  return {
    isRunning,
    // During auto-continuation, assistant-ui can briefly mark the message done
    // between chunks even though the adapter is about to POST the next run.
    // Keep the visible chat state running so the latest assistant message shows
    // Thinking/Resuming and does not expose footer actions prematurely.
    showRunningInUI: !forceStopped && (isRunning || isAutoResuming),
  };
}

export function resolveAssistantChatRunningStatusLabel({
  runningActivityLabel,
  isAutoResuming,
  isReconnecting,
  hasReconnectContent,
}: {
  runningActivityLabel: string | null | undefined;
  isAutoResuming: boolean;
  isReconnecting: boolean;
  hasReconnectContent: boolean;
}): string {
  if (runningActivityLabel) return runningActivityLabel;
  if (isAutoResuming) return "Resuming";
  if (isReconnecting && hasReconnectContent) return "Still working";
  return "Thinking";
}

type QueuedMessage = {
  id: string;
  text: string;
  images?: string[];
  attachments?: QueuedAttachment[];
  references?: Reference[];
  requestMode?: AgentRequestMode;
  recoveryAction?: AgentRecoveryAction;
  trackInRunsTray?: boolean;
};

// ─── Main Component ─────────────────────────────────────────────────────────

export interface AssistantChatHandle {
  /** Programmatically send a message into this chat */
  sendMessage(
    text: string,
    images?: string[],
    options?: AssistantChatSendOptions,
  ): void;
  /** Programmatically prefill the composer without submitting. */
  prefillMessage(text: string): void;
  /**
   * Add or replace keyed context for the next composer submission.
   * Focuses the composer by default; pass `{ focus: false }` for passive
   * context mirroring (e.g. canvas selection) that must not steal focus.
   */
  setComposerContextItem(
    item: AgentChatContextItem,
    options?: { focus?: boolean },
  ): void;
  /** Remove a keyed context item from the composer. */
  removeComposerContextItem(key: string): void;
  /** Clear all staged context items from the composer. */
  clearComposerContextItems(): void;
  /** Programmatically send a recovery prompt without replacing the original request. */
  sendRecoveryMessage(
    text: string,
    recoveryAction: AgentRecoveryAction,
    images?: string[],
  ): void;
  /** Queue a message to send after the current run finishes */
  queueMessage(text: string, images?: string[]): void;
  /** Whether the chat is currently running */
  isRunning(): boolean;
  /** Focus the composer input */
  focusComposer(): void;
  /** Export the currently visible client-side thread for operations like fork. */
  exportThreadSnapshot(): ChatThreadSnapshot | null;
}

export type AssistantChatThreadFooterSlot =
  | React.ReactNode
  | ((context: {
      threadId: string | null;
      tabId: string | null;
    }) => React.ReactNode);

export interface AssistantChatAdapterContext {
  apiUrl: string;
  tabId?: string;
  threadId?: string;
  modelRef: { current: string | undefined };
  engineRef: { current: string | undefined };
  effortRef: { current: ReasoningEffort | undefined };
  execModeRef: { current: "build" | "plan" | undefined };
  browserTabId?: string;
  scopeRef: { current: ChatThreadScope | null | undefined };
  surface: AgentChatSurfaceKind;
}

export interface AssistantChatProps {
  /** API endpoint URL. Default: "/_agent-native/agent-chat" */
  apiUrl?: string;
  /** Stable tab identifier passed to the adapter for event correlation */
  tabId?: string;
  /** Stable browser tab id used for tab-scoped app-state context. */
  browserTabId?: string;
  /** Thread ID for SQL-backed persistence. When set, messages are loaded from and saved to the server. */
  threadId?: string;
  /** Resource scope to include with chat requests for server-side context. */
  contextScope?: ChatThreadScope | null;
  /** Whether this chat owns the active visible composer context snapshot. */
  isActiveComposer?: boolean;
  /**
   * Identifies which surface hosts this chat. Defaults to "app", which keeps
   * dev filesystem/bash code-editing tools out of in-product sidebars.
   */
  agentChatSurface?: AgentChatSurfaceKind;
  /** Placeholder text for empty state */
  emptyStateText?: string;
  /** Suggestion prompts shown when no messages */
  suggestions?: string[];
  /** Context-aware suggestions merged with `suggestions`. Enabled by default. */
  dynamicSuggestions?: AgentDynamicSuggestionsOption;
  /** Optional content rendered at the bottom of the scrollable thread, after messages. */
  threadFooterSlot?: AssistantChatThreadFooterSlot;
  /** Optional content rendered in the empty state, above the suggestion buttons. */
  emptyStateAddon?: React.ReactNode;
  /** Whether to show the header bar. Default: true */
  showHeader?: boolean;
  /** CSS class for the outer container */
  className?: string;
  /** Callback when user clicks "Use CLI" button */
  onSwitchToCli?: () => void;
  /** Callback when message count changes */
  onMessageCountChange?: (count: number) => void;
  /** Callback to save thread data to the server (provided by useChatThreads) */
  onSaveThread?: (
    threadId: string,
    data: {
      threadData: string;
      title: string;
      preview: string;
      messageCount: number;
    },
  ) => void;
  /** Callback to generate a title from the first user message */
  onGenerateTitle?: (threadId: string, message: string) => void;
  /** Optional content rendered just above the composer input */
  composerSlot?: React.ReactNode;
  /** Class applied to the shared composer area for host-specific sizing/skin. */
  composerAreaClassName?: string;
  /** Placeholder for the shared composer in its normal idle state. */
  composerPlaceholder?: string;
  /** Sidebar uses a compact setup CTA above the composer; page chat keeps the default below-composer CTA. */
  missingApiKeySetupLayout?: BuilderSetupCardLayout;
  /** Visual density for the shared composer shell. */
  composerLayoutVariant?: AgentComposerLayoutVariant;
  /** Center the composer on a fresh empty chat instead of pinning it low. */
  centerComposerWhenEmpty?: boolean;
  /** Hide the default empty-state icon/text/suggestions for custom start screens. */
  emptyStateDisplay?: "default" | "hidden";
  /** Optional content rendered inside the composer toolbar after the attach button. */
  composerToolbarSlot?: React.ReactNode;
  /** Optional action rendered beside the voice/send controls. */
  composerExtraActionButton?: React.ReactNode;
  /** Disable the composer for capability-gated surfaces while still showing history. */
  composerDisabled?: boolean;
  /** Placeholder to show while the composer is disabled by the host surface. */
  composerDisabledPlaceholder?: string;
  /** When true, skip the restore skeleton (used for freshly created threads with no messages) */
  isNewThread?: boolean;
  /** Called when a slash command (e.g. /clear, /help) is executed */
  onSlashCommand?: (command: string) => void;
  /** Current execution mode (build/plan) */
  execMode?: "build" | "plan";
  /** Callback to change execution mode */
  onExecModeChange?: (mode: "build" | "plan") => void;
  /** Disable Plan mode while leaving Act mode available. */
  planModeDisabled?: boolean;
  /** Explanation shown next to the disabled Plan option. */
  planModeDisabledReason?: string;
  /** Selected model override for this conversation (undefined = use server default) */
  selectedModel?: string;
  /** Default model from server config (shown in picker when no override is set) */
  defaultModel?: string;
  /** Selected engine override for this conversation */
  selectedEngine?: string;
  /** Selected reasoning effort override for this conversation */
  selectedEffort?: ReasoningEffort;
  /** Available engine/model list for the model picker */
  availableModels?: Array<{
    engine: string;
    label: string;
    models: string[];
    configured: boolean;
  }>;
  /** Callback when user picks a model from the picker */
  onModelChange?: (model: string, engine: string) => void;
  /** Callback when user picks a reasoning effort from the picker */
  onEffortChange?: (effort: ReasoningEffort) => void;
  /**
   * Optional secondary model menu (e.g. an image-generation model) shown inside
   * the composer's model picker. Opt-in; chat-only apps omit it.
   */
  imageModelMenu?: ComposerImageModelMenu;
  /** Callback when user clicks "Fork Chat" in the message actions menu */
  onForkChat?: () => void | boolean | Promise<void | boolean>;
  /** Override Builder/provider connect routing for embedded hosts. */
  onConnectProvider?: () => void;
  /**
   * Controls the shared composer + menu. Sidebar keeps the full menu by default;
   * hosts without the sidebar provider stack can use upload-only.
   */
  plusMenuMode?: "full" | "upload-only" | "hidden";
  /**
   * Enable framework provider/env status checks. Embedded hosts that provide
   * model/provider state through another transport can disable these probes.
   */
  providerStatusChecksEnabled?: boolean;
  /**
   * Advanced host override for non-HTTP transports. Defaults to the production
   * sidebar SSE adapter when omitted.
   */
  createAdapter?: (context: AssistantChatAdapterContext) => ChatModelAdapter;
  /**
   * Bring-your-own agent runtime. When supplied, AssistantChat keeps the
   * standard composer/transcript/tool rendering shell but sends turns through
   * this runtime instead of the built-in Agent-Native SSE endpoint. If
   * `createAdapter` is also supplied, the adapter override takes precedence.
   */
  runtime?: AgentChatRuntime;
  /**
   * Explicitly recreate an injected adapter when the host transport identity
   * changes. Omit for the production sidebar so parent rerenders do not reset
   * active chats.
   */
  adapterReloadKey?: unknown;
  /**
   * Advanced host override for thread replay. Defaults to SQL thread fetch when
   * `threadId` is set, or sessionStorage for legacy tab chats.
   */
  loadHistoryRepository?: () => Promise<ExportedMessageRepository | null>;
  /** Re-run `loadHistoryRepository` when the host's external transcript changes. */
  historyReloadKey?: string | number | null;
  /** Smooth the last assistant message while an external transcript is updating. */
  externalStreaming?: boolean;
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

/** Remove persisted chat for a given tabId (or "default"). */
export function clearChatStorage(tabId?: string) {
  try {
    sessionStorage.removeItem(`${CHAT_STORAGE_PREFIX}${tabId || "default"}`);
  } catch {}
}

/**
 * Ensure all messages in a thread repository have required fields.
 * assistant-ui accesses `message.metadata.submittedFeedback` and
 * `lastMessage.status.type` without null-checking, so server-constructed
 * messages missing these fields crash.
 */
function ensureMessageMetadata(repo: any): any {
  // Drop duplicate message ids before import — assistant-ui's MessageRepository
  // throws "performOp/link: A message with the same id already exists in the
  // parent tree" (Sentry AGENT-NATIVE-BROWSER-2Q) when fed repeated ids. No-op
  // for the normal no-duplicate case. See dedupeRepoMessagesById.
  repo = dropEmptyAssistantMessages(dedupeRepoMessagesById(repo));
  if (!repo?.messages || !Array.isArray(repo.messages)) return repo;
  for (const entry of repo.messages) {
    // Handle both wrapped ({ message: { ... } }) and flat ({ role, ... }) formats
    const msg = entry?.message ?? entry;
    if (!msg) continue;
    if (!msg.metadata) {
      msg.metadata = {};
    }
    if (msg.role === "assistant") {
      const statusType =
        msg.status && typeof msg.status === "object"
          ? (msg.status as { type?: unknown }).type
          : undefined;
      const isTerminal =
        statusType === "complete" || statusType === "incomplete";
      if (!isTerminal) {
        const runError =
          msg.metadata?.custom?.runError ?? msg.metadata?.runError;
        msg.status = runError
          ? { type: "incomplete", reason: "error" }
          : { type: "complete", reason: "stop" };
      }
      if (
        Array.isArray(msg.content) &&
        (isTerminal ||
          msg.status?.type === "complete" ||
          msg.status?.type === "incomplete")
      ) {
        settleInterruptedToolCalls(msg.content);
      }
    }
  }
  return repo;
}

// Re-export for backwards compatibility
import {
  extractThreadMeta,
  normalizeThreadRepository,
} from "../agent/thread-data-builder.js";
export { extractThreadMeta };

/**
 * Strip raw base64 payload from attachment content parts when a hosted URL
 * already exists in the same content entry. This keeps the periodic thread
 * save payload compact — the server already stored the URL reference when it
 * processed the POST, and re-shipping multi-megabyte base64 strings on every
 * 5-second poll save balloons the SQL thread_data column unnecessarily.
 *
 * Only strips the raw base64 data-URL string from `content[].image` / `content[].data`
 * when a `metadata.uploadUrl` reference is present on the same attachment object,
 * so the transcript can still render from the hosted URL after hydration.
 */
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
      // Only strip when we have a hosted upload URL confirmed by the server.
      if (!meta?.uploadUrl) return att;

      if (!Array.isArray(a.content)) return att;
      const strippedContent = a.content.map((part: unknown) => {
        if (!part || typeof part !== "object") return part;
        const p = part as Record<string, unknown>;
        // Replace the raw base64 image data-URL with the hosted URL.
        if (
          p.type === "image" &&
          typeof p.image === "string" &&
          p.image.startsWith("data:")
        ) {
          return { ...p, image: meta.uploadUrl };
        }
        // Replace the raw base64 file data with a stripped marker.
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

const AssistantChatInner = forwardRef<
  AssistantChatHandle,
  AssistantChatProps & { apiUrl: string }
>(function AssistantChatInner(
  {
    emptyStateText,
    suggestions,
    dynamicSuggestions,
    threadFooterSlot,
    emptyStateAddon,
    showHeader = true,
    onSwitchToCli,
    className,
    apiUrl,
    tabId,
    browserTabId,
    threadId,
    contextScope,
    isActiveComposer = true,
    onMessageCountChange,
    onSaveThread,
    onGenerateTitle,
    composerSlot,
    composerAreaClassName,
    composerPlaceholder,
    missingApiKeySetupLayout = "default",
    composerLayoutVariant = "default",
    centerComposerWhenEmpty = false,
    emptyStateDisplay = "default",
    composerToolbarSlot,
    composerExtraActionButton,
    composerDisabled = false,
    composerDisabledPlaceholder,
    isNewThread,
    onSlashCommand,
    execMode,
    onExecModeChange,
    planModeDisabled,
    planModeDisabledReason,
    selectedModel,
    defaultModel,
    selectedEffort,
    availableModels,
    onModelChange,
    onEffortChange,
    imageModelMenu,
    onForkChat,
    onConnectProvider,
    plusMenuMode = "full",
    providerStatusChecksEnabled = true,
    loadHistoryRepository,
    historyReloadKey,
    externalStreaming = false,
  },
  ref,
) {
  const thread = useThread();
  const threadRuntime = useThreadRuntime();
  const composerRuntime = useComposerRuntime();
  const isRuntimeRunning = thread.isRunning;
  const messages = thread.messages;
  const { suggestions: resolvedSuggestions } = useAgentDynamicSuggestionsResult(
    {
      staticSuggestions: suggestions,
      dynamicSuggestions,
      browserTabId,
      scope: contextScope,
      enabled: messages.length === 0,
    },
  );
  const messageListResetKey = useMemo(
    () => messages.map((message) => message.id).join("|"),
    [messages],
  );

  // Chat-wide drag-and-drop: users expect to drop a file anywhere on the agent
  // sidebar (thread, header, composer) and have it attach — same as ChatGPT,
  // Claude.ai, Linear, Slack, etc. Tiptap's own `handleDrop` only fires inside
  // the contenteditable; drops on the message thread or the composer
  // attachment strip otherwise navigate to the file (browser default), which
  // is why "upload does nothing" — the chat refreshes to the dropped image.
  const [dropActive, setDropActive] = useState(false);
  // Inline error shown just above the composer for attachment failures
  // (unsupported format, size cap, body-size rejection, drop errors).
  // Cleared on the next message send.
  const [composerError, setComposerError] = useState<string | null>(null);
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
      // Mirror TiptapComposer's paste/drop name-uniqueness so consecutive
      // screenshots (all named `image.png`) don't collide on the
      // SimpleImageAttachmentAdapter id.
      const attachments = files.map((file) => {
        if (!file.type.startsWith("image/")) return file;
        const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;
        return new File([file], uniqueName, { type: file.type });
      });
      void Promise.all(
        attachments.map((file) => composerRuntime.addAttachment(file)),
      ).catch((error) => {
        const msg =
          error instanceof Error
            ? error.message
            : "Could not add the dropped file. Try a different format.";
        setComposerError(msg);
      });
    },
    [composerRuntime, setComposerError],
  );

  // Patch the underlying assistant-ui MessageRepository so addOrUpdateMessage
  // can't throw "Parent message not found" mid-run. assistant-ui calls
  // `repository.clear()` from `runtime.import()` and from `resetHead(null)`,
  // and on a few async paths (history-adapter load, branch reset, repeat
  // imports) the repo can be cleared between the `append` that added the
  // user message and the `performRoundtrip` call that tries to record the
  // assistant placeholder against that user message's id. The internal-bug
  // throw turns into an unhandled rejection that Sentry captures from the
  // assets.agent-native.com prompt composer (AGENT-NATIVE-BROWSER-18). Fix
  // it by relinking to the current head whenever the requested parent has
  // gone missing instead of throwing.
  useEffect(() => {
    const repo = (threadRuntime as any)?.__internal_threadBinding?.getState?.()
      ?.repository as
      | { addOrUpdateMessage?: (parentId: any, message: any) => void }
      | undefined;
    if (!repo || typeof repo.addOrUpdateMessage !== "function") return;
    const patched = repo as any;
    if (patched.__agentNativePatched) return;
    patched.__agentNativePatched = true;
    const original = repo.addOrUpdateMessage.bind(repo);
    repo.addOrUpdateMessage = function (parentId: any, message: any) {
      try {
        return original(parentId, message);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (parentId && msg.includes("Parent message not found")) {
          const fallbackParent = (this as any).head?.current?.id ?? null;
          if (fallbackParent && fallbackParent !== parentId) {
            return original(fallbackParent, message);
          }
          return original(null, message);
        }
        if (msg.includes("same id already exists")) {
          return;
        }
        throw err;
      }
    };
  }, [threadRuntime]);
  const agentEngineConfigured = useAgentEngineConfigured(
    providerStatusChecksEnabled,
  );
  const missingApiKey = agentEngineConfigured.missing;
  const isComposerDisabled = missingApiKey || composerDisabled;
  // Once a provider connects, `useAgentEngineConfigured` flips to "configured"
  // off the `agent-engine:configured-changed` event. The composer banner is a
  // separate piece of state that would otherwise only clear on manual dismiss
  // or the next successful send, so drop the stale "no LLM provider" message
  // here to match the resolved connection.
  useEffect(() => {
    if (agentEngineConfigured.state !== "configured") return;
    setComposerError((current) =>
      current === LLM_MISSING_CREDENTIALS_MESSAGE ? null : current,
    );
  }, [agentEngineConfigured.state]);
  const missingApiKeySetupAboveComposer =
    missingApiKeySetupLayout === "sidebar";
  // Increments each time the user tries to chat while no LLM is connected.
  // `BuilderSetupCard` watches this to replay a one-shot bounce.
  const [missingKeyBouncePulse, setMissingKeyBouncePulse] = useState(0);
  const ensureAgentEngineReadyForSubmit = useCallback(async () => {
    const state =
      agentEngineConfigured.state === "missing"
        ? "missing"
        : await fetchAgentEngineConfiguredState(providerStatusChecksEnabled, {
            timeoutMs: SUBMIT_ENGINE_STATUS_TIMEOUT_MS,
          });
    if (state !== "missing") return true;

    setComposerError(LLM_MISSING_CREDENTIALS_MESSAGE);
    setMissingKeyBouncePulse((p) => p + 1);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("agent-chat:missing-api-key"));
    }
    return false;
  }, [agentEngineConfigured.state, providerStatusChecksEnabled]);
  const [authError, setAuthError] = useState<{
    sessionExpired?: boolean;
  } | null>(null);
  const [authSessionAvailable, setAuthSessionAvailable] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const queuedMessagesRef = useRef<QueuedMessage[]>([]);
  const queueDirtyRef = useRef(false);
  const queueMutationVersionRef = useRef(0);
  const dequeueInFlightRef = useRef(false);
  const [composerContextItems, setComposerContextItems] = useState<
    AgentChatContextItem[]
  >([]);
  const composerContextItemsRef = useRef<AgentChatContextItem[]>([]);
  const isActiveComposerRef = useRef(isActiveComposer);
  isActiveComposerRef.current = isActiveComposer;
  const publishComposerContextItems = useCallback(
    (items: AgentChatContextItem[]) => {
      if (!isActiveComposerRef.current) return;
      publishAgentChatContextItems(items);
    },
    [],
  );
  const updateComposerContextItems = useCallback(
    (updater: (previous: AgentChatContextItem[]) => AgentChatContextItem[]) => {
      setComposerContextItems((previous) => {
        const next = updater(previous);
        composerContextItemsRef.current = next;
        return next;
      });
      // Publish outside the setState updater. `publishComposerContextItems`
      // mutates the module-level context store and synchronously dispatches a
      // window event, which would re-enter React (notifying
      // `useSyncExternalStore` subscribers like `useAgentChatContext`) while the
      // updater runs during the render phase. React 19 then throws "Cannot
      // update a component while rendering a different component". Queueing a
      // microtask runs the publish after the commit; it reads the freshly
      // updated `composerContextItemsRef`, not React state.
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

  useEffect(() => {
    if (!isActiveComposer) return;
    let cancelled = false;
    void refreshAgentChatContext().then((state) => {
      if (cancelled || !isActiveComposerRef.current) return;
      composerContextItemsRef.current = state.items;
      setComposerContextItems(state.items);
    });
    const unsubscribe = subscribeAgentChatContext(() => {
      if (cancelled || !isActiveComposerRef.current) return;
      const state = getAgentChatContextState();
      composerContextItemsRef.current = state.items;
      setComposerContextItems(state.items);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isActiveComposer]);
  // Tracks the JSON of the last queue we successfully persisted so the
  // debounced save effect can skip no-op writes (e.g. restore-from-server
  // on mount, or queue state that hasn't actually changed).
  const lastPersistedQueueRef = useRef<string>("[]");
  // Cheap change-guard for `importThreadData`. The real-time sync layer
  // refetches `/threads/:id` (or re-runs `loadHistoryRepository`) on poll /
  // change ticks, on reconnect, and whenever the host's transcript bumps
  // `historyReloadKey`. On a long thread the JSON.parse +
  // normalizeThreadRepository + threadRuntime.export()/import round-trip is
  // CPU-bound and triggers re-render churn even when the content is byte-for-
  // byte identical to what we last imported. We hash the raw incoming payload
  // and skip the whole pipeline when it hasn't advanced, returning the
  // already-imported repo so callers (e.g. the reconnect loop's
  // repoHasAssistantMessage check) see consistent data. Any real change — a
  // new message, an arriving tool result, the server replacing an optimistic
  // copy, or switching threads — produces a different signal and falls
  // through to a full import.
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
  const userStoppedRunRef = useRef<{
    at: number;
    runId?: string;
  } | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  // True during the 250ms continuation window and startup of the next chunk
  // (adapter's auto-continue delay before POSTing the next chunk).
  const [isAutoResuming, setIsAutoResuming] = useState(false);
  const autoResumeTimerRef = useRef<number | null>(null);
  const [optimisticRunning, setOptimisticRunning] = useState(false);
  const [runningActivityLabel, setRunningActivityLabel] = useState<
    string | null
  >(null);
  const [runningActivityTool, setRunningActivityTool] = useState<string | null>(
    null,
  );
  // Delayed-reveal state for the activity label (see ACTIVITY_LABEL_REVEAL_DELAY_MS).
  // `latest` holds the most recent activity label; `surfaced` flips true once the
  // reveal timer fires; `timer` is the pending one-shot reveal.
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
  // When stop is clicked during reconnect, keep content visible (don't wipe it)
  const [reconnectFrozen, setReconnectFrozen] = useState(false);
  const reconnectRunIdRef = useRef<string | null>(null);
  const reconnectTailOnlyRef = useRef(false);
  const reconnectCanMaterializeRef = useRef(false);
  const reconnectAbortRef = useRef<AbortController | null>(null);
  // Nuclear stop: user clicked stop. Clears the stop button/indicator AND
  // lets new submissions go through immediately — prevents the "stuck
  // queueing forever" state where isReconnecting or isRuntimeRunning gets
  // wedged (e.g. after a tab refresh + stop during reconnect).
  const [forceStopped, setForceStopped] = useState(false);
  const [hasActiveServerRun, setHasActiveServerRun] = useState(() =>
    activeRunMatchesThread(getActiveRun(), threadId),
  );
  useEffect(() => {
    const syncActiveRun = (state = getActiveRun()) => {
      setHasActiveServerRun(activeRunMatchesThread(state, threadId));
    };
    syncActiveRun();
    const handler = (event: Event) => {
      const state = (event as CustomEvent<{ state?: ActiveRunState | null }>)
        .detail?.state;
      syncActiveRun(state ?? null);
    };
    const storageHandler = () => syncActiveRun();
    window.addEventListener(ACTIVE_RUN_STATE_EVENT, handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(ACTIVE_RUN_STATE_EVENT, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, [threadId]);
  // Real running state drives submission/queue gating; UI running also covers
  // short auto-continuation gaps so the latest assistant message does not flash
  // into a done state while the agent is still working.
  const { isRunning, showRunningInUI } = resolveAssistantChatRunningState({
    forceStopped,
    isRuntimeRunning,
    isReconnecting,
    optimisticRunning,
    isAutoResuming,
    hasActiveServerRun,
  });
  const textStreaming = showRunningInUI || externalStreaming;
  // A revealed activity label wins; otherwise keep recovery states calm and
  // product-facing. Reconnect is transport machinery, so normal replay reads as
  // ongoing work instead of exposing "Reconnecting" mid-chat.
  const runningStatusLabel = resolveAssistantChatRunningStatusLabel({
    runningActivityLabel,
    isAutoResuming,
    isReconnecting,
    hasReconnectContent: reconnectContent.length > 0,
  });
  const reconnectActivityContent = useMemo(
    () =>
      (isReconnecting || reconnectFrozen) && reconnectContent.length === 0
        ? reconnectActivityFallbackContent(runningActivityTool)
        : [],
    [
      isReconnecting,
      reconnectFrozen,
      reconnectContent.length,
      runningActivityTool,
    ],
  );
  const lastBroadcastRunningRef = useRef(isRunning);
  const tiptapRef = useRef<TiptapComposerHandle>(null);
  // Stable ref to the "stop active run" action so addToQueue can abort
  // a running turn without adding many unstable closure deps to its dep list.
  const stopActiveRunRef = useRef<() => void>(() => {});

  const markOptimisticRunning = useCallback(() => {
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

  // ─── Chat persistence ──────────────────────────────────────────────
  const hasRestoredRef = useRef(false);
  const [initialCachedThreadSnapshot] = useState(() =>
    readCachedThreadSnapshot(apiUrl, threadId),
  );
  const hasImportedInitialCachedSnapshotRef = useRef(false);
  const [isRestoring, setIsRestoring] = useState(
    !!(threadId || loadHistoryRepository) &&
      !isNewThread &&
      !initialCachedThreadSnapshot,
  );
  const onSaveThreadRef = useRef(onSaveThread);
  onSaveThreadRef.current = onSaveThread;
  const onGenerateTitleRef = useRef(onGenerateTitle);
  onGenerateTitleRef.current = onGenerateTitle;
  const titleGeneratedRef = useRef(false);

  const importThreadData = useCallback(
    (threadData: unknown, options?: { markTitleGenerated?: boolean }): any => {
      // Cheap-signal short-circuit: if the raw payload is identical to the
      // last one we imported, there is nothing new to parse, normalize, or
      // re-import into the runtime. Reuse the already-imported repo so callers
      // still get back a stable result without the CPU + re-render cost. We
      // still honor `markTitleGenerated` because a re-fetch carrying the same
      // content can legitimately confirm a title is settled.
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
      // Whether this payload settled into the runtime (either imported, or
      // had no messages to import). Only then is it safe to remember its
      // signature as the canonical "last imported" — a payload that
      // `shouldImportServerThreadData` deliberately rejected (e.g. it
      // regressed message count) must NOT be cached, so an identical re-fetch
      // re-evaluates against the runtime exactly as before instead of
      // short-circuiting to the rejected repo.
      let settled = true;
      let settledRepo = repo;
      if (repo?.messages?.length > 0) {
        let shouldImport = true;
        try {
          shouldImport = shouldImportServerThreadData(
            normalizeThreadRepository(threadRuntime.export()),
            repo,
          );
        } catch {
          shouldImport = true;
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
      if (Array.isArray(repo?.queuedMessages)) {
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

  const refreshThreadFromServer = useCallback(async (): Promise<any | null> => {
    if (loadHistoryRepository) {
      try {
        const repo = await loadHistoryRepository();
        if (!repo) return null;
        return importThreadData(repo);
      } catch {
        return null;
      }
    }
    if (!threadId) return null;
    try {
      const refreshRes = await fetch(
        `${apiUrl}/threads/${encodeURIComponent(threadId)}`,
      );
      if (!refreshRes.ok) return null;
      const refreshData = await refreshRes.json();
      if (!refreshData.threadData) return null;
      return importThreadData(refreshData.threadData);
    } catch {
      return null;
    }
  }, [apiUrl, importThreadData, loadHistoryRepository, threadId]);

  const exportCleanThreadRepo = useCallback(
    () =>
      ensureMessageMetadata(normalizeThreadRepository(threadRuntime.export())),
    [threadRuntime],
  );

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
    const repo = exportCleanThreadRepo();
    const threadData = JSON.stringify(stripBase64FromRepo(repo));
    const { title, preview } = extractThreadMeta(repo);
    writeCachedThreadSnapshot(apiUrl, threadId, {
      threadData,
      title,
      preview,
      messageCount: messages.length,
    });
  }, [apiUrl, exportCleanThreadRepo, messages.length, threadId]);

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

  const wasRecentlyStoppedRun = useCallback((runId?: string): boolean => {
    const stopped = userStoppedRunRef.current;
    return Boolean(
      stopped &&
      Date.now() - stopped.at < 10_000 &&
      (!stopped.runId || !runId || stopped.runId === runId),
    );
  }, []);

  const startReconnectToRun = useCallback(
    (runInfo: ActiveRunLookup): boolean => {
      if (!threadId || !runInfo.runId || runInfo.status !== "running") {
        return false;
      }
      const runId = String(runInfo.runId);
      if (wasRecentlyStoppedRun(runId)) return false;
      if (reconnectRunIdRef.current === runId) return true;

      reconnectRunIdRef.current = runId;
      const afterSeq = resolveReconnectAfterSeq(threadId, runId);
      reconnectTailOnlyRef.current = afterSeq > 0;
      reconnectCanMaterializeRef.current = afterSeq === 0;
      const storedActivityTool = getActiveRunActivityTool(threadId, runId);
      setRunningActivityTool(storedActivityTool);
      setActiveRun({
        threadId,
        runId,
        lastSeq: afterSeq > 0 ? afterSeq - 1 : -1,
        ...(storedActivityTool ? { activityTool: storedActivityTool } : {}),
      });
      setIsReconnecting(true);
      setReconnectFrozen(false);
      setReconnectContent([]);
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: tabId || threadId },
        }),
      );

      const abortCtrl = new AbortController();
      reconnectAbortRef.current = abortCtrl;

      const watchdog = setInterval(async () => {
        try {
          const res = await fetch(
            `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
          );
          if (!res.ok) {
            abortCtrl.abort();
            clearInterval(watchdog);
            return;
          }
          const info = (await res.json()) as ActiveRunLookup;
          if (info.status !== "running" || activeRunLooksStale(info)) {
            abortCtrl.abort();
            clearInterval(watchdog);
          }
        } catch {
          // Network blip — keep polling.
        }
      }, 1000);

      let reconnectTimedOut = false;
      // Idle deadline, NOT a total-duration cap. A long-but-healthy run (image
      // generation emits `activity` heartbeats every few seconds) keeps
      // advancing `lastReconnectProgressAt`, so it is never aborted for simply
      // taking longer than the threshold. Only true silence for the full stuck
      // threshold trips it — the same semantics as `activeRunLooksStale` and the
      // SSE-level no-progress timeout. `markReconnectProgress` resets it on every
      // streamed event (see the `onSeq` callback below, which fires for every
      // event including activity, for both fresh and tail-resume reconnects).
      let lastReconnectProgressAt = Date.now();
      const markReconnectProgress = () => {
        lastReconnectProgressAt = Date.now();
      };
      const idleCheck = setInterval(() => {
        if (
          !reconnectProgressTimedOut({
            lastProgressAt: lastReconnectProgressAt,
            now: Date.now(),
          })
        ) {
          return;
        }
        reconnectTimedOut = true;
        abortCtrl.abort();
        clearInterval(watchdog);
        clearInterval(idleCheck);
      }, 1000);

      const streamReconnect = async () => {
        let noProgressDuringReconnect = false;
        let latestContent: ContentPart[] = [];
        const preparingActionState: PreparingActionState = {};
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
        const threadPollInterval =
          afterSeq > 0
            ? window.setInterval(() => {
                if (reconnectRunIdRef.current !== runId) return;
                void refreshThreadFromServer();
              }, 2000)
            : undefined;
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
                await new Promise((resolve) => window.setTimeout(resolve, 250));
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
                (seq) => {
                  markReconnectProgress();
                  updateActiveRunSeq(seq);
                },
                { preparingActionState },
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
                  await new Promise((resolve) =>
                    window.setTimeout(resolve, 250),
                  );
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
          } else if (
            reconnectTimedOut &&
            err instanceof Error &&
            err.name === "AbortError"
          ) {
            noProgressDuringReconnect = true;
          }
        } finally {
          if (threadPollInterval !== undefined) {
            window.clearInterval(threadPollInterval);
          }
          clearInterval(watchdog);
          clearInterval(idleCheck);
        }

        if (noProgressDuringReconnect && reconnectRunIdRef.current === runId) {
          captureError(new Error("agent-chat:reconnect_no_progress"), {
            tags: {
              context: "agent-native-chat",
              errorCode: "reconnect_no_progress",
              reconnectTimedOut: String(reconnectTimedOut),
            },
            extra: {
              runId,
              threadId: threadId ?? null,
              tabId: tabId ?? null,
              contentLength: latestContent.length,
            },
          });
          try {
            await fetch(`${apiUrl}/runs/${encodeURIComponent(runId)}/abort`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason: "no_progress" }),
            });
          } catch {
            // Best effort — the important part is unwinding the UI.
          }
          if (afterSeq > 0) {
            // Tail-resume only replays new events; never freeze that slice as a
            // complete assistant turn — the server thread is authoritative.
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
          setRunErrorInfo({
            message:
              "The previous agent run stopped producing visible progress during recovery, so it was stopped before it could keep looping.",
            errorCode: "reconnect_no_progress",
            recoverable: true,
            runId,
          });
          setDismissedRunErrorKey(null);
          clearActiveRunIfMatches(threadId, runId);
          reconnectAbortRef.current = null;
          setIsReconnecting(false);
          reconnectRunIdRef.current = null;
          reconnectTailOnlyRef.current = false;
          if (afterSeq > 0) {
            reconnectCanMaterializeRef.current = false;
          }
          window.dispatchEvent(
            new CustomEvent("agentNative.chatRunning", {
              detail: { isRunning: false, tabId: tabId || threadId },
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
          reconnectRunIdRef.current = null;
          reconnectTailOnlyRef.current = false;
          if (loaded || afterSeq > 0 || latestContent.length === 0) {
            reconnectCanMaterializeRef.current = false;
          }
          window.dispatchEvent(
            new CustomEvent("agentNative.chatRunning", {
              detail: { isRunning: false, tabId: tabId || threadId },
            }),
          );
        }
        if (!loaded) {
          const repo = await refreshThreadFromServer();
          if (afterSeq > 0 || repoHasAssistantMessage(repo)) {
            setReconnectContent([]);
            setReconnectFrozen(false);
            reconnectCanMaterializeRef.current = false;
          }
        }
      };

      void streamReconnect();
      return true;
    },
    [apiUrl, refreshThreadFromServer, tabId, threadId, wasRecentlyStoppedRun],
  );

  const reconnectActiveRunForThread =
    useCallback(async (): Promise<boolean> => {
      if (!threadId) return false;
      try {
        const storedActiveRun = getActiveRun();
        const runRes = await fetch(
          `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
        );
        if (!runRes.ok) return false;
        const runInfo = (await runRes.json()) as ActiveRunLookup;
        if (
          !runInfo.active ||
          runInfo.status !== "running" ||
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
    }, [apiUrl, refreshThreadFromServer, startReconnectToRun, threadId]);

  useEffect(() => {
    if (!threadId || !isNewThread) return;
    // A restored tab can be reclassified as client-only after the thread list
    // loads. Once that happens, there is no server row to restore, so show the
    // empty composer instead of leaving the per-thread restore skeleton up.
    setIsRestoring(false);
  }, [isNewThread, threadId]);

  // Restore messages from server on mount (when threadId is set). The
  // server is the single source of truth — we don't hydrate from localStorage
  // first, so what the user sees in the chat panel always matches what the
  // history list (and the agent) sees on disk.
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    if (loadHistoryRepository) {
      (async () => {
        try {
          const repo = await loadHistoryRepository();
          if (repo) {
            importThreadData(repo, { markTitleGenerated: true });
          }
          titleGeneratedRef.current = true;
        } catch {
          // Start fresh
        } finally {
          setIsRestoring(false);
        }
      })();
    } else if (threadId && isNewThread) {
      // Client-created empty tabs do not have a server row until the first
      // message is sent. Avoid probing /threads/:id on mount; that request
      // can only 404 and makes normal app startup look broken in DevTools.
      setIsRestoring(false);
    } else if (threadId && knownAbsentThreadIds.has(threadId)) {
      // A prior mount already learned this thread has no server row (404).
      // Skip the re-probe so remounts don't re-spam 404s for the same id.
      setIsRestoring(false);
    } else if (threadId) {
      (async () => {
        try {
          const res = await fetch(
            `${apiUrl}/threads/${encodeURIComponent(threadId)}`,
          );
          if (res.ok) {
            const data = await res.json();
            if (data.threadData) {
              const repo = importThreadData(data.threadData, {
                markTitleGenerated: true,
              });
              if (repo) {
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
            // Also skip title generation if thread already has a title
            if (data.title) {
              titleGeneratedRef.current = true;
            }
          } else if (res.status === 404) {
            // No server row for this thread yet — remember it so later remounts
            // skip the probe instead of re-fetching a known 404.
            knownAbsentThreadIds.add(threadId);
          }
        } catch {
          // Start fresh
        } finally {
          // Clear the skeleton as soon as the persisted messages are imported.
          // The active-run reconnect probe below must NOT gate first paint — it
          // only matters when a run is mid-flight (e.g. after a hot reload), and
          // it streams on top of the already-rendered messages.
          setIsRestoring(false);
        }
        // Reconnect to an in-progress run after the skeleton has cleared, so a
        // background `/runs/active` probe never delays showing the conversation.
        try {
          await reconnectActiveRunForThread();
        } catch {
          // No active run to reconnect to.
        }
      })();
    } else {
      // Legacy: restore from sessionStorage
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
  ]);

  useEffect(() => {
    if (
      !loadHistoryRepository ||
      !hasRestoredRef.current ||
      isRestoring ||
      isRunning
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
    isRestoring,
    isRunning,
    loadHistoryRepository,
  ]);

  // If assistant-ui stops the local runtime while the background server run is
  // still alive, immediately switch into the same reconnect path used after a
  // reload. Otherwise the composer unlocks, the next send hits a 409, and the
  // user sees "still working" even though the UI stopped updating.
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
      wasRecentlyStoppedRun()
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
    threadId,
    wasRecentlyStoppedRun,
  ]);

  // Generate a title when the first user message is sent
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    if (titleGeneratedRef.current) return;
    if (messages.length === 0) return;

    const firstUserMsg = messages.find((m) => m.role === "user");
    if (!firstUserMsg) return;

    // Extract text from the first user message
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

  // Periodically save thread data while the agent is running so refreshes
  // don't lose messages. Saves every 5 seconds while running.
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

    const repo = exportCleanThreadRepo();
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
  }, [apiUrl, exportCleanThreadRepo, messages, isRunning, threadId]);

  // Persist full thread data after each completed response
  useEffect(() => {
    if (!hasRestoredRef.current) return;
    if (isRunning) return;
    if (messages.length === 0) return;

    const repo = exportCleanThreadRepo();

    if (threadId && onSaveThreadRef.current) {
      // Save to server via the hook callback
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
      // Legacy: save to sessionStorage
      const storageKey = `${CHAT_STORAGE_PREFIX}${tabId || "default"}`;
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(repo));
      } catch {}
    }
  }, [apiUrl, exportCleanThreadRepo, messages, isRunning, threadId, tabId]);

  useEffect(() => {
    onMessageCountChange?.(messages.length);
  }, [messages.length, onMessageCountChange]);

  // Persist queued messages to the server so they survive reloads. Debounced
  // to 300ms so typing-and-queuing-rapidly doesn't hammer the endpoint.
  // Stores them in thread_data.queuedMessages via POST /threads/:id/queued.
  useEffect(() => {
    if (!threadId) return;
    if (!hasRestoredRef.current) return;
    const serialized = JSON.stringify(queuedMessages);
    if (serialized === lastPersistedQueueRef.current) return;
    const queueVersion = queueMutationVersionRef.current;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const res = await fetch(
            `${apiUrl}/threads/${encodeURIComponent(threadId)}/queued`,
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
  }, [queuedMessages, threadId, apiUrl]);

  // Nudge the shared hook to re-check after a Builder connect.
  const handleBuilderConnected = useCallback(() => {
    window.dispatchEvent(new Event("agent-engine:configured-changed"));
  }, []);

  // Listen for auth error events from the adapter
  const checkAuthSession = useCallback(async () => {
    try {
      const res = await fetch(agentNativePath("/_agent-native/auth/session"), {
        cache: "no-store",
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      const hasSession = !!data && !data.error;
      setAuthSessionAvailable(hasSession);
      if (hasSession) {
        setAuthError(null);
      }
      return hasSession;
    } catch {
      return false;
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
      setAuthSessionAvailable(false);
      setAuthError({ sessionExpired: detail?.reason === "session-expired" });
      void checkAuthSession();
    };
    window.addEventListener("agent-chat:auth-error", handler);
    return () => window.removeEventListener("agent-chat:auth-error", handler);
  }, [checkAuthSession, tabId, threadId]);

  useEffect(() => {
    if (!authError) return;
    const shouldCaptureStuckAuthCard =
      authSessionAvailable || authError.sessionExpired;
    // Auto-recovery (`checkAuthSession`) runs immediately + at 250ms. If the
    // card is still showing 3 seconds later, recovery failed and the user
    // is about to hit "Refresh chat" — that's the "Reload UI required"
    // symptom we want signal on.
    const stuckCapture = window.setTimeout(() => {
      void (async () => {
        const hasSession = await checkAuthSession();
        if (hasSession) return;
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

  // Listen for loop-limit events from the adapter
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

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as RunErrorInfo & {
        tabId?: string;
      };
      if (tabId && detail?.tabId && detail.tabId !== tabId) return;
      if (!detail?.message) return;
      const stopped = userStoppedRunRef.current;
      if (
        stopped &&
        Date.now() - stopped.at < 10_000 &&
        (!stopped.runId || !detail.runId || stopped.runId === detail.runId)
      ) {
        return;
      }
      setRunErrorInfo({
        message: detail.message,
        ...(detail.details ? { details: detail.details } : {}),
        ...(detail.errorCode ? { errorCode: detail.errorCode } : {}),
        ...(detail.runId ? { runId: detail.runId } : {}),
        ...(detail.recoverable ? { recoverable: detail.recoverable } : {}),
      });
      setDismissedRunErrorKey(null);
    };
    window.addEventListener("agent-chat:run-error", handler);
    return () => window.removeEventListener("agent-chat:run-error", handler);
  }, [tabId]);

  // Real activity means the next chunk has started. Surface longer-lived
  // activity such as "Still generating image" so active-run reconnects do not
  // look like failures while the server is still making progress.
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
      setIsAutoResuming(false);
      setRunningActivityTool(tool || null);
      updateActiveRunActivity(tool || null);
      latestActivityLabelRef.current = label;
      // Already past the delay → keep the visible label current.
      if (activityLabelSurfacedRef.current) {
        setRunningActivityLabel(label);
        return;
      }
      // Not yet surfaced → arm a single reveal timer on the FIRST activity of
      // this in-flight period. A burst of quick steps that all finish (clear)
      // before the timer fires never surfaces anything, so normal fast turns
      // stay a steady "Thinking". A step still in-flight at the deadline reveals
      // the latest label so a slow operation reads as working, not hung.
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
  }, [resetRunningActivity, tabId]);

  // Show "Resuming…" during the adapter's auto-continuation window (the
  // ~250ms gap between the end of one serverless chunk and the POST for the
  // next). The adapter dispatches `agent-chat:auto-continue` at that moment.
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

  // Clear auto-resume once the next chunk has visibly started or the user stops.
  // Do not clear solely because `isRunning` is false: auto-resume intentionally
  // covers that between-chunk gap so the chat never looks idle while work is
  // still scheduled.
  useEffect(() => {
    if (isRunning || forceStopped) {
      if (autoResumeTimerRef.current !== null) {
        window.clearTimeout(autoResumeTimerRef.current);
        autoResumeTimerRef.current = null;
      }
      setIsAutoResuming(false);
    }
    if (!isRunning && !isAutoResuming) {
      resetRunningActivity();
    }
  }, [forceStopped, isAutoResuming, isRunning, resetRunningActivity]);

  // Auto-dequeue: when the agent is idle, send the next queued message. This
  // intentionally does not depend on observing the running -> idle transition:
  // restored queues can exist after a reload where this component never saw the
  // previous run as active.
  useEffect(() => {
    if (isRestoring || isRunning || queuedMessages.length === 0) {
      return;
    }
    if (dequeueInFlightRef.current) return;

    const next = queuedMessages[0];
    if (!next) return;

    dequeueInFlightRef.current = true;
    let cancelled = false;
    let started = false;
    const timer = window.setTimeout(() => {
      started = true;
      void (async () => {
        let removedForAppend = false;
        let appended = false;
        try {
          // In serverless/cross-isolate deployments the client can receive the
          // terminal SSE event a beat before SQL has marked the previous run
          // complete. Starting the queued turn during that window can reconnect
          // to the old run and replay the old answer under the new prompt.
          await waitForThreadRunToClear(apiUrl, threadId);
          if (cancelled) return;

          if (queuedMessagesRef.current[0]?.id !== next.id) {
            return;
          }

          // Keep the placeholder visible while waiting. Remove it only when the
          // append is about to begin, so queue stalls don't look like the chat
          // silently ate the next message.
          applyLocalQueuedMessages((prev) =>
            prev.filter((message) => message.id !== next.id),
          );
          removedForAppend = true;

          const imageAttachments = createAgentImageAttachments(next.images);
          const messageAttachments =
            next.attachments && next.attachments.length > 0
              ? next.attachments
              : (imageAttachments ?? []);
          appendThreadMessage({
            role: "user",
            content: [{ type: "text", text: next.text }],
            ...(messageAttachments.length > 0
              ? { attachments: messageAttachments }
              : {}),
            ...createUserMessageRunConfig(
              next.references,
              next.requestMode,
              next.recoveryAction,
              next.trackInRunsTray,
              undefined,
              next.id,
            ),
          } as Parameters<typeof threadRuntime.append>[0]);
          appended = true;
        } catch (err) {
          if (
            removedForAppend &&
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
      if (!started) {
        dequeueInFlightRef.current = false;
      }
    };
  }, [
    apiUrl,
    appendThreadMessage,
    applyLocalQueuedMessages,
    isRestoring,
    isRunning,
    queuedMessages,
    threadId,
  ]);

  // Clear frozen reconnect content + forceStopped only on the false→true
  // transition of isRuntimeRunning (i.e. a NEW run is actually starting).
  // Reacting to "isRuntimeRunning is currently true" would clear the
  // nuclear-stop flag immediately after the user clicks stop, since
  // cancellation is async and isRuntimeRunning is still true at that moment.
  const prevIsRuntimeRunningRef = useRef(isRuntimeRunning);
  useEffect(() => {
    const wasRunning = prevIsRuntimeRunningRef.current;
    prevIsRuntimeRunningRef.current = isRuntimeRunning;
    if (isRuntimeRunning && !wasRunning) {
      if (reconnectFrozen) {
        setReconnectFrozen(false);
        setReconnectContent([]);
        reconnectCanMaterializeRef.current = false;
      }
      if (forceStopped) {
        setForceStopped(false);
      }
    }
  }, [isRuntimeRunning, reconnectFrozen, forceStopped]);

  // Same transition guard for isReconnecting: only clear forceStopped on
  // the false→true edge (a new reconnect starting on page load).
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
      setReconnectFrozen(false);
      setReconnectContent([]);
      return;
    }
    try {
      const frozenContent = cloneContentParts(reconnectContent);
      settleInterruptedToolCalls(frozenContent);
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
              },
            },
          },
        },
      ];
      repo.headId = id;

      threadRuntime.import(ensureMessageMetadata(repo));
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
    runErrorInfo?.runId,
    tabId,
    threadId,
    threadRuntime,
  ]);

  // Abort the active server run (identical to what the Stop button does) so
  // an immediate-while-running send can proceed cleanly without a 409 race.
  // Captured in a stable ref so addToQueue can call it without listing
  // all the stop-related state in its own dep array.
  const stopActiveRun = useCallback(() => {
    setForceStopped(true);
    setOptimisticRunning(false);
    const activeRun = getActiveRun();
    const runIdToAbort = reconnectRunIdRef.current ?? activeRun?.runId;
    userStoppedRunRef.current = {
      at: Date.now(),
      ...(runIdToAbort ? { runId: runIdToAbort } : {}),
    };
    setRunErrorInfo(null);
    setDismissedRunErrorKey(null);
    if (runIdToAbort) {
      if (threadId) clearActiveRunIfMatches(threadId, runIdToAbort);
      fetch(`${apiUrl}/runs/${encodeURIComponent(runIdToAbort)}/abort`, {
        method: "POST",
      }).catch(() => {});
    }
    if (isReconnecting) {
      reconnectAbortRef.current?.abort();
      reconnectAbortRef.current = null;
      reconnectRunIdRef.current = null;
      setIsReconnecting(false);
      const shouldFreezeReconnectContent =
        !reconnectTailOnlyRef.current &&
        reconnectCanMaterializeRef.current &&
        reconnectContent.length > 0;
      if (shouldFreezeReconnectContent) {
        setReconnectFrozen(true);
      } else {
        setReconnectFrozen(false);
        setReconnectContent([]);
        reconnectCanMaterializeRef.current = false;
      }
      reconnectTailOnlyRef.current = false;
    }
    threadRuntime.cancelRun();
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: tabId || threadId },
        }),
      );
    }
  }, [
    apiUrl,
    isReconnecting,
    reconnectContent.length,
    tabId,
    threadId,
    threadRuntime,
  ]);
  // Keep the ref current so addToQueue can call it without a stale closure.
  stopActiveRunRef.current = stopActiveRun;

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
    ) => {
      if (!(await ensureAgentEngineReadyForSubmit())) {
        return;
      }
      materializeFrozenReconnectContent();
      setShowContinue(false);
      setLoopLimitInfo(null);
      setRunErrorInfo(null);
      setDismissedRunErrorKey(null);
      setComposerError(null);
      userStoppedRunRef.current = null;
      // Selection context attached via Cmd+I is one-shot — clear it as soon
      // as the user actually sends a message so it can't be re-used.
      clearPendingSelection();
      // Sending a message is an explicit user action — always anchor to the
      // bottom so the new message and any reply land in view, even if the
      // user had scrolled up to read history. The sticky-bottom override
      // exists to stop streaming from yanking the viewport, not to swallow
      // direct sends.
      markNearBottom();
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
        const msg =
          err instanceof Error
            ? err.message
            : "Attachment could not be processed.";
        setComposerError(msg);
        return;
      }
      const imageAttachments = createAgentImageAttachments(images);
      const allAttachments = [
        ...(queuedAttachments ?? []),
        ...(imageAttachments ?? []),
      ];

      // ── Body-size guard (Fix 3) ─────────────────────────────────────
      // Estimate the total serialized attachment payload. If it exceeds the
      // Vercel/Netlify body limit, progressively re-compress images until
      // the payload fits, then reject the largest remaining file if still over.
      let messageAttachments = allAttachments;
      {
        const allDataUrls = allAttachments.flatMap((a) =>
          a.content
            .filter(
              (c): c is { type: "image"; image: string } => c.type === "image",
            )
            .map((c) => c.image),
        );
        if (
          estimateAttachmentBodyBytes(allDataUrls) > MAX_ESTIMATED_BODY_BYTES
        ) {
          // Re-compress image attachments more aggressively.
          const recompressed: typeof allAttachments = [];
          let stillOver = false;
          for (const att of allAttachments) {
            if (
              att.type === "image" &&
              att.content.length === 1 &&
              att.content[0].type === "image"
            ) {
              // Find the original File from the queued attachments input.
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
                  // Could not recompress — keep original and flag overflow
                  stillOver = true;
                }
              } else {
                stillOver = true;
              }
            }
            recompressed.push(att);
          }
          // Re-estimate after recompression.
          const recompressedUrls = recompressed.flatMap((a) =>
            a.content
              .filter(
                (c): c is { type: "image"; image: string } =>
                  c.type === "image",
              )
              .map((c) => c.image),
          );
          if (
            stillOver ||
            estimateAttachmentBodyBytes(recompressedUrls) >
              MAX_ESTIMATED_BODY_BYTES
          ) {
            // Find the largest attachment and reject it.
            let largestIdx = -1;
            let largestSize = 0;
            for (let i = 0; i < recompressed.length; i++) {
              const url =
                recompressed[i].content.find(
                  (c): c is { type: "image"; image: string } =>
                    c.type === "image",
                )?.image ?? "";
              if (url.length > largestSize) {
                largestSize = url.length;
                largestIdx = i;
              }
            }
            if (largestIdx >= 0) {
              const rejected = recompressed[largestIdx];
              setComposerError(
                `"${rejected.name}" makes the message too large to send (combined attachments must be under ${Math.round(MAX_ESTIMATED_BODY_BYTES / 1024 / 1024)} MB). Remove it or use a smaller image.`,
              );
              return;
            }
          }
          messageAttachments = recompressed;
        }
      }
      // ── End body-size guard ──────────────────────────────────────────
      // Snapshot the exec mode at enqueue time when the caller didn't
      // pass an explicit override. Without this, a plan-mode message that
      // sits in the queue runs as 'act' if the user flips the global toggle
      // before the queue flushes — turning a read-only message into a write.
      const effectiveRequestMode: AgentRequestMode | undefined =
        requestMode ??
        (execMode === "plan"
          ? "plan"
          : execMode === "build"
            ? "act"
            : undefined);
      if (isRunning && intent === "immediate") {
        // Explicit interrupt path: abort the active server run, then let the
        // auto-dequeue path append this message once the run is clear. Normal
        // composer sends while running resolve to "queued" before reaching here.
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
          },
        ]);
        stopActiveRunRef.current();
      } else if (isRunning && intent === "queued") {
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
          },
        ]);
      } else {
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
            ),
          } as Parameters<typeof threadRuntime.append>[0]);
        } catch (error) {
          setOptimisticRunning(false);
          throw error;
        }
      }
      if (submitted.includesContext) {
        updateComposerContextItems(() => []);
      }
    },
    [
      applyLocalQueuedMessages,
      buildComposerContextSubmission,
      ensureAgentEngineReadyForSubmit,
      execMode,
      isRunning,
      materializeFrozenReconnectContent,
      markOptimisticRunning,
      appendThreadMessage,
      updateComposerContextItems,
    ],
  );

  // Expose imperative handle
  useImperativeHandle(
    ref,
    () => ({
      sendMessage(
        text: string,
        images?: string[],
        options?: AssistantChatSendOptions,
      ) {
        addToQueue(
          text,
          images,
          undefined,
          undefined,
          options?.requestMode,
          "queued",
          undefined,
          false,
          options?.trackInRunsTray === true,
        );
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
        // Only pull focus into the composer for explicit user gestures.
        // Passive context mirroring (e.g. a canvas selection staged with
        // openSidebar:false) must not steal focus — doing so blurs an active
        // inline text editor living in the design canvas iframe and tears it
        // down the instant it opens.
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
        addToQueue(
          text,
          images,
          undefined,
          undefined,
          undefined,
          "queued",
          recoveryAction,
        );
      },
      queueMessage(text: string, images?: string[]) {
        addToQueue(text, images);
      },
      isRunning() {
        return isRunning;
      },
      focusComposer() {
        tiptapRef.current?.focus();
      },
      exportThreadSnapshot() {
        if (messages.length === 0) return null;
        const repo = exportCleanThreadRepo();
        const { title, preview } = extractThreadMeta(repo);
        return {
          threadData: JSON.stringify(repo),
          title,
          preview,
          messageCount: messages.length,
        };
      },
    }),
    [
      addToQueue,
      exportCleanThreadRepo,
      isRunning,
      messages.length,
      stageComposerContextItem,
    ],
  );

  const autoscrollFollowKey = useMemo(
    () =>
      [
        messages.map(messageFollowKey).join(";"),
        `q:${queuedMessages.map(queuedMessageFollowKey).join("|")}`,
        `r:${reconnectContentFollowKey(reconnectContent)}`,
      ].join(";;"),
    [messages, queuedMessages, reconnectContent],
  );

  const {
    scrollRef,
    isNearBottomRef,
    showScrollToBottom,
    markNearBottom,
    scrollToBottom,
    scrollToBottomAfterPaint,
  } = useNearBottomAutoscroll<HTMLDivElement>({
    followKey: autoscrollFollowKey,
    streaming: textStreaming,
  });

  const scrollToBottomWhileLayoutSettles = useCallback(() => {
    scrollToBottomAfterPaint();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;

    let stopped = false;
    const observer = new ResizeObserver(() => {
      if (!stopped && isNearBottomRef.current) scrollToBottom();
    });
    observer.observe(el);
    const timeout = window.setTimeout(() => {
      stopped = true;
      observer.disconnect();
      if (isNearBottomRef.current) scrollToBottom();
    }, 1600);

    return () => {
      stopped = true;
      window.clearTimeout(timeout);
      observer.disconnect();
    };
  }, [isNearBottomRef, scrollToBottom, scrollToBottomAfterPaint]);

  // Scroll to bottom when a restored thread finishes loading
  const wasRestoringRef = useRef(isRestoring);
  useEffect(() => {
    const wasRestoring = wasRestoringRef.current;
    wasRestoringRef.current = isRestoring;
    if (wasRestoring && !isRestoring) {
      return scrollToBottomWhileLayoutSettles();
    }
  }, [isRestoring, scrollToBottomWhileLayoutSettles]);

  useEffect(() => {
    if (!textStreaming && isNearBottomRef.current) {
      scrollToBottomAfterPaint();
    }
  }, [textStreaming, scrollToBottomAfterPaint]);

  const { isDevMode: cpDevMode } = useDevMode(apiUrl);
  const checkpointCtx = useMemo(
    () => ({ apiUrl, devMode: cpDevMode, threadId }),
    [apiUrl, cpDevMode, threadId],
  );
  const messageActionsCtx = useMemo(() => ({ onForkChat }), [onForkChat]);
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
  const contextXRayEnabled = Boolean(
    threadId &&
    (messages.length > 0 || isReconnecting || reconnectContent.length > 0),
  );
  const handleImplementPlan = useCallback(() => {
    onExecModeChange?.("build");
    void addToQueue(
      "Implement the plan.",
      undefined,
      undefined,
      undefined,
      "act",
    );
  }, [addToQueue, onExecModeChange]);
  const handleSwitchToAct = useCallback(() => {
    onExecModeChange?.("build");
  }, [onExecModeChange]);
  const visibleLoopLimit = showContinue
    ? (loopLimitInfo ?? lastMessageLoopLimit ?? {})
    : lastMessageLoopLimit;
  const visibleRunError = runErrorInfo ?? lastMessageRunError;
  const visibleRunErrorKey = visibleRunError
    ? `${visibleRunError.runId ?? ""}:${visibleRunError.errorCode ?? ""}:${visibleRunError.message}`
    : null;
  const shouldShowRunError =
    !!visibleRunError &&
    !showRunningInUI &&
    visibleRunErrorKey !== dismissedRunErrorKey &&
    !(
      userStoppedRunRef.current &&
      Date.now() - userStoppedRunRef.current.at < 10_000 &&
      (!userStoppedRunRef.current.runId ||
        !visibleRunError.runId ||
        userStoppedRunRef.current.runId === visibleRunError.runId)
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
  const hasThreadFooterSlot = Boolean(resolvedThreadFooterSlot);
  const isFreshEmptyChat =
    messages.length === 0 &&
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
    messages.length === 0 && !isReconnecting && !hasActiveChatWork;
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
    missingApiKeySetupAboveComposer &&
    missingApiKey &&
    !authError &&
    showEmptyState &&
    !isRestoring;

  // Clarifying-question surface: the `ask-question` action writes a
  // GuidedQuestionPayload to application_state under "guided-questions". The
  // hook polls that key, and on submit/skip composes the answer as a normal
  // user turn (via the shared sendToAgentChat) and clears the persisted key so
  // the question does not reappear.
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
  });

  // Human-in-the-loop approvals: when the user approves a paused `needsApproval`
  // tool call, re-issue the turn carrying the call's approval key so the server
  // gate lets that specific call run. Reuses the same append path as recovery /
  // queued messages (no hand-written fetch).
  const approvalCtx = useMemo<ApprovalContextValue>(
    () => ({
      onApprove: (approvalKey: string) => {
        markOptimisticRunning();
        appendThreadMessage({
          role: "user",
          content: [
            {
              type: "text",
              text: "Approved. Go ahead and run the requested action.",
            },
          ],
          ...createUserMessageRunConfig(
            undefined,
            execMode === "plan"
              ? "plan"
              : execMode === "build"
                ? "act"
                : undefined,
            undefined,
            undefined,
            [approvalKey],
          ),
        } as Parameters<typeof threadRuntime.append>[0]);
      },
    }),
    [appendThreadMessage, execMode, markOptimisticRunning],
  );

  return (
    <CheckpointContext.Provider value={checkpointCtx}>
      <MessageActionsContext.Provider value={messageActionsCtx}>
        <ApprovalContext.Provider value={approvalCtx}>
          <ChatRunningContext.Provider value={showRunningInUI}>
            <TextStreamingContext.Provider value={textStreaming}>
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
                      Drop to attach
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
                                aria-label="Switch to CLI"
                                className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent"
                              >
                                <IconTerminal className="h-3.5 w-3.5" />
                                CLI
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Switch to CLI</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </div>
                )}

                {/* Messages area */}
                <div
                  ref={scrollRef}
                  className="agent-chat-scroll flex-1 overflow-y-auto overflow-x-hidden min-h-0"
                >
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
                            ? "Chat session needs refresh"
                            : authError.sessionExpired
                              ? "Session expired"
                              : "Authentication required"}
                        </p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {authSessionAvailable
                            ? "You're signed in, but this chat connection needs to reconnect."
                            : authError.sessionExpired
                              ? "Your session may have expired. Log out and log back in to reconnect."
                              : "You need to log in to use the agent."}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {!authError.sessionExpired && !authSessionAvailable && (
                          <button
                            onClick={() => {
                              const ret =
                                window.location.pathname +
                                window.location.search;
                              window.location.href =
                                agentNativePath("/_agent-native/sign-in") +
                                `?return=${encodeURIComponent(ret)}`;
                            }}
                            className="text-xs text-background bg-foreground hover:opacity-90 px-3 py-1.5 rounded-md"
                          >
                            Log in
                          </button>
                        )}
                        {authError.sessionExpired && !authSessionAvailable && (
                          <button
                            onClick={async () => {
                              try {
                                await fetch(
                                  agentNativePath("/_agent-native/auth/logout"),
                                  {
                                    method: "POST",
                                  },
                                );
                              } catch {}
                              window.location.reload();
                            }}
                            className="text-xs text-destructive hover:text-destructive/80 px-3 py-1.5 rounded-md border border-destructive/30 hover:bg-destructive/10"
                          >
                            Log out
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
                          Refresh chat
                        </button>
                      </div>
                    </div>
                  ) : isRestoring && centeredRestoringState ? (
                    <div
                      className={cn(
                        "agent-empty-state",
                        emptyStateDisplay === "hidden"
                          ? "sr-only"
                          : "flex h-full flex-col items-center justify-center gap-4 px-4 py-16",
                      )}
                      aria-busy="true"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                        <IconMessage className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <p className="sr-only">
                        {emptyStateText ?? "Loading chat..."}
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
                  ) : showEmptyState ? (
                    <div
                      className={cn(
                        "agent-empty-state",
                        emptyStateDisplay === "hidden"
                          ? "sr-only"
                          : "flex h-full flex-col items-center justify-center gap-4 px-4 py-16",
                      )}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                        <IconMessage className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <p className="sr-only">
                        {emptyStateText ?? "How can I help you?"}
                      </p>
                      {emptyStateAddon}
                      {resolvedSuggestions && resolvedSuggestions.length > 0 ? (
                        <div className="flex flex-col gap-1.5 w-full max-w-[280px]">
                          {resolvedSuggestions.map((suggestion) => (
                            <button
                              key={suggestion}
                              onClick={() => {
                                if (missingApiKey) {
                                  setMissingKeyBouncePulse((p) => p + 1);
                                  return;
                                }
                                appendThreadMessage({
                                  role: "user",
                                  content: [{ type: "text", text: suggestion }],
                                });
                              }}
                              className="w-full rounded-lg border border-border px-3 py-2 text-start text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {showInlineEmptyThreadFooterSlot ? (
                        <div className="agent-thread-footer-slot agent-thread-footer-slot--empty">
                          {resolvedThreadFooterSlot}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="agent-thread-content flex flex-col gap-4 px-4 py-4">
                      <AssistantMessageListErrorBoundary
                        resetKey={messageListResetKey}
                      >
                        <ThreadPrimitive.Messages
                          components={{
                            UserMessage,
                            AssistantMessage,
                          }}
                        />
                      </AssistantMessageListErrorBoundary>
                      {visibleLoopLimit && !showRunningInUI && (
                        <LoopLimitContinueCard
                          info={visibleLoopLimit}
                          onContinue={() => {
                            setShowContinue(false);
                            setLoopLimitInfo(null);
                            addToQueue(
                              "Continue from where you left off.",
                              undefined,
                              undefined,
                              undefined,
                              undefined,
                              "queued",
                              "continue",
                            );
                          }}
                        />
                      )}
                      {shouldShowRunError && visibleRunError && (
                        <RunErrorRecoveryCard
                          info={visibleRunError}
                          onContinue={() => {
                            setRunErrorInfo(null);
                            addToQueue(
                              "Continue from where you stopped. Use the partial work above, verify what succeeded, and finish the original request. Do not rerun the exact same failed tool input unless the failure was transient or the user explicitly asked for an exact rerun. Prefer dedicated app actions over raw database edits when they exist.",
                              undefined,
                              undefined,
                              undefined,
                              undefined,
                              "queued",
                              "continue",
                            );
                          }}
                          onRetry={() => {
                            setRunErrorInfo(null);
                            addToQueue(
                              lastUserText
                                ? `Retry the previous request from a clean approach. Do not rerun the exact same failed tool input unless the failure was transient or the user explicitly asked for an exact rerun. If a provider query failed because of schema, syntax, or type mismatch, diagnose the error and adjust the query first.\n\nOriginal request:\n\n${lastUserText}`
                                : "Retry the previous request from a clean approach. Do not rerun the exact same failed tool input unless the failure was transient or the user explicitly asked for an exact rerun. If a provider query failed because of schema, syntax, or type mismatch, diagnose the error and adjust the query first.",
                              undefined,
                              undefined,
                              undefined,
                              undefined,
                              "queued",
                              "retry",
                            );
                          }}
                          onFork={onForkChat}
                          onDismiss={() => {
                            if (visibleRunErrorKey) {
                              setDismissedRunErrorKey(visibleRunErrorKey);
                            }
                            setRunErrorInfo(null);
                          }}
                        />
                      )}
                      {(isReconnecting || reconnectFrozen) &&
                        reconnectContent.length > 0 && (
                          <ReconnectStreamMessage content={reconnectContent} />
                        )}
                      {(isReconnecting || reconnectFrozen) &&
                        reconnectContent.length === 0 &&
                        reconnectActivityContent.length > 0 && (
                          <ReconnectStreamMessage
                            content={reconnectActivityContent}
                          />
                        )}
                      {showRunningInUI && (
                        <RunningActivityStatus label={runningStatusLabel} />
                      )}
                      {queuedMessages.map((msg) => {
                        const displayText = msg.text
                          .replace(/<context>[\s\S]*?<\/context>\n?/g, "")
                          .trim();
                        return (
                          <div
                            key={msg.id}
                            className="group flex items-start justify-end gap-1.5"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                applyLocalQueuedMessages((prev) =>
                                  prev.filter((m) => m.id !== msg.id),
                                )
                              }
                              aria-label="Remove from queue"
                              className="mt-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                            >
                              <IconX className="h-3 w-3" />
                            </button>
                            <div className="max-w-[85%] rounded-lg bg-accent/50 px-3 py-2 text-sm leading-relaxed text-foreground/60 whitespace-pre-wrap break-words">
                              {displayText}
                              {msg.images && msg.images.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                  {msg.images.map((img, j) => (
                                    <img
                                      key={j}
                                      src={img}
                                      alt=""
                                      className="h-12 w-12 rounded object-cover border border-border/50"
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {resolvedThreadFooterSlot ? (
                        <div className="agent-thread-footer-slot">
                          {resolvedThreadFooterSlot}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Scroll to bottom button */}
                {showScrollToBottom && (
                  <div className="shrink-0 flex justify-center -mb-1">
                    <button
                      type="button"
                      onClick={scrollToBottom}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background shadow-sm hover:bg-accent"
                      aria-label="Scroll to bottom"
                    >
                      <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                )}

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
                        ? { description: guidedQuestionsDescription }
                        : {})}
                      {...(guidedQuestionsSkipLabel
                        ? { skipLabel: guidedQuestionsSkipLabel }
                        : {})}
                      {...(guidedQuestionsSubmitLabel
                        ? { submitLabel: guidedQuestionsSubmitLabel }
                        : {})}
                      className="h-auto items-stretch justify-stretch bg-transparent"
                    />
                  </div>
                )}
                {showPlanModeCallout && (
                  <PlanModeCallout
                    canImplementPlan={canImplementPlan}
                    onImplementPlan={handleImplementPlan}
                    onSwitchToAct={handleSwitchToAct}
                  />
                )}
                <SelectionAttachedPill />
                {/* Inline attachment / body-size error */}
                {composerError && (
                  <div
                    role="alert"
                    className="shrink-0 mx-3 mb-1.5 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    <IconAlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="flex-1 leading-snug">{composerError}</span>
                    <button
                      type="button"
                      aria-label="Dismiss error"
                      onClick={() => setComposerError(null)}
                      className="shrink-0 opacity-70 hover:opacity-100"
                    >
                      <IconX className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {missingApiKey &&
                !authError &&
                missingApiKeySetupAboveComposer ? (
                  <BuilderSetupCard
                    onConnected={handleBuilderConnected}
                    bouncePulse={missingKeyBouncePulse}
                    layout={missingApiKeySetupLayout}
                  />
                ) : null}
                {/* Input area */}
                <AgentComposerFrame
                  layoutVariant={composerLayoutVariant}
                  className={cn(
                    composerAreaClassName,
                    missingApiKey && "cursor-pointer",
                    isComposerDisabled && "opacity-70",
                  )}
                  onClick={
                    missingApiKey
                      ? () => setMissingKeyBouncePulse((p) => p + 1)
                      : undefined
                  }
                >
                  <ComposerAttachmentPreviewStrip />
                  <TiptapComposer
                    focusRef={tiptapRef}
                    disabled={isComposerDisabled}
                    placeholder={
                      missingApiKey
                        ? missingApiKeySetupAboveComposer
                          ? "Connect AI above to start chatting..."
                          : "Connect AI below to start chatting..."
                        : composerDisabled
                          ? (composerDisabledPlaceholder ??
                            "Open Desktop to use this chat.")
                          : isRunning
                            ? queuedMessages.length > 0
                              ? `${queuedMessages.length} queued — send a follow-up...`
                              : "Send a follow-up..."
                            : composerPlaceholder
                    }
                    onSubmit={
                      isRunning || composerContextItems.length > 0
                        ? (text, references, attachments, options) =>
                            void addToQueue(
                              text,
                              undefined,
                              references.length > 0 ? references : undefined,
                              attachments,
                              undefined,
                              resolveAssistantChatSubmitIntent({
                                isRunning,
                                requestedIntent: options?.intent,
                              }),
                              undefined,
                              true,
                            )
                        : undefined
                    }
                    onSlashCommand={onSlashCommand}
                    onBeforeSubmit={ensureAgentEngineReadyForSubmit}
                    execMode={execMode}
                    onExecModeChange={onExecModeChange}
                    planModeDisabled={planModeDisabled}
                    planModeDisabledReason={planModeDisabledReason}
                    selectedModel={selectedModel ?? defaultModel}
                    selectedEffort={selectedEffort}
                    availableModels={availableModels}
                    onModelChange={onModelChange}
                    onEffortChange={onEffortChange}
                    imageModelMenu={imageModelMenu}
                    onConnectProvider={onConnectProvider}
                    toolbarSlot={composerToolbarSlot}
                    contextItems={composerContextItems}
                    onRemoveContextItem={removeComposerContextItem}
                    plusMenuMode={plusMenuMode}
                    layoutVariant={composerLayoutVariant}
                    providerConnectStatusEnabled={providerStatusChecksEnabled}
                    draftScope={threadId || tabId}
                    interceptBuildRequestsForBuilder
                    onAttachmentError={setComposerError}
                    extraActionButton={
                      contextXRayEnabled ||
                      composerExtraActionButton ||
                      showRunningInUI ? (
                        <>
                          {contextXRayEnabled && (
                            <ContextMeter threadId={threadId} />
                          )}
                          {composerExtraActionButton}
                          {showRunningInUI && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={stopActiveRun}
                                  className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground hover:bg-muted/80"
                                >
                                  <IconPlayerStop className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Stop generating</TooltipContent>
                            </Tooltip>
                          )}
                        </>
                      ) : undefined
                    }
                  />
                </AgentComposerFrame>
                {missingApiKey &&
                !authError &&
                !missingApiKeySetupAboveComposer ? (
                  <BuilderSetupCard
                    onConnected={handleBuilderConnected}
                    bouncePulse={missingKeyBouncePulse}
                    layout={missingApiKeySetupLayout}
                  />
                ) : null}
              </div>
            </TextStreamingContext.Provider>
          </ChatRunningContext.Provider>
        </ApprovalContext.Provider>
      </MessageActionsContext.Provider>
    </CheckpointContext.Provider>
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
    isActiveComposer,
    ...props
  },
  ref,
) {
  const modelRef = useRef<string | undefined>(props.selectedModel);
  modelRef.current = props.selectedModel;
  const engineRef = useRef<string | undefined>(props.selectedEngine);
  engineRef.current = props.selectedEngine;
  const effortRef = useRef<ReasoningEffort | undefined>(props.selectedEffort);
  effortRef.current = props.selectedEffort;
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
        tabId,
        threadId,
        modelRef,
        engineRef,
        effortRef,
        execModeRef,
        browserTabId,
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
    // Adapter factories must be memoized and use refs for changing values.
    // `adapterReloadKey` is an explicit opt-in for embedded hosts whose
    // transport identity can change without changing tab/thread ids.
    [
      apiUrl,
      tabId,
      threadId,
      browserTabId,
      surface,
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
      <TooltipProvider delayDuration={200}>
        <ThreadPrimitive.Root className="flex flex-1 flex-col h-full min-h-0 overflow-x-hidden">
          <AssistantUiStaleIndexErrorBoundary
            resetKey={`${tabId ?? ""}:${threadId ?? ""}`}
            componentName="AssistantChat"
          >
            <AssistantChatInner
              ref={ref}
              {...props}
              browserTabId={browserTabId}
              contextScope={contextScope}
              isActiveComposer={isActiveComposer}
              apiUrl={apiUrl}
              tabId={tabId}
              threadId={threadId}
            />
          </AssistantUiStaleIndexErrorBoundary>
        </ThreadPrimitive.Root>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
});
