import {
  AgentKitUploadError,
  hasActiveAgentRuns,
  selectAgentSuggestions,
  isCurrentAgentSuggestion,
  AGENT_NATIVE_SUBMISSION_EXPIRES_AT_METADATA_KEY,
  type AgentKitUploadDriver,
  type AgentThreadState,
} from "@agent-native/agentkit";
import {
  MAX_AGENT_REQUEST_ATTACHMENT_DATA_CHARS,
  isPersistableAttachmentUrl,
  persistableFilePart,
} from "@agent-native/agentkit/protocol";
import type {
  AgentActionResult,
  AgentApprovalRequest,
  AgentConnectionRequest,
  AgentEvent,
  AgentInteraction,
  AgentMessage,
  AgentQueuedMessage,
  AgentRequestAttachment,
  AgentRequestContext,
  AgentStreamIntegrityReport,
  AgentTransport,
  AgentThreadSnapshot,
  AgentToolCall,
  AgentUploadTarget,
  FilePart,
} from "@agent-native/agentkit/protocol";
import type { AgentChatAttachment } from "@agent-native/core";
import { CHATGPT_SUBSCRIPTION_ENGINE_NAME } from "@agent-native/core/agent/chatgpt-subscription-contract";
import { isCreditsLimitErrorCode } from "@agent-native/core/agent/engine/error-detail";
import {
  appendAgentChatContextToMessage,
  filterAgentChatContextItems,
  formatAgentChatContextItemsForPrompt,
  getAgentChatContextState,
  nextAgentChatStagingId,
  normalizeAgentChatContextItem,
  publishAgentChatContextItems,
  removeAgentChatContextItemAndPersist,
  reportAgentChatSubmitResult,
  refreshAgentChatContext,
  setAgentChatContextItemAndPersist,
  subscribeAgentChatContext,
  type AgentChatContextItem,
} from "@agent-native/core/client/agent-chat";
import type { CreateAgentNativeAgentKitTransportOptions } from "@agent-native/core/client/agent-chat";
import { AGENT_NATIVE_PROTOCOL_METADATA_KEY } from "@agent-native/core/client/agent-chat";
import {
  readAssistantChatComposerDraft,
  writeAssistantChatComposerDraft,
} from "@agent-native/core/client/agent-chat";
import {
  createAgentNativeChatRuntime,
  trackTurnSubmitted,
} from "@agent-native/core/client/agent-chat";
import type { CreateAgentNativeChatRuntimeOptions } from "@agent-native/core/client/agent-chat";
import { useAgentDynamicSuggestionsResult } from "@agent-native/core/client/agent-chat";
import {
  formatChatErrorText,
  localizeKnownChatErrorText,
} from "@agent-native/core/client/agent-chat";
import { dispatchAgentChatRunning } from "@agent-native/core/client/agent-chat";
import {
  agentEngineStatusUrlForChatApi,
  isLocalRuntimeEngine,
  useAgentEngineConfigured,
  type AgentEngineConfiguredState,
} from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import {
  compareAndSetClientAppState,
  deleteClientAppState,
  isClientAppStateMutationPending,
  readClientAppState,
} from "@agent-native/core/client/application-state";
import { identityBootstrapCallbackHref } from "@agent-native/core/client/auth/auth-page-helpers";
import { signOut } from "@agent-native/core/client/hooks";
import { callAction } from "@agent-native/core/client/hooks";
import { isInBuilderFrame } from "@agent-native/core/client/host";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/sign-in-return";
import { useFileUploadStatus } from "@agent-native/core/client/uploads";
import { useSession } from "@agent-native/core/client/use-session";
import { AGENTKIT_CHAT_MIGRATION_GUIDE_URL } from "@agent-native/core/package-lifecycle/migration-message";
import {
  parseBase64DataUrl,
  splitAgentChatContextFromMessage,
  stripAgentChatContextFromMessage,
  stripInlineAttachmentPayloads,
} from "@agent-native/core/shared";
import { AgentSelectToggle } from "@agent-native/toolkit/app/agent-select";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import {
  AgentSuggestionBar,
  agentSuggestionPrompt,
  snapshotComposerContextItems,
  type PromptComposerFile,
  type PromptComposerSubmitOptions,
  type Reference,
  type AgentSuggestionInput,
  type TiptapComposerHandle,
  AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES,
  composerContextFits,
  readAgentPromptAttachment,
} from "@agent-native/toolkit/composer";
import { IconButton } from "@agent-native/toolkit/design-system";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { cn } from "@agent-native/toolkit/utils";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCopy,
  IconDotsVertical,
  IconMessage,
  IconQuote,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import React, {
  createContext,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import {
  ComposerNotice,
  ComposerNoticeScope,
} from "../../composer/composer-notice.js";
import { approvalRequestKind } from "../agentkit/react/approval-card.js";
import {
  AgentKitChat,
  AgentKitComposer,
  AgentKitEmptyState,
  AgentKitTranscriptSkeleton,
  AgentApprovalPrompt,
  AgentInteractionItem,
  AgentMessageView,
  useAgentKit,
  useAgentKitBeginPendingSubmission,
  useAgentKitControl,
  useAgentKitInWorkStep,
  useAgentKitPendingSubmissions,
  useAgentKitStopButton,
  useAgentKitSubmissionHoldsTurn,
  useAgentThread,
  useAgentThreadSelector,
  type AgentKitRenderProps,
  type AgentKitRegionRenderProps,
  type AgentConnectionErrorRenderProps,
  type AgentKitBranchNavigation,
} from "../agentkit/react/index.js";
import {
  AGENTKIT_CLIENT_REQUEST_ID_METADATA_KEY,
  agentKitTurnInProgress,
  pendingSubmissionFiles,
} from "../agentkit/react/pending-submissions.js";
import { isStreamingVoiceMessage } from "../agentkit/react/voice-transcripts.js";
import { ThreadContextRing } from "../context-xray/ThreadContextRing.js";
import { threadHasFinishedReply } from "../context-xray/use-thread-context-usage.js";
import {
  AgentKitDevCheckpointProvider,
  AgentKitDevCheckpointRestore,
  useOptionalAgentKitHistory,
} from "./agentkit-chat/history.js";
import {
  CoreComposerRuntimeProvider,
  createAgentNativeAgentKitTransport,
  GuidedQuestionProviderGate,
  findMcpConnectionSuggestionIntegration,
  GuidedQuestionFlow,
  McpAgentKitConnectionRequestCard,
  McpAgentKitConnectionResume,
  McpConnectionSuggestion,
  AgentKitHistoryBeginningRevert,
  AgentKitHistoryMessageSupplement,
  AgentKitHistoryProvider,
  useGuidedQuestionFlow,
  type AgentKitHistoryConfig,
} from "./agentkit-chat/index.js";
import {
  AgentKitFilesChangedSummary,
  AgentKitMarkdownText,
} from "./agentkit-chat/parity-renderers.js";
import { CoreAgentKitRoot } from "./agentkit-chat/root.js";
import { agentKitWorkStepLabels } from "./agentkit-chat/work-step-labels.js";
import { AgentApprovalCard } from "./chat/agent-approval-card.js";
import { renderMarkdownToClipboardHtml } from "./chat/markdown-renderer.js";
import {
  RunErrorRecoveryCard,
  BuilderSetupCard,
  LoopLimitContinueCard,
  IMPLEMENT_PLAN_PROMPT,
  PlanModeCallout,
  getReplyRequestMode,
  isMissingLlmProviderRunError,
  type RunErrorInfo,
} from "./chat/run-recovery.js";
import type {
  AssistantChatAdapterContext,
  AssistantChatComposerContext,
  AssistantChatHandle,
  AssistantChatProps,
  AssistantChatSnapshotSaveSource,
  AssistantChatSendOptions,
  AssistantChatSubmitResult,
} from "./chat/surface-types.js";
import {
  ChatRunningContext,
  SuppressInlineOpenAppContext,
  ReasoningCell,
  ToolCallDisplay,
} from "./chat/tool-call-display.js";
import { resolveAgentKitToolSource } from "./chat/tool-integration.js";
import { ExternalAgentNudge } from "./external-agent-host.js";
import { fallbackChatTitle } from "./fallback-chat-title.js";
import { formatFeedbackReport } from "./feedback-report.js";
import { FileStorageSetupPopover } from "./FileStorageSetupPopover.js";
import {
  isWaitingOnApprovalRequest,
  isWaitingOnConnectionRequest,
  reconcileSettledRun,
} from "./reconcile-settled-run.js";
import {
  pickReplyConnectionSuggestion,
  latestReplyContext,
  type LatestReplyContext,
} from "./reply-connection-suggestion.js";
import { RunStuckBanner } from "./RunStuckBanner.js";
import { SESSION_REPLAY_MASK_PROPS } from "./session-replay-privacy.js";
import { ThinkingDisplayProvider } from "./thinking-display.js";

export interface AgentKitAssistantChatProps extends AssistantChatProps {
  /** Reference routing follows the selected conversation even when chat is hidden. */
  isReferenceTarget?: boolean;
  /** Called after AgentKit creates a fork so the host can add and activate a tab. */
  onForkedThread?: (threadId: string) => void;
  branchNavigation?: AgentKitBranchNavigation;
  /**
   * @deprecated Removed in Core 0.194.0. Pass `runtime` or `createTransport`.
   * @see https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/migrations/agentkit-chat.md
   */
  createAdapter?: "Removed. See https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/migrations/agentkit-chat.md";
}

const copyAgentKitMessage = ({ text }: { text: string }) => {
  const html = renderMarkdownToClipboardHtml(text);
  return html === null ? false : writeClipboardText(text, { html });
};

const dispatchAgentKitClientEffect = (effect: unknown) => {
  window.dispatchEvent(
    new CustomEvent("agent-chat:client-effect", { detail: effect }),
  );
};

const reportIntegrity = (report: AgentStreamIntegrityReport) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agentkit:stream-integrity", { detail: report }),
  );
};

const PENDING_SELECTION_TTL_MS = 5 * 60 * 1000;
const MAX_SELECTION_CONTEXT_CHARS = 8_000;
const THREAD_HANDOFF_TTL_MS = 60_000;
const MAX_THREAD_HANDOFF_SNAPSHOTS = 20;
const MAX_PENDING_THREAD_SNAPSHOT_WRITES = 8;
const MAX_THREAD_SNAPSHOT_SAVE_RETRIES = 3;
const THREAD_SNAPSHOT_SAVE_TIMEOUT_MS = 30_000;
const THREAD_SNAPSHOT_SAVE_RETRY_DELAY_MS = 1_000;
const threadSnapshotPersistenceQueues = new Map<string, Promise<void>>();
const threadSnapshotSaveQueues = new Map<string, Promise<void>>();
const threadSnapshotPersistenceQueueSizes = new Map<string, number>();
const threadSnapshotSaveQueueSizes = new Map<string, number>();
// An aborted write can still commit remotely, so keep its queue fenced until it settles.
const stalledThreadSnapshotPersistenceQueues = new Set<string>();
const stalledThreadSnapshotSaveQueues = new Set<string>();
const latestThreadSnapshotGenerations = new Map<string, number>();
let threadSnapshotGeneration = 0;
const DEFERRED_PROVIDER_SUBMISSIONS_VERSION = 1;
const DEFERRED_PROVIDER_SUBMISSION_CLAIM_TTL_MS = 15 * 60 * 1000;
const DEFERRED_PROVIDER_SUBMISSION_MAX_RETRIES = 3;
const DEFERRED_PROVIDER_SUBMISSIONS_KEY_PREFIX =
  "agentkit-deferred-provider-submissions:";
type AgentKitHandoffThreadSnapshot = AgentThreadSnapshot & {
  titleSource?: "fallback";
};
const threadHandoffSnapshots = new Map<
  string,
  { snapshot: AgentKitHandoffThreadSnapshot; expiresAt: number }
>();
const deferredProviderSubmissionOperations = new Map<
  string,
  Promise<unknown>
>();
// i18n-ignore: Internal recovery instruction sent to the agent, never shown as product copy.
const RECOVERY_CONTINUE_PROMPT =
  "Continue from where you left off and finish my last request. Do not repeat completed work.";

function enqueueThreadSnapshotPersistence<T>(
  key: string,
  persist: (context: AgentRequestContext) => Promise<T> | T,
  context?: AgentRequestContext,
): Promise<T> {
  if (stalledThreadSnapshotPersistenceQueues.has(key)) {
    return Promise.reject(threadSnapshotQueueStalledError());
  }
  if (
    !reserveThreadSnapshotQueueSlot(threadSnapshotPersistenceQueueSizes, key)
  ) {
    return Promise.reject(threadSnapshotQueueFullError());
  }
  const previous =
    threadSnapshotPersistenceQueues.get(key) ?? Promise.resolve();
  let resolveResult!: (value: T | PromiseLike<T>) => void;
  let rejectResult!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  let operationStarted = false;
  let operationSettled = false;
  let slotReleased = false;
  const releaseSlot = () => {
    if (slotReleased) return;
    slotReleased = true;
    releaseThreadSnapshotQueueSlot(threadSnapshotPersistenceQueueSizes, key);
  };
  const controller = new AbortController();
  const onAbort = () => {
    if (operationStarted && !operationSettled) {
      stalledThreadSnapshotPersistenceQueues.add(key);
    }
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const abortFromCaller = () => controller.abort(context?.signal?.reason);
  if (context?.signal?.aborted) abortFromCaller();
  else
    context?.signal?.addEventListener("abort", abortFromCaller, {
      once: true,
    });
  let writeTimeout: number | undefined;
  const queueWaitTimeout = window.setTimeout(() => {
    const error = new Error("Chat thread snapshot persistence timed out.");
    error.name = "TimeoutError";
    controller.abort(error);
  }, THREAD_SNAPSHOT_SAVE_TIMEOUT_MS);
  const cleanup = () => {
    window.clearTimeout(queueWaitTimeout);
    if (writeTimeout !== undefined) window.clearTimeout(writeTimeout);
    context?.signal?.removeEventListener("abort", abortFromCaller);
    controller.signal.removeEventListener("abort", onAbort);
  };
  const operation = previous.then(() => {
    if (controller.signal.aborted) throw abortError(controller.signal);
    operationStarted = true;
    window.clearTimeout(queueWaitTimeout);
    writeTimeout = window.setTimeout(() => {
      const error = new Error("Chat thread snapshot persistence timed out.");
      error.name = "TimeoutError";
      controller.abort(error);
    }, THREAD_SNAPSHOT_SAVE_TIMEOUT_MS);
    return persist({ ...context, signal: controller.signal });
  });
  const settled = operation
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      operationSettled = true;
      stalledThreadSnapshotPersistenceQueues.delete(key);
      cleanup();
      releaseSlot();
      if (threadSnapshotPersistenceQueues.get(key) === settled) {
        threadSnapshotPersistenceQueues.delete(key);
      }
    });
  threadSnapshotPersistenceQueues.set(key, settled);
  const pending = runWithAbortSignal(controller.signal, () => operation);
  void pending.then(resolveResult, rejectResult).then(cleanup, cleanup);
  return result;
}

function enqueueThreadSnapshotSave<T>(
  key: string,
  save: (context: AgentRequestContext) => Promise<T> | T,
): Promise<T> {
  if (stalledThreadSnapshotSaveQueues.has(key)) {
    return Promise.reject(threadSnapshotQueueStalledError());
  }
  if (!reserveThreadSnapshotQueueSlot(threadSnapshotSaveQueueSizes, key)) {
    return Promise.reject(threadSnapshotQueueFullError());
  }
  const previous = threadSnapshotSaveQueues.get(key) ?? Promise.resolve();
  let resolveResult!: (value: T | PromiseLike<T>) => void;
  let rejectResult!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  let operationStarted = false;
  let operationSettled = false;
  let slotReleased = false;
  const releaseSlot = () => {
    if (slotReleased) return;
    slotReleased = true;
    releaseThreadSnapshotQueueSlot(threadSnapshotSaveQueueSizes, key);
  };
  const controller = new AbortController();
  const onAbort = () => {
    if (operationStarted && !operationSettled) {
      stalledThreadSnapshotSaveQueues.add(key);
    }
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  let writeTimeout: number | undefined;
  const queueWaitTimeout = window.setTimeout(() => {
    const error = new Error("Chat thread snapshot persistence timed out.");
    error.name = "TimeoutError";
    controller.abort(error);
  }, THREAD_SNAPSHOT_SAVE_TIMEOUT_MS);
  const cleanup = () => {
    window.clearTimeout(queueWaitTimeout);
    if (writeTimeout !== undefined) window.clearTimeout(writeTimeout);
    controller.signal.removeEventListener("abort", onAbort);
  };
  const operation = previous.then(() => {
    if (controller.signal.aborted) throw abortError(controller.signal);
    operationStarted = true;
    window.clearTimeout(queueWaitTimeout);
    writeTimeout = window.setTimeout(() => {
      const error = new Error("Chat thread snapshot persistence timed out.");
      error.name = "TimeoutError";
      controller.abort(error);
    }, THREAD_SNAPSHOT_SAVE_TIMEOUT_MS);
    return save({ signal: controller.signal });
  });
  const settled = operation
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      operationSettled = true;
      stalledThreadSnapshotSaveQueues.delete(key);
      cleanup();
      releaseSlot();
      if (threadSnapshotSaveQueues.get(key) === settled) {
        threadSnapshotSaveQueues.delete(key);
      }
    });
  threadSnapshotSaveQueues.set(key, settled);
  const pending = runWithAbortSignal(controller.signal, () => operation);
  void pending.then(resolveResult, rejectResult).then(cleanup, cleanup);
  return result;
}

function runWithAbortSignal<T>(
  signal: AbortSignal,
  operation: () => Promise<T> | T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortError(signal)));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    void Promise.resolve()
      .then(() => {
        if (signal.aborted) throw abortError(signal);
        return operation();
      })
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("Chat thread snapshot persistence was aborted.");
  error.name = "AbortError";
  return error;
}

function reserveThreadSnapshotQueueSlot(
  queueSizes: Map<string, number>,
  key: string,
): boolean {
  const pending = queueSizes.get(key) ?? 0;
  if (pending >= MAX_PENDING_THREAD_SNAPSHOT_WRITES) return false;
  queueSizes.set(key, pending + 1);
  return true;
}

function releaseThreadSnapshotQueueSlot(
  queueSizes: Map<string, number>,
  key: string,
): void {
  const pending = queueSizes.get(key) ?? 0;
  if (pending <= 1) queueSizes.delete(key);
  else queueSizes.set(key, pending - 1);
}

function threadSnapshotQueueFullError(): Error {
  const error = new Error("Too many chat thread snapshot writes are pending.");
  error.name = "ThreadSnapshotQueueFullError";
  Object.assign(error, { code: "thread_snapshot_queue_full" });
  return error;
}

function threadSnapshotQueueStalledError(): Error {
  const error = new Error(
    "A previous chat thread snapshot write has not settled after cancellation.",
  );
  error.name = "ThreadSnapshotQueueStalledError";
  Object.assign(error, { code: "thread_snapshot_queue_stalled" });
  return error;
}

function withSerializedThreadSnapshotPersistence(
  transport: AgentTransport,
  persistenceKeyForThread: (threadId: string) => string,
): AgentTransport {
  const persist = transport.persistThreadSnapshot;
  if (!persist) return transport;

  const boundMethods = new Map<PropertyKey, Function>();
  return new Proxy(transport, {
    get(target, property) {
      if (property === "persistThreadSnapshot") {
        return (
          ...args: Parameters<
            NonNullable<AgentTransport["persistThreadSnapshot"]>
          >
        ) =>
          enqueueThreadSnapshotPersistence(
            persistenceKeyForThread(args[0].threadId),
            (context) => persist.call(target, args[0], context),
            args[1],
          );
      }
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const cached = boundMethods.get(property);
      if (cached) return cached;
      const bound = value.bind(target);
      boundMethods.set(property, bound);
      return bound;
    },
  });
}

function withCoreSnapshotPersistence(
  customTransport: AgentTransport,
  coreTransport: AgentTransport,
  persistenceKeyForThread: (threadId: string) => string,
): AgentTransport {
  if (customTransport === coreTransport) {
    return withSerializedThreadSnapshotPersistence(
      customTransport,
      persistenceKeyForThread,
    );
  }
  const corePersist = coreTransport.persistThreadSnapshot;
  if (!corePersist) {
    throw new TypeError("Core transport must persist thread snapshots.");
  }
  const boundMethods = new Map<PropertyKey, Function>();
  let disposed = false;
  const persistThreadSnapshot: NonNullable<
    AgentTransport["persistThreadSnapshot"]
  > = (...args) =>
    enqueueThreadSnapshotPersistence(
      persistenceKeyForThread(args[0].threadId),
      async (context) => {
        const writes = [
          ...(customTransport.persistThreadSnapshot
            ? [
                Promise.resolve().then(() =>
                  customTransport.persistThreadSnapshot!.call(
                    customTransport,
                    args[0],
                    context,
                  ),
                ),
              ]
            : []),
          Promise.resolve().then(() =>
            corePersist.call(coreTransport, args[0], context),
          ),
        ];
        const results = await Promise.allSettled(writes);
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) {
          throw new AggregateError(
            errors,
            "Thread snapshot persistence failed.",
          );
        }
      },
      args[1],
    );
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    const results = await Promise.allSettled([
      Promise.resolve(customTransport.dispose?.()),
      Promise.resolve(coreTransport.dispose?.()),
    ]);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "Chat transport disposal failed.");
    }
  };
  return new Proxy(customTransport, {
    get(target, property) {
      if (property === "persistThreadSnapshot") return persistThreadSnapshot;
      if (property === "dispose") return dispose;
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const cached = boundMethods.get(property);
      if (cached) return cached;
      const bound = value.bind(target);
      boundMethods.set(property, bound);
      return bound;
    },
  });
}

type ThreadRestoreState =
  | { status: "ready" | "loading" }
  | { status: "error"; notFound: boolean };

const THREAD_RESTORE_READY: ThreadRestoreState = { status: "ready" };
const THREAD_RESTORE_LOADING: ThreadRestoreState = { status: "loading" };

type AgentKitInternalSendOptions = AssistantChatSendOptions & {
  recoveryAction?: "continue" | "retry";
  /** The failed run a retry answers; one retry per run. */
  recoveryOfRunId?: string;
  /** The retry is the automatic resend after AI setup; the server allows one per refused run. */
  resumeAfterSetup?: boolean;
  recoveryReferences?: Reference[];
  recoveryModel?: string;
  recoveryEngine?: string;
  recoveryEffort?: string;
  recoveryRequestMode?: "act" | "plan";
  deferredFileParts?: FilePart[];
  deferredRequestAttachments?: AgentRequestAttachment[];
  contextAlreadyIncluded?: boolean;
  pendingSelectionCapturedAt?: number | null;
  skipAmbientSelectionContext?: boolean;
  deferredAgentId?: string | null;
  deferredContextScope?: AgentKitAssistantChatProps["contextScope"] | null;
  deferredSubmissionId?: string;
  /** The deferred send came from app code, whose id the deferral drops. */
  deferredFromApp?: boolean;
};

function isSubmissionExpired(submissionExpiresAt: number | undefined): boolean {
  return (
    submissionExpiresAt !== undefined &&
    (!Number.isFinite(submissionExpiresAt) || submissionExpiresAt <= Date.now())
  );
}

function isSubmissionExpiredError(error: unknown): boolean {
  return asRecord(error)?.code === "submission_expired";
}

interface PendingProviderSubmission {
  id: string;
  threadId: string;
  text: string;
  submissionExpiresAt?: number;
  fileParts: FilePart[];
  requestAttachments?: AgentRequestAttachment[];
  references: Reference[];
  composerOptions: AgentKitSuggestionSubmitOptions;
  options: AgentKitInternalSendOptions;
  attempts?: number;
  failed?: true;
  attachmentRestoreRequired?: true;
  claim?: { token: string; expiresAt: number };
}

interface DeferredProviderSubmissionsState {
  version: typeof DEFERRED_PROVIDER_SUBMISSIONS_VERSION;
  threadId: string;
  submissions: PendingProviderSubmission[];
}

interface PendingSelectionContext {
  text: string;
  capturedAt: number;
}

interface PendingSelectionHydration {
  threadId: string;
  promise: Promise<void>;
  resolve: () => void;
  status: "pending" | "loaded" | "failed";
}

function createPendingSelectionHydration(
  threadId: string,
): PendingSelectionHydration {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { threadId, promise, resolve, status: "pending" };
}

function deferredProviderSubmissionsStateKey(threadId: string): string {
  const encodedThreadId = Array.from(threadId, (character) =>
    character.codePointAt(0)!.toString(16),
  ).join("-");
  return `${DEFERRED_PROVIDER_SUBMISSIONS_KEY_PREFIX}${encodedThreadId}`;
}

function isBase64Payload(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.length > 0 &&
    normalized.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      normalized,
    )
  );
}

function assertNoInlineAttachmentPayload(
  value: unknown,
  path: string,
  imageContext = false,
  active = new WeakSet<object>(),
  fieldName = "",
): void {
  if (typeof value === "string") {
    const payloadField =
      /^(?:base64|bytes|body|data|dataurl|image|payload)$/i.test(fieldName);
    const referenceField = /^(?:preview|referenceUrl|src|thumbnail|url)$/i.test(
      fieldName,
    );
    if (
      isInlineDataUrl(value) &&
      (imageContext ||
        payloadField ||
        fieldName === "preview" ||
        fieldName === "thumbnail")
    ) {
      throw new TypeError(
        `${path}: inline attachment data cannot be persisted in application state.`,
      );
    }
    if (
      (payloadField || (imageContext && referenceField)) &&
      (imageContext || fieldName === "base64") &&
      isBase64Payload(value)
    ) {
      throw new TypeError(
        `${path}: inline image bytes cannot be persisted in application state.`,
      );
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (active.has(value)) {
    throw new TypeError(`${path}: deferred submissions must be JSON data.`);
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        imageContext &&
        /^(?:base64|bytes|data|image|payload|preview|thumbnail)$/i.test(
          fieldName,
        ) &&
        value.length > 0 &&
        value.every(
          (entry) =>
            typeof entry === "number" &&
            Number.isInteger(entry) &&
            entry >= 0 &&
            entry <= 255,
        )
      ) {
        throw new TypeError(
          `${path}: inline image bytes cannot be persisted in application state.`,
        );
      }
      value.forEach((entry, index) =>
        assertNoInlineAttachmentPayload(
          entry,
          `${path}[${index}]`,
          imageContext,
          active,
          fieldName,
        ),
      );
      return;
    }
    if (ArrayBuffer.isView(value) && imageContext) {
      throw new TypeError(
        `${path}: inline image bytes cannot be persisted in application state.`,
      );
    }

    const record = value as Record<string, unknown>;
    const attachmentRecord =
      imageContext ||
      ["document", "file", "image"].includes(
        String(record.type ?? "").toLowerCase(),
      ) ||
      [record.contentType, record.mediaType, record.mimeType].some(
        (mimeType) =>
          typeof mimeType === "string" && /^image\//i.test(mimeType),
      );
    for (const [key, entry] of Object.entries(record)) {
      const isPayloadField = /^(?:base64|bytes|body|data|image|payload)$/i.test(
        key,
      );
      const imagePayloadField =
        isPayloadField && (attachmentRecord || key === "base64");
      if (
        imagePayloadField &&
        typeof entry === "string" &&
        (isInlineDataUrl(entry) || isBase64Payload(entry))
      ) {
        throw new TypeError(
          `${path}.${key}: inline image bytes cannot be persisted in application state.`,
        );
      }
      if (
        (attachmentRecord || key === "preview" || key === "thumbnail") &&
        /^(?:preview|referenceUrl|src|thumbnail|url)$/i.test(key) &&
        typeof entry === "string" &&
        isInlineDataUrl(entry)
      ) {
        throw new TypeError(
          `${path}.${key}: inline attachment data cannot be persisted in application state.`,
        );
      }
      assertNoInlineAttachmentPayload(
        entry,
        `${path}.${key}`,
        attachmentRecord ||
          /^(?:attachment|attachments|file|files|image|images|reference|references|requestAttachments)$/i.test(
            key,
          ),
        active,
        key,
      );
    }
  } finally {
    active.delete(value);
  }
}

function parseDeferredProviderSubmissions(
  value: unknown,
  threadId: string,
): PendingProviderSubmission[] {
  assertNoInlineAttachmentPayload(value, "deferredSubmissions");
  if (value === null) return [];
  const state = asRecord(value);
  if (
    state?.version !== DEFERRED_PROVIDER_SUBMISSIONS_VERSION ||
    state.threadId !== threadId ||
    !Array.isArray(state.submissions)
  ) {
    throw new Error(
      `Deferred AgentKit submissions for ${threadId} have an invalid state shape.`,
    );
  }

  return state.submissions.map((value) => {
    const submission = asRecord(value);
    const fileParts = submission?.fileParts;
    const requestAttachments = submission?.requestAttachments;
    const composerOptions = asRecord(submission?.composerOptions);
    const options = asRecord(submission?.options);
    const claim = asRecord(submission?.claim);
    const deferredFileParts = options?.deferredFileParts;
    const deferredRequestAttachments = options?.deferredRequestAttachments;
    if (
      typeof submission?.id !== "string" ||
      submission.threadId !== threadId ||
      typeof submission.text !== "string" ||
      !Array.isArray(fileParts) ||
      !fileParts.every((part) => {
        const filePart = asRecord(part);
        return (
          filePart?.type === "file" &&
          typeof filePart.name === "string" &&
          !isInlineDataUrl(filePart.url) &&
          filePart.data === undefined &&
          (isDurableAttachmentUrl(filePart.url) ||
            (typeof filePart.fileId === "string" &&
              filePart.fileId.trim().length > 0 &&
              !isInlineDataUrl(filePart.fileId)))
        );
      }) ||
      (requestAttachments !== undefined &&
        (!Array.isArray(requestAttachments) ||
          !requestAttachments.every((attachment) => {
            const requestAttachment = asRecord(attachment);
            const durableUrl =
              requestAttachment &&
              (isDurableAttachmentUrl(requestAttachment.url)
                ? requestAttachment.url
                : isDurableAttachmentUrl(requestAttachment.referenceUrl)
                  ? requestAttachment.referenceUrl
                  : undefined);
            return (
              requestAttachment?.type === "image" &&
              typeof requestAttachment.name === "string" &&
              typeof durableUrl === "string" &&
              requestAttachment.data === undefined
            );
          }))) ||
      (deferredFileParts !== undefined &&
        (!Array.isArray(deferredFileParts) ||
          !deferredFileParts.every((part) => {
            const filePart = asRecord(part);
            return (
              filePart?.type === "file" &&
              typeof filePart.name === "string" &&
              !isInlineDataUrl(filePart.url) &&
              filePart.data === undefined &&
              (isDurableAttachmentUrl(filePart.url) ||
                (typeof filePart.fileId === "string" &&
                  filePart.fileId.trim().length > 0 &&
                  !isInlineDataUrl(filePart.fileId)))
            );
          }))) ||
      (deferredRequestAttachments !== undefined &&
        (!Array.isArray(deferredRequestAttachments) ||
          !deferredRequestAttachments.every((attachment) => {
            const requestAttachment = asRecord(attachment);
            const durableUrl =
              requestAttachment &&
              (isDurableAttachmentUrl(requestAttachment.url)
                ? requestAttachment.url
                : isDurableAttachmentUrl(requestAttachment.referenceUrl)
                  ? requestAttachment.referenceUrl
                  : undefined);
            return (
              requestAttachment?.type === "image" &&
              typeof requestAttachment.name === "string" &&
              typeof durableUrl === "string" &&
              requestAttachment.data === undefined
            );
          }))) ||
      !Array.isArray(submission.references) ||
      !composerOptions ||
      !options ||
      (submission.submissionExpiresAt !== undefined &&
        (typeof submission.submissionExpiresAt !== "number" ||
          !Number.isFinite(submission.submissionExpiresAt))) ||
      (submission.attempts !== undefined &&
        (!Number.isSafeInteger(submission.attempts) ||
          (submission.attempts as number) < 0)) ||
      (submission.failed !== undefined && submission.failed !== true) ||
      (submission.attachmentRestoreRequired !== undefined &&
        submission.attachmentRestoreRequired !== true) ||
      (submission.claim !== undefined &&
        (typeof claim?.token !== "string" ||
          typeof claim.expiresAt !== "number" ||
          !Number.isFinite(claim.expiresAt)))
    ) {
      throw new Error(
        `Deferred AgentKit submission for ${threadId} is incomplete.`,
      );
    }
    return {
      id: submission.id,
      threadId,
      text: submission.text,
      ...(typeof submission.submissionExpiresAt === "number"
        ? { submissionExpiresAt: submission.submissionExpiresAt }
        : {}),
      fileParts: fileParts as FilePart[],
      ...(Array.isArray(requestAttachments)
        ? {
            requestAttachments: requestAttachments as AgentRequestAttachment[],
          }
        : {}),
      references: submission.references as Reference[],
      composerOptions: composerOptions as AgentKitSuggestionSubmitOptions,
      options: options as AgentKitInternalSendOptions,
      ...(typeof submission.attempts === "number"
        ? { attempts: submission.attempts }
        : {}),
      ...(submission.failed === true ? { failed: true as const } : {}),
      ...(submission.attachmentRestoreRequired === true
        ? { attachmentRestoreRequired: true as const }
        : {}),
      ...(claim
        ? {
            claim: {
              token: claim.token as string,
              expiresAt: claim.expiresAt as number,
            },
          }
        : {}),
    };
  });
}

function legacyDurableFileParts(value: unknown): FilePart[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const part = asRecord(entry);
    if (part?.type !== "file" || typeof part.name !== "string") return [];
    const url = isDurableAttachmentUrl(part.url) ? part.url : undefined;
    const fileId =
      typeof part.fileId === "string" &&
      part.fileId.trim() &&
      !isInlineDataUrl(part.fileId)
        ? part.fileId
        : undefined;
    if (!url && !fileId) return [];
    return [
      {
        ...part,
        ...(url ? { url } : {}),
        ...(fileId ? { fileId } : {}),
      } as FilePart,
    ];
  });
}

function legacyDurableRequestAttachments(
  value: unknown,
): AgentRequestAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const attachment = asRecord(entry);
    if (attachment?.type !== "image" || typeof attachment.name !== "string") {
      return [];
    }
    const url = isDurableAttachmentUrl(attachment.url)
      ? attachment.url
      : isDurableAttachmentUrl(attachment.referenceUrl)
        ? attachment.referenceUrl
        : undefined;
    return url ? [{ ...attachment, url } as AgentRequestAttachment] : [];
  });
}

function containsDeferredInlinePayload(value: unknown): boolean {
  try {
    assertNoInlineAttachmentPayload(value, "deferredSubmissions");
    return false;
  } catch (error) {
    if (
      error instanceof TypeError &&
      /inline (?:attachment data|image bytes)/i.test(error.message)
    ) {
      return true;
    }
    throw error;
  }
}

function hasDurableReferenceRecovery(
  reference: unknown,
  retainedAttachments: unknown[],
): boolean {
  const record = asRecord(reference);
  if (!record) return false;
  const metadata = asRecord(record.metadata);
  if (
    [
      record.url,
      record.referenceUrl,
      metadata?.url,
      metadata?.referenceUrl,
    ].some(isDurableAttachmentUrl)
  ) {
    return true;
  }

  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) return false;
  return retainedAttachments.some((value) => {
    const attachment = asRecord(value);
    if (
      !attachment ||
      typeof attachment.name !== "string" ||
      attachment.name.trim().toLowerCase() !== name.toLowerCase()
    ) {
      return false;
    }
    const isImage =
      attachment.type === "image" ||
      [attachment.mediaType, attachment.contentType, attachment.mimeType].some(
        (type) => typeof type === "string" && /^image\//i.test(type),
      );
    const hasDurableLocation =
      isDurableAttachmentUrl(attachment.url) ||
      (typeof attachment.fileId === "string" &&
        attachment.fileId.trim().length > 0 &&
        !isInlineDataUrl(attachment.fileId));
    return isImage && hasDurableLocation;
  });
}

function hasLostInlineReferencePayload(
  value: unknown,
  retainedAttachments: unknown[],
): boolean {
  const references = Array.isArray(value) ? value : [value];
  return references.some(
    (reference) =>
      containsDeferredInlinePayload(reference) &&
      !hasDurableReferenceRecovery(reference, retainedAttachments),
  );
}

function sanitizeLegacyDeferredProviderState(
  value: unknown,
  threadId: string,
): DeferredProviderSubmissionsState | null {
  if (value === null) return null;
  const state = asRecord(value);
  if (
    state?.version !== DEFERRED_PROVIDER_SUBMISSIONS_VERSION ||
    state.threadId !== threadId ||
    !Array.isArray(state.submissions)
  ) {
    throw new Error(
      `Deferred AgentKit submissions for ${threadId} have an invalid state shape.`,
    );
  }

  const submissions = state.submissions.map((entry) => {
    if (!containsDeferredInlinePayload(entry))
      return entry as PendingProviderSubmission;
    const submission = asRecord(entry);
    if (!submission) return entry as PendingProviderSubmission;
    const cleaned = stripInlineAttachmentPayloads(submission) as Record<
      string,
      unknown
    >;
    const rawOptions = asRecord(cleaned.options) ?? {};
    const originalOptions = asRecord(submission.options) ?? {};
    const rawAttachments = submission.requestAttachments;
    const rawFileParts = submission.fileParts;
    const requestAttachments = legacyDurableRequestAttachments(rawAttachments);
    const fileParts = legacyDurableFileParts(rawFileParts);
    const options = { ...rawOptions };
    if (rawOptions.deferredRequestAttachments !== undefined) {
      options.deferredRequestAttachments = legacyDurableRequestAttachments(
        rawOptions.deferredRequestAttachments,
      );
    }
    if (rawOptions.deferredFileParts !== undefined) {
      options.deferredFileParts = legacyDurableFileParts(
        rawOptions.deferredFileParts,
      );
    }
    const lostRequestAttachment =
      Array.isArray(rawAttachments) &&
      rawAttachments.some(
        (attachment) =>
          containsDeferredInlinePayload(attachment) &&
          legacyDurableRequestAttachments([attachment]).length === 0,
      );
    const lostFilePart =
      Array.isArray(rawFileParts) &&
      rawFileParts.some(
        (part) =>
          containsDeferredInlinePayload(part) &&
          legacyDurableFileParts([part]).length === 0,
      );
    const lostDeferredRequestAttachment =
      originalOptions.deferredRequestAttachments !== undefined &&
      (Array.isArray(originalOptions.deferredRequestAttachments)
        ? originalOptions.deferredRequestAttachments.some(
            (attachment) =>
              containsDeferredInlinePayload(attachment) &&
              legacyDurableRequestAttachments([attachment]).length === 0,
          )
        : containsDeferredInlinePayload(
            originalOptions.deferredRequestAttachments,
          ));
    const lostDeferredFilePart =
      originalOptions.deferredFileParts !== undefined &&
      (Array.isArray(originalOptions.deferredFileParts)
        ? originalOptions.deferredFileParts.some(
            (part) =>
              containsDeferredInlinePayload(part) &&
              legacyDurableFileParts([part]).length === 0,
          )
        : containsDeferredInlinePayload(originalOptions.deferredFileParts));
    const retainedAttachments = [
      ...fileParts,
      ...requestAttachments,
      ...(Array.isArray(options.deferredFileParts)
        ? options.deferredFileParts
        : []),
      ...(Array.isArray(options.deferredRequestAttachments)
        ? options.deferredRequestAttachments
        : []),
    ];
    const lostReferencePayload = hasLostInlineReferencePayload(
      submission.references,
      retainedAttachments,
    );
    const lostComposerPayload = containsDeferredInlinePayload(
      submission.composerOptions,
    );
    const unrelatedOptions = { ...originalOptions };
    delete unrelatedOptions.deferredFileParts;
    delete unrelatedOptions.deferredRequestAttachments;
    const lostOtherOptionsPayload =
      containsDeferredInlinePayload(unrelatedOptions);
    for (const [key, value] of Object.entries(unrelatedOptions)) {
      if (containsDeferredInlinePayload(value)) delete options[key];
    }
    const { claim: _claim, ...withoutClaim } = cleaned;
    return {
      ...withoutClaim,
      fileParts,
      requestAttachments,
      options,
      ...(lostRequestAttachment ||
      lostFilePart ||
      lostDeferredRequestAttachment ||
      lostDeferredFilePart ||
      lostReferencePayload ||
      lostComposerPayload ||
      lostOtherOptionsPayload
        ? { failed: true as const, attachmentRestoreRequired: true as const }
        : {}),
    } as unknown as PendingProviderSubmission;
  });
  return submissions.length > 0
    ? {
        version: DEFERRED_PROVIDER_SUBMISSIONS_VERSION,
        threadId,
        submissions,
      }
    : null;
}

function runDeferredProviderSubmissionStateOperation<T>(
  threadId: string,
  operation: (stateKey: string) => Promise<T> | T,
): Promise<T> {
  const stateKey = deferredProviderSubmissionsStateKey(threadId);
  const previous = deferredProviderSubmissionOperations.get(stateKey);
  const next = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => operation(stateKey));
  deferredProviderSubmissionOperations.set(stateKey, next);
  const clearOperation = () => {
    if (deferredProviderSubmissionOperations.get(stateKey) === next) {
      deferredProviderSubmissionOperations.delete(stateKey);
    }
  };
  void next.then(clearOperation, clearOperation);
  return next;
}

function readDeferredProviderSubmissions(
  threadId: string,
): Promise<PendingProviderSubmission[]> {
  return runDeferredProviderSubmissionStateOperation(
    threadId,
    async (stateKey) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const persisted = await readClientAppState<unknown>(stateKey);
        try {
          return parseDeferredProviderSubmissions(persisted, threadId);
        } catch (error) {
          if (!containsDeferredInlinePayload(persisted)) throw error;
          const expected = persisted === null ? null : asRecord(persisted);
          if (expected === undefined) throw error;
          const sanitized = sanitizeLegacyDeferredProviderState(
            persisted,
            threadId,
          );
          const next = sanitized as Record<string, unknown> | null;
          parseDeferredProviderSubmissions(sanitized, threadId);
          if (
            await compareAndSetClientAppState(stateKey, expected, next, {
              requestSource: "agentkit-deferred-legacy-cleanup",
            })
          ) {
            return parseDeferredProviderSubmissions(sanitized, threadId);
          }
        }
      }
      throw new Error(
        `Deferred AgentKit submissions for ${threadId} changed repeatedly during cleanup.`,
      );
    },
  );
}

export async function updateDeferredProviderSubmissions(
  threadId: string,
  update: (
    submissions: PendingProviderSubmission[],
  ) => PendingProviderSubmission[],
): Promise<PendingProviderSubmission[]> {
  await readDeferredProviderSubmissions(threadId);
  return runDeferredProviderSubmissionStateOperation(
    threadId,
    async (stateKey) => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const persisted = await readClientAppState<unknown>(stateKey);
        const current = parseDeferredProviderSubmissions(persisted, threadId);
        const submissions = update(current);
        parseDeferredProviderSubmissions(
          submissions.length > 0
            ? {
                version: DEFERRED_PROVIDER_SUBMISSIONS_VERSION,
                threadId,
                submissions,
              }
            : null,
          threadId,
        );
        if (JSON.stringify(submissions) === JSON.stringify(current)) {
          return current;
        }
        const next: DeferredProviderSubmissionsState | null =
          submissions.length > 0
            ? {
                version: DEFERRED_PROVIDER_SUBMISSIONS_VERSION,
                threadId,
                submissions,
              }
            : null;
        const expected = persisted === null ? null : asRecord(persisted);
        if (expected === undefined) {
          throw new Error(
            `Deferred AgentKit submissions for ${threadId} have an invalid state shape.`,
          );
        }
        if (
          await compareAndSetClientAppState(
            stateKey,
            expected,
            next as Record<string, unknown> | null,
            { requestSource: "agentkit-deferred-submit" },
          )
        ) {
          return submissions;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 10));
      }
      throw new Error(
        `Deferred AgentKit submissions for ${threadId} changed too often to update safely.`,
      );
    },
  );
}

function isRetryableDeferredProviderSubmissionError(error: unknown): boolean {
  const record = asRecord(error);
  if (typeof record?.retryable === "boolean") return record.retryable;
  if (typeof record?.status === "number") {
    return (
      record.status === 408 ||
      record.status === 425 ||
      record.status === 429 ||
      record.status >= 500
    );
  }
  return error instanceof TypeError || record?.name === "AbortError";
}

type AgentKitComposerSubmit = (
  text: string,
  files: PromptComposerFile[],
  references: Reference[],
  options: AgentKitSuggestionSubmitOptions,
  prepare?: () => Promise<PromptComposerSubmitOptions>,
) => Promise<void>;

type AgentKitSuggestionSubmitOptions = PromptComposerSubmitOptions & {
  suggestion?: Exclude<AgentSuggestionInput, string>;
  validateSubmission?: () => void;
  validateSubmissionScope?: () => void;
  queuedWhileRunActive?: boolean;
};

function preserveQueuedIntent(
  preparedOptions: PromptComposerSubmitOptions,
  originalOptions: PromptComposerSubmitOptions,
): PromptComposerSubmitOptions {
  return {
    ...preparedOptions,
    ...(originalOptions.intent === "queued" ? { intent: "queued" } : {}),
    ...(originalOptions.steer ? { steer: true } : {}),
  };
}

function captureQueuedRunState(
  options: PromptComposerSubmitOptions,
  runWasActive: boolean,
): AgentKitSuggestionSubmitOptions {
  return {
    ...options,
    ...(options.intent === "queued" && runWasActive
      ? { queuedWhileRunActive: true }
      : {}),
  };
}

type AgentKitSuggestionSubmitRef = React.MutableRefObject<{
  threadId: string;
  submit: (suggestion: AgentSuggestionInput) => Promise<void>;
} | null>;

interface AgentKitSurfaceContextValue {
  props: AgentKitAssistantChatProps;
  handoffSnapshot: AgentThreadSnapshot | null;
  hasRenderedMessages: boolean;
  canChat: boolean;
  setupMissing: boolean;
  /** Only the server's readiness answer, never the model list's early guess. */
  setupConfirmedMissing: boolean;
  providerStatus: AgentEngineConfiguredState;
  modelListUnavailable: boolean;
  retryProviderStatus: () => void;
  retryModelList?: () => void;
  fileStorageConfigured: boolean;
  fileStorageMissing: boolean;
  retryFileStorageStatus: () => void;
  deferredSubmissionFailed: boolean;
  deferredSubmissionRequiresAttachment: boolean;
  retryDeferredSubmission: () => Promise<void>;
  dismissDeferredSubmission: () => Promise<void>;
  isRunning: boolean;
  isRestoring: boolean;
  threadRestore:
    | { status: "ready" | "loading" }
    | { status: "error"; notFound: boolean };
  retryThreadRestore: () => void;
  authError: { sessionExpired?: boolean } | null;
  authSessionAvailable: boolean;
  setupBouncePulse: number;
  bounceSetupCard: () => void;
  onComposerSetupRequiredChange: (required: boolean) => void;
  isSubmissionInFlight: boolean;
  composerSubmissionPending: boolean;
  onComposerSubmissionPendingChange: (pending: boolean) => void;
  isThinkingVisibleInTranscript: boolean;
  contextItems: AgentChatContextItem[];
  providerContextItems: { current: readonly AgentChatContextItem[] };
  suggestions: AgentSuggestionInput[];
  showSuggestions: boolean;
  /** A sent user message is showing before the agent client appended it. */
  pendingSubmissionVisible: boolean;
  selectionLength: number | null;
  prefillRevision: number;
  text: string;
  onTextChange: (text: string) => void;
  onRemoveContextItem: (key: string) => void;
  onClearSelection: () => void;
  onSubmit: AgentKitComposerSubmit;
  sendMessage: (
    text: string,
    images?: string[],
    options?: AssistantChatSendOptions,
  ) => Promise<AssistantChatSubmitResult>;
  sendRecoveryMessage: (
    text: string,
    recoveryAction: "continue" | "retry",
    images?: string[],
    fileParts?: FilePart[],
    references?: Reference[],
    recoveryOptions?: Pick<
      AgentKitInternalSendOptions,
      | "recoveryModel"
      | "recoveryEngine"
      | "recoveryEffort"
      | "recoveryRequestMode"
      | "recoveryOfRunId"
      | "resumeAfterSetup"
      | "deferredRequestAttachments"
    >,
  ) => Promise<AssistantChatSubmitResult>;
  submitSuggestion: (suggestion: AgentSuggestionInput) => void;
  suggestionSubmitRef: AgentKitSuggestionSubmitRef;
  /** Prompts already sent again after AI setup, shared by every card in this chat. */
  resumedAfterSetup: Set<string>;
  onImplementPlan: () => boolean;
}

const AgentKitSurfaceContext =
  createContext<AgentKitSurfaceContextValue | null>(null);

function useAgentKitSurface() {
  const value = React.useContext(AgentKitSurfaceContext);
  if (!value) throw new Error("AgentKit chat surface context is missing.");
  return value;
}

const agentKitSlots = {
  composer: AgentKitComposerSlot,
  // Core owns suggestion placement across the transcript and empty states.
  suggestions: () => null,
  emptyState: AgentKitAssistantEmptyState,
  // The transcript renders its own not-found and load-failure states with Retry.
  threadUnavailable: () => null,
  transcript: AgentKitTranscript,
  message: AgentKitUserMessage,
  messageSupplement: AgentKitMessageSupplement,
  messageActionsTrailing: AgentKitHistoryMessageSupplement,
  text: AgentKitMarkdownText,
  tool: AgentKitTool,
  connectionRequest: AgentKitConnectionRequest,
  runFailure: AgentKitRunFailure,
  connectionError: AgentKitConnectionError,
  approval: AgentKitApproval,
  reasoning: AgentKitReasoning,
};

const agentKitRegistry = {
  toolSource: resolveAgentKitToolSource,
  tools: {
    "connect-builder": AgentKitTool,
    "connect-file-storage": AgentKitTool,
  },
  agentInteractions: {
    failed: AgentKitFailedInteraction,
  },
};

export const AgentKitAssistantChat = forwardRef<
  AssistantChatHandle,
  AgentKitAssistantChatProps
>(function AgentKitAssistantChat(props, ref) {
  if ((props as { createAdapter?: unknown }).createAdapter !== undefined) {
    throw new Error(
      `AssistantChat's createAdapter prop was removed. Pass runtime or createTransport instead. Migration guide: ${AGENTKIT_CHAT_MIGRATION_GUIDE_URL}`,
    );
  }
  const t = useT();
  const translatorRef = useRef(t);
  translatorRef.current = t;
  const { formatDate } = useFormatters();
  const threadId = props.threadId ?? props.tabId;
  if (!threadId) {
    throw new Error("AgentKit chat requires a stable thread or tab id.");
  }
  const handoffSnapshot =
    props.createTransport || props.runtime
      ? null
      : readAgentKitThreadHandoffSnapshot(
          createAgentKitThreadHandoffKey(props, threadId),
        );
  const [manualLoadThreadId, setManualLoadThreadId] = useState<string | null>(
    () => (props.isNewThread ? threadId : null),
  );
  const hasManualLoadForCurrentThread =
    props.isNewThread || manualLoadThreadId === threadId;
  const restoreInputKey = [
    threadId,
    props.isThreadStateLoading ? "loading" : "settled",
    hasManualLoadForCurrentThread ? "manual" : "auto",
    props.isNewThread ? "new" : "existing",
  ].join("\u0000");
  const restoreInputKeyRef = useRef(restoreInputKey);
  restoreInputKeyRef.current = restoreInputKey;
  // Keyed by the restore inputs so the first commit after a thread switch
  // already reads "loading"; an effect-driven reset would paint one frame of
  // the previous thread's "ready" state as an empty new chat.
  const [storedThreadRestore, setStoredThreadRestore] = useState<{
    key: string;
    state: ThreadRestoreState;
  } | null>(null);
  if (storedThreadRestore && storedThreadRestore.key !== restoreInputKey) {
    setStoredThreadRestore(null);
  }
  const threadRestore: ThreadRestoreState =
    storedThreadRestore?.key === restoreInputKey
      ? storedThreadRestore.state
      : props.isThreadStateLoading || !hasManualLoadForCurrentThread
        ? THREAD_RESTORE_LOADING
        : THREAD_RESTORE_READY;
  const setThreadRestore = useCallback((state: ThreadRestoreState) => {
    const key = restoreInputKeyRef.current;
    setStoredThreadRestore((current) =>
      current?.key === key &&
      current.state.status === state.status &&
      (state.status !== "error" ||
        (current.state.status === "error" &&
          current.state.notFound === state.notFound))
        ? current
        : { key, state },
    );
  }, []);
  const [restoreRetryLoadPhase, setRestoreRetryLoadPhase] = useState<
    "idle" | "release" | "reopen"
  >("idle");
  const [restoreRetryThreadId, setRestoreRetryThreadId] = useState<
    string | null
  >(null);
  const notifiedMissingThreadsRef = useRef(new Set<string>());
  const onThreadRestoreLoaded = useCallback(() => {
    setThreadRestore(THREAD_RESTORE_READY);
    setRestoreRetryLoadPhase("idle");
    setRestoreRetryThreadId(null);
  }, [setThreadRestore]);
  useEffect(() => {
    setManualLoadThreadId((current) =>
      props.isNewThread ? threadId : current === threadId ? current : null,
    );
  }, [props.isNewThread, threadId]);
  const onThreadRestoreLoadError = useCallback(
    (error: unknown) => {
      const record = asRecord(error);
      const response = asRecord(record?.response);
      const status = record?.status ?? record?.statusCode ?? response?.status;
      const code =
        typeof record?.code === "string" ? record.code.toLowerCase() : "";
      const notFound =
        status === 404 || code === "not_found" || code === "http_404";
      setThreadRestore({ status: "error", notFound });
      if (
        notFound &&
        props.onThreadRestoreNotFound &&
        !notifiedMissingThreadsRef.current.has(threadId)
      ) {
        notifiedMissingThreadsRef.current.add(threadId);
        props.onThreadRestoreNotFound();
      }
    },
    [props.onThreadRestoreNotFound, setThreadRestore, threadId],
  );
  const retryThreadRestore = useCallback(() => {
    if (props.isNewThread) return;
    setThreadRestore(THREAD_RESTORE_LOADING);
    setRestoreRetryThreadId(threadId);
    setRestoreRetryLoadPhase("release");
  }, [props.isNewThread, setThreadRestore, threadId]);
  useEffect(() => {
    if (
      restoreRetryLoadPhase !== "release" ||
      restoreRetryThreadId !== threadId
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setRestoreRetryLoadPhase("reopen");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [restoreRetryLoadPhase, restoreRetryThreadId, threadId]);
  const labels = useMemo(
    () => ({
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
      durationHourShort: t("agentChat.duration.hourShort"),
      durationMinuteShort: t("agentChat.duration.minuteShort"),
      durationSecondShort: t("agentChat.duration.secondShort"),
      composerLabel: t("agentChat.composer.messageAgent"),
      composerPlaceholder:
        props.composerPlaceholder || t("agentChat.composer.newChatPlaceholder"),
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
      usageMixedBuilderCredits: t(
        "agentChat.message.usageMixedBuilderCredits",
        { amount: "{{amount}}" },
      ),
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
    }),
    [formatDate, props.composerPlaceholder, t],
  );
  const uploadedFilesRef = useRef(new Map<string, FilePart>());
  const upload: AgentKitUploadDriver = useCallback(
    async (target, file, context) => {
      if (file.size > AGENT_CHAT_UPLOAD_MAX_FILE_BYTES) {
        throw attachmentTooLargeError(
          uploadTooLargeMessage(translatorRef.current),
        );
      }
      const form = new FormData();
      for (const [key, value] of Object.entries(target.fields ?? {})) {
        form.set(key, value);
      }
      form.set("file", file.body, file.name);
      let response: Response;
      try {
        response = await fetch(target.url, {
          method: target.method,
          headers: target.headers,
          body: form,
          signal: context?.signal,
        });
      } catch (error) {
        if (context?.signal?.aborted) throw error;
        throw Object.assign(
          new Error(translatorRef.current("agentChat.composer.uploadOffline")),
          { code: "upload_network_error", retryable: true, cause: error },
        );
      }
      // The server's error body is never shown: its text is untranslated.
      if (!response.ok) {
        throw uploadHttpError(response.status, translatorRef.current);
      }
      const result: unknown = await response.json();
      const uploaded = asRecord(result);
      if (typeof uploaded?.url !== "string" || !uploaded.url) {
        throw Object.assign(
          new Error(translatorRef.current("agentChat.composer.uploadFailed")),
          { code: "upload_invalid_response", retryable: false },
        );
      }
      uploadedFilesRef.current.set(target.uploadId, {
        type: "file",
        name: file.name,
        mediaType: file.mediaType,
        url: uploaded.url,
        ...(typeof uploaded.id === "string" ? { fileId: uploaded.id } : {}),
      });
    },
    [],
  );
  const transportThreadIdRef = useRef(threadId);
  const tabIdRef = useRef(props.tabId);
  const modelRef = useRef<string | undefined>(props.selectedModel);
  const engineRef = useRef<string | undefined>(props.selectedEngine);
  const effortRef = useRef<AssistantChatAdapterContext["effortRef"]["current"]>(
    props.selectedEffort,
  );
  const harnessRef = useRef<string | undefined>(
    props.hostedHarness ? props.selectedAgent : undefined,
  );
  const hostedHarnessRef = useRef(props.hostedHarness === true);
  const scopeRef = useRef<AssistantChatAdapterContext["scopeRef"]["current"]>(
    props.contextScope,
  );
  const isolateHistoryByScopeRef = useRef(props.isolateHistoryByScope);
  const createTransportRef = useRef(props.createTransport);
  const injectedRuntimeRef = useRef(props.runtime);
  const adapterReloadKeyRef = useRef(props.adapterReloadKey);
  transportThreadIdRef.current = threadId;
  tabIdRef.current = props.tabId;
  if (adapterReloadKeyRef.current !== props.adapterReloadKey) {
    adapterReloadKeyRef.current = props.adapterReloadKey;
    injectedRuntimeRef.current = props.runtime;
  }
  modelRef.current = props.selectedModel;
  engineRef.current = props.selectedEngine;
  effortRef.current = props.selectedEffort;
  harnessRef.current = props.hostedHarness ? props.selectedAgent : undefined;
  hostedHarnessRef.current = props.hostedHarness === true;
  scopeRef.current = props.contextScope;
  isolateHistoryByScopeRef.current = props.isolateHistoryByScope;
  createTransportRef.current = props.createTransport;
  const autoContinueLabelRef = useRef("");
  autoContinueLabelRef.current = t("agentChat.status.resuming");
  const transport = useMemo(() => {
    const operations: NonNullable<
      CreateAgentNativeAgentKitTransportOptions["operations"]
    > = {
      createUpload: async () =>
        ({
          uploadId: createAgentUploadId(),
          method: "POST",
          url: agentNativePath("/_agent-native/file-upload"),
          fields: {},
        }) satisfies AgentUploadTarget,
      completeUpload: async ({ uploadId }) => {
        const uploaded = uploadedFilesRef.current.get(uploadId);
        if (!uploaded) {
          throw new Error(`Upload ${uploadId} did not complete.`);
        }
        uploadedFilesRef.current.delete(uploadId);
        return uploaded;
      },
      invokeAction: async ({ invocation }) => {
        try {
          const result = await callAction(
            invocation.action,
            asRecord(invocation.payload) ?? {},
          );
          return {
            invocationId: invocation.id,
            status: "completed",
            data: result,
            ...(invocation.metadata ? { metadata: invocation.metadata } : {}),
          } satisfies AgentActionResult;
        } catch (error) {
          const errorRecord = asRecord(error);
          return {
            invocationId: invocation.id,
            status: "failed",
            error: {
              code:
                typeof errorRecord?.code === "string"
                  ? errorRecord.code
                  : "action_failed",
              message: error instanceof Error ? error.message : String(error),
            },
            ...(invocation.metadata ? { metadata: invocation.metadata } : {}),
          } satisfies AgentActionResult;
        }
      },
    };
    const surface =
      props.agentChatSurface === "dev-frame"
        ? "dev-frame"
        : props.agentChatSurface === "desktop"
          ? "desktop"
          : "app";
    const apiUrl = props.apiUrl ?? agentNativePath("/_agent-native/agent-chat");
    const adapterContext: AssistantChatAdapterContext = {
      apiUrl,
      streamingUrl: props.streamingUrl,
      tabId: props.tabId,
      threadId,
      modelRef,
      engineRef,
      effortRef,
      harnessRef,
      hostedHarnessRef,
      browserTabId: props.browserTabId,
      scopeRef,
      surface,
    };
    const persistenceKeyForThread = (persistedThreadId: string) =>
      createAgentKitThreadHandoffKey(
        {
          apiUrl,
          browserTabId: props.browserTabId,
          contextScope: scopeRef.current,
        },
        persistedThreadId,
      );
    const customTransport = createTransportRef.current;
    if (customTransport) {
      const persistenceTransport = createAgentNativeAgentKitTransport({
        apiUrl,
        browserTabId: props.browserTabId,
        get threadId() {
          return transportThreadIdRef.current;
        },
        surface,
        get scope() {
          return scopeRef.current;
        },
        get isolateHistoryByScope() {
          return isolateHistoryByScopeRef.current;
        },
        adapter: { textFormat: "markdown" },
      });
      return withCoreSnapshotPersistence(
        customTransport(adapterContext),
        persistenceTransport,
        persistenceKeyForThread,
      );
    }
    const runtimeOptions: CreateAgentNativeChatRuntimeOptions = {
      apiUrl: props.apiUrl ?? agentNativePath("/_agent-native/agent-chat"),
      streamingUrl: props.streamingUrl,
      browserTabId: props.browserTabId,
      get threadId() {
        return transportThreadIdRef.current;
      },
      surface,
      get model() {
        return modelRef.current;
      },
      get engine() {
        return engineRef.current;
      },
      get effort() {
        return effortRef.current;
      },
      get scope() {
        return scopeRef.current;
      },
    };
    const builtTransport = withSerializedThreadSnapshotPersistence(
      createAgentNativeAgentKitTransport({
        apiUrl: props.apiUrl ?? agentNativePath("/_agent-native/agent-chat"),
        runtime:
          injectedRuntimeRef.current ??
          createAgentNativeChatRuntime(runtimeOptions, {
            onTurnSubmitted: trackTurnSubmitted,
          }),
        browserTabId: props.browserTabId,
        get threadId() {
          return transportThreadIdRef.current;
        },
        surface,
        get scope() {
          return scopeRef.current;
        },
        get isolateHistoryByScope() {
          return isolateHistoryByScopeRef.current;
        },
        adapter: {
          textFormat: "markdown",
          get autoContinueLabel() {
            return autoContinueLabelRef.current;
          },
        },
        operations,
      }),
      persistenceKeyForThread,
    );
    const getThreadSnapshot = builtTransport.getThreadSnapshot;
    if (!getThreadSnapshot || injectedRuntimeRef.current) return builtTransport;
    return {
      ...builtTransport,
      getThreadSnapshot: async (input, context) => {
        const handoff = readAgentKitThreadHandoffSnapshot(
          createAgentKitThreadHandoffKey(
            {
              apiUrl: props.apiUrl,
              browserTabId: props.browserTabId,
              contextScope: scopeRef.current,
            },
            input.threadId,
          ),
          true,
        );
        return handoff ?? getThreadSnapshot(input, context);
      },
    };
  }, [
    props.adapterReloadKey,
    props.agentChatSurface,
    props.apiUrl,
    props.browserTabId,
    props.createTransport,
    props.streamingUrl,
    props.tabId,
    props.createTransport ? threadId : undefined,
  ]);
  const agentKitLoad =
    props.isThreadStateLoading ||
    hasManualLoadForCurrentThread ||
    (restoreRetryThreadId === threadId && restoreRetryLoadPhase === "release")
      ? "manual"
      : "auto";
  const getThreadSnapshot = useCallback(
    async (requestedThreadId: string) =>
      (await transport.getThreadSnapshot?.({ threadId: requestedThreadId })) ??
      null,
    [transport],
  );
  const history = props.chatHistory as
    | AgentKitHistoryConfig<unknown, any, any>
    | undefined;
  const clientOptions = useMemo(
    () => ({
      transportOwnership: "owned" as const,
      retainActiveRunsOnThreadRelease: true,
      onIntegrityReport: reportIntegrity,
      upload,
    }),
    [upload],
  );
  const slots = useMemo(
    () =>
      props.workedForSummarySlot
        ? { ...agentKitSlots, workedForSummary: props.workedForSummarySlot }
        : agentKitSlots,
    [props.workedForSummarySlot],
  );
  const onForkedThread = props.onForkedThread;
  const onThreadForked = useCallback(
    (thread: { id: string }) => onForkedThread?.(thread.id),
    [onForkedThread],
  );

  return (
    <ThinkingDisplayProvider value={props.thinkingDisplay}>
      <CoreComposerRuntimeProvider>
        <CoreAgentKitRoot
          transport={transport}
          clientOptions={clientOptions}
          threadId={threadId}
          load={agentKitLoad}
          onLoadError={onThreadRestoreLoadError}
          slots={slots}
          registry={agentKitRegistry}
          labels={labels}
          resolveMessageContentOrder={props.resolveMessageContentOrder}
          branchNavigation={props.branchNavigation}
          buildFeedbackReport={formatFeedbackReport}
          workedForRowLayout={props.workedForRowLayout}
          dataChartLayout={props.dataChartLayout}
          formatWorkedForDuration={props.formatWorkedForDuration}
          onThreadForked={onThreadForked}
          onCopyMessage={copyAgentKitMessage}
          onClientEffect={dispatchAgentKitClientEffect}
        >
          {history ? (
            <AgentKitHistoryProvider history={history}>
              <AgentKitDevCheckpointProvider
                apiUrl={
                  props.apiUrl ?? agentNativePath("/_agent-native/agent-chat")
                }
              >
                <AgentKitAssistantChatBody
                  {...props}
                  threadId={threadId}
                  handoffSnapshot={handoffSnapshot}
                  getThreadSnapshot={getThreadSnapshot}
                  threadRestore={threadRestore}
                  retryThreadRestore={retryThreadRestore}
                  onThreadRestoreLoaded={onThreadRestoreLoaded}
                  ref={ref}
                />
              </AgentKitDevCheckpointProvider>
            </AgentKitHistoryProvider>
          ) : (
            <AgentKitDevCheckpointProvider
              apiUrl={
                props.apiUrl ?? agentNativePath("/_agent-native/agent-chat")
              }
            >
              <AgentKitAssistantChatBody
                {...props}
                threadId={threadId}
                handoffSnapshot={handoffSnapshot}
                getThreadSnapshot={getThreadSnapshot}
                threadRestore={threadRestore}
                retryThreadRestore={retryThreadRestore}
                onThreadRestoreLoaded={onThreadRestoreLoaded}
                ref={ref}
              />
            </AgentKitDevCheckpointProvider>
          )}
        </CoreAgentKitRoot>
      </CoreComposerRuntimeProvider>
    </ThinkingDisplayProvider>
  );
});

const AgentKitAssistantChatBody = forwardRef<
  AssistantChatHandle,
  AgentKitAssistantChatProps & {
    threadId: string;
    handoffSnapshot: AgentThreadSnapshot | null;
    getThreadSnapshot: (
      threadId: string,
    ) => Promise<AgentThreadSnapshot | null>;
    threadRestore: ThreadRestoreState;
    retryThreadRestore: () => void;
    onThreadRestoreLoaded: () => void;
  }
>(function AgentKitAssistantChatBody(props, ref) {
  const { controller, threadId, requestComposerFocus } = useAgentKit();
  const control = useAgentKitControl(threadId);
  const thread = useAgentThread(threadId);
  const queueScopeRef = useRef({
    threadId,
    tabId: props.tabId,
    contextScope: props.contextScope,
  });
  queueScopeRef.current = {
    threadId,
    tabId: props.tabId,
    contextScope: props.contextScope,
  };
  const history = useOptionalAgentKitHistory();
  const suggestionSubmitRef =
    useRef<AgentKitSuggestionSubmitRef["current"]>(null);
  const resumedAfterSetupRef = useRef(new Set<string>());
  const t = useT();
  const providerChecksEnabled = !isLocalRuntimeEngine(props.selectedEngine);
  const readinessSource = useMemo(
    () => ({
      statusUrl: agentEngineStatusUrlForChatApi(
        props.apiUrl ?? agentNativePath("/_agent-native/agent-chat"),
      ),
      credentials: "include" as const,
    }),
    [props.apiUrl],
  );
  const readiness = useAgentEngineConfigured(providerChecksEnabled, {
    tabId: props.tabId,
    threadId,
    source: readinessSource,
  });
  const modelCatalogPending =
    props.showModelSelector !== false && props.modelListLoading === true;
  const modelListUnavailable =
    props.showModelSelector !== false && props.modelListError === true;
  const effectiveReadiness = readiness.state;
  const canChat = !providerChecksEnabled || effectiveReadiness === "configured";
  const [composerSetupRequired, setComposerSetupRequired] = useState(false);
  const setupConfirmedMissing =
    providerChecksEnabled && effectiveReadiness === "missing";
  // The composer's model list knows nothing is connected well before the
  // readiness check answers; an answer of "configured" still wins. Only this
  // chat's own card can show on that guess: a host-owned card waits for the
  // server, and acting on the guess without it closes the prompt with nothing
  // on screen to explain why.
  const ownsSetupCard =
    props.showMissingApiKeySetup !== false && props.setupCardOwner !== "host";
  const setupMissing =
    setupConfirmedMissing ||
    (providerChecksEnabled &&
      ownsSetupCard &&
      effectiveReadiness !== "configured" &&
      composerSetupRequired);
  const providerStatus: AgentEngineConfiguredState = setupMissing
    ? "missing"
    : modelListUnavailable
      ? "unavailable"
      : modelCatalogPending
        ? "unknown"
        : providerChecksEnabled
          ? effectiveReadiness
          : "configured";
  const retryProviderStatus = useCallback(() => {
    window.dispatchEvent(new Event("agent-engine:configured-changed"));
  }, []);
  const retryModelList = modelListUnavailable
    ? props.onRetryModelList
    : retryProviderStatus;
  const fileUploadStatus = useFileUploadStatus(
    props.isActiveComposer !== false,
  );
  const fileStorageConfigured =
    fileUploadStatus.data?.configured === true && !fileUploadStatus.isError;
  const fileStorageMissing =
    fileUploadStatus.data?.configured === false && !fileUploadStatus.isError;
  const retryFileStorageStatus = useCallback(() => {
    void fileUploadStatus.refetch();
  }, [fileUploadStatus.refetch]);
  const isRestoring =
    history?.isRestoring === true || props.threadRestore.status === "loading";
  const isSubmissionInFlight = history?.isSubmissionInFlight === true;
  const [composerSubmissionPending, setComposerSubmissionPending] =
    useState(false);
  const beginPendingSubmission = useAgentKitBeginPendingSubmission();
  // The agent client appends a sent message only after its own awaits, so
  // the transcript shows this copy from submit until that message lands.
  const beginSubmittedMessage = useCallback(
    (text: string, files: readonly PromptComposerFile[]) => {
      const previews = pendingSubmissionFiles(
        files.map((file) => ({ name: file.name, file })),
      );
      return beginPendingSubmission(
        threadId,
        { text, attachments: previews.attachments },
        { release: previews.release },
      );
    },
    [beginPendingSubmission, threadId],
  );
  const [continueSubmissionFailed, setContinueSubmissionFailed] =
    useState(false);
  const [queueSubmissionError, setQueueSubmissionError] = useState<
    string | null
  >(null);
  const [historyNoticeDismissed, setHistoryNoticeDismissed] = useState(false);
  // Notices describe this thread's last attempt; another thread starts clean.
  useEffect(() => {
    setContinueSubmissionFailed(false);
    setQueueSubmissionError(null);
    setHistoryNoticeDismissed(false);
  }, [threadId]);
  const [authError, setAuthError] = useState<{
    sessionExpired?: boolean;
  } | null>(null);
  const [authSessionAvailable, setAuthSessionAvailable] = useState(false);
  const [composerText, setComposerText] = useState(
    () => readAssistantChatComposerDraft(props.tabId ?? threadId) ?? "",
  );
  const onComposerTextChange = useCallback(
    (text: string) => {
      setComposerText(text);
      writeAssistantChatComposerDraft(props.tabId ?? threadId, text);
      props.onComposerTextChange?.(text);
    },
    [props.onComposerTextChange, props.tabId, threadId],
  );
  const [prefillRevision, setPrefillRevision] = useState(0);
  const [
    pendingProviderSubmissionVersion,
    setPendingProviderSubmissionVersion,
  ] = useState(0);
  const [deferredSubmissionsLoadedThread, setDeferredSubmissionsLoadedThread] =
    useState<string | null>(null);
  const pendingProviderRetryTimerRef = useRef<number | undefined>(undefined);
  const pendingProviderSubmissionsRef = useRef<PendingProviderSubmission[]>([]);
  const drainingProviderSubmissionsRef = useRef(false);
  const [
    deferredProviderSubmissionFailureId,
    setDeferredProviderSubmissionFailureId,
  ] = useState<string | null>(null);
  const scheduleProviderSubmissionRetry = useCallback((delayMs = 300) => {
    if (pendingProviderRetryTimerRef.current !== undefined) return;
    pendingProviderRetryTimerRef.current = window.setTimeout(() => {
      pendingProviderRetryTimerRef.current = undefined;
      setPendingProviderSubmissionVersion((version) => version + 1);
    }, delayMs);
  }, []);
  useEffect(() => {
    if (deferredSubmissionsLoadedThread === threadId) return;
    let active = true;
    pendingProviderSubmissionsRef.current = [];
    setDeferredSubmissionsLoadedThread(null);
    void readDeferredProviderSubmissions(threadId).then(
      (submissions) => {
        if (!active) return;
        pendingProviderSubmissionsRef.current = submissions;
        setDeferredProviderSubmissionFailureId(
          submissions.find((submission) => submission.failed)?.id ?? null,
        );
        setDeferredSubmissionsLoadedThread(threadId);
      },
      () => {
        if (active) scheduleProviderSubmissionRetry(1000);
      },
    );
    return () => {
      active = false;
    };
  }, [
    deferredSubmissionsLoadedThread,
    pendingProviderSubmissionVersion,
    scheduleProviderSubmissionRetry,
    threadId,
  ]);
  useEffect(
    () => () => {
      if (pendingProviderRetryTimerRef.current !== undefined) {
        window.clearTimeout(pendingProviderRetryTimerRef.current);
      }
    },
    [],
  );
  const [setupBouncePulse, setSetupBouncePulse] = useState(0);
  const previousPrefillRevisionRef = useRef(prefillRevision);
  const [contextItems, setContextItems] = useState<AgentChatContextItem[]>([]);
  // Items the composer provider owns; the composer surface keeps this current so
  // the staging check counts what a submit would also send.
  const providerContextItems = useRef<readonly AgentChatContextItem[]>([]);
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelectionContext | null>(null);
  const pendingSelectionRef = useRef<PendingSelectionContext | null>(null);
  const updatePendingSelection = useCallback(
    (selection: PendingSelectionContext | null) => {
      pendingSelectionRef.current = selection;
      setPendingSelection(selection);
    },
    [],
  );
  const pendingSelectionHydrationRef = useRef<PendingSelectionHydration | null>(
    null,
  );
  if (pendingSelectionHydrationRef.current?.threadId !== threadId) {
    pendingSelectionHydrationRef.current?.resolve();
    pendingSelectionHydrationRef.current =
      createPendingSelectionHydration(threadId);
  }
  const selectionRevisionRef = useRef(0);
  const selectionLength = pendingSelection?.text.length ?? null;
  const pendingSubmissionVisible =
    useAgentKitPendingSubmissions(threadId).length > 0;
  const hasRenderedMessages =
    thread.messages.length > 0 ||
    pendingSubmissionVisible ||
    props.threadContentSlot != null ||
    getAgentKitThreadHandoffMessages(
      thread,
      props.threadRestore.status === "error" ? null : props.handoffSnapshot,
    ).length > 0;
  const seenEventsRef = useRef({
    threadId,
    initialized: false,
    ids: new Set<string>(),
  });
  const observedMessagesRef = useRef(new Set<string>());
  const toolInputArgsRef = useRef(new Map<string, string>());
  const observedThreadIdRef = useRef(threadId);
  const observedTerminalEventsRef = useRef({
    threadId,
    ids: new Set<string>(),
  });
  const lastSavedThreadDataRef = useRef<string | null>(null);
  const latestThreadDataRef = useRef<string | null>(null);
  const lastSavedMetadataSnapshotRef = useRef({
    persistenceKey: "",
    threadData: null as string | null,
  });
  const latestMetadataSnapshotRef = useRef({
    persistenceKey: "",
    threadData: null as string | null,
  });
  const metadataSaveInFlightRef = useRef(false);
  const savingThreadDataRef = useRef(new Set<string>());
  const retryThreadSaveTimerRef = useRef<number | null>(null);
  const threadSaveRetryRef = useRef({
    threadData: null as string | null,
    retries: 0,
    exhausted: false,
    failureReported: false,
  });
  const completionSnapshotRetryRef = useRef({
    threadData: null as string | null,
    pending: false,
    retried: false,
  });
  const snapshotGenerationRef = useRef({
    persistenceKey: "",
    threadData: null as string | null,
    generation: 0,
  });
  const saveMetadataSnapshotRef = useRef<() => void>(() => undefined);
  const saveSnapshotRef = useRef<
    (metadataOnly?: boolean, allowCompletionRetry?: boolean) => void
  >(() => undefined);
  const isUnmountingRef = useRef(false);
  const localSubmissionRef = useRef(false);
  const latestAssistant = useMemo(
    () =>
      [...thread.messages]
        .reverse()
        .find((message) => message.role === "assistant"),
    [thread.messages],
  );

  const saveThreadSnapshot = useCallback(
    (
      snapshot: ReturnType<typeof createAgentKitThreadSnapshot>,
      allowCompletionRetry = false,
    ) => {
      const onSaveThread = props.onSaveThread;
      if (!onSaveThread) return;
      const persistenceKey = createAgentKitThreadHandoffKey(props, threadId);
      if (
        snapshotGenerationRef.current.persistenceKey !== persistenceKey ||
        snapshotGenerationRef.current.threadData !== snapshot.threadData
      ) {
        latestThreadDataRef.current = snapshot.threadData;
        threadSaveRetryRef.current = {
          threadData: snapshot.threadData,
          retries: 0,
          exhausted: false,
          failureReported: false,
        };
        completionSnapshotRetryRef.current = {
          threadData: snapshot.threadData,
          pending: false,
          retried: false,
        };
        if (retryThreadSaveTimerRef.current !== null) {
          window.clearTimeout(retryThreadSaveTimerRef.current);
          retryThreadSaveTimerRef.current = null;
        }
        const generation = ++threadSnapshotGeneration;
        snapshotGenerationRef.current = {
          persistenceKey,
          threadData: snapshot.threadData,
          generation,
        };
        latestThreadSnapshotGenerations.set(persistenceKey, generation);
      }
      let retry = threadSaveRetryRef.current;
      const completionRetry = completionSnapshotRetryRef.current;
      if (
        allowCompletionRetry &&
        retry.threadData === snapshot.threadData &&
        completionRetry.threadData === snapshot.threadData &&
        !completionRetry.retried
      ) {
        completionRetry.pending = true;
        if (retry.exhausted) {
          completionRetry.pending = false;
          completionRetry.retried = true;
          retry = {
            ...retry,
            retries: 0,
            exhausted: false,
          };
          threadSaveRetryRef.current = retry;
        }
      }
      if (
        retry.exhausted &&
        retry.threadData === snapshot.threadData &&
        !isUnmountingRef.current
      ) {
        return;
      }
      if (retryThreadSaveTimerRef.current !== null) return;
      if (snapshot.threadData === lastSavedThreadDataRef.current) {
        return;
      }
      if (savingThreadDataRef.current.has(snapshot.threadData)) {
        return;
      }
      let generation = latestThreadSnapshotGenerations.get(persistenceKey);
      if (generation === undefined) {
        generation = ++threadSnapshotGeneration;
        snapshotGenerationRef.current = {
          persistenceKey,
          threadData: snapshot.threadData,
          generation,
        };
        latestThreadSnapshotGenerations.set(persistenceKey, generation);
      }
      savingThreadDataRef.current.add(snapshot.threadData);
      const finish = (saved: boolean) => {
        savingThreadDataRef.current.delete(snapshot.threadData);
        if (
          latestThreadSnapshotGenerations.get(persistenceKey) !== generation
        ) {
          if (
            latestThreadDataRef.current !== snapshot.threadData &&
            latestThreadDataRef.current !== lastSavedThreadDataRef.current &&
            !isUnmountingRef.current &&
            savingThreadDataRef.current.size === 0
          ) {
            saveSnapshotRef.current();
          }
          return;
        }
        if (
          latestThreadDataRef.current !== snapshot.threadData &&
          latestThreadDataRef.current !== lastSavedThreadDataRef.current &&
          !isUnmountingRef.current &&
          savingThreadDataRef.current.size === 0
        ) {
          saveSnapshotRef.current();
          return;
        }
        if (saved && latestThreadDataRef.current === snapshot.threadData) {
          lastSavedThreadDataRef.current = snapshot.threadData;
          lastSavedMetadataSnapshotRef.current = {
            persistenceKey,
            threadData: snapshot.threadData,
          };
          try {
            props.onThreadSnapshotPersisted?.(threadId, snapshot.messageCount);
          } catch (error) {
            console.error(
              "Failed to report the saved chat thread snapshot.",
              error,
            );
          }
          if (retryThreadSaveTimerRef.current !== null) {
            window.clearTimeout(retryThreadSaveTimerRef.current);
            retryThreadSaveTimerRef.current = null;
          }
          threadSaveRetryRef.current = {
            threadData: snapshot.threadData,
            retries: 0,
            exhausted: false,
            failureReported: false,
          };
          latestThreadSnapshotGenerations.delete(persistenceKey);
        } else if (
          !saved &&
          latestThreadDataRef.current === snapshot.threadData &&
          threadSaveRetryRef.current.threadData === snapshot.threadData &&
          retryThreadSaveTimerRef.current === null
        ) {
          if (
            !isUnmountingRef.current &&
            threadSaveRetryRef.current.retries <
              MAX_THREAD_SNAPSHOT_SAVE_RETRIES
          ) {
            threadSaveRetryRef.current.retries += 1;
            retryThreadSaveTimerRef.current = window.setTimeout(
              () => {
                retryThreadSaveTimerRef.current = null;
                if (
                  !isUnmountingRef.current &&
                  latestThreadSnapshotGenerations.get(persistenceKey) ===
                    generation
                ) {
                  saveSnapshotRef.current();
                }
              },
              THREAD_SNAPSHOT_SAVE_RETRY_DELAY_MS *
                2 ** (threadSaveRetryRef.current.retries - 1),
            );
          } else {
            threadSaveRetryRef.current.exhausted = true;
            latestThreadSnapshotGenerations.delete(persistenceKey);
            const completionRetry = completionSnapshotRetryRef.current;
            const shouldRetryCompletionSnapshot =
              !isUnmountingRef.current &&
              completionRetry.threadData === snapshot.threadData &&
              completionRetry.pending &&
              !completionRetry.retried;
            if (
              !shouldRetryCompletionSnapshot &&
              !threadSaveRetryRef.current.failureReported
            ) {
              threadSaveRetryRef.current.failureReported = true;
              toast.error(t("agentChat.common.saveFailed"));
            }
            if (shouldRetryCompletionSnapshot) {
              completionRetry.pending = false;
              completionRetry.retried = true;
              threadSaveRetryRef.current = {
                threadData: snapshot.threadData,
                retries: 0,
                exhausted: false,
                failureReported: threadSaveRetryRef.current.failureReported,
              };
              saveSnapshotRef.current();
            }
          }
        }
      };
      const threadDataSave = enqueueThreadSnapshotSave(
        persistenceKey,
        async (requestContext) => {
          if (
            latestThreadSnapshotGenerations.get(persistenceKey) !== generation
          ) {
            return false;
          }

          const messages = agentKitMessagesFromThreadSnapshot(snapshot);
          let saveSource: AssistantChatSnapshotSaveSource = "transport";
          try {
            if (controller.persistThreadSnapshotWithResult) {
              const persisted =
                await controller.persistThreadSnapshotWithResult(
                  threadId,
                  messages,
                  requestContext,
                );
              if (persisted === false) return false;
              if (persisted === undefined) saveSource = "host-fallback";
            } else {
              saveSource = "host-fallback";
              await controller.persistThreadSnapshot(threadId, messages);
            }
          } catch (error) {
            console.error(
              "Failed to persist the chat transport snapshot.",
              error,
            );
            return false;
          }
          if (
            latestThreadSnapshotGenerations.get(persistenceKey) !==
              generation ||
            requestContext.signal?.aborted
          ) {
            return false;
          }

          try {
            // Legacy controller persistence can resolve for expected
            // deferrals, so the host write below is the confirmation here.
            return (
              (await onSaveThread(
                threadId,
                snapshot,
                requestContext,
                saveSource,
              )) !== false
            );
          } catch (error) {
            console.error("Failed to save the chat thread snapshot.", error);
            return false;
          }
        },
      );
      void threadDataSave.then(finish, (error: unknown) => {
        if ((error as Error)?.name !== "TimeoutError") {
          console.error("Failed to persist the chat thread snapshot.", error);
        }
        finish(false);
      });
    },
    [
      controller,
      props.apiUrl,
      props.browserTabId,
      props.contextScope,
      props.createTransport,
      props.onSaveThread,
      props.onThreadSnapshotPersisted,
      t,
      threadId,
    ],
  );
  const saveThreadMetadata = useCallback(
    (snapshot: ReturnType<typeof createAgentKitThreadSnapshot>) => {
      const onSaveThread = props.onSaveThread;
      if (!onSaveThread || isUnmountingRef.current) return;
      const persistenceKey = createAgentKitThreadHandoffKey(props, threadId);
      const lastSaved = lastSavedMetadataSnapshotRef.current;
      if (
        lastSaved.persistenceKey === persistenceKey &&
        lastSaved.threadData === snapshot.threadData
      ) {
        return;
      }
      const latest = latestMetadataSnapshotRef.current;
      if (
        metadataSaveInFlightRef.current &&
        latest.persistenceKey === persistenceKey &&
        latest.threadData === snapshot.threadData
      ) {
        return;
      }
      latestMetadataSnapshotRef.current = {
        persistenceKey,
        threadData: snapshot.threadData,
      };
      if (metadataSaveInFlightRef.current) return;
      metadataSaveInFlightRef.current = true;

      void enqueueThreadSnapshotSave(persistenceKey, async (context) => {
        const current = latestMetadataSnapshotRef.current;
        const lastSavedSnapshot = lastSavedMetadataSnapshotRef.current;
        if (
          lastSavedSnapshot.persistenceKey === persistenceKey &&
          lastSavedSnapshot.threadData === snapshot.threadData
        ) {
          return true;
        }
        if (
          current.persistenceKey !== persistenceKey ||
          current.threadData !== snapshot.threadData
        ) {
          return false;
        }
        try {
          return (
            (await onSaveThread(threadId, snapshot, context, "metadata")) !==
            false
          );
        } catch (error) {
          console.error("Failed to save chat thread metadata.", error);
          return false;
        }
      })
        .then((saved) => {
          const current = latestMetadataSnapshotRef.current;
          if (
            saved &&
            current.persistenceKey === persistenceKey &&
            current.threadData === snapshot.threadData
          ) {
            lastSavedMetadataSnapshotRef.current = {
              persistenceKey,
              threadData: snapshot.threadData,
            };
          }
        })
        .catch((error: unknown) => {
          if ((error as Error)?.name !== "TimeoutError") {
            console.error("Failed to persist chat thread metadata.", error);
          }
        })
        .finally(() => {
          metadataSaveInFlightRef.current = false;
          const current = latestMetadataSnapshotRef.current;
          if (
            !isUnmountingRef.current &&
            (current.persistenceKey !== persistenceKey ||
              current.threadData !== snapshot.threadData)
          ) {
            saveMetadataSnapshotRef.current();
          }
        });
    },
    [
      props.apiUrl,
      props.browserTabId,
      props.contextScope,
      props.onSaveThread,
      threadId,
    ],
  );
  const isRunning = hasActiveAgentRuns(thread);
  const lastMessage = thread.messages.at(-1);
  const isThinkingVisibleInTranscript =
    (isRunning || isSubmissionInFlight) &&
    lastMessage?.role === "user" &&
    lastMessage.metadata?.hideUserMessage !== true;
  // A send that has no run id yet already holds the thread's turn, so what
  // follows it queues instead of starting a second turn.
  const isThreadRunning = useCallback(
    () => agentKitTurnInProgress(controller, threadId),
    [controller, threadId],
  );
  const reconcileServerSettled = useCallback(
    () =>
      reconcileSettledRun({
        load: control.load,
        getThread: () => controller.getThread(threadId),
        tabId: props.tabId ?? threadId,
      }),
    [control.load, controller, props.tabId, threadId],
  );

  useEffect(() => {
    if (previousPrefillRevisionRef.current === prefillRevision) return;
    previousPrefillRevisionRef.current = prefillRevision;
    requestComposerFocus(threadId);
  }, [prefillRevision, requestComposerFocus, threadId]);

  const bounceSetupCard = useCallback(() => {
    if (setupMissing) setSetupBouncePulse((pulse) => pulse + 1);
  }, [setupMissing]);
  const lastCustomRunningStateRef = useRef<{
    custom: boolean;
    isRunning: boolean;
    runId?: string;
    turnId?: string;
  } | null>(null);

  useEffect(() => {
    const isCustomTransport = typeof props.createTransport === "function";
    const previous = lastCustomRunningStateRef.current;
    const runId =
      thread.activeRunIds[0] ??
      (previous?.isRunning ? previous.runId : undefined);
    const runStartedEvent = runId
      ? [...thread.events]
          .reverse()
          .find(
            (event) => event.type === "run.started" && event.runId === runId,
          )
      : undefined;
    const observability = asRecord(
      asRecord(
        asRecord(runStartedEvent?.metadata)?.[
          AGENT_NATIVE_PROTOCOL_METADATA_KEY
        ],
      )?.observability,
    );
    const turnId =
      (typeof observability?.turnId === "string"
        ? observability.turnId
        : undefined) ??
      (previous && previous.runId === runId ? previous.turnId : undefined);
    const next = {
      custom: isCustomTransport,
      isRunning,
      ...(runId ? { runId } : {}),
      ...(turnId ? { turnId } : {}),
    };
    if (
      !isCustomTransport ||
      (previous?.custom === true &&
        previous.isRunning === isRunning &&
        previous.runId === runId &&
        previous.turnId === turnId)
    ) {
      return;
    }
    lastCustomRunningStateRef.current = next;
    dispatchAgentChatRunning({
      isRunning,
      phase: isRunning ? "working" : "idle",
      threadId,
      tabId: props.tabId ?? threadId,
      ...(runId ? { runId } : {}),
      ...(turnId ? { turnId } : {}),
      reason: isRunning ? "run.started" : "run.completed",
    });
  }, [
    isRunning,
    props.createTransport,
    props.tabId,
    thread.activeRunIds,
    thread.events,
    threadId,
  ]);

  useEffect(() => {
    if (thread.thread) props.onThreadRestoreLoaded();
  }, [props.onThreadRestoreLoaded, thread.thread]);

  const checkAuthSession = useCallback(async (): Promise<
    "available" | "missing" | "unknown"
  > => {
    try {
      const response = await fetch(
        agentNativePath("/_agent-native/auth/session"),
        {
          cache: "no-store",
        },
      );
      if (!response.ok) {
        return response.status === 401 || response.status === 403
          ? "missing"
          : "unknown";
      }
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        return "unknown";
      }
      const hasSession = Boolean(data) && !asRecord(data)?.error;
      setAuthSessionAvailable(hasSession);
      if (hasSession) setAuthError(null);
      return hasSession ? "available" : "missing";
    } catch {
      return "unknown";
    }
  }, []);

  useEffect(() => {
    const onAuthError = (event: Event) => {
      const detail = asRecord((event as CustomEvent).detail);
      const eventTabId =
        typeof detail?.tabId === "string" ? detail.tabId : null;
      const eventThreadId =
        typeof detail?.threadId === "string" ? detail.threadId : null;
      if (
        (eventTabId || eventThreadId) &&
        eventTabId !== props.tabId &&
        eventThreadId !== threadId
      ) {
        return;
      }
      void (async () => {
        const state = await checkAuthSession();
        if (state !== "missing") return;
        setAuthSessionAvailable(false);
        setAuthError({ sessionExpired: detail?.reason === "session-expired" });
      })();
    };
    window.addEventListener("agent-chat:auth-error", onAuthError);
    return () =>
      window.removeEventListener("agent-chat:auth-error", onAuthError);
  }, [checkAuthSession, props.tabId, threadId]);

  useEffect(() => {
    if (!authError) return;
    const timer = window.setTimeout(() => void checkAuthSession(), 250);
    window.addEventListener("focus", checkAuthSession);
    window.addEventListener(
      "agent-engine:configured-changed",
      checkAuthSession,
    );
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", checkAuthSession);
      window.removeEventListener(
        "agent-engine:configured-changed",
        checkAuthSession,
      );
    };
  }, [authError, checkAuthSession]);
  const staticSuggestionPrompts = useMemo(
    () => props.suggestions?.map(agentSuggestionPrompt),
    [props.suggestions],
  );
  const { suggestions: dynamicSuggestionPrompts } =
    useAgentDynamicSuggestionsResult({
      staticSuggestions: staticSuggestionPrompts,
      dynamicSuggestions: props.dynamicSuggestions,
      browserTabId: props.browserTabId,
      scope: props.contextScope,
      enabled:
        canChat &&
        thread.messages.length === 0 &&
        Object.keys(thread.runs).length === 0,
    });
  const isInitialThread =
    thread.messages.length === 0 && Object.keys(thread.runs).length === 0;
  const suggestions = isInitialThread
    ? resolveAgentKitSuggestionInputs(
        dynamicSuggestionPrompts,
        props.suggestions,
      )
    : selectAgentSuggestions(thread);
  const showSuggestions =
    canChat &&
    !isRestoring &&
    !isSubmissionInFlight &&
    !isRunning &&
    (!isInitialThread || props.suggestionVisibility !== "after-agent-response");

  const clearPendingSelection = useCallback(() => {
    const selectionRevision = ++selectionRevisionRef.current;
    return deleteClientAppState("pending-selection-context", {
      keepalive: true,
    }).then(() => {
      if (selectionRevision !== selectionRevisionRef.current) return;
      updatePendingSelection(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("agent-panel:selection-cleared"));
      }
    });
  }, [updatePendingSelection]);
  const requestPendingSelectionClear = useCallback(() => {
    void clearPendingSelection().catch((error: unknown) => {
      console.warn("[agent-chat] Couldn't clear the pending selection", error);
    });
  }, [clearPendingSelection]);

  useEffect(() => {
    let cancelled = false;
    const hydration = pendingSelectionHydrationRef.current;
    updatePendingSelection(null);
    const selectionRevision = selectionRevisionRef.current;
    void readClientAppState<unknown>("pending-selection-context")
      .then((value) => {
        if (cancelled || hydration?.threadId !== threadId) return;
        const state = asRecord(value);
        const nestedValue = asRecord(state?.value);
        const text =
          typeof nestedValue?.text === "string"
            ? nestedValue.text
            : typeof state?.text === "string"
              ? state.text
              : undefined;
        const capturedAt =
          typeof nestedValue?.capturedAt === "number"
            ? nestedValue.capturedAt
            : typeof state?.capturedAt === "number"
              ? state.capturedAt
              : 0;
        if (selectionRevision === selectionRevisionRef.current) {
          updatePendingSelection(
            text && Date.now() - capturedAt <= PENDING_SELECTION_TTL_MS
              ? { text, capturedAt }
              : null,
          );
        }
        if (hydration) hydration.status = "loaded";
      })
      .catch(() => {
        if (hydration) hydration.status = "failed";
      })
      .finally(() => {
        if (hydration?.status === "pending") hydration.status = "failed";
        hydration?.resolve();
      });
    return () => {
      cancelled = true;
      if (hydration?.status === "pending") hydration.status = "failed";
      hydration?.resolve();
    };
  }, [threadId, updatePendingSelection]);

  useEffect(() => {
    const onAttached = (event: Event) => {
      const detail = asRecord((event as CustomEvent).detail);
      if (typeof detail?.text === "string" && detail.text) {
        selectionRevisionRef.current += 1;
        updatePendingSelection({ text: detail.text, capturedAt: Date.now() });
      }
    };
    const onCleared = () => {
      selectionRevisionRef.current += 1;
      updatePendingSelection(null);
    };
    const onClearRequested = requestPendingSelectionClear;
    window.addEventListener("agent-panel:selection-attached", onAttached);
    window.addEventListener("agent-panel:selection-cleared", onCleared);
    window.addEventListener(
      "agent-panel:selection-clear-requested",
      onClearRequested,
    );
    return () => {
      window.removeEventListener("agent-panel:selection-attached", onAttached);
      window.removeEventListener("agent-panel:selection-cleared", onCleared);
      window.removeEventListener(
        "agent-panel:selection-clear-requested",
        onClearRequested,
      );
    };
  }, [requestPendingSelectionClear, updatePendingSelection]);

  useEffect(() => {
    const apply = () => {
      if (!props.isActiveComposer && props.isActiveComposer !== undefined)
        return;
      setContextItems(
        filterAgentChatContextItems(
          getAgentChatContextState().items,
          props.contextNamespace,
          threadId,
        ),
      );
    };
    apply();
    void refreshAgentChatContext().then(apply);
    return subscribeAgentChatContext(apply);
  }, [props.contextNamespace, props.isActiveComposer, threadId]);

  useEffect(() => {
    if (seenEventsRef.current.threadId !== threadId) {
      seenEventsRef.current = {
        threadId,
        initialized: false,
        ids: new Set(),
      };
    }
    const seen = seenEventsRef.current;
    if (!seen.initialized && thread.thread && !localSubmissionRef.current) {
      seen.ids = new Set(thread.events.map((event) => event.id));
      seen.initialized = true;
      return;
    }
    if (!seen.initialized && thread.events.length === 0) return;
    seen.initialized = true;
    for (const event of thread.events) {
      if (seen.ids.has(event.id)) continue;
      seen.ids.add(event.id);
      dispatchAgentKitCompatibilityEvent(
        event,
        props.tabId ?? threadId,
        thread,
        toolInputArgsRef.current,
      );
    }
  }, [props.tabId, thread, threadId]);

  const reportedMessageCountRef = useRef<number | null>(null);

  useEffect(() => {
    // This effect re-runs on every host render; reporting an unchanged count
    // makes the host re-render, which re-runs it.
    const reportMessageCount = (count: number) => {
      if (reportedMessageCountRef.current === count) return;
      reportedMessageCountRef.current = count;
      props.onMessageCountChange?.(count);
    };
    if (observedThreadIdRef.current !== threadId) {
      observedThreadIdRef.current = threadId;
      observedMessagesRef.current = new Set();
    }
    if (
      observedMessagesRef.current.size === 0 &&
      thread.thread &&
      thread.messages.length > 0 &&
      !localSubmissionRef.current
    ) {
      observedMessagesRef.current = new Set(
        thread.messages.map((message) => message.id),
      );
      observedTerminalEventsRef.current = {
        threadId,
        ids: new Set(
          thread.events
            .filter(
              (event) =>
                event.type === "run.completed" ||
                event.type === "run.cancelled" ||
                event.type === "run.failed",
            )
            .map((event) => event.id),
        ),
      };
      reportMessageCount(thread.messages.length);
      return;
    }
    let addedUserMessage = false;
    for (const [index, message] of thread.messages.entries()) {
      if (isStreamingVoiceMessage(message)) continue;
      if (observedMessagesRef.current.has(message.id)) continue;
      observedMessagesRef.current.add(message.id);
      if (message.role !== "user") continue;
      localSubmissionRef.current = false;
      addedUserMessage = true;
      const text = agentMessageText(message);
      if (
        !thread.messages.slice(0, index).some((item) => item.role === "user")
      ) {
        const { engine, model } = message.metadata ?? {};
        props.onGenerateTitle?.(threadId, text, {
          ...(typeof engine === "string" ? { engine } : {}),
          ...(typeof model === "string" ? { model } : {}),
        });
      }
    }
    const terminalEvents = thread.events.filter(
      (event) =>
        event.type === "run.completed" ||
        event.type === "run.cancelled" ||
        event.type === "run.failed",
    );
    let terminalEventAdded = false;
    if (observedTerminalEventsRef.current.threadId !== threadId) {
      observedTerminalEventsRef.current = {
        threadId,
        ids: new Set(terminalEvents.map((event) => event.id)),
      };
    } else {
      for (const event of terminalEvents) {
        if (observedTerminalEventsRef.current.ids.has(event.id)) continue;
        observedTerminalEventsRef.current.ids.add(event.id);
        terminalEventAdded = true;
      }
    }
    const completedAssistantSnapshot =
      !isRunning &&
      thread.messages.at(-1)?.role === "assistant" &&
      thread.messages.at(-1)?.status === "complete";
    if (addedUserMessage || terminalEventAdded || completedAssistantSnapshot) {
      saveSnapshotRef.current(
        false,
        terminalEventAdded || completedAssistantSnapshot,
      );
    }
    reportMessageCount(thread.messages.length);
  }, [isRunning, props, thread, threadId]);

  saveSnapshotRef.current = (
    metadataOnly = false,
    allowCompletionRetry = false,
  ) => {
    if (!hasPersistableMessages(thread)) return;
    const snapshot = createAgentKitThreadSnapshot(thread);
    if (
      isUnmountingRef.current &&
      props.onSaveThread &&
      !props.createTransport &&
      !props.runtime
    ) {
      storeAgentKitThreadHandoffSnapshot(
        createAgentKitThreadHandoffKey(props, threadId),
        thread,
        snapshot,
      );
    }
    if (metadataOnly) saveThreadMetadata(snapshot);
    else saveThreadSnapshot(snapshot, allowCompletionRetry);
  };
  saveMetadataSnapshotRef.current = () => saveSnapshotRef.current(true);

  useEffect(() => {
    isUnmountingRef.current = false;
    return () => {
      isUnmountingRef.current = true;
      if (retryThreadSaveTimerRef.current !== null) {
        window.clearTimeout(retryThreadSaveTimerRef.current);
        retryThreadSaveTimerRef.current = null;
      }
      saveSnapshotRef.current();
    };
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => saveSnapshotRef.current(), 5000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  const acquireSubmission = useCallback(async () => {
    if (
      isRestoring ||
      props.composerDisabled ||
      props.composerSubmissionDisabled
    ) {
      return null;
    }
    if (!history) return () => undefined;
    return history.beginSubmission();
  }, [
    history,
    isRestoring,
    props.composerDisabled,
    props.composerSubmissionDisabled,
  ]);

  const dispatch = useCallback(
    async (
      text: string,
      files: PromptComposerFile[],
      references: Reference[],
      composerOptions: AgentKitSuggestionSubmitOptions,
      options: AgentKitInternalSendOptions = {},
    ) => {
      const selectedEngine =
        composerOptions.engine ??
        options.recoveryEngine ??
        props.selectedEngine;
      const queuedSubmit =
        !options.recoveryAction &&
        (composerOptions.queuedWhileRunActive ||
          composerOptions.intent === "queued");
      let queuedMessageReservationId: string | undefined;
      let queueMessagePreflightToken:
        | Awaited<ReturnType<typeof controller.assertQueueMessageReady>>
        | undefined;
      try {
        if (queuedSubmit) {
          queuedMessageReservationId = control.reserveQueuedMessage?.(
            text,
            composerOptions.onLocalSubmit,
          ).id;
          if (queuedMessageReservationId) localSubmissionRef.current = true;
        }
        if (
          queuedSubmit &&
          typeof controller.assertQueueMessageReady === "function"
        ) {
          queueMessagePreflightToken = await controller.assertQueueMessageReady(
            {
              threadId,
              text,
              ...(options.deferredRequestAttachments?.length
                ? { requestAttachments: options.deferredRequestAttachments }
                : {}),
              hasAttachments: Boolean(
                options.attachments?.length ||
                files.length ||
                options.deferredFileParts?.length ||
                options.deferredRequestAttachments?.length,
              ),
              metadata:
                typeof selectedEngine === "string"
                  ? { engine: selectedEngine }
                  : undefined,
            },
          );
        } else {
          await controller.assertAiSetupReady({
            engine:
              typeof selectedEngine === "string" ? selectedEngine : undefined,
          });
        }
        const selectionHydration = pendingSelectionHydrationRef.current;
        await selectionHydration?.promise;
        const currentPendingSelection = pendingSelectionRef.current;
        const selectionRevision = selectionRevisionRef.current;
        const context =
          options.recoveryAction || options.contextAlreadyIncluded
            ? ""
            : [
                composerOptions.composerModeContext,
                formatAgentChatContextItemsForPrompt(
                  composerOptions.contextItems ?? contextItems,
                ),
                pendingSelectionPromptContext(currentPendingSelection),
              ]
                .filter(Boolean)
                .join("\n\n");
        const message = options.contextAlreadyIncluded
          ? text
          : appendAgentChatContextToMessage(text, context);
        const attachments = options.attachments ?? [];
        const needsFileStorage = requiresDurableAttachmentUpload(
          attachments,
          files,
        );
        composerOptions.validateSubmission?.();
        if (
          needsFileStorage &&
          !fileStorageConfigured &&
          (queuedSubmit ||
            !canSendInlineImagesWithoutStorage(attachments, files))
        ) {
          throw new Error(t("onboarding.fileStorage.title"));
        }
        const uploadedAttachments = options.deferredFileParts
          ? {
              fileParts: options.deferredFileParts,
              requestAttachments: options.deferredRequestAttachments ?? [],
            }
          : await uploadAgentChatAttachments(control, attachments, files, {
              storageConfigured: fileStorageConfigured,
              storageUnavailableMessage: t("onboarding.fileStorage.title"),
              fileTooLargeMessage: uploadTooLargeMessage(t),
            });
        const fileParts = uploadedAttachments.fileParts;
        let requestAttachments = normalizeRequestAttachmentReferences(
          options.deferredRequestAttachments ??
            uploadedAttachments.requestAttachments,
        );
        let retryRequestAttachments = requestAttachments.filter(
          (attachment) =>
            !attachment.data && isDurableAttachmentUrl(attachment.url),
        );
        let retryAttachmentsUnavailable = false;
        const inlineImageDataChars = requestAttachments.reduce(
          (total, attachment) => total + (attachment.data?.length ?? 0),
          0,
        );
        if (
          inlineImageDataChars > MAX_AGENT_REQUEST_ATTACHMENT_DATA_CHARS &&
          !fileStorageConfigured
        ) {
          throw new Error(t("agentChat.composer.requestTooLarge"));
        }
        if (requestAttachments.some((attachment) => attachment.data)) {
          if (!fileStorageConfigured) {
            if (
              queuedSubmit ||
              !canSendInlineImagesWithoutStorage(attachments, files)
            ) {
              throw Object.assign(
                new Error(t("onboarding.fileStorage.title")),
                {
                  code: "upload_storage_unavailable",
                  retryable: false,
                },
              );
            }
            retryAttachmentsUnavailable = true;
          } else {
            const durableAttachments = await uploadRequestAttachments(
              control,
              requestAttachments,
            );
            requestAttachments =
              inlineImageDataChars > MAX_AGENT_REQUEST_ATTACHMENT_DATA_CHARS
                ? durableAttachments
                : requestAttachments.map((attachment, index) => {
                    const durable = durableAttachments[index];
                    return attachment.data && durable?.url
                      ? { ...attachment, url: durable.url }
                      : attachment;
                  });
            retryRequestAttachments = durableAttachments.filter(
              (attachment) =>
                !attachment.data && isDurableAttachmentUrl(attachment.url),
            );
            retryAttachmentsUnavailable =
              retryRequestAttachments.length !== requestAttachments.length;
          }
        }
        // Readiness was gated before the upload; a provider status refresh during
        // it must not discard the upload, only a change of thread or scope.
        composerOptions.validateSubmissionScope?.();
        const selectionChangedDuringSubmission =
          selectionRevision !== selectionRevisionRef.current ||
          (options.pendingSelectionCapturedAt !== undefined &&
            options.pendingSelectionCapturedAt !==
              (currentPendingSelection?.capturedAt ?? null));
        const skipAmbientSelectionContext =
          options.skipAmbientSelectionContext === true ||
          selectionHydration?.status === "pending" ||
          isClientAppStateMutationPending("pending-selection-context") ||
          selectionChangedDuringSubmission ||
          Boolean(pendingSelectionPromptContext(currentPendingSelection));
        const requestMode =
          options.requestMode ??
          options.recoveryRequestMode ??
          composerOptions.requestMode ??
          "act";
        const model =
          composerOptions.model ?? options.recoveryModel ?? props.selectedModel;
        const engine =
          composerOptions.engine ??
          options.recoveryEngine ??
          props.selectedEngine;
        const effort =
          composerOptions.effort ??
          options.recoveryEffort ??
          props.selectedEffort;
        const contextScope =
          options.deferredContextScope !== undefined
            ? (options.deferredContextScope ?? undefined)
            : props.contextScope;
        const selectedAgent =
          options.deferredAgentId !== undefined
            ? (options.deferredAgentId ?? undefined)
            : props.selectedAgent;
        const actionScope = options.actionScope ?? contextScope;
        const customMetadata = {
          ...(typeof options.submissionExpiresAt === "number"
            ? {
                [AGENT_NATIVE_SUBMISSION_EXPIRES_AT_METADATA_KEY]:
                  options.submissionExpiresAt,
              }
            : {}),
          ...(options.recoveryAction
            ? { agentNativeRecoveryAction: options.recoveryAction }
            : {}),
          ...(options.recoveryOfRunId
            ? { agentNativeRecoveryOfRunId: options.recoveryOfRunId }
            : {}),
          ...(options.resumeAfterSetup
            ? { agentNativeResumeAfterSetup: true }
            : {}),
          ...(options.deferredSubmissionId
            ? {
                agentNativeDeferredSubmissionId: options.deferredSubmissionId,
              }
            : {}),
          ...(options.deferredFromApp
            ? { agentNativeDeferredFromApp: true }
            : {}),
          ...(retryRequestAttachments.length
            ? { agentNativeRetryRequestAttachments: retryRequestAttachments }
            : {}),
          ...(retryAttachmentsUnavailable
            ? { agentNativeRetryAttachmentsUnavailable: true }
            : {}),
        };
        const metadata = {
          ...(composerOptions.suggestion
            ? { suggestion: composerOptions.suggestion }
            : {}),
          ...(options.submitMessageId
            ? { submitMessageId: options.submitMessageId }
            : {}),
          ...(composerOptions.submissionId
            ? {
                [AGENTKIT_CLIENT_REQUEST_ID_METADATA_KEY]:
                  composerOptions.submissionId,
              }
            : {}),
          ...(options.usageLabel ? { usageLabel: options.usageLabel } : {}),
          ...(options.surface ? { agentNativeSurface: options.surface } : {}),
          ...(options.trackInRunsTray ? { trackInRunsTray: true } : {}),
          ...(skipAmbientSelectionContext
            ? { agentNativeSkipPendingSelectionContext: true }
            : {}),
          ...(actionScope ? { actionScope } : {}),
          ...(options.approvedToolCalls
            ? { approvedToolCalls: options.approvedToolCalls }
            : {}),
          ...(options.hideUserMessage ? { hideUserMessage: true } : {}),
          ...(Object.keys(customMetadata).length
            ? { custom: customMetadata }
            : {}),
          ...(options.recoveryAction === "continue"
            ? { agentNativeInternalContinuation: true }
            : {}),
          ...(contextScope ? { chatScope: contextScope } : {}),
          ...(references.length || options.recoveryReferences?.length
            ? {
                references: [
                  ...references,
                  ...(options.recoveryReferences ?? []),
                ],
              }
            : {}),
          ...(model ? { model } : {}),
          ...(engine ? { engine } : {}),
          ...(effort ? { effort } : {}),
          ...(selectedAgent ? { agentId: selectedAgent } : {}),
          requestMode,
        };
        if (!queuedMessageReservationId) localSubmissionRef.current = true;
        if (isSubmissionExpired(options.submissionExpiresAt)) {
          throw Object.assign(
            new Error("The prompt expired before it could be sent."),
            { code: "submission_expired", retryable: false },
          );
        }
        await control.sendMessage({
          text: message,
          attachments: fileParts,
          ...(requestAttachments.length ? { requestAttachments } : {}),
          queuedWhileRunActive:
            composerOptions.queuedWhileRunActive ||
            composerOptions.intent === "queued",
          ...(options.submissionExpiresAt !== undefined
            ? { queueWhileRunning: false }
            : {}),
          deliverInActiveRun: composerOptions.steer,
          options: {
            model,
            mode: requestMode,
            agentId: selectedAgent,
            reasoningEffort:
              effort && effort !== "auto" && effort !== "max"
                ? (effort as "low" | "medium" | "high" | "xhigh")
                : undefined,
            metadata,
          },
          metadata,
          ...(queuedMessageReservationId ? { queuedMessageReservationId } : {}),
          ...(queuedSubmit
            ? {
                queueMessageHasAttachments: Boolean(
                  options.attachments?.length ||
                  files.length ||
                  options.deferredFileParts?.length ||
                  options.deferredRequestAttachments?.length,
                ),
              }
            : {}),
          ...(queueMessagePreflightToken ? { queueMessagePreflightToken } : {}),
          ...(queuedMessageReservationId
            ? {}
            : { onLocalSubmit: composerOptions.onLocalSubmit }),
        });
        reportAgentChatSubmitResult(options.submitMessageId, true);
        if (
          !options.recoveryAction &&
          !selectionChangedDuringSubmission &&
          selectionRevision === selectionRevisionRef.current &&
          Boolean(pendingSelectionPromptContext(currentPendingSelection))
        ) {
          requestPendingSelectionClear();
        }
        // Matched by staging identity as well as key, so a replacement staged while this
        // send was in flight survives the cleanup.
        const isSent = (item: AgentChatContextItem) =>
          contextItems.some(
            (sent) =>
              sent.key === item.key && sent.stagingId === item.stagingId,
          );
        publishAgentChatContextItems(
          getAgentChatContextState().items.filter((item) => !isSent(item)),
        );
        setContextItems((items) => items.filter((item) => !isSent(item)));
      } catch (error) {
        localSubmissionRef.current = false;
        if (queuedMessageReservationId) {
          control.cancelQueuedMessageReservation?.(queuedMessageReservationId);
        }
        throw error;
      }
    },
    [
      contextItems,
      controller,
      control,
      threadId,
      props.contextScope,
      props.selectedAgent,
      props.selectedEffort,
      props.selectedEngine,
      props.selectedModel,
      fileStorageConfigured,
      t,
      requestPendingSelectionClear,
    ],
  );

  const submit = useCallback(
    async (
      text: string,
      files: PromptComposerFile[],
      references: Reference[],
      composerOptions: AgentKitSuggestionSubmitOptions,
      options: AgentKitInternalSendOptions = {},
    ): Promise<AssistantChatSubmitResult> => {
      if (isSubmissionExpired(options.submissionExpiresAt)) {
        reportAgentChatSubmitResult(
          options.submitMessageId,
          false,
          "submission-expired",
        );
        return { status: "rejected", reason: "submission-expired" };
      }
      const submittedComposerOptions = captureQueuedRunState(
        composerOptions,
        isThreadRunning(),
      );
      const release = await acquireSubmission();
      if (!release) {
        if (isSubmissionExpired(options.submissionExpiresAt)) {
          reportAgentChatSubmitResult(
            options.submitMessageId,
            false,
            "submission-expired",
          );
          return { status: "rejected", reason: "submission-expired" };
        }
        if (isRestoring) {
          try {
            const selectedEngine =
              submittedComposerOptions.engine ?? props.selectedEngine;
            await controller.assertAiSetupReady({
              engine:
                typeof selectedEngine === "string" ? selectedEngine : undefined,
            });
            const selectionHydration = pendingSelectionHydrationRef.current;
            await selectionHydration?.promise;
            const currentPendingSelection = pendingSelectionRef.current;
            const selectionRevision = selectionRevisionRef.current;
            const attachments = options.attachments ?? [];
            const needsFileStorage =
              !options.deferredFileParts &&
              requiresDurableAttachmentUpload(attachments, files);
            submittedComposerOptions.validateSubmission?.();
            if (needsFileStorage && !fileStorageConfigured) {
              throw new Error(t("onboarding.fileStorage.title"));
            }
            // Persist only URLs or opaque file handles; application_state is
            // not a file store and must never receive attachment bodies.
            const uploadedAttachments = options.deferredFileParts
              ? {
                  fileParts: options.deferredFileParts,
                  requestAttachments: options.deferredRequestAttachments ?? [],
                }
              : await uploadAgentChatAttachments(control, attachments, files, {
                  storageConfigured: fileStorageConfigured,
                  storageUnavailableMessage: t("onboarding.fileStorage.title"),
                  fileTooLargeMessage: uploadTooLargeMessage(t),
                });
            const fileParts = await durableFileParts(
              control,
              uploadedAttachments.fileParts,
              {
                storageConfigured: fileStorageConfigured,
                storageUnavailableMessage: t("onboarding.fileStorage.title"),
              },
            );
            if (
              !fileStorageConfigured &&
              uploadedAttachments.requestAttachments.some(
                (attachment) => attachment.data,
              )
            ) {
              throw new Error(t("onboarding.fileStorage.title"));
            }
            if (isSubmissionExpired(options.submissionExpiresAt)) {
              reportAgentChatSubmitResult(
                options.submitMessageId,
                false,
                "submission-expired",
              );
              return { status: "rejected", reason: "submission-expired" };
            }
            const requestAttachments = normalizeRequestAttachmentReferences(
              options.deferredRequestAttachments ??
                (await uploadRequestAttachments(
                  control,
                  uploadedAttachments.requestAttachments,
                )),
            );
            submittedComposerOptions.validateSubmissionScope?.();
            if (isSubmissionExpired(options.submissionExpiresAt)) {
              reportAgentChatSubmitResult(
                options.submitMessageId,
                false,
                "submission-expired",
              );
              return { status: "rejected", reason: "submission-expired" };
            }
            const selectionChangedDuringUpload =
              selectionRevision !== selectionRevisionRef.current;
            const context = options.recoveryAction
              ? ""
              : [
                  submittedComposerOptions.composerModeContext,
                  formatAgentChatContextItemsForPrompt(
                    submittedComposerOptions.contextItems ?? contextItems,
                  ),
                  pendingSelectionPromptContext(currentPendingSelection),
                ]
                  .filter(Boolean)
                  .join("\n\n");
            const { submitMessageId } = options;
            const deferredOptions = { ...options };
            deferredOptions.pendingSelectionCapturedAt =
              currentPendingSelection?.capturedAt ?? null;
            if (
              options.skipAmbientSelectionContext === true ||
              selectionHydration?.status === "pending" ||
              selectionChangedDuringUpload
            ) {
              deferredOptions.skipAmbientSelectionContext = true;
            }
            delete deferredOptions.submitMessageId;
            if (submitMessageId) deferredOptions.deferredFromApp = true;
            delete deferredOptions.attachments;
            deferredOptions.contextAlreadyIncluded = true;
            deferredOptions.deferredRequestAttachments = requestAttachments;
            deferredOptions.deferredSubmissionId =
              submitMessageId ?? createAgentUploadId();
            deferredOptions.deferredAgentId = props.selectedAgent ?? null;
            deferredOptions.deferredContextScope =
              props.contextScope === undefined ? null : props.contextScope;
            deferredOptions.requestMode ??=
              submittedComposerOptions.requestMode ?? "act";
            const deferredComposerOptions = { ...submittedComposerOptions };
            delete deferredComposerOptions.attachments;
            delete deferredComposerOptions.onLocalSubmit;
            delete deferredComposerOptions.validateSubmission;
            delete deferredComposerOptions.validateSubmissionScope;
            delete deferredComposerOptions.validateSubmissionScope;
            deferredComposerOptions.model ??= props.selectedModel;
            deferredComposerOptions.engine ??= props.selectedEngine;
            deferredComposerOptions.effort ??= props.selectedEffort;
            const submission: PendingProviderSubmission = {
              id: deferredOptions.deferredSubmissionId,
              threadId,
              text: appendAgentChatContextToMessage(text, context),
              ...(typeof options.submissionExpiresAt === "number"
                ? { submissionExpiresAt: options.submissionExpiresAt }
                : {}),
              fileParts,
              ...(requestAttachments.length ? { requestAttachments } : {}),
              references: [...references],
              composerOptions: deferredComposerOptions,
              options: deferredOptions,
            };
            if (isSubmissionExpired(options.submissionExpiresAt)) {
              reportAgentChatSubmitResult(
                submitMessageId,
                false,
                "submission-expired",
              );
              return { status: "rejected", reason: "submission-expired" };
            }
            const submissions = await updateDeferredProviderSubmissions(
              threadId,
              (current) =>
                current.some(({ id }) => id === submission.id)
                  ? current
                  : [...current, submission],
            );
            if (isSubmissionExpired(options.submissionExpiresAt)) {
              pendingProviderSubmissionsRef.current =
                await updateDeferredProviderSubmissions(threadId, (current) =>
                  current.filter(({ id }) => id !== submission.id),
                );
              setPendingProviderSubmissionVersion((version) => version + 1);
              reportAgentChatSubmitResult(
                submitMessageId,
                false,
                "submission-expired",
              );
              return { status: "rejected", reason: "submission-expired" };
            }
            pendingProviderSubmissionsRef.current = submissions;
            setDeferredSubmissionsLoadedThread(threadId);
            reportAgentChatSubmitResult(submitMessageId, true);
            return { status: "submitted" };
          } catch (error) {
            if (isSubmissionExpiredError(error)) {
              reportAgentChatSubmitResult(
                options.submitMessageId,
                false,
                "submission-expired",
              );
              return { status: "rejected", reason: "submission-expired" };
            }
            reportAgentChatSubmitResult(
              options.submitMessageId,
              false,
              submitFailureReason(error),
            );
            dispatchSetupRequiredEvent(error, props.tabId, threadId);
            throw error;
          }
        }
        const reason = setupMissing
          ? "engine-not-configured"
          : "submission-unavailable";
        reportAgentChatSubmitResult(options.submitMessageId, false, reason);
        return { status: "rejected", reason };
      }
      const pending =
        !options.hideUserMessage &&
        !options.approvedToolCalls &&
        !submittedComposerOptions.submissionId &&
        !isThreadRunning()
          ? beginSubmittedMessage(text, files)
          : undefined;
      try {
        if (isSubmissionExpired(options.submissionExpiresAt)) {
          reportAgentChatSubmitResult(
            options.submitMessageId,
            false,
            "submission-expired",
          );
          return { status: "rejected", reason: "submission-expired" };
        }
        await dispatch(
          text,
          files,
          references,
          pending
            ? { ...submittedComposerOptions, submissionId: pending.id }
            : submittedComposerOptions,
          options,
        );
        return { status: "submitted" };
      } catch (error) {
        if (isSubmissionExpiredError(error)) {
          reportAgentChatSubmitResult(
            options.submitMessageId,
            false,
            "submission-expired",
          );
          return { status: "rejected", reason: "submission-expired" };
        }
        reportAgentChatSubmitResult(
          options.submitMessageId,
          false,
          submitFailureReason(error),
        );
        dispatchSetupRequiredEvent(error, props.tabId, threadId);
        throw error;
      } finally {
        pending?.end();
        release?.();
      }
    },
    [
      acquireSubmission,
      beginSubmittedMessage,
      contextItems,
      control,
      dispatch,
      fileStorageConfigured,
      props.contextScope,
      props.selectedAgent,
      props.selectedEffort,
      props.selectedEngine,
      props.selectedModel,
      isRestoring,
      isThreadRunning,
      props.tabId,
      setupMissing,
      t,
      threadId,
    ],
  );

  const submitPrepared = useCallback(
    async (
      text: string,
      files: PromptComposerFile[],
      references: Reference[],
      composerOptions: AgentKitSuggestionSubmitOptions,
      prepare?: () => Promise<PromptComposerSubmitOptions>,
    ) => {
      const runWasActiveAtSubmit = isThreadRunning();
      setContinueSubmissionFailed(false);
      const release = await acquireSubmission();
      if (!release)
        throw new Error(t("agentChat.recovery.deferredSubmissionFailed"));
      const pending =
        !runWasActiveAtSubmit && !composerOptions.submissionId
          ? beginSubmittedMessage(text, files)
          : undefined;
      if (pending) {
        composerOptions = { ...composerOptions, submissionId: pending.id };
      }
      try {
        const preparedOptions = prepare
          ? { ...(await prepare()), submissionId: composerOptions.submissionId }
          : composerOptions;
        await dispatch(
          text,
          files,
          references,
          captureQueuedRunState(
            preserveQueuedIntent(preparedOptions, composerOptions),
            runWasActiveAtSubmit,
          ),
        );
      } catch (error) {
        dispatchSetupRequiredEvent(error, props.tabId, threadId);
        throw error;
      } finally {
        pending?.end();
        release?.();
      }
    },
    [
      acquireSubmission,
      beginSubmittedMessage,
      dispatch,
      isThreadRunning,
      props.composerDisabled,
      props.composerSubmissionDisabled,
      props.tabId,
      t,
      threadId,
    ],
  );

  const queueImperativeMessage = useCallback(
    async (
      text: string,
      images: string[] = [],
    ): Promise<AssistantChatSubmitResult> => {
      if (
        isRestoring ||
        props.composerDisabled ||
        props.composerSubmissionDisabled
      ) {
        return { status: "rejected", reason: "submission-unavailable" };
      }

      if (
        images.some(
          (url) => !parseBase64DataUrl(url) && !isDurableAttachmentUrl(url),
        )
      ) {
        throw Object.assign(
          new TypeError("Images need a data URL or durable reference."),
          { code: ATTACHMENT_UNREADABLE_SUBMIT_REASON },
        );
      }
      const selectionHydration = pendingSelectionHydrationRef.current;
      const currentPendingSelection = pendingSelectionRef.current;
      const selectionRevision = selectionRevisionRef.current;
      const context = [
        formatAgentChatContextItemsForPrompt(contextItems),
        pendingSelectionPromptContext(currentPendingSelection),
      ]
        .filter(Boolean)
        .join("\n\n");
      const message = appendAgentChatContextToMessage(text, context);
      let requestAttachments: AgentRequestAttachment[] = images.map(
        (url, index) => {
          const parsed = parseBase64DataUrl(url);
          if (parsed) {
            return {
              type: "image" as const,
              name: `image-${index + 1}`,
              contentType: parsed.mediaType,
              data: url,
            };
          }
          return {
            type: "image" as const,
            name: `image-${index + 1}`,
            url,
          };
        },
      );
      let attachments: FilePart[] = requestAttachments.flatMap((attachment) =>
        !attachment.data && attachment.url
          ? [
              {
                type: "file" as const,
                name: attachment.name,
                ...(attachment.contentType
                  ? { mediaType: attachment.contentType }
                  : {}),
                url: attachment.url,
              },
            ]
          : [],
      );
      const requestMode = "act";
      const model = props.selectedModel;
      const engine = props.selectedEngine;
      const effort = props.selectedEffort;
      const skipAmbientSelectionContext =
        selectionHydration?.status === "pending" ||
        isClientAppStateMutationPending("pending-selection-context") ||
        selectionRevision !== selectionRevisionRef.current ||
        Boolean(pendingSelectionPromptContext(currentPendingSelection));
      const capturedScope = JSON.stringify([
        threadId,
        props.tabId ?? null,
        props.contextScope?.type ?? null,
        props.contextScope?.id ?? null,
      ]);
      const validateBeforeQueue = () => {
        const current = queueScopeRef.current;
        const currentScope = JSON.stringify([
          current.threadId,
          current.tabId ?? null,
          current.contextScope?.type ?? null,
          current.contextScope?.id ?? null,
        ]);
        if (currentScope !== capturedScope) {
          throw Object.assign(new Error(t("agentChat.error.failed")), {
            code: "AGENT_CHAT_SUBMISSION_SCOPE_CHANGED",
          });
        }
      };
      let queuedMessageReservationId: string | undefined;
      let queueMessagePreflightToken:
        | Awaited<ReturnType<typeof controller.assertQueueMessageReady>>
        | undefined;
      setQueueSubmissionError(null);
      try {
        queuedMessageReservationId = control.reserveQueuedMessage?.(message).id;
        assertAttachmentSizesWithinLimit(
          requestAttachments.map((attachment) => ({
            type: "image",
            name: attachment.name,
            ...(attachment.contentType
              ? { contentType: attachment.contentType }
              : {}),
            ...(attachment.data ? { data: attachment.data } : {}),
            ...(attachment.url ? { url: attachment.url } : {}),
          })),
          [],
          t("agentChat.composer.fileTooLarge"),
        );
        if (typeof controller.assertQueueMessageReady === "function") {
          queueMessagePreflightToken = await controller.assertQueueMessageReady(
            {
              threadId,
              text: message,
              requestAttachments,
              metadata: engine ? { engine } : undefined,
            },
          );
        } else {
          await controller.assertAiSetupReady({
            engine: typeof engine === "string" ? engine : undefined,
          });
        }
        if (requestAttachments.some((attachment) => attachment.data)) {
          if (!fileStorageConfigured) {
            throw Object.assign(new Error(t("onboarding.fileStorage.title")), {
              code: "upload_storage_unavailable",
            });
          }
          requestAttachments = await uploadRequestAttachments(
            control,
            requestAttachments,
          );
          if (
            requestAttachments.some(
              (attachment) =>
                attachment.data || !isDurableAttachmentUrl(attachment.url),
            )
          ) {
            throw new TypeError(
              "Queued images require durable URL references.",
            );
          }
          attachments = requestAttachments.map((attachment) => ({
            type: "file" as const,
            name: attachment.name,
            ...(attachment.contentType
              ? { mediaType: attachment.contentType }
              : {}),
            url: attachment.url!,
          }));
        }
        const retryRequestAttachments = requestAttachments.filter(
          (attachment) => isDurableAttachmentUrl(attachment.url),
        );
        if (retryRequestAttachments.length !== requestAttachments.length) {
          throw new TypeError("Queued images require durable URL references.");
        }
        const customMetadata = {
          ...(retryRequestAttachments.length
            ? { agentNativeRetryRequestAttachments: retryRequestAttachments }
            : {}),
        };
        const metadata = {
          ...(skipAmbientSelectionContext
            ? { agentNativeSkipPendingSelectionContext: true }
            : {}),
          ...(props.contextScope
            ? { actionScope: props.contextScope, chatScope: props.contextScope }
            : {}),
          ...(props.selectedAgent ? { agentId: props.selectedAgent } : {}),
          ...(Object.keys(customMetadata).length
            ? { custom: customMetadata }
            : {}),
          ...(model ? { model } : {}),
          ...(engine ? { engine } : {}),
          ...(effort ? { effort } : {}),
          requestMode,
        };
        await control.queueMessage({
          text: message,
          attachments,
          ...(requestAttachments.length ? { requestAttachments } : {}),
          queuedWhileRunActive: true,
          ...(queuedMessageReservationId ? { queuedMessageReservationId } : {}),
          queueMessageHasAttachments: Boolean(
            attachments.length || requestAttachments.length,
          ),
          ...(queueMessagePreflightToken ? { queueMessagePreflightToken } : {}),
          validateBeforeQueue,
          options: {
            model,
            mode: requestMode,
            agentId: props.selectedAgent,
            reasoningEffort:
              effort && effort !== "auto" && effort !== "max"
                ? (effort as "low" | "medium" | "high" | "xhigh")
                : undefined,
            metadata,
          },
          metadata,
        });
        const selectionChangedDuringSubmission =
          selectionRevision !== selectionRevisionRef.current;
        if (
          !selectionChangedDuringSubmission &&
          Boolean(pendingSelectionPromptContext(currentPendingSelection))
        ) {
          requestPendingSelectionClear();
        }
        // Matched by staging identity as well as key, so a replacement staged while this
        // send was in flight survives the cleanup.
        const isSent = (item: AgentChatContextItem) =>
          contextItems.some(
            (sent) =>
              sent.key === item.key && sent.stagingId === item.stagingId,
          );
        publishAgentChatContextItems(
          getAgentChatContextState().items.filter((item) => !isSent(item)),
        );
        setContextItems((items) => items.filter((item) => !isSent(item)));
        setQueueSubmissionError(null);
        return { status: "submitted" };
      } catch (error) {
        if (queuedMessageReservationId) {
          control.cancelQueuedMessageReservation?.(queuedMessageReservationId);
        }
        const reason = submitFailureReason(error);
        const rejected = setupSubmissionResult(error);
        setQueueSubmissionError(
          rejected ? null : queueSubmissionErrorMessage(error, t),
        );
        reportAgentChatSubmitResult(
          undefined,
          false,
          rejected?.status === "rejected" ? rejected.reason : reason,
        );
        dispatchSetupRequiredEvent(error, props.tabId, threadId);
        if (rejected) return rejected;
        throw error;
      }
    },
    [
      contextItems,
      control,
      isRestoring,
      props.composerDisabled,
      props.composerSubmissionDisabled,
      props.contextScope,
      fileStorageConfigured,
      props.selectedAgent,
      props.selectedEffort,
      props.selectedEngine,
      props.selectedModel,
      props.tabId,
      requestPendingSelectionClear,
      t,
      threadId,
    ],
  );

  useEffect(() => {
    if (
      !canChat ||
      isRestoring ||
      setupMissing ||
      deferredSubmissionsLoadedThread !== threadId ||
      drainingProviderSubmissionsRef.current
    ) {
      return;
    }
    const submission = pendingProviderSubmissionsRef.current.find(
      (candidate) => candidate.threadId === threadId,
    );
    if (!submission) return;
    if (submission.failed) {
      setDeferredProviderSubmissionFailureId(submission.id);
      return;
    }

    let active = true;
    drainingProviderSubmissionsRef.current = true;
    void (async () => {
      let release: (() => void) | null = null;
      let claimToken: string | undefined;
      let claimRenewalTimer: number | undefined;
      try {
        if (isSubmissionExpired(submission.submissionExpiresAt)) {
          const submissions = await updateDeferredProviderSubmissions(
            threadId,
            (current) => current.filter(({ id }) => id !== submission.id),
          );
          pendingProviderSubmissionsRef.current = submissions;
          reportAgentChatSubmitResult(
            submission.id,
            false,
            "submission-expired",
          );
          setPendingProviderSubmissionVersion((version) => version + 1);
          return;
        }
        release = await acquireSubmission();
        if (!release) {
          if (active) scheduleProviderSubmissionRetry();
          return;
        }
        const hasSubmissionMarker = (message: { metadata?: unknown }) => {
          const custom = asRecord(asRecord(message.metadata)?.custom);
          return custom?.agentNativeDeferredSubmissionId === submission.id;
        };
        const latestThread = await props.getThreadSnapshot(threadId);
        const alreadySubmitted =
          (latestThread?.messages ?? thread.messages).some(
            (message) =>
              message.role === "user" && hasSubmissionMarker(message),
          ) ||
          (latestThread?.queuedMessages ?? thread.queuedMessages).some(
            (message) => hasSubmissionMarker(message),
          );
        if (alreadySubmitted) {
          const submissions = await updateDeferredProviderSubmissions(
            threadId,
            (current) => current.filter(({ id }) => id !== submission.id),
          );
          pendingProviderSubmissionsRef.current = submissions;
          setDeferredProviderSubmissionFailureId(null);
          setPendingProviderSubmissionVersion((version) => version + 1);
          return;
        }

        claimToken = createAgentUploadId();
        const claimedSubmissions = await updateDeferredProviderSubmissions(
          threadId,
          (current) =>
            current.map((candidate) =>
              candidate.id !== submission.id ||
              candidate.failed ||
              (candidate.claim && candidate.claim.expiresAt > Date.now())
                ? candidate
                : {
                    ...candidate,
                    claim: {
                      token: claimToken!,
                      expiresAt:
                        Date.now() + DEFERRED_PROVIDER_SUBMISSION_CLAIM_TTL_MS,
                    },
                  },
            ),
        );
        pendingProviderSubmissionsRef.current = claimedSubmissions;
        const currentSubmission = claimedSubmissions.find(
          (candidate) => candidate.id === submission.id,
        );
        if (!currentSubmission) {
          setPendingProviderSubmissionVersion((version) => version + 1);
          return;
        }
        if (currentSubmission.failed) {
          setDeferredProviderSubmissionFailureId(submission.id);
          return;
        }
        if (currentSubmission.claim?.token !== claimToken) {
          const waitMs = currentSubmission.claim
            ? currentSubmission.claim.expiresAt - Date.now()
            : 1000;
          scheduleProviderSubmissionRetry(
            Math.max(1000, Math.min(10_000, waitMs)),
          );
          return;
        }
        if (isSubmissionExpired(currentSubmission.submissionExpiresAt)) {
          const submissions = await updateDeferredProviderSubmissions(
            threadId,
            (current) => current.filter(({ id }) => id !== submission.id),
          );
          pendingProviderSubmissionsRef.current = submissions;
          reportAgentChatSubmitResult(
            submission.id,
            false,
            "submission-expired",
          );
          setPendingProviderSubmissionVersion((version) => version + 1);
          return;
        }

        claimRenewalTimer = window.setInterval(() => {
          void updateDeferredProviderSubmissions(threadId, (current) =>
            current.map((candidate) =>
              candidate.id === submission.id &&
              candidate.claim?.token === claimToken
                ? {
                    ...candidate,
                    claim: {
                      token: claimToken!,
                      expiresAt:
                        Date.now() + DEFERRED_PROVIDER_SUBMISSION_CLAIM_TTL_MS,
                    },
                  }
                : candidate,
            ),
          )
            .then((submissions) => {
              pendingProviderSubmissionsRef.current = submissions;
            })
            .catch(() => undefined);
        }, DEFERRED_PROVIDER_SUBMISSION_CLAIM_TTL_MS / 3);

        await dispatch(
          submission.text,
          [],
          submission.references,
          submission.composerOptions,
          {
            ...submission.options,
            deferredFileParts: submission.fileParts,
            deferredRequestAttachments: submission.requestAttachments,
            contextAlreadyIncluded: true,
            deferredSubmissionId: submission.id,
          },
        );
        const submissions = await updateDeferredProviderSubmissions(
          threadId,
          (current) => current.filter(({ id }) => id !== submission.id),
        );
        pendingProviderSubmissionsRef.current = submissions;
        setDeferredProviderSubmissionFailureId(null);
        setPendingProviderSubmissionVersion((version) => version + 1);
      } catch (error) {
        if (isSubmissionExpiredError(error)) {
          const submissions = await updateDeferredProviderSubmissions(
            threadId,
            (current) =>
              current.filter(
                (candidate) =>
                  candidate.id !== submission.id ||
                  !claimToken ||
                  candidate.claim?.token !== claimToken,
              ),
          );
          pendingProviderSubmissionsRef.current = submissions;
          reportAgentChatSubmitResult(
            submission.id,
            false,
            "submission-expired",
          );
          if (active) {
            setDeferredProviderSubmissionFailureId(null);
            setPendingProviderSubmissionVersion((version) => version + 1);
          }
          return;
        }
        let snapshotReadFailed = false;
        const latestThread = await props
          .getThreadSnapshot(threadId)
          .catch(() => {
            snapshotReadFailed = true;
            return null;
          });
        const hasSubmissionMarker = (message: { metadata?: unknown }) => {
          const custom = asRecord(asRecord(message.metadata)?.custom);
          return custom?.agentNativeDeferredSubmissionId === submission.id;
        };
        const alreadySubmitted =
          (latestThread?.messages ?? thread.messages).some(
            (message) =>
              message.role === "user" && hasSubmissionMarker(message),
          ) ||
          (latestThread?.queuedMessages ?? thread.queuedMessages).some(
            (message) => hasSubmissionMarker(message),
          );
        if (alreadySubmitted) {
          const submissions = await updateDeferredProviderSubmissions(
            threadId,
            (current) => current.filter(({ id }) => id !== submission.id),
          );
          pendingProviderSubmissionsRef.current = submissions;
          if (active) {
            setDeferredProviderSubmissionFailureId(null);
            setPendingProviderSubmissionVersion((version) => version + 1);
          }
          return;
        }
        const attempts = (submission.attempts ?? 0) + 1;
        const shouldRetry =
          !snapshotReadFailed &&
          isRetryableDeferredProviderSubmissionError(error) &&
          attempts < DEFERRED_PROVIDER_SUBMISSION_MAX_RETRIES;
        try {
          const submissions = await updateDeferredProviderSubmissions(
            threadId,
            (current) =>
              current.map((candidate) => {
                if (
                  candidate.id !== submission.id ||
                  (candidate.claim && candidate.claim.token !== claimToken)
                ) {
                  return candidate;
                }
                const { claim: _claim, ...withoutClaim } = candidate;
                return shouldRetry
                  ? { ...withoutClaim, attempts }
                  : { ...withoutClaim, attempts, failed: true };
              }),
          );
          pendingProviderSubmissionsRef.current = submissions;
          const currentSubmission = submissions.find(
            (candidate) => candidate.id === submission.id,
          );
          if (active && currentSubmission?.failed) {
            setDeferredProviderSubmissionFailureId(submission.id);
          } else if (active && shouldRetry) {
            scheduleProviderSubmissionRetry(500 * 2 ** (attempts - 1));
          }
        } catch {
          if (active) {
            setDeferredProviderSubmissionFailureId(submission.id);
            scheduleProviderSubmissionRetry(
              DEFERRED_PROVIDER_SUBMISSION_CLAIM_TTL_MS,
            );
          }
        }
      } finally {
        if (claimRenewalTimer !== undefined) {
          window.clearInterval(claimRenewalTimer);
        }
        release?.();
        drainingProviderSubmissionsRef.current = false;
      }
    })();
    return () => {
      active = false;
    };
  }, [
    acquireSubmission,
    canChat,
    deferredSubmissionsLoadedThread,
    dispatch,
    isRestoring,
    pendingProviderSubmissionVersion,
    scheduleProviderSubmissionRetry,
    setupMissing,
    props.getThreadSnapshot,
    thread.messages,
    thread.queuedMessages,
    threadId,
  ]);

  const send = useCallback(
    async (
      text: string,
      images?: string[],
      options?: AssistantChatSendOptions,
    ) => {
      try {
        return await submit(
          text,
          [],
          [],
          { intent: isThreadRunning() ? "queued" : "immediate" },
          {
            ...options,
            attachments: [
              ...(options?.attachments ?? []),
              ...(images ?? []).map((url) => ({
                type: "image",
                name: "image",
                url,
              })),
            ],
          },
        );
      } catch (error) {
        const rejected = setupSubmissionResult(error);
        if (rejected) return rejected;
        throw error;
      }
    },
    [isThreadRunning, submit],
  );
  const sendRecoveryMessage = useCallback(
    async (
      text: string,
      recoveryAction: "continue" | "retry",
      images?: string[],
      fileParts?: FilePart[],
      references?: Reference[],
      recoveryOptions?: Pick<
        AgentKitInternalSendOptions,
        | "recoveryModel"
        | "recoveryEngine"
        | "recoveryEffort"
        | "recoveryRequestMode"
        | "recoveryOfRunId"
        | "resumeAfterSetup"
      >,
    ) => {
      try {
        return await submit(
          text,
          [],
          [],
          { intent: isThreadRunning() ? "queued" : "immediate" },
          {
            hideUserMessage: true,
            recoveryAction,
            recoveryReferences: references,
            ...recoveryOptions,
            deferredFileParts: [
              ...(fileParts ?? []),
              ...(images ?? []).map(
                (url): FilePart => ({
                  type: "file",
                  name: "image",
                  mediaType: "image",
                  url,
                }),
              ),
            ],
          },
        );
      } catch (error) {
        const rejected = setupSubmissionResult(error);
        if (rejected) return rejected;
        throw error;
      }
    },
    [isThreadRunning, submit],
  );
  const resumeIntegrationPrompt = useCallback(
    async (message: string) => {
      if (props.isActiveComposer === false) {
        throw new Error("Cannot resume a request in an inactive chat.");
      }
      try {
        const result = await send(message);
        if (result.status === "rejected") {
          throw new Error(`Chat resume was rejected: ${result.reason}.`);
        }
      } catch (error) {
        dispatchSetupRequiredEvent(error, props.tabId, threadId);
        throw error;
      }
    },
    [props.isActiveComposer, props.tabId, send, threadId],
  );
  const submitSuggestion = useCallback(
    (suggestion: AgentSuggestionInput) => {
      if (composerSubmissionPending) return;
      const handler = suggestionSubmitRef.current;
      if (!handler || handler.threadId !== threadId) return;
      void handler.submit(suggestion).catch((error) => {
        dispatchSetupRequiredEvent(error, props.tabId, threadId);
      });
    },
    [composerSubmissionPending, props.tabId, threadId],
  );
  const retryDeferredSubmission = useCallback(async () => {
    if (!deferredProviderSubmissionFailureId) return;
    const submissions = await updateDeferredProviderSubmissions(
      threadId,
      (current) =>
        current.map((candidate) => {
          if (candidate.id !== deferredProviderSubmissionFailureId) {
            return candidate;
          }
          if (
            !candidate.failed ||
            (candidate.claim && candidate.claim.expiresAt > Date.now())
          ) {
            return candidate;
          }
          const { claim: _claim, failed: _failed, ...retryable } = candidate;
          return { ...retryable, attempts: 0 };
        }),
    );
    pendingProviderSubmissionsRef.current = submissions;
    setDeferredProviderSubmissionFailureId(null);
    setPendingProviderSubmissionVersion((version) => version + 1);
  }, [deferredProviderSubmissionFailureId, threadId]);
  const dismissDeferredSubmission = useCallback(async () => {
    if (!deferredProviderSubmissionFailureId) return;
    const submissions = await updateDeferredProviderSubmissions(
      threadId,
      (current) =>
        current.filter(({ id }) => id !== deferredProviderSubmissionFailureId),
    );
    pendingProviderSubmissionsRef.current = submissions;
    setDeferredProviderSubmissionFailureId(null);
    setPendingProviderSubmissionVersion((version) => version + 1);
  }, [deferredProviderSubmissionFailureId, threadId]);

  const setContextItem = useCallback(
    (rawItem: AgentChatContextItem, focus = true) => {
      const normalized = normalizeAgentChatContextItem(rawItem);
      if (!normalized) return;
      // A caller may carry the staging identity of an item it read back; a replacement
      // must not keep the replaced item's identity.
      const item = { ...normalized, stagingId: nextAgentChatStagingId() };
      const current = getAgentChatContextState().items;
      const next = current
        .filter((candidate) => candidate.key !== item.key)
        .concat(item);
      publishAgentChatContextItems(next);
      setContextItems(
        filterAgentChatContextItems(next, props.contextNamespace, threadId),
      );
      if (focus) requestComposerFocus(threadId);
    },
    [props.contextNamespace, requestComposerFocus, threadId],
  );
  const removeContextItem = useCallback(
    (key: string, options?: { threadScoped?: boolean; stagingId?: string }) => {
      const targetKey = options?.threadScoped ? `${key}:${threadId}` : key;
      if (options?.threadScoped) {
        return removeAgentChatContextItemAndPersist(targetKey, {
          stagingId: options.stagingId,
        }).then(() => {
          setContextItems(
            filterAgentChatContextItems(
              getAgentChatContextState().items,
              props.contextNamespace,
              threadId,
            ),
          );
        });
      }
      const next = getAgentChatContextState().items.filter(
        (item) => item.key !== targetKey,
      );
      publishAgentChatContextItems(next);
      setContextItems(
        filterAgentChatContextItems(next, props.contextNamespace, threadId),
      );
    },
    [props.contextNamespace, threadId],
  );
  const implementPlan = useCallback(() => {
    if (getReplyRequestMode(thread.messages, latestAssistant) !== "plan") {
      return false;
    }
    void send(IMPLEMENT_PLAN_PROMPT, undefined, { requestMode: "act" });
    return true;
  }, [latestAssistant, send, thread.messages]);

  useImperativeHandle(
    ref,
    () => ({
      sendMessage: (text, images, options) => send(text, images, options),
      implementPlan,
      prefillMessage: (text) => {
        setComposerText(text);
        writeAssistantChatComposerDraft(props.tabId ?? threadId, text);
        setPrefillRevision((revision) => revision + 1);
      },
      canStageComposerContextItem: (item) => {
        const scopedKey = `${item.key}:${threadId}`;
        return composerContextFits([
          ...[...contextItems, ...providerContextItems.current].filter(
            (candidate) => candidate.key !== scopedKey,
          ),
          { ...item, key: scopedKey, targetThreadId: threadId },
        ]);
      },
      setComposerContextItem: (item, options) => {
        const focus = options?.focus !== false;
        if (!options?.threadScoped) {
          setContextItem(item, focus);
          return;
        }

        const scopedItem = {
          ...item,
          key: `${item.key}:${threadId}`,
          targetThreadId: threadId,
        };
        return setAgentChatContextItemAndPersist(scopedItem).then((staged) => {
          setContextItems(
            filterAgentChatContextItems(
              getAgentChatContextState().items,
              props.contextNamespace,
              threadId,
            ),
          );
          if (focus) requestComposerFocus(threadId);
          return staged;
        });
      },
      removeComposerContextItem: removeContextItem,
      clearComposerContextItems: () => {
        for (const item of contextItems) removeContextItem(item.key);
      },
      sendRecoveryMessage: (text, recoveryAction, images) =>
        sendRecoveryMessage(text, recoveryAction, images),
      queueMessage: (text, images) => queueImperativeMessage(text, images),
      isRunning: isThreadRunning,
      hasInFlightWork: () =>
        Object.values(thread.tools).some((tool) => tool.status === "running") ||
        Object.values(thread.activities).some(
          (activity) => activity.status === "running",
        ),
      focusComposer: () => requestComposerFocus(threadId),
      exportThreadSnapshot: () => {
        if (!hasPersistableMessages(thread)) return null;
        const snapshot = createAgentKitThreadSnapshot(thread);
        if (!props.createTransport && !props.runtime) {
          storeAgentKitThreadHandoffSnapshot(
            createAgentKitThreadHandoffKey(props, threadId),
            thread,
            snapshot,
          );
        }
        return snapshot;
      },
    }),
    [
      contextItems,
      implementPlan,
      props.apiUrl,
      props.browserTabId,
      props.contextScope,
      props.createTransport,
      props.runtime,
      props.tabId,
      removeContextItem,
      requestComposerFocus,
      send,
      sendRecoveryMessage,
      queueImperativeMessage,
      setContextItem,
      thread,
      threadId,
    ],
  );

  const surfaceContext: AgentKitSurfaceContextValue = {
    props,
    handoffSnapshot: props.handoffSnapshot,
    hasRenderedMessages,
    canChat,
    setupMissing,
    setupConfirmedMissing,
    providerStatus,
    modelListUnavailable,
    retryProviderStatus,
    retryModelList,
    fileStorageConfigured,
    fileStorageMissing,
    retryFileStorageStatus,
    deferredSubmissionFailed: deferredProviderSubmissionFailureId !== null,
    deferredSubmissionRequiresAttachment:
      pendingProviderSubmissionsRef.current.some(
        (submission) =>
          submission.id === deferredProviderSubmissionFailureId &&
          submission.attachmentRestoreRequired === true,
      ),
    retryDeferredSubmission,
    dismissDeferredSubmission,
    isRunning,
    isRestoring,
    threadRestore: props.threadRestore,
    retryThreadRestore: props.retryThreadRestore,
    authError,
    authSessionAvailable,
    setupBouncePulse,
    bounceSetupCard,
    onComposerSetupRequiredChange: setComposerSetupRequired,
    isSubmissionInFlight,
    composerSubmissionPending,
    onComposerSubmissionPendingChange: setComposerSubmissionPending,
    isThinkingVisibleInTranscript,
    contextItems,
    providerContextItems,
    pendingSubmissionVisible,
    selectionLength,
    suggestions: suggestions ?? [],
    showSuggestions,
    prefillRevision,
    text: composerText,
    onTextChange: onComposerTextChange,
    onRemoveContextItem: removeContextItem,
    onClearSelection: requestPendingSelectionClear,
    onSubmit: submitPrepared,
    sendMessage: send,
    sendRecoveryMessage,
    submitSuggestion,
    suggestionSubmitRef,
    resumedAfterSetup: resumedAfterSetupRef.current,
    onImplementPlan: implementPlan,
  };

  return (
    <ComposerNoticeScope>
      <AgentKitSurfaceContext.Provider value={surfaceContext}>
        {props.isActiveComposer === false ? null : (
          <McpAgentKitConnectionResume
            onResume={(
              { threadId: targetThreadId, runId, requestId },
              request,
            ) => {
              if (targetThreadId !== threadId) return "not-owner";
              return control.resolveConnectionRequest(runId, requestId, {
                status: "connected",
                message: request.message,
              });
            }}
            onMessageResume={(request) =>
              resumeIntegrationPrompt(request.message)
            }
          />
        )}
        <RunStuckBanner
          threadId={threadId}
          enabled={props.isActiveComposer !== false}
          apiUrl={props.apiUrl ?? agentNativePath("/_agent-native/agent-chat")}
          autoRetry
          autoRetryOwnerId={props.browserTabId}
          hasInFlightWork={() =>
            Object.values(thread.tools).some(
              (tool) => tool.status === "running",
            ) ||
            Object.values(thread.activities).some(
              (activity) => activity.status === "running",
            )
          }
          isAwaitingResponse={() =>
            isRunning &&
            !isWaitingOnConnectionRequest(thread) &&
            !isWaitingOnApprovalRequest(thread)
          }
          onServerSettled={reconcileServerSettled}
          onRetry={(runId) => {
            const lastUserMessage = [...thread.messages]
              .reverse()
              .find((message) => message.role === "user");
            runContinueWithVisibleError(
              () =>
                sendContinueRequest(
                  surfaceContext,
                  retryRequestFrom(lastUserMessage),
                  runId,
                ),
              setContinueSubmissionFailed,
            );
          }}
        />
        {continueSubmissionFailed ? (
          <ComposerNotice
            role="alert"
            noticeId="continue-failed"
            onDismiss={() => setContinueSubmissionFailed(false)}
            dismissLabel={t("agentChat.common.dismiss")}
          >
            {t("agentChat.recovery.continueUnavailable")}
          </ComposerNotice>
        ) : null}
        {queueSubmissionError ? (
          <ComposerNotice
            role="alert"
            noticeId="queue-failed"
            onDismiss={() => setQueueSubmissionError(null)}
            dismissLabel={t("agentChat.common.dismiss")}
          >
            {queueSubmissionError}
          </ComposerNotice>
        ) : null}
        {history?.historyLoadFailed && !historyNoticeDismissed ? (
          <ComposerNotice
            role="alert"
            noticeId="history-unavailable"
            actions={
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={history.retryHistory}
                disabled={history.isRetryingHistory}
                aria-busy={history.isRetryingHistory || undefined}
              >
                {history.isRetryingHistory ? (
                  <Spinner className="size-3" aria-hidden="true" />
                ) : null}
                {t("agentChat.common.retry")}
              </Button>
            }
            onDismiss={() => setHistoryNoticeDismissed(true)}
            dismissLabel={t("agentChat.common.dismiss")}
          >
            {t("agentChat.message.historyUnavailable")}
          </ComposerNotice>
        ) : null}
        <AgentKitChat
          {...(props.className === undefined
            ? {}
            : { className: props.className })}
          composerProps={{ attachmentsEnabled: fileStorageConfigured }}
          hasRenderedMessages={hasRenderedMessages}
          {...(props.transcriptLayout === undefined
            ? {}
            : { transcriptLayout: props.transcriptLayout })}
          emptyComposerPlacement={
            props.centerComposerWhenEmpty && !isRestoring ? "center" : "bottom"
          }
          expectExistingThread={!props.isNewThread}
          autoScroll
        />
      </AgentKitSurfaceContext.Provider>
    </ComposerNoticeScope>
  );
});

function AgentKitComposerSlot({ threadId }: { threadId: string }) {
  const surface = useAgentKitSurface();
  if (surface.props.composerContextProvider) {
    return (
      <AgentKitScopedComposerContext threadId={threadId} surface={surface} />
    );
  }
  return <AgentKitComposerSurface threadId={threadId} {...surface} />;
}

function AgentKitScopedComposerContext({
  threadId,
  surface,
}: {
  threadId: string;
  surface: AgentKitSurfaceContextValue;
}) {
  const { session } = useSession();
  const Provider = surface.props.composerContextProvider!;
  return (
    <Provider
      key={JSON.stringify([
        threadId,
        surface.props.tabId,
        session?.authUserId,
        session?.email,
        session?.orgId,
      ])}
      threadId={threadId}
      tabId={surface.props.tabId}
      isActive={surface.props.isActiveComposer !== false}
    >
      {(composerContext) => (
        <AgentKitComposerSurface
          threadId={threadId}
          {...surface}
          composerContext={composerContext}
        />
      )}
    </Provider>
  );
}

function AgentKitAssistantEmptyState({ threadId }: { threadId: string }) {
  const surface = useAgentKitSurface();
  const t = useT();
  const thread = useAgentThread(threadId);
  if (
    surface.threadRestore.status !== "error" &&
    getAgentKitThreadHandoffMessages(thread, surface.handoffSnapshot).length > 0
  ) {
    return null;
  }
  const showDefault = surface.props.emptyStateDisplay !== "hidden";
  if (
    !showDefault &&
    !surface.props.emptyStateAddon &&
    !surface.props.emptyStateFooter
  ) {
    return null;
  }
  const promptSuggestions =
    surface.props.suggestionPlacement !== "context-chips" &&
    surface.props.suggestionPlacement !== "after-composer" &&
    surface.props.suggestionPlacement !== "hidden" &&
    surface.showSuggestions
      ? surface.suggestions
      : [];
  // A host's text is a hint about this surface, not a replacement greeting.
  const hostHint = surface.props.emptyStateText?.trim();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-16">
      {showDefault ? (
        <AgentKitEmptyState
          className="w-full"
          text={
            hostHint ? (
              <span className="mx-auto block max-w-[30rem] text-sm font-normal leading-5 tracking-normal text-muted-foreground">
                {hostHint}
              </span>
            ) : (
              t("agentChat.empty.prompt")
            )
          }
        >
          {promptSuggestions.length ? (
            <AgentKitSuggestedPrompts
              suggestions={promptSuggestions}
              disabled={
                !surface.canChat ||
                Boolean(surface.props.composerDisabled) ||
                Boolean(surface.props.composerSubmissionDisabled) ||
                surface.composerSubmissionPending
              }
              onSelect={surface.submitSuggestion}
              // The two-line track is wider than a narrow lane, so the chips
              // wrap within it rather than also scrolling sideways.
              className="agentkit-empty-suggestions max-w-[30rem] px-0 [&_[data-agent-suggestion-track=true]]:max-w-full"
            />
          ) : null}
        </AgentKitEmptyState>
      ) : null}
      {surface.props.emptyStateAddon}
      {surface.props.emptyStateFooter}
    </div>
  );
}

function AgentKitSelectionPill({
  length,
  onClear,
}: {
  length: number;
  onClear: () => void;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  return (
    <div className="agent-selection-attached-pill shrink-0 px-3 pt-1.5 -mb-1">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
        <IconQuote size={11} aria-hidden="true" />
        <span>
          {t("agentChat.selection.attached", {
            count: length,
            formattedCount: formatNumber(length),
          })}
        </span>
        <button
          type="button"
          aria-label={t("agentChat.selection.clear")}
          onClick={onClear}
          className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        >
          <IconX size={11} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function AgentKitTranscript({ children, threadId }: AgentKitRegionRenderProps) {
  const { controller, slots } = useAgentKit();
  const MessageView = slots.message ?? AgentMessageView;
  const surface = useAgentKitSurface();
  const t = useT();
  const thread = useAgentThread(threadId);
  const handoffMessages =
    surface.threadRestore.status === "error"
      ? []
      : getAgentKitThreadHandoffMessages(thread, surface.handoffSnapshot);
  const guided = useGuidedQuestionFlow({
    enabled:
      surface.props.isActiveComposer !== false &&
      surface.props.showGuidedQuestions !== false,
    stateKey: "guided-questions",
    queryKey: ["guided-questions", "agentkit"],
    browserTabId: surface.props.browserTabId,
    threadId,
    onSubmitMessage: async ({ message, context }) => {
      await surface.onSubmit(
        appendAgentChatContextToMessage(message, context),
        [],
        [],
        {
          intent: hasActiveAgentRuns(controller.getThread(threadId))
            ? "queued"
            : "immediate",
        },
      );
      return { delivered: true };
    },
    onSkipMessage: async ({ message, context }) => {
      await surface.onSubmit(
        appendAgentChatContextToMessage(message, context),
        [],
        [],
        {
          intent: hasActiveAgentRuns(controller.getThread(threadId))
            ? "queued"
            : "immediate",
        },
      );
      return { delivered: true };
    },
  });
  const activeRunId = thread.activeRunIds.at(-1);
  const [requestIdCopyFeedback, setRequestIdCopyFeedback] = useState<{
    runId: string;
    status: "copied" | "failed";
  } | null>(null);
  const activeRunRequestIdCopyStatus =
    requestIdCopyFeedback && requestIdCopyFeedback.runId === activeRunId
      ? requestIdCopyFeedback.status
      : null;
  useEffect(() => {
    if (!requestIdCopyFeedback) return;
    const timeout = setTimeout(() => setRequestIdCopyFeedback(null), 1_400);
    return () => clearTimeout(timeout);
  }, [requestIdCopyFeedback]);
  const copyActiveRunRequestId = async () => {
    if (!activeRunId) return;
    try {
      const copied = await writeClipboardText(activeRunId);
      setRequestIdCopyFeedback({
        runId: activeRunId,
        status: copied ? "copied" : "failed",
      });
    } catch {
      setRequestIdCopyFeedback({ runId: activeRunId, status: "failed" });
    }
  };
  const lastMessage = thread.messages.at(-1);
  const showThinking =
    !surface.isRunning &&
    (surface.pendingSubmissionVisible ||
      (surface.isSubmissionInFlight &&
        lastMessage?.role === "user" &&
        lastMessage.metadata?.hideUserMessage !== true));
  if (surface.authError) {
    const authTitle = surface.authSessionAvailable
      ? t("agentChat.auth.refreshTitle")
      : surface.authError.sessionExpired
        ? t("agentChat.auth.expiredTitle")
        : t("agentChat.auth.requiredTitle");
    const authDescription = surface.authSessionAvailable
      ? t("agentChat.auth.refreshDescription")
      : surface.authError.sessionExpired
        ? t("agentChat.auth.expiredDescription")
        : t("agentChat.auth.requiredDescription");
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-16">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          {surface.authSessionAvailable ? (
            <IconRefresh className="h-5 w-5 text-muted-foreground" />
          ) : (
            <IconMessage className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="max-w-[280px] text-center">
          <p className="mb-1 text-sm font-medium text-foreground">
            {authTitle}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {authDescription}
          </p>
        </div>
        <div className="flex gap-2">
          {!surface.authError.sessionExpired &&
          !surface.authSessionAvailable ? (
            <button
              type="button"
              onClick={() => {
                window.location.href = buildSignInReturnHref();
              }}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background hover:opacity-90"
            >
              {t("agentChat.auth.logIn")}
            </button>
          ) : null}
          {surface.authError.sessionExpired && !surface.authSessionAvailable ? (
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-md border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
            >
              {t("agentChat.auth.logOut")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {t("agentChat.auth.refreshChat")}
          </button>
        </div>
      </div>
    );
  }
  if (
    surface.threadRestore.status === "loading" &&
    thread.messages.length === 0 &&
    handoffMessages.length === 0
  ) {
    return (
      <AgentKitTranscriptSkeleton label={t("agentChat.empty.loadingChat")} />
    );
  }
  if (
    surface.threadRestore.status === "error" &&
    thread.messages.length === 0 &&
    handoffMessages.length === 0
  ) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 px-4 py-16"
        role="alert"
      >
        <IconAlertTriangle
          aria-hidden="true"
          className="size-5 text-[hsl(var(--agent-kit-warning))]"
        />
        <p className="max-w-[420px] text-center text-sm text-muted-foreground">
          {surface.threadRestore.notFound
            ? t("agentChat.message.threadNotFound")
            : t("agentChat.message.threadLoadFailed")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={surface.retryThreadRestore}
        >
          {t("agentChat.common.retry")}
        </Button>
      </div>
    );
  }
  return (
    <>
      {thread.messages.length > 0 || surface.hasRenderedMessages ? (
        <AgentKitHistoryBeginningRevert />
      ) : null}
      {surface.threadRestore.status === "error" ? (
        <ComposerNotice
          role="alert"
          noticeId="thread-restore"
          actions={
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={surface.retryThreadRestore}
            >
              {t("agentChat.common.retry")}
            </Button>
          }
        >
          {surface.threadRestore.notFound
            ? t("agentChat.message.threadNotFound")
            : t("agentChat.message.threadLoadFailed")}
        </ComposerNotice>
      ) : null}
      {renderThreadSlot(
        surface.props.threadContentSlot,
        threadId,
        surface.props.tabId,
      )}
      {children}
      {activeRunId ? (
        <div
          className="agentkit-activities-static agentkit-active-run-actions"
          data-agentkit-active-run-id-copy="true"
        >
          {activeRunRequestIdCopyStatus ? (
            <span
              className={cn(
                "agentkit-active-run-actions-feedback",
                activeRunRequestIdCopyStatus === "failed" &&
                  "agentkit-active-run-actions-feedback-error",
              )}
              role={
                activeRunRequestIdCopyStatus === "failed" ? "alert" : "status"
              }
            >
              {activeRunRequestIdCopyStatus === "copied" ? (
                <IconCircleCheck size={14} aria-hidden="true" />
              ) : (
                <IconAlertTriangle size={14} aria-hidden="true" />
              )}
              {activeRunRequestIdCopyStatus === "copied"
                ? t("agentChat.common.copied")
                : t("agentChat.recovery.copyFailed")}
            </span>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label={t("agentChat.message.actions")}
                title={t("agentChat.message.actions")}
                icon={<IconDotsVertical aria-hidden="true" />}
                size="compact"
                className="agentkit-active-run-actions-trigger"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6}>
              <DropdownMenuItem onSelect={() => void copyActiveRunRequestId()}>
                {activeRunRequestIdCopyStatus === "copied" ? (
                  <IconCircleCheck size={14} aria-hidden="true" />
                ) : activeRunRequestIdCopyStatus === "failed" ? (
                  <IconAlertTriangle size={14} aria-hidden="true" />
                ) : (
                  <IconCopy size={14} aria-hidden="true" />
                )}
                {t("agentChat.message.copyRequestId")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      {handoffMessages.map((message) => (
        <MessageView key={message.id} value={message} threadId={threadId} />
      ))}
      {showThinking ? (
        <div
          className="agentkit-activities agentkit-activities-summary-content"
          role="status"
          aria-live="polite"
        >
          <span
            className="agentkit-activities-current"
            data-running="true"
            data-agentkit-current-activity="true"
          >
            <span className="agentkit-activities-current-label agent-running-shimmer">
              {t("agentChat.status.thinking")}
            </span>
          </span>
        </div>
      ) : null}
      {surface.props.showGuidedQuestions !== false &&
      guided.questions?.length ? (
        <div className="px-3 pb-3">
          <GuidedQuestionFlow
            questions={guided.questions}
            onSubmit={guided.handleSubmit}
            onSkip={guided.handleSkip}
            isSubmitting={guided.isSubmitting}
            isSubmissionBlocked={!surface.canChat}
            providerStatus={surface.providerStatus}
            modelListUnavailable={surface.modelListUnavailable}
            showProviderStatusGate={!composerShowsSetupCard(surface)}
            onRetryProviderStatus={
              surface.modelListUnavailable
                ? surface.retryModelList
                : surface.retryProviderStatus
            }
            {...(guided.title ? { title: guided.title } : {})}
            {...(guided.description ? { description: guided.description } : {})}
            {...(guided.skipLabel ? { skipLabel: guided.skipLabel } : {})}
            {...(guided.submitLabel ? { submitLabel: guided.submitLabel } : {})}
            className="h-auto items-stretch justify-stretch bg-transparent"
          />
        </div>
      ) : null}
      {renderThreadSlot(
        surface.props.threadFooterSlot,
        threadId,
        surface.props.tabId,
      )}
    </>
  );
}

function renderThreadSlot(
  slot: AssistantChatProps["threadContentSlot"],
  threadId: string,
  tabId?: string,
) {
  return typeof slot === "function"
    ? slot({ threadId, tabId: tabId ?? null })
    : slot;
}

function composerPlaceholder({
  props,
  setupMissing,
  isRunning,
  thread,
  t,
}: {
  props: AgentKitAssistantChatProps;
  setupMissing: boolean;
  isRunning: boolean;
  thread: ReturnType<typeof useAgentThread>;
  t: ReturnType<typeof useT>;
}) {
  if (setupMissing) return t("agentChat.setup.connectPlaceholder");
  if (props.composerDisabled) {
    return (
      props.composerDisabledPlaceholder ?? t("agentChat.composer.openDesktop")
    );
  }
  if (isRunning) {
    return thread.queuedMessages.length
      ? t("agentChat.queue.followUpWithCount", {
          count: thread.queuedMessages.length,
        })
      : t("agentChat.queue.followUp");
  }
  // Idle: the composer picks the new-chat or reply label from the thread.
  return undefined;
}

function resolveAgentKitSuggestionInputs(
  prompts: readonly string[] | undefined,
  provided: readonly AgentSuggestionInput[] | undefined,
): AgentSuggestionInput[] | undefined {
  if (!prompts?.length) return undefined;
  const byPrompt = new Map(
    (provided ?? []).map((suggestion) => [
      agentSuggestionPrompt(suggestion),
      suggestion,
    ]),
  );
  return prompts.map((prompt) => byPrompt.get(prompt) ?? prompt);
}

function pendingSelectionPromptContext(
  selection: PendingSelectionContext | null,
): string {
  if (
    !selection?.text ||
    Date.now() - selection.capturedAt > PENDING_SELECTION_TTL_MS
  ) {
    return "";
  }
  const selectedText = selection.text.slice(0, MAX_SELECTION_CONTEXT_CHARS);
  const truncationNotice =
    selection.text.length > MAX_SELECTION_CONTEXT_CHARS
      ? "\n\n…[selection truncated after 8,000 characters. Use an app data action if the omitted text is required.]"
      : "";
  // i18n-ignore: This instruction is internal prompt context, never rendered as product copy.
  return (
    "The user selected this text and pressed Cmd+I to focus the agent. " +
    "Treat it as the immediate context to act on:\n<selection>\n" /* i18n-ignore: Internal prompt instruction and selection delimiters, never product copy. */ +
    selectedText +
    truncationNotice +
    "\n</selection>" /* i18n-ignore: Internal prompt envelope delimiter, never shown as product copy. */
  );
}

class AgentKitComposerContextError extends Error {
  readonly code = "composer_context_mismatch";

  constructor(message: string) {
    super(message);
    this.name = "AgentKitComposerContextError";
  }
}

function AgentKitComposerSurface({
  threadId,
  props,
  composerContext,
  canChat,
  setupMissing,
  providerStatus,
  modelListUnavailable,
  retryProviderStatus,
  retryModelList,
  fileStorageConfigured,
  fileStorageMissing,
  retryFileStorageStatus,
  deferredSubmissionFailed,
  deferredSubmissionRequiresAttachment,
  retryDeferredSubmission,
  dismissDeferredSubmission,
  isRunning,
  isRestoring,
  isSubmissionInFlight,
  composerSubmissionPending,
  onComposerSubmissionPendingChange,
  isThinkingVisibleInTranscript,
  hasRenderedMessages,
  threadRestore,
  suggestions,
  showSuggestions,
  setupBouncePulse,
  bounceSetupCard,
  onComposerSetupRequiredChange,
  contextItems,
  providerContextItems,
  selectionLength,
  prefillRevision,
  text,
  onTextChange,
  onRemoveContextItem,
  onClearSelection,
  onSubmit,
  submitSuggestion,
  suggestionSubmitRef,
  onImplementPlan,
}: {
  threadId: string;
  props: AgentKitAssistantChatProps;
  composerContext?: AssistantChatComposerContext;
  canChat: boolean;
  setupMissing: boolean;
  providerStatus: AgentEngineConfiguredState;
  modelListUnavailable: boolean;
  retryProviderStatus: () => void;
  retryModelList?: () => void;
  fileStorageConfigured: boolean;
  fileStorageMissing: boolean;
  retryFileStorageStatus: () => void;
  deferredSubmissionFailed: boolean;
  deferredSubmissionRequiresAttachment: boolean;
  retryDeferredSubmission: () => Promise<void>;
  dismissDeferredSubmission: () => Promise<void>;
  isRunning: boolean;
  isRestoring: boolean;
  isSubmissionInFlight: boolean;
  composerSubmissionPending: boolean;
  onComposerSubmissionPendingChange: (pending: boolean) => void;
  isThinkingVisibleInTranscript: boolean;
  hasRenderedMessages: boolean;
  setupBouncePulse: number;
  bounceSetupCard: () => void;
  onComposerSetupRequiredChange: (required: boolean) => void;
  contextItems: AgentChatContextItem[];
  providerContextItems: { current: readonly AgentChatContextItem[] };
  selectionLength: number | null;
  prefillRevision: number;
  text: string;
  onTextChange: (text: string) => void;
  onRemoveContextItem: (key: string) => void;
  onClearSelection: () => void;
  onSubmit: AgentKitComposerSubmit;
  threadRestore:
    | { status: "ready" | "loading" }
    | { status: "error"; notFound: boolean };
  suggestions: AgentSuggestionInput[];
  showSuggestions: boolean;
  submitSuggestion: (suggestion: AgentSuggestionInput) => void;
  suggestionSubmitRef: AgentKitSuggestionSubmitRef;
  onImplementPlan: () => boolean;
}) {
  const t = useT();
  const [composerError, setComposerError] = useState<string | null>(null);
  useEffect(() => setComposerError(null), [threadId]);
  React.useLayoutEffect(() => {
    providerContextItems.current = composerContext?.contextItems ?? [];
    return () => {
      providerContextItems.current = [];
    };
  }, [composerContext?.contextItems, providerContextItems]);
  const mounted = useRef(true);
  const submissionAllowed = useRef(false);
  submissionAllowed.current =
    !props.composerDisabled &&
    !props.composerSubmissionDisabled &&
    !isRestoring &&
    props.isActiveComposer !== false;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const providerContextKeys = new Set(
    composerContext?.contextItems.map((item) => item.key),
  );
  const visibleContextItems = composerContext
    ? [...contextItems, ...composerContext.contextItems]
    : contextItems;
  const submissionScope = JSON.stringify([
    threadId,
    props.tabId,
    props.contextScope?.type ?? null,
    props.contextScope?.id ?? null,
  ]);
  const currentSubmissionScope = useRef(submissionScope);
  currentSubmissionScope.current = submissionScope;
  const { controller } = useAgentKit();
  const composerRef = useRef<TiptapComposerHandle>(null);
  const selectedSuggestionRef = useRef<
    Exclude<AgentSuggestionInput, string> | undefined
  >(undefined);
  const submitComposer = async (
    message: string,
    files: PromptComposerFile[],
    references: Reference[],
    options: AgentKitSuggestionSubmitOptions,
  ) => {
    options = {
      ...options,
      ...(selectedSuggestionRef.current
        ? { suggestion: selectedSuggestionRef.current }
        : {}),
    };
    setComposerError(null);
    const assertSubmissionScope = () => {
      const latest = controller.getThread(threadId);
      if (
        !mounted.current ||
        currentSubmissionScope.current !== submissionScope ||
        (options.suggestion &&
          (latest.messages.length || Object.keys(latest.runs).length) &&
          !isCurrentAgentSuggestion(latest, options.suggestion))
      ) {
        throw Object.assign(
          new Error(t("agentChat.composer.submissionScopeChanged")),
          { code: "submission_scope_changed" },
        );
      }
    };
    const assertCurrentSubmission = () => {
      if (!submissionAllowed.current) {
        throw Object.assign(
          new Error(t("agentChat.composer.submissionNotReady")),
          { code: "submission_not_ready" },
        );
      }
      assertSubmissionScope();
    };
    assertCurrentSubmission();
    options = {
      ...options,
      validateSubmission: assertCurrentSubmission,
      validateSubmissionScope: assertSubmissionScope,
    };
    const captured = snapshotComposerContextItems(
      options.contextItems ?? visibleContextItems,
    );
    let prepared: AssistantChatComposerContext["contextItems"] | undefined;
    await onSubmit(message, files, references, options, async () => {
      assertCurrentSubmission();
      if (!composerContext) return { ...options, contextItems: captured };
      const capturedProvider = snapshotComposerContextItems(
        captured.filter((item) => providerContextKeys.has(item.key)),
      );
      prepared = await composerContext.prepareSubmission(capturedProvider);
      const preparedSnapshot = snapshotComposerContextItems(prepared);
      const capturedKeys = new Set(capturedProvider.map((item) => item.key));
      const preparedByKey = new Map(
        preparedSnapshot.map((item) => [item.key, item]),
      );
      if (
        preparedByKey.size !== preparedSnapshot.length ||
        preparedByKey.size !== capturedKeys.size ||
        preparedSnapshot.some((item) => !capturedKeys.has(item.key))
      ) {
        throw new AgentKitComposerContextError(t("agentChat.error.failed"));
      }
      const refreshed = captured.map((item) =>
        capturedKeys.has(item.key) ? preparedByKey.get(item.key)! : item,
      );
      // Preparing can grow provider items past the limit the staging check saw; refuse
      // here, before the send is accepted, rather than fail the send later.
      if (!composerContextFits(refreshed)) {
        throw new AgentKitComposerContextError(t("agentChat.error.failed"));
      }
      assertCurrentSubmission();
      return { ...options, contextItems: refreshed };
    });
    if (prepared) composerContext?.submissionAccepted(prepared);
  };
  React.useLayoutEffect(() => {
    const registration = {
      threadId,
      submit: async (suggestion: AgentSuggestionInput) => {
        const latest = controller.getThread(threadId);
        if (hasActiveAgentRuns(latest)) return;
        if (
          (latest.messages.length || Object.keys(latest.runs).length) &&
          (typeof suggestion === "string" ||
            !isCurrentAgentSuggestion(latest, suggestion))
        )
          return;
        const composer = composerRef.current;
        if (!composer || selectedSuggestionRef.current) return;
        const selected =
          typeof suggestion === "string" ? undefined : suggestion;
        selectedSuggestionRef.current = selected;
        try {
          await composer.submitWithText(agentSuggestionPrompt(suggestion));
        } catch (error) {
          if (mounted.current)
            setComposerError(
              error instanceof Error
                ? error.message
                : t("agentChat.error.failed"),
            );
          throw error;
        } finally {
          if (selectedSuggestionRef.current === selected)
            selectedSuggestionRef.current = undefined;
        }
      },
    };
    suggestionSubmitRef.current = registration;
    return () => {
      if (suggestionSubmitRef.current === registration)
        suggestionSubmitRef.current = null;
    };
  });
  const [fileStoragePromptOpen, setFileStoragePromptOpen] = useState(false);
  const fileStorageAnchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fileStorageConfigured) setFileStoragePromptOpen(false);
  }, [fileStorageConfigured]);
  const requestFileStorage = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setFileStoragePromptOpen(true);
  }, []);
  const thread = useAgentThread(threadId);
  const providerSubmissionPending =
    !canChat &&
    !setupMissing &&
    (providerStatus === "unknown" || providerStatus === "unavailable");
  // Missing setup keeps the draft editable and sendable: the composer's send
  // gate holds the draft, points at the setup card, and resends it once setup
  // connects.
  const providerBlocksComposer =
    !canChat && !setupMissing && !providerSubmissionPending;
  const latestAssistant = [...thread.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const showPlanCallout =
    getReplyRequestMode(thread.messages, latestAssistant) === "plan" &&
    !isRunning &&
    !props.planModeDisabled &&
    !props.composerDisabled;
  const submissionHoldsTurn = useAgentKitSubmissionHoldsTurn(threadId);
  const stopButton = useAgentKitStopButton({
    label: t("agentChat.composer.stopResponse"),
    threadId,
    beforeCancel: async () => {
      setComposerError(null);
      return !props.onStop || (await props.onStop()) !== false;
    },
    onError: (error) => setComposerError(error.message),
  });
  const showHomeIntro =
    props.homeIntroSlot &&
    !hasRenderedMessages &&
    threadRestore.status === "ready";
  const showHomeSuggestions =
    props.centerComposerWhenEmpty &&
    !hasRenderedMessages &&
    threadRestore.status === "ready" &&
    props.suggestionPlacement === "context-chips" &&
    showSuggestions &&
    suggestions.length > 0;
  // Starters for a docked chat share the follow-up row above the composer,
  // so the chips never move when the first message lands.
  const showSuggestionsSlot =
    props.suggestionPlacement !== "hidden" &&
    (hasRenderedMessages ||
      (props.suggestionPlacement === "context-chips" &&
        !showHomeSuggestions &&
        threadRestore.status === "ready"));
  const showAfterComposerSuggestions =
    props.suggestionPlacement === "after-composer" &&
    !hasRenderedMessages &&
    threadRestore.status === "ready" &&
    showSuggestions &&
    suggestions.length > 0;
  const showAfterComposerSlot =
    props.afterComposerSlot &&
    !hasRenderedMessages &&
    threadRestore.status === "ready";
  return (
    <div
      ref={fileStorageAnchorRef}
      className={cn(
        "agentkit-host-composer",
        setupMissing && "agent-composer-area--attached-above",
        props.composerAreaClassName,
      )}
    >
      <FileStorageSetupPopover
        open={fileStoragePromptOpen && !fileStorageConfigured}
        onOpenChange={setFileStoragePromptOpen}
        onConnected={retryFileStorageStatus}
        anchorRef={fileStorageAnchorRef}
        {...(fileStorageMissing
          ? { status: "missing" as const }
          : {
              status: "unavailable" as const,
              onRetry: retryFileStorageStatus,
            })}
      />
      {props.composerSlot}
      {props.composerContextBannerSlot}
      {showHomeIntro ? (
        <div className="agentkit-home-intro">{props.homeIntroSlot}</div>
      ) : null}
      {showHomeSuggestions ? (
        <AgentKitSuggestedPrompts
          suggestions={suggestions}
          disabled={
            !canChat ||
            props.composerDisabled ||
            props.composerSubmissionDisabled ||
            isSubmissionInFlight ||
            composerSubmissionPending
          }
          onSelect={submitSuggestion}
          className="agentkit-home-suggestions"
        />
      ) : null}
      {showPlanCallout ? (
        <PlanModeCallout onImplementPlan={onImplementPlan} />
      ) : null}
      {setupMissing &&
      props.showMissingApiKeySetup !== false &&
      props.setupCardOwner !== "host" ? (
        <BuilderSetupCard
          fullWidth
          attached
          bouncePulse={setupBouncePulse}
          layout={props.missingApiKeySetupLayout ?? "default"}
          onConnected={() =>
            window.dispatchEvent(new Event("agent-engine:configured-changed"))
          }
        />
      ) : null}
      {!setupMissing &&
      (modelListUnavailable ||
        (!canChat && providerStatus !== "configured")) ? (
        <GuidedQuestionProviderGate
          providerStatus={providerStatus}
          modelListUnavailable={modelListUnavailable}
          onRetry={modelListUnavailable ? retryModelList : retryProviderStatus}
        />
      ) : null}
      {selectionLength !== null && selectionLength > 0 ? (
        <AgentKitSelectionPill
          length={selectionLength}
          onClear={onClearSelection}
        />
      ) : null}
      {showSuggestionsSlot ? (
        <div
          className="agentkit-host-suggestions-slot"
          data-agentkit-host-suggestions-slot="true"
        >
          {showSuggestions && suggestions.length > 0 ? (
            <AgentKitSuggestedPrompts
              suggestions={suggestions}
              disabled={
                !canChat ||
                props.composerDisabled ||
                props.composerSubmissionDisabled ||
                isSubmissionInFlight ||
                composerSubmissionPending
              }
              onSelect={submitSuggestion}
              className="agentkit-host-suggestions"
              layout="single-line"
            />
          ) : null}
        </div>
      ) : null}
      <div className="relative">
        <AgentKitComposer
          threadId={threadId}
          isReferenceTarget={props.isReferenceTarget !== false}
          requireAgentEngine
          disabled={
            providerBlocksComposer || props.composerDisabled || isRestoring
          }
          submissionDisabled={
            providerBlocksComposer ||
            props.composerSubmissionDisabled === true ||
            // A submission that already holds the turn takes the next draft
            // into the queue behind it.
            (isSubmissionInFlight && !submissionHoldsTurn)
          }
          onDisabledClick={
            props.composerDisabled || !setupMissing
              ? undefined
              : () => {
                  bounceSetupCard();
                  window.dispatchEvent(
                    new CustomEvent("agent-chat:missing-api-key", {
                      detail: { tabId: props.tabId, threadId },
                    }),
                  );
                }
          }
          initialText={text}
          initialTextKey={`${props.tabId ?? threadId}:${prefillRevision}`}
          showMissingApiKeySetup={false}
          setupCardVisible={composerShowsSetupCard({ setupMissing, props })}
          onModelConnectionRequiredChange={onComposerSetupRequiredChange}
          onTextChange={onTextChange}
          announcePendingSubmission={!isThinkingVisibleInTranscript}
          onSubmissionPendingChange={onComposerSubmissionPendingChange}
          contextItems={visibleContextItems}
          contextMenuItems={composerContext?.menuItems}
          onRemoveContextItem={(key) => {
            if (providerContextKeys.has(key))
              composerContext?.onRemoveContextItem(key);
            else onRemoveContextItem(key);
          }}
          onRetryContextItem={composerContext?.onRetryContextItem}
          interceptBuildRequestsForBuilder={isInBuilderFrame()}
          selectedModel={props.selectedModel ?? props.defaultModel}
          contextUsageSlot={
            <ThreadContextRing
              threadId={threadId}
              model={props.selectedModel ?? props.defaultModel}
              enabled={threadHasFinishedReply(thread.messages)}
            />
          }
          selectedEngine={props.selectedEngine}
          selectedEffort={props.selectedEffort}
          availableModels={props.availableModels}
          modelListLoading={props.modelListLoading}
          onModelChange={props.onModelChange}
          onEffortChange={props.onEffortChange}
          availableAgents={props.availableAgents}
          selectedAgent={props.selectedAgent}
          agentOnly={props.hostedHarness}
          onAgentChange={props.onAgentChange}
          showModelSelector={props.showModelSelector}
          planModeDisabled={props.planModeDisabled}
          layoutVariant={props.composerLayoutVariant}
          plusMenuMode={props.plusMenuMode}
          placeholder={composerPlaceholder({
            props,
            setupMissing,
            isRunning,
            thread,
            t,
          })}
          onConnectProvider={props.onConnectProvider}
          onConnectLocalRuntime={props.onConnectLocalRuntime}
          imageModelMenu={props.imageModelMenu}
          voiceEnabled
          toolbarSlot={
            <>
              {props.selectedEngine === CHATGPT_SUBSCRIPTION_ENGINE_NAME ? (
                <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{t("agentChat.composer.chatgptPlanUsing")}</span>
                  <a
                    href="https://chatgpt.com/settings/usage"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    {t("agentChat.composer.chatgptManageUsage")}
                  </a>
                </span>
              ) : null}
              <AgentSelectToggle
                reservedContextItems={composerContext?.contextItems}
              />
              {props.composerToolbarSlot}
            </>
          }
          extraActionButton={props.composerExtraActionButton}
          includeDefaultSlashCommands
          includeDefaultSlashSkills
          onSlashCommand={props.onSlashCommand}
          modelStatusChecksEnabled={
            props.showModelSelector !== false &&
            props.availableModels === undefined
          }
          attachmentsEnabled={fileStorageConfigured}
          onAttachmentRequest={requestFileStorage}
          contextButtonTooltipDisabled={fileStoragePromptOpen}
          onAttachmentError={setComposerError}
          onSubmit={submitComposer}
          composerRef={composerRef}
          stopButton={stopButton}
        />
        {deferredSubmissionFailed ? (
          <ComposerNotice
            role="alert"
            noticeId="deferred-submission"
            actions={
              !deferredSubmissionRequiresAttachment ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={!canChat || isSubmissionInFlight}
                  onClick={() =>
                    void retryDeferredSubmission().catch(() => undefined)
                  }
                >
                  {t("agentChat.common.retry")}
                </Button>
              ) : undefined
            }
            onDismiss={() =>
              void dismissDeferredSubmission().catch(() => undefined)
            }
            dismissLabel={t("agentChat.common.dismissError")}
          >
            {t(
              deferredSubmissionRequiresAttachment
                ? "agentChat.recovery.retryAttachmentUnavailable"
                : "agentChat.recovery.deferredSubmissionFailed",
            )}
          </ComposerNotice>
        ) : null}
        {composerError ? (
          <ComposerNotice
            role="alert"
            noticeId="composer"
            onDismiss={() => setComposerError(null)}
            dismissLabel={t("agentChat.common.dismissError")}
          >
            <span {...SESSION_REPLAY_MASK_PROPS}>{composerError}</span>
          </ComposerNotice>
        ) : null}
        <ExternalAgentNudge variant="prompt" />
      </div>
      {showAfterComposerSuggestions ? (
        <AgentKitSuggestedPrompts
          suggestions={suggestions}
          disabled={
            !canChat ||
            props.composerDisabled ||
            props.composerSubmissionDisabled ||
            isSubmissionInFlight ||
            composerSubmissionPending
          }
          onSelect={submitSuggestion}
          className="agentkit-home-suggestions"
        />
      ) : null}
      {showAfterComposerSlot ? (
        <div className="agentkit-after-composer-slot">
          {props.afterComposerSlot}
        </div>
      ) : null}
      {composerContext?.dialogs}
    </div>
  );
}

function AgentKitSuggestedPrompts({
  suggestions,
  disabled,
  onSelect,
  className,
  layout,
}: {
  suggestions: AgentSuggestionInput[];
  disabled: boolean;
  onSelect: (suggestion: AgentSuggestionInput) => void;
  className: string;
  layout?: "wrap" | "single-line";
}) {
  const t = useT();
  return (
    <AgentSuggestionBar
      ariaLabel={t("agentChat.composer.suggestedPrompts")}
      title={t("agentChat.composer.suggestedActions")}
      suggestions={suggestions.map((suggestion, index) => ({
        ...(typeof suggestion === "string"
          ? {
              id: `host-suggestion-${index}-${suggestion}`,
              label: suggestion,
              prompt: suggestion,
            }
          : suggestion),
        disabled: Boolean(
          disabled || (typeof suggestion !== "string" && suggestion.disabled),
        ),
      }))}
      onSelect={onSelect}
      className={className}
      layout={layout}
    />
  );
}

function AgentKitUserMessage(props: AgentKitRenderProps<AgentMessage>) {
  const message = props.value;
  if (message.role !== "user") return <AgentMessageView {...props} />;
  if (message.metadata?.hideUserMessage === true) return null;
  const visible: AgentMessage = {
    ...message,
    parts: message.parts.map((part) =>
      part.type === "text"
        ? { ...part, text: splitAgentChatContextFromMessage(part.text).message }
        : part,
    ),
  };
  return <AgentMessageView {...props} value={visible} />;
}

interface AgentKitSuggestionContext extends LatestReplyContext {
  runsActive: boolean;
}

const NO_SUGGESTION_CONTEXT: AgentKitSuggestionContext = {
  isLatest: false,
  userText: "",
  agentRequestedProviders: "",
  runsActive: true,
};

function AgentKitMessageSupplement(props: AgentKitRenderProps<AgentMessage>) {
  const value = props.value;
  const t = useT();
  const surface = useAgentKitSurface();
  const isAssistant = value.role === "assistant";
  // Every row renders this, so it reads only what it shows; a whole-thread
  // subscription would re-render every row on every streamed delta.
  const suggestion = useAgentThreadSelector(
    (thread): AgentKitSuggestionContext => {
      const context = isAssistant
        ? latestReplyContext(thread, value.id)
        : undefined;
      return context?.isLatest
        ? { ...context, runsActive: hasActiveAgentRuns(thread) }
        : NO_SUGGESTION_CONTEXT;
    },
    (previous, next) =>
      previous.isLatest === next.isLatest &&
      previous.userText === next.userText &&
      previous.agentRequestedProviders === next.agentRequestedProviders &&
      previous.runsActive === next.runsActive,
    props.threadId,
  );
  const text = value.parts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
  const excludedIntegrationIds =
    surface.props.mcpSuggestionExcludedIntegrationIds;
  const replyFinished = value.status === "complete" && !suggestion.runsActive;
  // The streaming row re-renders on every delta; its ask is read once done.
  const replyText = replyFinished ? text : "";
  const integration = useMemo(
    () =>
      isAssistant
        ? pickReplyConnectionSuggestion({
            context: suggestion,
            replyText,
            replyFinished,
            find: (message) =>
              findMcpConnectionSuggestionIntegration({
                text: message,
                variant: "response",
                ...(excludedIntegrationIds ? { excludedIntegrationIds } : {}),
              }),
          })
        : null,
    [excludedIntegrationIds, isAssistant, replyFinished, replyText, suggestion],
  );
  const runWarning = asRecord(asRecord(value.metadata?.custom)?.runWarning);
  const missingFinalResponse =
    runWarning?.errorCode === "final_response_missing_after_tool";
  const loopBreakerStopped = runWarning?.errorCode === "tool_loop_stopped";
  return (
    <>
      {missingFinalResponse ? (
        <div
          className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-xs text-muted-foreground"
          role="status"
        >
          {t("agentChat.message.missingFinal")}
        </div>
      ) : null}
      {loopBreakerStopped ? (
        <div
          className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-xs text-muted-foreground"
          role="status"
        >
          <span>{t("agentChat.error.stopped")}</span>
        </div>
      ) : null}
      {value.role === "assistant" && value.status === "complete" ? (
        <>
          <AgentKitFilesChangedSummary {...props} />
          <AgentKitDevCheckpointRestore message={value} />
        </>
      ) : null}
      {integration ? (
        <McpConnectionSuggestion
          text={text}
          contextText={suggestion.userText}
          variant="response"
          requestedByAgent
          excludedIntegrationIds={
            surface.props.mcpSuggestionExcludedIntegrationIds
          }
          integrationId={integration.id}
        />
      ) : null}
    </>
  );
}

function AgentKitTool({ value, active }: AgentKitRenderProps<AgentToolCall>) {
  const surface = useAgentKitSurface();
  const metadata = value.metadata ?? {};
  const input = asRecord(value.input) ?? {};
  const errorOutput =
    value.status === "failed"
      ? Array.from(
          new Set(
            [
              value.error?.message?.trim(),
              formatErrorDetails(value.error?.details),
              formatErrorDetails(value.output),
            ].filter((detail): detail is string => Boolean(detail?.trim())),
          ),
        ).join("\n\n") || undefined
      : undefined;
  const output =
    errorOutput ??
    (typeof value.output === "string"
      ? value.output
      : value.output === undefined
        ? undefined
        : JSON.stringify(value.output));
  return (
    <ChatRunningContext.Provider
      value={active === true || value.status === "running"}
    >
      <SuppressInlineOpenAppContext.Provider
        value={surface.props.suppressInlineOpenApp === true}
      >
        <ToolCallDisplay
          toolName={value.name}
          toolCallId={value.id}
          args={input}
          argsText={JSON.stringify(input)}
          result={output}
          status={value.status}
          isError={value.status === "failed"}
          isRunning={value.status === "running"}
          structuredMeta={metadata}
          mcpApp={asRecord(metadata.mcpApp) as never}
          chatUI={asRecord(metadata.chatUI) as never}
          activity={metadata.activity === true}
          isActiveTail={active === true}
          workedForRowLayout={surface.props.workedForRowLayout}
          dataChartLayout={surface.props.dataChartLayout}
          formatWorkedForDuration={surface.props.formatWorkedForDuration}
        />
      </SuppressInlineOpenAppContext.Provider>
    </ChatRunningContext.Provider>
  );
}

function AgentKitApproval({
  value,
  runId,
}: AgentKitRenderProps<AgentApprovalRequest> & { runId: string }) {
  const surface = useAgentKitSurface();
  const control = useAgentKitControl();
  const actions = surface.props.approvalActions;
  const t = useT();
  const [pending, setPending] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const metadata = asRecord(value.metadata);
  const toolName =
    typeof metadata?.toolName === "string"
      ? metadata.toolName
      : (value.description ?? "");
  const exactCommandScope = actions?.alwaysAllowScope === "exact-command";
  const allowPersistentApproval = metadata?.allowPersistentApproval !== false;
  if (
    approvalRequestKind(value) !== "approval" ||
    value.options?.length ||
    value.input
  ) {
    return <AgentApprovalPrompt request={value} runId={runId} />;
  }
  const resolve = async (decision: "approve" | "deny") => {
    setPending(true);
    setSaveFailed(false);
    try {
      await control.resolveApproval(runId, value.id, {
        decision,
        optionIds: [decision],
      });
      if (decision === "deny") actions?.onDeny?.(value.id);
    } catch {
      setSaveFailed(true);
    } finally {
      setPending(false);
    }
  };
  const alwaysAllow = async () => {
    setPending(true);
    setSaveFailed(false);
    try {
      if (actions?.onAlwaysAllow) {
        await actions.onAlwaysAllow(value.id, toolName);
      } else {
        await callAction("set-tool-approval-policy", {
          toolName,
          enabled: true,
          ...(typeof metadata?.approvalAskId === "string"
            ? { approvalId: metadata.approvalAskId }
            : {}),
        });
      }
      await control.resolveApproval(runId, value.id, {
        decision: "approve",
        optionIds: ["approve"],
      });
    } catch {
      setSaveFailed(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <AgentApprovalCard
      toolName={toolName}
      question={value.title}
      approveLabel={t("agentChat.approval.approve")}
      denyLabel={t("agentChat.approval.deny")}
      moreOptionsLabel={t("agentChat.approval.moreOptions")}
      alwaysAllowLabel={t(
        exactCommandScope
          ? "agentChat.approval.alwaysAllow"
          : "agentChat.approval.alwaysAllowAction",
      )}
      alwaysAllowHint={t(
        exactCommandScope
          ? "agentChat.approval.alwaysAllowHint"
          : "agentChat.approval.alwaysAllowActionHint",
      )}
      saveFailedLabel={
        saveFailed ? t("agentChat.common.saveFailed") : undefined
      }
      isAlwaysAllowing={pending}
      onApprove={() => void resolve("approve")}
      onDeny={() => void resolve("deny")}
      onAlwaysAllow={
        allowPersistentApproval &&
        (actions?.onAlwaysAllow || !exactCommandScope)
          ? alwaysAllow
          : undefined
      }
    />
  );
}

function AgentKitReasoning({
  value,
  active,
  resetKey,
}: AgentKitRenderProps<
  Extract<AgentMessage["parts"][number], { type: "reasoning" }>
>) {
  const inWorkStep = useAgentKitInWorkStep();
  if (value.visibility === "hidden") return null;
  return (
    <ReasoningCell
      text={value.text}
      isStreaming={active}
      defaultOpen={active}
      resetKey={resetKey}
      inline={inWorkStep}
    />
  );
}

function AgentKitFailedInteraction(
  props: AgentKitRenderProps<AgentInteraction>,
) {
  const t = useT();
  const reasonKey = props.value.metadata?.failureReasonKey;
  if (typeof reasonKey !== "string") return <AgentInteractionItem {...props} />;
  // The key comes from persisted run state, so one this build does not know
  // falls back to the generic reason rather than printing the key.
  const detail = t(reasonKey, {
    defaultValue: t("agentChat.agent.failureReason.failed"),
  });
  return <AgentInteractionItem {...props} value={{ ...props.value, detail }} />;
}

function AgentKitConnectionRequest({
  value,
  runId,
  threadId,
}: AgentKitRenderProps<AgentConnectionRequest> & { runId: string }) {
  const surface = useAgentKitSurface();
  const control = useAgentKitControl();
  return (
    <McpAgentKitConnectionRequestCard
      provider={value.provider}
      detail={value.detail}
      reason={value.reason}
      status={value.status}
      appId={value.appId}
      source={value.source}
      excludedIntegrationIds={surface.props.mcpSuggestionExcludedIntegrationIds}
      target={{ threadId, runId, requestId: value.id }}
      onConnected={() =>
        control.resolveConnectionRequest(runId, value.id, {
          status: "connected",
        })
      }
      onDeclined={() =>
        control.resolveConnectionRequest(runId, value.id, {
          status: "declined",
        })
      }
    />
  );
}

function AgentKitRunFailure({
  error,
  runId,
  threadId,
}: {
  error: {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
  };
  runId: string;
  threadId: string;
}) {
  const { session } = useSession();
  const control = useAgentKitControl(threadId);
  const thread = useAgentThread(threadId);
  const surface = useAgentKitSurface();
  const t = useT();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [continueFailed, setContinueFailed] = useState(false);
  const [retryWithoutAttachmentFailed, setRetryWithoutAttachmentFailed] =
    useState(false);
  const authErrorReason =
    error.code === "unauthorized" || error.code === "http_401"
      ? "session-expired"
      : error.code === "forbidden" || error.code === "http_403"
        ? "auth-required"
        : undefined;
  useEffect(() => {
    if (!authErrorReason) return;
    window.dispatchEvent(
      new CustomEvent("agent-chat:auth-error", {
        detail: {
          reason: authErrorReason,
          tabId: surface.props.tabId,
          threadId,
        },
      }),
    );
  }, [authErrorReason, surface.props.tabId, threadId]);
  const setupFailure = isAiSetupRunFailure(error);
  const supersededAt = thread.runs[runId]?.startedAt;
  const superseded = Object.values(thread.runs).some(
    (run) =>
      run.id !== runId &&
      Boolean(run.startedAt && supersededAt && run.startedAt > supersededAt),
  );
  const newerCreditsLimitRun =
    isCreditsLimitErrorCode(error.code) &&
    Object.values(thread.runs).some(
      (run) =>
        run.id !== runId &&
        isCreditsLimitErrorCode(run.error?.code) &&
        ((run.startedAt ?? "") > (supersededAt ?? "") ||
          ((run.startedAt ?? "") === (supersededAt ?? "") && run.id > runId)),
    );
  const lastUserMessage = [...thread.messages]
    .reverse()
    .find((message) => message.role === "user");
  const failedPrompt = userMessageForRun(thread.messages, runId);
  const retryRequest = retryRequestFrom(failedPrompt ?? lastUserMessage);
  const failedAttachmentNames = retryAttachmentNames(retryRequest);
  const canRetryWithoutAttachment =
    error.code === "invalid_attachment" && failedAttachmentNames.length > 0;
  const alreadyRetried = wasRetried(
    thread.messages,
    runId,
    failedPrompt?.id,
    lastUserMessage?.id,
  );
  const retryFailedTurn = () => sendRetryRequest(surface, retryRequest, runId);
  const retryWithoutAttachments =
    retryRequest.fileParts.length || retryRequest.requestAttachments.length
      ? () =>
          runContinueWithVisibleError(
            () =>
              sendRetryRequest(
                surface,
                {
                  ...retryRequest,
                  text: retryRequest.textWithContext,
                  fileParts: [],
                  requestAttachments: [],
                  hasUnavailableAttachment: false,
                },
                runId,
              ),
            setRetryWithoutAttachmentFailed,
          )
      : undefined;
  const resumeAfterSetup = useResumeAfterAiSetup(
    `${threadId}:${(failedPrompt ?? lastUserMessage)?.id ?? runId}`,
    setupFailure &&
      !superseded &&
      !alreadyRetried &&
      !retryRequest.hasUnavailableAttachment,
    () => sendRetryRequest(surface, retryRequest, runId, true),
  );
  // A refusal the user already moved past is stale; any other failure keeps
  // its Retry so a reloaded thread never shows an unanswered prompt.
  if (dismissed === runId || newerCreditsLimitRun) return null;
  if (setupFailure) {
    if (superseded || alreadyRetried) {
      return null;
    }
    if (composerShowsSetupCard(surface)) return null;
    return (
      <BuilderSetupCard
        fullWidth
        layout="default"
        onConnected={() => {
          window.dispatchEvent(new Event("agent-engine:configured-changed"));
          resumeAfterSetup();
        }}
        onRetry={
          retryRequest.hasUnavailableAttachment ? undefined : resumeAfterSetup
        }
      />
    );
  }
  if (error.code === "loop_limit") {
    const details = asRecord(error.details);
    return (
      <>
        <LoopLimitContinueCard
          info={{
            ...(typeof details?.maxIterations === "number"
              ? { maxIterations: details.maxIterations }
              : {}),
          }}
          onContinue={() =>
            runContinueWithVisibleError(
              () => sendContinueRequest(surface, retryRequest, runId),
              setContinueFailed,
            )
          }
        />
        {continueFailed ? (
          <ComposerNotice
            role="alert"
            noticeId="continue-failed"
            onDismiss={() => setContinueFailed(false)}
            dismissLabel={t("agentChat.common.dismiss")}
          >
            {t("agentChat.recovery.continueUnavailable")}
          </ComposerNotice>
        ) : null}
      </>
    );
  }
  if (wasRetried(thread.messages, runId)) return null;
  // Continuing resumes the stopped run's own turn, so finished steps are not
  // run again; that needs it to still be the turn's newest run.
  const continueStoppedRun = control.canContinueRun
    ? superseded
      ? undefined
      : () =>
          runContinueWithVisibleError(
            () => control.continueRun(runId),
            setContinueFailed,
          )
    : () =>
        runContinueWithVisibleError(
          () => sendContinueRequest(surface, retryRequest, runId),
          setContinueFailed,
        );
  const info: RunErrorInfo = {
    message: canRetryWithoutAttachment
      ? t("agentChat.errorMessages.invalidAttachmentNamed", {
          name: failedAttachmentNames.join(", "),
        })
      : formatAgentKitErrorText(error, t),
    errorCode: error.code,
    details: formatErrorDetails(error.details),
    runId,
    recoverable: error.retryable,
  };
  return (
    <>
      <RunErrorRecoveryCard
        info={info}
        verificationEmail={
          session?.emailVerified === true ? null : session?.email
        }
        verificationCallbackURL={
          session?.email &&
          session.emailVerified !== true &&
          typeof window !== "undefined"
            ? identityBootstrapCallbackHref(window.location.pathname, {
                enabled: session.identitySsoEnabled === true,
                bootstrapPath: agentNativePath(
                  "/_agent-native/identity/bootstrap",
                ),
                origin: window.location.origin,
              })
            : undefined
        }
        onContinue={continueStoppedRun}
        continueError={
          continueFailed ? t("agentChat.recovery.continueUnavailable") : null
        }
        onRetry={() => void retryFailedTurn()}
        onRetryWithoutAttachments={retryWithoutAttachments}
        retryHasUnavailableAttachment={retryRequest.hasUnavailableAttachment}
        onRetryWithoutAttachment={
          canRetryWithoutAttachment
            ? () =>
                runContinueWithVisibleError(
                  () =>
                    sendRetryRequestWithoutAttachments(
                      surface,
                      retryRequest,
                      runId,
                    ),
                  setRetryWithoutAttachmentFailed,
                )
            : undefined
        }
        onFork={async () => {
          if (!lastUserMessage) return surface.props.onForkChat?.();
          const fork = await control.fork(lastUserMessage.id);
          surface.props.onForkedThread?.(fork.id);
          return true;
        }}
        onDismiss={() => setDismissed(runId)}
      />
      {retryWithoutAttachmentFailed ? (
        <ComposerNotice
          role="alert"
          noticeId="retry-failed"
          onDismiss={() => setRetryWithoutAttachmentFailed(false)}
          dismissLabel={t("agentChat.common.dismiss")}
        >
          {t("agentChat.recovery.deferredSubmissionFailed")}
        </ComposerNotice>
      ) : null}
    </>
  );
}

/**
 * Sends a prompt that missing AI setup refused again, once: when setup goes
 * from missing to ready while the refusal is on screen, or through the
 * returned callback (the setup card's connect or retry). `resendKey` names the
 * prompt, so every card showing the same refusal sends it one time; another
 * tab learns it was sent from the retry's persisted marker (`enabled`). A
 * thread reopened after connecting elsewhere keeps its Retry button instead of
 * replaying.
 */
function useResumeAfterAiSetup(
  resendKey: string,
  enabled: boolean,
  resend: () => Promise<AssistantChatSubmitResult>,
): () => void {
  const surface = useAgentKitSurface();
  const sawSetupMissingRef = useRef(false);
  // A resend fires without a fresh user action, so only the server's answer
  // arms it; the model list's early guess can be briefly wrong.
  if (surface.setupConfirmedMissing) sawSetupMissingRef.current = true;
  const latestRef = useRef({ resendKey, enabled, resend });
  latestRef.current = { resendKey, enabled, resend };
  const resumed = surface.resumedAfterSetup;
  const resume = useCallback(() => {
    const {
      resendKey: key,
      enabled: canResend,
      resend: send,
    } = latestRef.current;
    if (!canResend || resumed.has(key)) return;
    resumed.add(key);
    const release = () => {
      resumed.delete(key);
    };
    void send().then((result) => {
      if (result.status === "rejected") release();
    }, release);
  }, [resumed]);
  const setupReady = surface.canChat && !surface.setupMissing;
  useEffect(() => {
    if (enabled && setupReady && sawSetupMissingRef.current) resume();
  }, [enabled, resume, setupReady]);
  return resume;
}

/** What retrying a failed or refused prompt sends again, read from its user message. */
function retryRequestFrom(message: AgentMessage | undefined) {
  const metadata = asRecord(message?.metadata);
  const custom = asRecord(metadata?.custom);
  const metadataString = (key: string) => {
    const value = metadata?.[key] ?? custom?.[key];
    return typeof value === "string" && value.trim() ? value : undefined;
  };
  const fileParts = message?.parts.filter((part) => part.type === "file") ?? [];
  const parsedRequestAttachments = parseRetryRequestAttachments(
    custom?.agentNativeRetryRequestAttachments,
  );
  const mode = metadataString("requestMode");
  const requestMode: "plan" | "act" | undefined =
    mode === "plan" || mode === "act" ? mode : undefined;
  return {
    text: message ? agentMessageText(message) : "",
    textWithContext: message ? rawAgentMessageText(message) : "",
    fileParts,
    requestAttachments: parsedRequestAttachments.attachments,
    hasUnavailableAttachment:
      custom?.agentNativeRetryAttachmentsUnavailable === true ||
      fileParts.some((part) => !hasDurableFilePart(part)) ||
      parsedRequestAttachments.unavailable,
    references: Array.isArray(metadata?.references)
      ? (metadata.references as Reference[])
      : [],
    model: metadataString("model"),
    engine: metadataString("engine"),
    effort: metadataString("effort"),
    requestMode,
  };
}

function sendRetryRequest(
  surface: AgentKitSurfaceContextValue,
  request: ReturnType<typeof retryRequestFrom>,
  recoveryOfRunId: string,
  resumeAfterSetup = false,
) {
  return surface.sendRecoveryMessage(
    request.text || "Please retry the last request.",
    "retry",
    undefined,
    request.fileParts,
    request.references,
    {
      recoveryModel: request.model,
      recoveryEngine: request.engine,
      recoveryEffort: request.effort,
      recoveryOfRunId,
      ...(request.requestAttachments.length
        ? { deferredRequestAttachments: request.requestAttachments }
        : {}),
      ...(resumeAfterSetup ? { resumeAfterSetup } : {}),
      ...(request.requestMode
        ? { recoveryRequestMode: request.requestMode }
        : {}),
    },
  );
}

function sendContinueRequest(
  surface: AgentKitSurfaceContextValue,
  request: ReturnType<typeof retryRequestFrom>,
  recoveryOfRunId?: string,
) {
  if (
    request.hasUnavailableAttachment ||
    request.fileParts.some((part) => !hasDurableFilePart(part))
  ) {
    throw new TypeError("Cannot continue with unavailable attachments.");
  }
  return surface.sendRecoveryMessage(
    RECOVERY_CONTINUE_PROMPT,
    "continue",
    undefined,
    request.fileParts,
    request.references,
    {
      recoveryModel: request.model,
      recoveryEngine: request.engine,
      recoveryEffort: request.effort,
      ...(recoveryOfRunId ? { recoveryOfRunId } : {}),
      ...(request.requestAttachments.length
        ? { deferredRequestAttachments: request.requestAttachments }
        : {}),
      ...(request.requestMode
        ? { recoveryRequestMode: request.requestMode }
        : {}),
    },
  );
}

function runContinueWithVisibleError(
  action: () => Promise<unknown>,
  setFailed: (failed: boolean) => void,
) {
  setFailed(false);
  void Promise.resolve()
    .then(action)
    .then((result) => {
      if (asRecord(result)?.status === "rejected") setFailed(true);
    })
    .catch(() => setFailed(true));
}

function sendRetryRequestWithoutAttachments(
  surface: AgentKitSurfaceContextValue,
  request: ReturnType<typeof retryRequestFrom>,
  recoveryOfRunId: string,
) {
  return surface.sendRecoveryMessage(
    request.text || "Please retry the last request.",
    "retry",
    undefined,
    [],
    request.references,
    {
      recoveryModel: request.model,
      recoveryEngine: request.engine,
      recoveryEffort: request.effort,
      recoveryOfRunId,
      ...(request.requestMode
        ? { recoveryRequestMode: request.requestMode }
        : {}),
    },
  );
}

function retryAttachmentNames(
  request: ReturnType<typeof retryRequestFrom>,
): string[] {
  return [
    ...new Set(
      [
        ...request.fileParts.map((part) => part.name),
        ...request.requestAttachments.map((attachment) => attachment.name),
      ]
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

function parseRetryRequestAttachments(value: unknown): {
  attachments: AgentRequestAttachment[];
  unavailable: boolean;
} {
  if (value === undefined) return { attachments: [], unavailable: false };
  if (!Array.isArray(value)) return { attachments: [], unavailable: true };
  const attachments: AgentRequestAttachment[] = [];
  let unavailable = false;
  for (const candidate of value) {
    const record = asRecord(candidate);
    if (
      record?.type !== "image" ||
      typeof record.name !== "string" ||
      !isDurableAttachmentUrl(record.url) ||
      record.data !== undefined
    ) {
      unavailable = true;
      continue;
    }
    attachments.push({
      type: "image",
      name: record.name,
      ...(typeof record.contentType === "string"
        ? { contentType: record.contentType }
        : {}),
      url: record.url,
      ...(typeof record.referenceUrl === "string"
        ? { referenceUrl: record.referenceUrl }
        : {}),
    });
  }
  return { attachments, unavailable };
}

/**
 * The custom-metadata flag the server sets on a prompt it refused before any
 * run started (`RUN_NOT_STARTED_METADATA_KEY` in core's shared module).
 */
const RUN_NOT_STARTED_METADATA_KEY = "agentNativeRunNotStarted";

function submittedRunIdOf(message: AgentMessage): string | undefined {
  const custom = asRecord(asRecord(message.metadata)?.custom);
  const id = custom?.submittedRunId ?? custom?.submittedTurnId;
  return typeof id === "string" ? id : undefined;
}

/** The user message a run answers, when the server recorded which. */
function userMessageForRun(
  messages: readonly AgentMessage[],
  runId: string,
): AgentMessage | undefined {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "user" && submittedRunIdOf(message) === runId,
    );
}

/**
 * The prompt a turn refused before its run started left in the thread: marked
 * by the server so it survives a reload, or still errored from this session.
 */
function refusedPromptFrom(
  messages: readonly AgentMessage[],
): AgentMessage | undefined {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "user" &&
        (message.status === "error" ||
          asRecord(asRecord(message.metadata)?.custom)?.[
            RUN_NOT_STARTED_METADATA_KEY
          ] === true),
    );
}

/** Whether a retry answering one of `ids` was already sent, per its persisted marker. */
function wasRetried(
  messages: readonly AgentMessage[],
  ...ids: Array<string | undefined>
): boolean {
  return messages.some((message) => {
    const marker = asRecord(
      asRecord(message.metadata)?.custom,
    )?.agentNativeRecoveryOfRunId;
    return typeof marker === "string" && ids.includes(marker);
  });
}

/** A refusal the user fixes by connecting Builder or adding a provider key. */
function isAiSetupRunFailure(error: {
  code: string;
  message: string;
  details?: unknown;
}): boolean {
  return (
    error.code === "AGENT_CHAT_AI_SETUP_REQUIRED" ||
    isMissingLlmProviderRunError({
      message: error.message,
      errorCode: error.code,
      ...(typeof error.details === "string" ? { details: error.details } : {}),
    })
  );
}

function AgentKitConnectionError({
  error,
  threadId,
  recover,
  recovering,
  recoveryError,
  dismiss,
}: AgentConnectionErrorRenderProps) {
  const t = useT();
  const surface = useAgentKitSurface();
  if (isAiSetupRunFailure(error)) {
    return <AgentKitRefusedPromptSetup threadId={threadId} />;
  }
  const chatGPTPlanUsageError =
    surface.props.selectedEngine === CHATGPT_SUBSCRIPTION_ENGINE_NAME &&
    `${error.code} ${error.message}`.match(
      /subscription_sharing_usage_limit_(exceeded|unavailable)/,
    )?.[1];
  return (
    <ComposerNotice
      tone={error.retryable ? "warning" : "danger"}
      role="alert"
      noticeId="connection-error"
      rootProps={{ "data-error-code": error.code, "data-thread-id": threadId }}
      onDismiss={dismiss}
      dismissLabel={t("agentChat.common.dismiss")}
      actions={
        error.retryable || chatGPTPlanUsageError ? (
          <>
            {error.retryable ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={recovering}
                aria-busy={recovering || undefined}
                onClick={() => void recover().catch(() => undefined)}
              >
                {recovering ? (
                  <Spinner className="size-3" aria-hidden="true" />
                ) : null}
                {t("agentChat.common.reconnect")}
              </Button>
            ) : null}
            {chatGPTPlanUsageError ? (
              <a
                href="https://chatgpt.com/settings/usage"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                {t("agentChat.composer.chatgptManageUsage")}
              </a>
            ) : null}
          </>
        ) : undefined
      }
    >
      {chatGPTPlanUsageError ? (
        t(
          chatGPTPlanUsageError === "exceeded"
            ? "agentChat.error.chatgptPlanUsageLimit"
            : "agentChat.error.chatgptPlanUsageUnavailable",
        )
      ) : (
        <span {...SESSION_REPLAY_MASK_PROPS}>
          {formatAgentKitErrorText(error, t)}
        </span>
      )}
      {recoveryError ? (
        <span {...SESSION_REPLAY_MASK_PROPS} className="block">
          {formatAgentKitErrorText(
            { code: "runtime_error", message: recoveryError.message },
            t,
          )}
        </span>
      ) : null}
    </ComposerNotice>
  );
}

/**
 * The server refused to start the turn because AI setup is missing, so there
 * is no run to retry: the refused prompt is sent again, once, after setup.
 */
function AgentKitRefusedPromptSetup({ threadId }: { threadId: string }) {
  const thread = useAgentThread(threadId);
  const surface = useAgentKitSurface();
  const refused = refusedPromptFrom(thread.messages);
  const refusedRunId = refused
    ? (submittedRunIdOf(refused) ?? refused.id)
    : undefined;
  const retryRequest = retryRequestFrom(refused);
  const alreadyRetried = wasRetried(thread.messages, refusedRunId, refused?.id);
  const resume = useResumeAfterAiSetup(
    `${threadId}:${refused?.id ?? ""}`,
    Boolean(refusedRunId) &&
      !alreadyRetried &&
      !retryRequest.hasUnavailableAttachment,
    () => sendRetryRequest(surface, retryRequest, refusedRunId!, true),
  );
  if (composerShowsSetupCard(surface)) return null;
  if (alreadyRetried) return null;
  return (
    <BuilderSetupCard
      fullWidth
      layout="default"
      onConnected={() => {
        window.dispatchEvent(new Event("agent-engine:configured-changed"));
        resume();
      }}
      onRetry={
        refused && !retryRequest.hasUnavailableAttachment ? resume : undefined
      }
    />
  );
}

function composerShowsSetupCard(
  surface: Pick<AgentKitSurfaceContextValue, "setupMissing" | "props">,
): boolean {
  return (
    surface.setupMissing &&
    (surface.props.showMissingApiKeySetup !== false ||
      surface.props.setupCardOwner === "host")
  );
}

function formatAgentKitErrorText(
  error: { code: string; message: string; details?: unknown },
  t: ReturnType<typeof useT>,
): string {
  const upgradeUrl = asRecord(error.details)?.upgradeUrl;
  const formatted = formatChatErrorText(
    error.message,
    typeof upgradeUrl === "string" ? upgradeUrl : undefined,
    error.code,
  );
  return localizeKnownChatErrorText(formatted, t);
}

function dispatchAgentKitCompatibilityEvent(
  event: AgentEvent,
  tabId: string,
  thread: ReturnType<typeof useAgentThread>,
  toolInputArgs: Map<string, string>,
) {
  if (typeof window === "undefined") return;
  if (event.type === "activity.started" || event.type === "activity.updated") {
    const tool =
      typeof event.activity.metadata?.tool === "string"
        ? event.activity.metadata.tool
        : undefined;
    window.dispatchEvent(
      new CustomEvent("agent-chat:activity", {
        detail: {
          label: event.activity.label,
          ...(tool ? { tool } : {}),
          tabId,
        },
      }),
    );
    return;
  }
  if (event.type === "activity.completed") {
    window.dispatchEvent(
      new CustomEvent("agent-chat:activity-clear", { detail: { tabId } }),
    );
    return;
  }
  if (event.type === "tool.started") {
    const tool = event.toolCall;
    const input = asRecord(tool.input) ?? {};
    const argsText = JSON.stringify(input);
    toolInputArgs.set(tool.id, argsText);
    window.dispatchEvent(
      new CustomEvent("agent-native:tool-start", {
        detail: { tool: tool.name, input },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("agent-chat:activity", {
        detail: { label: tool.name, tool: tool.name, tabId },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("agent-native:tool-input", {
        detail: {
          phase: "start",
          tool: tool.name,
          id: tool.id,
          argsText,
          tabId,
        },
      }),
    );
    return;
  }
  if (event.type === "tool.delta") {
    const tool = thread.tools[event.toolCallId];
    if (!tool || !event.inputTextDelta) return;
    const argsText = `${toolInputArgs.get(tool.id) ?? ""}${event.inputTextDelta}`;
    toolInputArgs.set(tool.id, argsText);
    window.dispatchEvent(
      new CustomEvent("agent-native:tool-input", {
        detail: {
          phase: "delta",
          tool: tool.name,
          id: tool.id,
          argsText,
          text: event.inputTextDelta,
          tabId,
        },
      }),
    );
    return;
  }
  if (event.type === "tool.updated") {
    const tool = event.toolCall;
    if (
      tool.status === "completed" ||
      tool.status === "failed" ||
      tool.status === "cancelled"
    ) {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-done", {
          detail: {
            tool: tool.name,
            result: tool.output,
            isError: tool.status !== "completed",
            completedSideEffect: tool.metadata?.completedSideEffect === true,
            tabId,
            eventId: tool.id,
          },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agent-chat:activity-clear", { detail: { tabId } }),
      );
      toolInputArgs.delete(tool.id);
    }
    return;
  }
  if (
    (event.type === "message.delta" || event.type === "reasoning.delta") &&
    event.text
  ) {
    window.dispatchEvent(
      new CustomEvent("agent-chat:stream-progress", { detail: { tabId } }),
    );
    return;
  }
  if (event.type === "run.failed") {
    if (
      event.error.code === "AGENT_CHAT_AI_SETUP_REQUIRED" ||
      event.error.code === "missing_api_key"
    ) {
      window.dispatchEvent(
        new CustomEvent("agent-chat:missing-api-key", {
          detail: { tabId, threadId: event.threadId },
        }),
      );
    }
    window.dispatchEvent(
      new CustomEvent("agent-chat:run-error", {
        detail: {
          message: event.error.message,
          errorCode: event.error.code,
          details: event.error.details,
          tabId,
          runId: event.runId,
        },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("agent-chat:activity-clear", { detail: { tabId } }),
    );
  } else if (event.type === "run.completed" || event.type === "run.cancelled") {
    window.dispatchEvent(
      new CustomEvent("agent-chat:activity-clear", { detail: { tabId } }),
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isInlineDataUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:/i.test(value.trim());
}

function isDurableAttachmentUrl(value: unknown): value is string {
  return isPersistableAttachmentUrl(value);
}

function hasDurableFilePart(value: unknown): value is FilePart {
  const filePart = asRecord(value);
  return (
    filePart?.type === "file" &&
    typeof filePart.name === "string" &&
    filePart.data === undefined &&
    (isDurableAttachmentUrl(filePart.url) ||
      (typeof filePart.fileId === "string" &&
        filePart.fileId.trim().length > 0 &&
        !isInlineDataUrl(filePart.fileId)))
  );
}

function formatErrorDetails(details: unknown): string | undefined {
  if (details == null) return undefined;
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

function dispatchSetupRequiredEvent(
  error: unknown,
  tabId: string | undefined,
  threadId: string,
) {
  const code = asRecord(error)?.code;
  if (code === "AGENT_CHAT_AI_SETUP_REQUIRED" || code === "missing_api_key") {
    window.dispatchEvent(
      new CustomEvent("agent-chat:missing-api-key", {
        detail: { tabId, threadId },
      }),
    );
  }
}

function createAgentUploadId(): string {
  return `agent-upload-${
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }`;
}

async function attachmentToFile(
  attachment: AgentChatAttachment,
): Promise<File | undefined> {
  if (attachment.storageRequired || attachment.storageUploadFailed) {
    throw new Error(
      `Could not create a durable upload for ${attachment.name}. Try attaching it again.`,
    );
  }
  if (attachment.url || attachment.displayOnly) return undefined;
  if (attachment.data?.startsWith("data:")) {
    const response = await fetch(attachment.data);
    if (!response.ok) throw new Error(`Could not read ${attachment.name}.`);
    const blob = await response.blob();
    return new File([blob], attachment.name, {
      type: attachment.contentType ?? blob.type ?? "application/octet-stream",
    });
  }
  if (attachment.data) {
    const bytes = Uint8Array.from(atob(attachment.data), (character) =>
      character.charCodeAt(0),
    );
    return new File([bytes], attachment.name, {
      type: attachment.contentType ?? "application/octet-stream",
    });
  }
  if (attachment.text) {
    return new File([attachment.text], attachment.name, {
      type: attachment.contentType ?? "text/plain",
    });
  }
  throw Object.assign(
    new Error(`Attachment ${attachment.name} has no uploadable content.`),
    { code: ATTACHMENT_UNREADABLE_SUBMIT_REASON },
  );
}

/**
 * The submit result a host sees when an attached file has nothing to upload,
 * so it can say which part failed instead of a generic send failure.
 */
const ATTACHMENT_UNREADABLE_SUBMIT_REASON = "attachment-unreadable";

function submitFailureReason(error: unknown): string {
  const record = asRecord(error);
  if (record?.code === "submission_expired") {
    return "submission-expired";
  }
  if (record?.code === ATTACHMENT_UNREADABLE_SUBMIT_REASON) {
    return ATTACHMENT_UNREADABLE_SUBMIT_REASON;
  }
  if (
    record?.code === "AGENT_CHAT_SUBMISSION_SCOPE_CHANGED" ||
    record?.code === "submission_scope_changed"
  ) {
    return "submission-scope-changed";
  }
  if (record?.code === "upload_too_large") {
    return "attachment-too-large";
  }
  if (
    typeof record?.code === "string" &&
    (record.code.startsWith("upload_") ||
      record.code.startsWith("upload_http_"))
  ) {
    return "attachment-upload-failed";
  }
  if (record?.code === "AGENT_CHAT_AI_SETUP_REQUIRED") {
    return record.state === "missing"
      ? "engine-not-configured"
      : "submission-unavailable";
  }
  return "submission-failed";
}

function queueSubmissionErrorMessage(
  error: unknown,
  t: ReturnType<typeof useT>,
): string {
  const generic = t("agentChat.error.failed");
  const record = asRecord(error);
  if (
    typeof record?.code !== "string" ||
    (!record.code.startsWith("upload_") &&
      !record.code.startsWith("upload_http_"))
  ) {
    return generic;
  }
  const message = typeof record.message === "string" ? record.message : "";
  const localizedUploadMessages = [
    t("agentChat.composer.fileTooLarge"),
    uploadTooLargeMessage(t),
    t("agentChat.composer.sessionExpired"),
    t("agentChat.composer.unsupportedFileType"),
    t("agentChat.composer.uploadFailed"),
    t("agentChat.composer.uploadUnavailable"),
    t("agentChat.composer.uploadOffline"),
    t("onboarding.fileStorage.title"),
  ];
  return localizedUploadMessages.some(
    (localized) => localized && message.includes(localized),
  )
    ? message
    : generic;
}

function setupSubmissionResult(
  error: unknown,
): AssistantChatSubmitResult | undefined {
  const record = asRecord(error);
  if (record?.code !== "AGENT_CHAT_AI_SETUP_REQUIRED") return undefined;
  return {
    status: "rejected",
    reason:
      record.state === "missing"
        ? "engine-not-configured"
        : "submission-unavailable",
  };
}

interface UploadedAgentChatAttachments {
  fileParts: FilePart[];
  requestAttachments: AgentRequestAttachment[];
}

const AGENT_CHAT_UPLOAD_MAX_FILE_BYTES = 25 * 1024 * 1024;

function attachmentTooLargeError(message: string): Error {
  return Object.assign(new Error(message), {
    code: "upload_too_large",
    status: 413,
    retryable: false,
  });
}

function assertAttachmentSizesWithinLimit(
  attachments: readonly AgentChatAttachment[],
  files: readonly PromptComposerFile[],
  message: string,
): void {
  const hasOversizedFile = files.some(
    (file) => file.size > AGENT_CHAT_UPLOAD_MAX_FILE_BYTES,
  );
  const hasOversizedAttachment = attachments.some((attachment) => {
    if (attachment.displayOnly || attachment.url) return false;
    if (attachment.data) {
      const parsed = parseBase64DataUrl(attachment.data);
      const base64 = parsed?.data ?? attachment.data;
      if (/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        const padding = base64.endsWith("==")
          ? 2
          : base64.endsWith("=")
            ? 1
            : 0;
        return (
          Math.max(0, Math.floor((base64.length * 3) / 4) - padding) >
          AGENT_CHAT_UPLOAD_MAX_FILE_BYTES
        );
      }
    }
    return (
      attachment.text !== undefined &&
      new TextEncoder().encode(attachment.text).byteLength >
        AGENT_CHAT_UPLOAD_MAX_FILE_BYTES
    );
  });
  if (hasOversizedFile || hasOversizedAttachment) {
    throw attachmentTooLargeError(message);
  }
}

function uploadTooLargeMessage(t: ReturnType<typeof useT>): string {
  return t("agentChat.composer.fileTooLarge", {
    size: AGENT_CHAT_UPLOAD_MAX_FILE_BYTES / 1024 / 1024,
  });
}

function uploadHttpError(status: number, t: ReturnType<typeof useT>): Error {
  const [code, message, retryable]: [string, string, boolean] =
    status === 413
      ? ["upload_too_large", uploadTooLargeMessage(t), false]
      : status === 401 || status === 403
        ? [
            "upload_session_expired",
            t("agentChat.composer.sessionExpired"),
            false,
          ]
        : status === 415
          ? [
              "upload_unsupported_type",
              t("agentChat.composer.unsupportedFileType"),
              false,
            ]
          : status === 408 || status === 429 || status >= 500
            ? [
                "upload_unavailable",
                t("agentChat.composer.uploadUnavailable"),
                true,
              ]
            : [
                "upload_http_" + status,
                t("agentChat.composer.uploadFailed"),
                false,
              ];
  return Object.assign(new Error(message), { code, status, retryable });
}

/**
 * Durable uploads keyed by the attachment or file they came from, so a send
 * that failed on one file reuses its siblings' uploads instead of uploading
 * them again.
 */
const uploadedAgentChatSources = new WeakMap<object, FilePart>();

const OPTIMIZABLE_RASTER_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isPotentiallyDownscalableImage(args: {
  mediaType: string;
  sizeBytes: number;
}): boolean {
  const mediaType = args.mediaType.split(";", 1)[0]!.trim().toLowerCase();
  return (
    args.sizeBytes > AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES &&
    OPTIMIZABLE_RASTER_IMAGE_TYPES.has(mediaType)
  );
}

function isPotentiallyDownscalableAttachment(
  attachment: AgentChatAttachment,
): boolean {
  if (attachment.displayOnly || attachment.url || !attachment.data) {
    return false;
  }
  const dataUrl = parseBase64DataUrl(attachment.data);
  const base64 = dataUrl?.data ?? attachment.data;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return false;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const sizeBytes = Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
  const mediaType = attachment.contentType ?? dataUrl?.mediaType ?? "";
  return isPotentiallyDownscalableImage({ mediaType, sizeBytes });
}

function requiresDurableAttachmentUpload(
  attachments: readonly AgentChatAttachment[],
  files: readonly PromptComposerFile[],
): boolean {
  return (
    files.some(
      (file) =>
        !isPotentiallyDownscalableImage({
          mediaType: file.type,
          sizeBytes: file.size,
        }),
    ) ||
    attachments.some(
      (attachment) =>
        !attachment.displayOnly &&
        !isDurableAttachmentUrl(attachment.url) &&
        !isPotentiallyDownscalableAttachment(attachment),
    )
  );
}

function canSendInlineImagesWithoutStorage(
  attachments: readonly AgentChatAttachment[],
  files: readonly PromptComposerFile[],
): boolean {
  return (
    files.every(
      (file) =>
        file.type.startsWith("image/") &&
        file.size <= AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES,
    ) &&
    attachments.every((attachment) => {
      if (attachment.displayOnly || isDurableAttachmentUrl(attachment.url)) {
        return true;
      }
      const payload = attachment.data ?? attachment.url;
      if (!payload) return false;
      const dataUrl = parseBase64DataUrl(payload);
      const base64 = dataUrl?.data ?? payload;
      const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
      const sizeBytes = Math.max(
        0,
        Math.floor((base64.length * 3) / 4) - padding,
      );
      const mediaType =
        attachment.contentType ??
        (attachment.type === "image" ? dataUrl?.mediaType : attachment.type);
      return (
        !attachment.storageRequired &&
        !attachment.storageUploadFailed &&
        typeof mediaType === "string" &&
        mediaType.startsWith("image/") &&
        Boolean(attachment.data || isInlineDataUrl(attachment.url)) &&
        sizeBytes <= AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES
      );
    })
  );
}

async function uploadAgentChatAttachments(
  control: ReturnType<typeof useAgentKitControl>,
  attachments: readonly AgentChatAttachment[],
  files: readonly PromptComposerFile[],
  options: {
    storageConfigured: boolean;
    storageUnavailableMessage: string;
    fileTooLargeMessage: string;
  },
): Promise<UploadedAgentChatAttachments> {
  const entries: Array<FilePart | File> = [];
  const sourceByFile = new Map<File, object>();
  for (const attachment of attachments) {
    if (attachment.displayOnly) continue;
    if (isDurableAttachmentUrl(attachment.url)) {
      entries.push({
        type: "file",
        name: attachment.name,
        mediaType: attachment.contentType ?? attachment.type,
        url: attachment.url,
      });
    } else {
      const file = await attachmentToFile({
        ...attachment,
        url: undefined,
        ...(isInlineDataUrl(attachment.url)
          ? { data: attachment.data ?? attachment.url }
          : {}),
      });
      if (file) {
        entries.push(file);
        sourceByFile.set(file, attachment);
      }
    }
  }
  entries.push(...files);
  const pending = entries.filter(
    (entry): entry is File => entry instanceof File,
  );
  const sourceOf = (file: File): object => sourceByFile.get(file) ?? file;
  const optimizedImages = new Map<
    File,
    { data: string; contentType: string }
  >();
  for (const file of pending) {
    if (
      !file.type.startsWith("image/") ||
      (options.storageConfigured &&
        file.size <= AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES)
    ) {
      continue;
    }
    const attachment = await readAgentPromptAttachment(file);
    if (!attachment.dataUrl) continue;
    const mediaType = parseBase64DataUrl(attachment.dataUrl)?.mediaType;
    if (mediaType) {
      optimizedImages.set(file, {
        data: attachment.dataUrl,
        contentType: mediaType,
      });
    }
  }
  const uploadedByFile = new Map<File, FilePart>();
  const filesToUploadNormally = pending.filter(
    (file) => !optimizedImages.has(file),
  );
  if (!options.storageConfigured && filesToUploadNormally.length > 0) {
    throw new Error(options.storageUnavailableMessage);
  }
  const oversized = filesToUploadNormally.flatMap((file, index) =>
    file.size > AGENT_CHAT_UPLOAD_MAX_FILE_BYTES
      ? [
          {
            index,
            name: file.name,
            error: Object.assign(new Error(options.fileTooLargeMessage), {
              code: "upload_too_large",
              retryable: false,
            }),
          },
        ]
      : [],
  );
  if (oversized.length) throw new AgentKitUploadError(oversized, []);
  const filesToUpload = filesToUploadNormally.filter((file) => {
    const reused = uploadedAgentChatSources.get(sourceOf(file));
    if (reused) uploadedByFile.set(file, reused);
    return !reused;
  });
  if (filesToUpload.length) {
    let uploaded: FilePart[];
    try {
      uploaded = await control.uploadFiles(
        filesToUpload.map((file) => ({
          name: file.name,
          mediaType: file.type || "application/octet-stream",
          size: file.size,
          body: file,
        })),
      );
    } catch (error) {
      if (error instanceof AgentKitUploadError) {
        for (const { index, part } of error.uploaded) {
          uploadedAgentChatSources.set(sourceOf(filesToUpload[index]!), part);
        }
      }
      throw error;
    }
    filesToUpload.forEach((file, index) => {
      const part = uploaded[index];
      if (!part || !hasDurableFilePart(part)) {
        throw new TypeError("File upload did not return every uploaded file.");
      }
      uploadedByFile.set(file, part);
      uploadedAgentChatSources.set(sourceOf(file), part);
    });
  }
  for (const file of pending) {
    if (
      !optimizedImages.has(file) ||
      !options.storageConfigured ||
      file.size > AGENT_CHAT_UPLOAD_MAX_FILE_BYTES
    ) {
      continue;
    }
    try {
      const [part] = await control.uploadFiles([
        {
          name: file.name,
          mediaType: file.type || "application/octet-stream",
          size: file.size,
          body: file,
        },
      ]);
      if (part && hasDurableFilePart(part)) uploadedByFile.set(file, part);
    } catch {
      // coercion-ok: the resized inline pixels are sent; this upload only adds a reusable URL.
    }
  }
  const fileParts = entries.flatMap((entry) => {
    if (!(entry instanceof File)) return [entry];
    const part = uploadedByFile.get(entry);
    return part ? [part] : [];
  });
  const requestAttachments = pending.flatMap((file) => {
    const optimized = optimizedImages.get(file);
    if (!optimized) return [];
    const part = uploadedByFile.get(file);
    return [
      {
        type: "image" as const,
        name: file.name,
        contentType: optimized.contentType,
        data: optimized.data,
        ...(part?.url && isDurableAttachmentUrl(part.url)
          ? { referenceUrl: part.url }
          : {}),
      },
    ];
  });
  return { fileParts, requestAttachments };
}

async function uploadRequestAttachments(
  control: ReturnType<typeof useAgentKitControl>,
  attachments: readonly AgentRequestAttachment[],
): Promise<AgentRequestAttachment[]> {
  const inline = attachments.filter((attachment) => attachment.data);
  if (inline.length === 0) return [...attachments];
  const files = await Promise.all(
    inline.map(async (attachment) => {
      const file = await attachmentToFile({
        type: "image",
        name: attachment.name,
        contentType: attachment.contentType,
        data: attachment.data,
      });
      if (!file) throw new TypeError(`Could not prepare ${attachment.name}.`);
      return file;
    }),
  );
  const uploaded = await control.uploadFiles(
    files.map((file) => ({
      name: file.name,
      mediaType: file.type || "application/octet-stream",
      size: file.size,
      body: file,
    })),
  );
  let uploadIndex = 0;
  return attachments.map((attachment) => {
    if (!attachment.data) return attachment;
    const part = uploaded[uploadIndex++];
    if (!part?.url || !isDurableAttachmentUrl(part.url)) {
      throw new TypeError(
        `The optimized image ${attachment.name} did not receive a durable URL.`,
      );
    }
    const { data: _data, ...reference } = attachment;
    return { ...reference, url: part.url };
  });
}

function normalizeRequestAttachmentReferences(
  attachments: readonly AgentRequestAttachment[],
): AgentRequestAttachment[] {
  return attachments.map((attachment) => {
    if (isInlineDataUrl(attachment.url) && !attachment.data) {
      throw new TypeError(
        "The image " +
          attachment.name +
          " has inline bytes in its URL instead of a durable reference.",
      );
    }
    const {
      url: _inlineUrl,
      referenceUrl: _inlineReferenceUrl,
      ...rest
    } = attachment;
    return {
      ...rest,
      ...(isDurableAttachmentUrl(attachment.url)
        ? { url: attachment.url }
        : {}),
      ...(isDurableAttachmentUrl(attachment.referenceUrl)
        ? { referenceUrl: attachment.referenceUrl }
        : {}),
    };
  });
}

/** Stored submissions carry durable references, so inline file bytes upload first. */
async function durableFileParts(
  control: ReturnType<typeof useAgentKitControl>,
  parts: readonly FilePart[],
  options: { storageConfigured: boolean; storageUnavailableMessage: string },
): Promise<FilePart[]> {
  const inline = parts.filter((part) => isInlineDataUrl(part.url));
  if (inline.length === 0) return [...parts];
  if (!options.storageConfigured) {
    throw new Error(options.storageUnavailableMessage);
  }
  const uploaded = await control.uploadFiles(
    await Promise.all(
      inline.map(async (part) => {
        const body = await (await fetch(part.url!)).blob();
        return {
          name: part.name,
          mediaType:
            part.mediaType ?? (body.type || "application/octet-stream"),
          size: body.size,
          body,
        };
      }),
    ),
  );
  let uploadIndex = 0;
  return parts.map((part) => {
    if (!isInlineDataUrl(part.url)) return part;
    const durable = uploaded[uploadIndex++];
    if (!durable?.url && !durable?.fileId) {
      throw new TypeError(part.name + " did not receive a durable reference.");
    }
    return durable;
  });
}

function rawAgentMessageTextFromParts(parts: AgentMessage["parts"]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

export function agentMessageTextFromParts(
  parts: AgentMessage["parts"],
): string {
  return stripAgentChatContextFromMessage(rawAgentMessageTextFromParts(parts));
}

function rawAgentMessageText(message: AgentMessage): string {
  return rawAgentMessageTextFromParts(message.parts);
}

function agentMessageText(message: AgentMessage): string {
  return agentMessageTextFromParts(message.parts);
}

function persistedAgentSnapshotValue(value: unknown): unknown {
  return stripInlineAttachmentPayloads(value);
}

/**
 * The live message keeps inline image bytes for display; what is stored keeps
 * only a durable reference, or a named omitted marker when there is none.
 */
function persistedAgentMessage(message: AgentMessage): AgentMessage {
  const persisted = {
    ...message,
    parts: message.parts.map((part) => {
      const record = asRecord(part);
      if (record?.type === "file") {
        return persistableFilePart(record as unknown as FilePart);
      }
      if (
        !record ||
        (!isInlineDataUrl(record.data) && !isInlineDataUrl(record.url))
      ) {
        return part;
      }
      const { data: _data, url, ...rest } = record;
      const durableUrl = isInlineDataUrl(url) ? undefined : url;
      return {
        ...rest,
        ...(durableUrl ? { url: durableUrl } : {}),
        ...(durableUrl || rest.fileId ? {} : { omitted: "inline-bytes" }),
      } as unknown as AgentMessage["parts"][number];
    }),
  };
  return persistedAgentSnapshotValue(persisted) as AgentMessage;
}

function persistedAgentEvent(event: AgentEvent): AgentEvent {
  return "message" in event && event.message
    ? { ...event, message: persistedAgentMessage(event.message) }
    : event;
}

function persistedQueuedMessage(
  message: AgentQueuedMessage,
): AgentQueuedMessage {
  return {
    ...message,
    ...(message.attachments
      ? { attachments: message.attachments.map(persistableFilePart) }
      : {}),
    ...(message.requestAttachments
      ? {
          requestAttachments: message.requestAttachments.flatMap(
            ({ data: _data, ...reference }) => {
              const url = isDurableAttachmentUrl(reference.url)
                ? reference.url
                : undefined;
              const referenceUrl = isDurableAttachmentUrl(
                reference.referenceUrl,
              )
                ? reference.referenceUrl
                : undefined;
              return url || referenceUrl
                ? [
                    {
                      ...reference,
                      ...(url ? { url } : {}),
                      ...(referenceUrl ? { referenceUrl } : {}),
                    },
                  ]
                : [];
            },
          ),
        }
      : {}),
  };
}

function hasPersistableMessages(thread: AgentThreadState): boolean {
  return thread.messages.some((message) => !isStreamingVoiceMessage(message));
}

function createAgentKitThreadSnapshot(thread: AgentThreadState) {
  const messages = thread.messages
    .filter((message) => !isStreamingVoiceMessage(message))
    .map(persistedAgentMessage);
  const repositoryMessages = messages.map((message, index) => ({
    parentId: index > 0 ? (messages[index - 1]?.id ?? null) : null,
    message: {
      id: message.id,
      role: message.role,
      status: message.status,
      content: message.parts,
      metadata: message.metadata,
      createdAt: message.createdAt,
    },
  }));
  const firstUser = messages.find((message) => message.role === "user");
  const latestUser = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const firstUserText = firstUser && rawAgentMessageText(firstUser);
  const latestUserText = latestUser && agentMessageText(latestUser);
  const handoffThread = thread.thread as AgentKitHandoffThreadSnapshot | null;
  const savedTitle = handoffThread?.title?.trim();
  const titleSource: "fallback" | undefined =
    !savedTitle || handoffThread?.titleSource === "fallback"
      ? "fallback"
      : undefined;
  const title = savedTitle || fallbackChatTitle(firstUserText ?? "");
  const persistedTitle = persistedAgentSnapshotValue(title);
  const runs = Object.entries(thread.runs).map(([id, run]) => ({
    ...run,
    id,
    threadId: thread.id,
  }));
  const agentKit = {
    messages,
    events: thread.events.map(persistedAgentEvent),
    runs,
    activeRunIds: thread.activeRunIds,
    toolCalls: Object.values(thread.tools),
    activities: Object.values(thread.activities),
  };
  const repositorySnapshot = persistedAgentSnapshotValue({
    headId: messages.at(-1)?.id ?? null,
    messages: repositoryMessages,
    queuedMessages: thread.queuedMessages.map(persistedQueuedMessage),
    agentKit,
  });
  return {
    threadData: JSON.stringify(repositorySnapshot),
    title: typeof persistedTitle === "string" ? persistedTitle : "",
    ...(titleSource ? { titleSource } : {}),
    preview:
      (persistedAgentSnapshotValue((latestUserText ?? "").slice(0, 280)) as
        | string
        | undefined) ?? "",
    messageCount: messages.length,
  };
}

function agentKitMessagesFromThreadSnapshot(
  snapshot: ReturnType<typeof createAgentKitThreadSnapshot>,
): AgentMessage[] {
  const repository = asRecord(JSON.parse(snapshot.threadData));
  const agentKit = asRecord(repository?.agentKit);
  if (!Array.isArray(agentKit?.messages)) {
    throw new TypeError("AgentKit thread snapshot is missing its messages.");
  }
  return agentKit.messages as AgentMessage[];
}

function createAgentKitThreadHandoffKey(
  props: Pick<AssistantChatProps, "apiUrl" | "browserTabId" | "contextScope">,
  threadId: string,
): string {
  const scope = props.contextScope;
  return JSON.stringify([
    props.apiUrl ?? agentNativePath("/_agent-native/agent-chat"),
    props.browserTabId ?? null,
    scope?.type ?? null,
    scope?.id ?? null,
    threadId,
  ]);
}

function readAgentKitThreadHandoffSnapshot(
  key: string,
  consume = false,
): AgentKitHandoffThreadSnapshot | null {
  const entry = threadHandoffSnapshots.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    threadHandoffSnapshots.delete(key);
    return null;
  }
  if (consume) threadHandoffSnapshots.delete(key);
  return entry.snapshot;
}

function storeAgentKitThreadHandoffSnapshot(
  key: string,
  thread: AgentThreadState,
  snapshot: ReturnType<typeof createAgentKitThreadSnapshot>,
) {
  const serialized = asRecord(JSON.parse(snapshot.threadData));
  const agentKit = asRecord(serialized?.agentKit);
  const messages = Array.isArray(agentKit?.messages)
    ? (agentKit.messages as AgentMessage[])
    : [];
  if (!messages.length) return;

  const now = new Date().toISOString();
  const handoff = persistedAgentSnapshotValue({
    ...(thread.thread ?? {}),
    id: thread.id,
    title: snapshot.title || thread.thread?.title,
    ...(snapshot.titleSource === "fallback"
      ? { titleSource: "fallback" as const }
      : {}),
    createdAt: thread.thread?.createdAt ?? messages[0]?.createdAt ?? now,
    updatedAt: thread.thread?.updatedAt ?? messages.at(-1)?.createdAt ?? now,
    messages,
    queuedMessages: thread.queuedMessages.map(persistedQueuedMessage),
    events: thread.events.map(persistedAgentEvent),
    runs: Object.entries(thread.runs).map(([id, run]) => ({
      ...run,
      id,
      threadId: thread.id,
    })),
    activeRunIds: thread.activeRunIds,
    toolCalls: Object.values(thread.tools),
    activities: Object.values(thread.activities),
    tasks: Object.values(thread.tasks),
    taskGroups: Object.values(thread.taskGroups),
    approvals: Object.entries(thread.approvals).map(([id, request]) => ({
      request,
      status: "pending" as const,
      ...(thread.approvalRunIds[id]
        ? { runId: thread.approvalRunIds[id] }
        : {}),
    })),
    connectionRequests: Object.entries(thread.connectionRequests).map(
      ([id, request]) => ({
        request,
        ...(thread.connectionRequestRunIds[id]
          ? { runId: thread.connectionRequestRunIds[id] }
          : {}),
      }),
    ),
    widgets: Object.entries(thread.widgets).flatMap(([id, widget]) => {
      const messageId = thread.widgetMessageIds[id];
      return messageId ? [{ messageId, widget }] : [];
    }),
    annotations: Object.entries(thread.annotations).flatMap(
      ([id, annotation]) => {
        const messageId = thread.annotationMessageIds[id];
        return messageId ? [{ messageId, annotation }] : [];
      },
    ),
    agents: Object.values(thread.agents),
    interactions: thread.agentInteractions,
    artifacts: thread.artifacts,
    suggestions: thread.suggestions,
  }) as AgentKitHandoffThreadSnapshot;

  const timestamp = Date.now();
  for (const [existingKey, entry] of threadHandoffSnapshots) {
    if (entry.expiresAt <= timestamp)
      threadHandoffSnapshots.delete(existingKey);
  }
  threadHandoffSnapshots.delete(key);
  threadHandoffSnapshots.set(key, {
    snapshot: handoff,
    expiresAt: timestamp + THREAD_HANDOFF_TTL_MS,
  });
  while (threadHandoffSnapshots.size > MAX_THREAD_HANDOFF_SNAPSHOTS) {
    const oldestKey = threadHandoffSnapshots.keys().next().value;
    if (oldestKey === undefined) break;
    threadHandoffSnapshots.delete(oldestKey);
  }
}

function getAgentKitThreadHandoffMessages(
  thread: AgentThreadState,
  snapshot: AgentThreadSnapshot | null,
): AgentMessage[] {
  if (
    !snapshot ||
    snapshot.id !== thread.id ||
    snapshot.messages.length <= thread.messages.length
  ) {
    return [];
  }
  for (let index = 0; index < thread.messages.length; index += 1) {
    if (snapshot.messages[index]?.id !== thread.messages[index]?.id) return [];
  }
  return snapshot.messages.slice(thread.messages.length);
}
