import type { AgentKitUploadDriver } from "@agent-native/agentkit";
import type { AgentThreadState } from "@agent-native/agentkit";
import type {
  AgentActionResult,
  AgentApprovalRequest,
  AgentConnectionRequest,
  AgentEvent,
  AgentMessage,
  AgentStreamIntegrityReport,
  AgentThreadSnapshot,
  AgentToolCall,
  AgentUploadTarget,
  FilePart,
} from "@agent-native/agentkit/protocol";
import {
  AgentKitChat,
  AgentKitComposer,
  AgentApprovalPrompt,
  AgentMessageView,
  useAgentKit,
  useAgentKitControl,
  useAgentThread,
  type AgentKitRenderProps,
  type AgentKitRegionRenderProps,
  type AgentConnectionErrorRenderProps,
  type AgentKitBranchNavigation,
} from "@agent-native/agentkit/react";
import { AgentKitRoot } from "@agent-native/agentkit/react/root";

import "@agent-native/agentkit/react/styles.css";
import {
  AgentSuggestionBar,
  agentSuggestionPrompt,
  type PromptComposerFile,
  type PromptComposerProps,
  type PromptComposerSubmitOptions,
  type Reference,
  type AgentSuggestionInput,
} from "@agent-native/toolkit/composer";
import {
  appendRealtimeVoiceTranscriptToRepository,
  realtimeVoiceTranscriptRegistry,
  type RealtimeVoiceTranscriptMessage,
} from "@agent-native/toolkit/composer/realtime-voice-transcript";
import {
  IconAlertTriangle,
  IconMessage,
  IconPlayerStopFilled,
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

import type { AgentChatAttachment } from "../agent/types.js";
import { splitAgentChatContextFromMessage } from "../shared/agent-chat-context.js";
import {
  appendAgentChatContextToMessage,
  filterAgentChatContextItems,
  formatAgentChatContextItemsForPrompt,
  getAgentChatContextState,
  normalizeAgentChatContextItem,
  publishAgentChatContextItems,
  reportAgentChatSubmitResult,
  refreshAgentChatContext,
  subscribeAgentChatContext,
  type AgentChatContextItem,
} from "./agent-chat.js";
import {
  AgentKitDevCheckpointProvider,
  AgentKitDevCheckpointRestore,
  useOptionalAgentKitHistory,
} from "./agentkit-chat/history.js";
import {
  CoreComposerRuntimeProvider,
  createAgentNativeAgentKitTransport,
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
import { agentNativePath } from "./api-path.js";
import {
  deleteClientAppState,
  readClientAppState,
} from "./application-state.js";
import { isInBuilderFrame } from "./builder-frame.js";
import { AgentApprovalCard } from "./chat/agent-approval-card.js";
import type { CreateAgentNativeAgentKitTransportOptions } from "./chat/agentkit-agent-native.js";
import {
  readAssistantChatComposerDraft,
  writeAssistantChatComposerDraft,
} from "./chat/composer-draft.js";
import { renderMarkdownToClipboardHtml } from "./chat/markdown-renderer.js";
import {
  RunErrorRecoveryCard,
  BuilderSetupCard,
  LoopLimitContinueCard,
  PlanModeCallout,
  getRequestModeMetadata,
  type RunErrorInfo,
} from "./chat/run-recovery.js";
import { createAgentNativeChatRuntime } from "./chat/runtime.js";
import type { CreateAgentNativeChatRuntimeOptions } from "./chat/runtime.js";
import type {
  AssistantChatAdapterContext,
  AssistantChatHandle,
  AssistantChatProps,
  AssistantChatSendOptions,
  AssistantChatSubmitResult,
} from "./chat/surface-types.js";
import {
  ChatRunningContext,
  SuppressInlineOpenAppContext,
  ReasoningCell,
  ToolCallDisplay,
} from "./chat/tool-call-display.js";
import { writeClipboardText } from "./clipboard.js";
import { useAgentDynamicSuggestionsResult } from "./dynamic-suggestions.js";
import {
  formatChatErrorText,
  localizeKnownChatErrorText,
} from "./error-format.js";
import { ExternalAgentNudge } from "./external-agent-host.js";
import { useFormatters, useT } from "./i18n.js";
import { buildSignInReturnHref } from "./require-session.js";
import { RunStuckBanner } from "./RunStuckBanner.js";
import { signOut } from "./sign-out.js";
import { ThinkingDisplayProvider } from "./thinking-display.js";
import { callAction } from "./use-action.js";
import { dispatchAgentChatRunning } from "./use-agent-chat-running-threads.js";
import { useAgentEngineConfigured } from "./use-agent-engine-configured.js";
import { cn } from "./utils.js";

export interface AgentKitAssistantChatProps extends AssistantChatProps {
  /** Called after AgentKit creates a fork so the host can add and activate a tab. */
  onForkedThread?: (threadId: string) => void;
  branchNavigation?: AgentKitBranchNavigation;
}

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
const threadHandoffSnapshots = new Map<
  string,
  { snapshot: AgentThreadSnapshot; expiresAt: number }
>();
// i18n-ignore: Internal recovery instruction sent to the agent, never shown as product copy.
const RECOVERY_CONTINUE_PROMPT =
  "Continue from where you left off and finish my last request. Do not repeat completed work.";

type ThreadRestoreState =
  | { status: "ready" | "loading" }
  | { status: "error"; notFound: boolean };

type AgentKitInternalSendOptions = AssistantChatSendOptions & {
  recoveryAction?: "continue" | "retry";
  recoveryReferences?: Reference[];
  recoveryModel?: string;
  recoveryEngine?: string;
  recoveryEffort?: string;
  recoveryRequestMode?: "act" | "plan";
};

interface PendingSelectionContext {
  text: string;
  capturedAt: number;
}

interface AgentKitSurfaceContextValue {
  props: AgentKitAssistantChatProps;
  handoffSnapshot: AgentThreadSnapshot | null;
  canChat: boolean;
  setupMissing: boolean;
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
  isSubmissionInFlight: boolean;
  contextItems: AgentChatContextItem[];
  suggestions: AgentSuggestionInput[];
  showSuggestions: boolean;
  voiceTranscriptMessages: AgentMessage[];
  selectionLength: number | null;
  prefillRevision: number;
  text: string;
  onTextChange: (text: string) => void;
  onRemoveContextItem: (key: string) => void;
  onClearSelection: () => void;
  onBeforeSubmit: () => Promise<boolean>;
  onSubmit: PromptComposerProps["onSubmit"];
  sendMessage: (
    text: string,
    images?: string[],
    options?: AssistantChatSendOptions,
  ) => Promise<AssistantChatSubmitResult>;
  sendRecoveryMessage: (
    text: string,
    recoveryAction: "continue" | "retry",
    images?: string[],
    attachments?: AgentChatAttachment[],
    references?: Reference[],
    recoveryOptions?: Pick<
      AgentKitInternalSendOptions,
      | "recoveryModel"
      | "recoveryEngine"
      | "recoveryEffort"
      | "recoveryRequestMode"
    >,
  ) => Promise<AssistantChatSubmitResult>;
  submitSuggestion: (prompt: string) => void;
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
  emptyState: AgentKitEmptyState,
  transcript: AgentKitTranscript,
  message: AgentKitUserMessage,
  messageSupplement: AgentKitMessageSupplement,
  text: AgentKitMarkdownText,
  tool: AgentKitTool,
  connectionRequest: AgentKitConnectionRequest,
  runFailure: AgentKitRunFailure,
  connectionError: AgentKitConnectionError,
  approval: AgentKitApproval,
  reasoning: AgentKitReasoning,
};

export const AgentKitAssistantChat = forwardRef<
  AssistantChatHandle,
  AgentKitAssistantChatProps
>(function AgentKitAssistantChat(props, ref) {
  const t = useT();
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
  const [threadRestore, setThreadRestore] = useState<ThreadRestoreState>(() =>
    props.isThreadStateLoading || !props.isNewThread
      ? { status: "loading" }
      : { status: "ready" },
  );
  const [restoreRetryVersion, setRestoreRetryVersion] = useState(0);
  const notifiedMissingThreadsRef = useRef(new Set<string>());
  const onThreadRestoreLoaded = useCallback(() => {
    setThreadRestore({ status: "ready" });
  }, []);
  useEffect(() => {
    setThreadRestore(
      props.isThreadStateLoading || !props.isNewThread
        ? { status: "loading" }
        : { status: "ready" },
    );
  }, [props.isNewThread, props.isThreadStateLoading, threadId]);
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
    [props.onThreadRestoreNotFound, threadId],
  );
  const retryThreadRestore = useCallback(() => {
    if (props.isNewThread) return;
    setThreadRestore({ status: "loading" });
    setRestoreRetryVersion((version) => version + 1);
  }, [props.isNewThread]);
  const labels = useMemo(
    () => ({
      conversation: t("agentChat.message.messages"),
      assistant: t("agentChat.common.agent"),
      you: t("agentChat.common.you"),
      approvalApprove: t("agentChat.approval.approve"),
      approvalDeny: t("agentChat.approval.deny"),
      connectionConnect: t("agentChat.common.connect"),
      connectionRetry: t("agentChat.common.retry"),
      connectionConnected: t("agentChat.integrations.connectedSection"),
      activities: t("agentChat.activity.groupLabel"),
      working: t("agentChat.status.working"),
      workingFor: t("agentChat.status.workingFor", {
        duration: "{{duration}}",
      }),
      worked: t("agentChat.tool.worked"),
      workedFor: t("agentChat.tool.workedFor", { duration: "{{duration}}" }),
      durationHourShort: t("agentChat.duration.hourShort"),
      durationMinuteShort: t("agentChat.duration.minuteShort"),
      durationSecondShort: t("agentChat.duration.secondShort"),
      composerLabel: t("agentChat.composer.messageAgent"),
      composerPlaceholder: t("agentChat.composer.messageAgent"),
      queue: t("agentChat.queue.label"),
      queueSteer: t("agentChat.queue.steer"),
      queueSteerHint: t("agentChat.queue.steerHint"),
      queueMoveToTop: t("agentChat.queue.moveToTop"),
      queueRemove: t("agentChat.queue.remove"),
      queueMore: t("agentChat.queue.moreActions"),
      suggestions: t("agentChat.composer.suggestedPrompts"),
      copy: t("agentChat.message.copyMessage"),
      copied: t("agentChat.common.copied"),
      messageActions: t("agentChat.message.actions"),
      copyRequestId: t("agentChat.message.copyRequestId"),
      requestIdUnavailable: t("agentChat.message.requestIdUnavailable"),
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
      fork: t("agentChat.message.forkChat"),
      previousBranch: t("agentChat.message.previousBranch"),
      nextBranch: t("agentChat.message.nextBranch"),
      branchPosition: "{{index}}/{{count}}",
      error: t("agentChat.error.failed"),
      runFailed: t("agentChat.error.failed"),
      reconnect: t("agentChat.agentPanel.chatgptSubscriptionReconnect"),
      reasoning: t("agentChat.status.thinking"),
      expandActivity: t("agentChat.common.expand"),
      collapseActivity: t("agentChat.common.collapse"),
      editMessage: t("agentChat.message.edit"),
      cancelEditing: t("agentChat.common.cancel"),
      regenerateResponse: t("agentChat.message.regenerate"),
      expandMessage: t("agentChat.common.expand"),
      collapseMessage: t("agentChat.common.collapse"),
      previewAttachment: t("agentChat.composer.previewAttachment", {
        name: "{{name}}",
      }),
      pastedText: t("agentChat.pastedText.title"),
      imagePreview: t("agentChat.composer.imagePreview"),
      closePreview: t("agentChat.composer.closePreview"),
      dropFilesToAttach: t("agentChat.composer.dropToAttach"),
      scrollToBottom: t("agentChat.composer.scrollToBottom"),
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
    [formatDate, t],
  );
  const uploadedFilesRef = useRef(new Map<string, FilePart>());
  const upload: AgentKitUploadDriver = useCallback(
    async (target, file, context) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(target.fields ?? {})) {
        form.set(key, value);
      }
      form.set("file", file.body, file.name);
      const response = await fetch(target.url, {
        method: target.method,
        headers: target.headers,
        body: form,
        signal: context?.signal,
      });
      if (!response.ok) {
        throw new Error(`Upload failed with ${response.status}.`);
      }
      const result: unknown = await response.json();
      const uploaded = asRecord(result);
      if (typeof uploaded?.url !== "string" || !uploaded.url) {
        throw new TypeError("File upload response did not include a URL.");
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
  const modelRef = useRef<string | undefined>(props.selectedModel);
  const engineRef = useRef<string | undefined>(props.selectedEngine);
  const effortRef = useRef<AssistantChatAdapterContext["effortRef"]["current"]>(
    props.selectedEffort,
  );
  const harnessRef = useRef<string | undefined>(
    props.hostedHarness ? props.selectedAgent : undefined,
  );
  const hostedHarnessRef = useRef(props.hostedHarness === true);
  const execModeRef = useRef<"build" | "plan" | undefined>(props.execMode);
  const scopeRef = useRef<AssistantChatAdapterContext["scopeRef"]["current"]>(
    props.contextScope,
  );
  const isolateHistoryByScopeRef = useRef(props.isolateHistoryByScope);
  const createTransportRef = useRef(props.createTransport);
  modelRef.current = props.selectedModel;
  engineRef.current = props.selectedEngine;
  effortRef.current = props.selectedEffort;
  harnessRef.current = props.hostedHarness ? props.selectedAgent : undefined;
  hostedHarnessRef.current = props.hostedHarness === true;
  execModeRef.current = props.execMode;
  scopeRef.current = props.contextScope;
  isolateHistoryByScopeRef.current = props.isolateHistoryByScope;
  createTransportRef.current = props.createTransport;
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
    const adapterContext: AssistantChatAdapterContext = {
      apiUrl: props.apiUrl ?? agentNativePath("/_agent-native/agent-chat"),
      streamingUrl: props.streamingUrl,
      tabId: props.tabId,
      threadId,
      modelRef,
      engineRef,
      effortRef,
      harnessRef,
      hostedHarnessRef,
      execModeRef,
      browserTabId: props.browserTabId,
      scopeRef,
      surface,
    };
    const customTransport = createTransportRef.current;
    if (customTransport) return customTransport(adapterContext);
    const runtimeOptions: CreateAgentNativeChatRuntimeOptions = {
      apiUrl: props.apiUrl ?? agentNativePath("/_agent-native/agent-chat"),
      streamingUrl: props.streamingUrl,
      browserTabId: props.browserTabId,
      threadId,
      surface,
      get mode() {
        return execModeRef.current === "plan" ? "plan" : "act";
      },
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
    const builtTransport = createAgentNativeAgentKitTransport({
      apiUrl: props.apiUrl ?? agentNativePath("/_agent-native/agent-chat"),
      runtime: props.runtime ?? createAgentNativeChatRuntime(runtimeOptions),
      browserTabId: props.browserTabId,
      threadId,
      surface,
      get scope() {
        return scopeRef.current;
      },
      get isolateHistoryByScope() {
        return isolateHistoryByScopeRef.current;
      },
      adapter: { textFormat: "markdown" },
      operations,
    });
    const getThreadSnapshot = builtTransport.getThreadSnapshot;
    if (!getThreadSnapshot || props.runtime) return builtTransport;
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
    props.runtime,
    props.streamingUrl,
    props.tabId,
    threadId,
  ]);
  const history = props.chatHistory as
    | AgentKitHistoryConfig<unknown, any, any>
    | undefined;

  return (
    <ThinkingDisplayProvider value={props.thinkingDisplay}>
      <CoreComposerRuntimeProvider>
        <AgentKitRoot
          key={`${threadId}:${restoreRetryVersion}`}
          transport={transport}
          clientOptions={{
            transportOwnership: "owned",
            retainActiveRunsOnThreadRelease: true,
            onIntegrityReport: reportIntegrity,
            upload,
          }}
          threadId={threadId}
          load={
            props.isThreadStateLoading || props.isNewThread ? "manual" : "auto"
          }
          onLoadError={onThreadRestoreLoadError}
          slots={agentKitSlots}
          labels={labels}
          branchNavigation={props.branchNavigation}
          onThreadForked={(thread) => props.onForkedThread?.(thread.id)}
          onCopyMessage={({ text }) => {
            const html = renderMarkdownToClipboardHtml(text);
            return html === null ? false : writeClipboardText(text, { html });
          }}
          onClientEffect={(effect) => {
            window.dispatchEvent(
              new CustomEvent("agent-chat:client-effect", { detail: effect }),
            );
          }}
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
                threadRestore={threadRestore}
                retryThreadRestore={retryThreadRestore}
                onThreadRestoreLoaded={onThreadRestoreLoaded}
                ref={ref}
              />
            </AgentKitDevCheckpointProvider>
          )}
        </AgentKitRoot>
      </CoreComposerRuntimeProvider>
    </ThinkingDisplayProvider>
  );
});

const AgentKitAssistantChatBody = forwardRef<
  AssistantChatHandle,
  AgentKitAssistantChatProps & {
    threadId: string;
    handoffSnapshot: AgentThreadSnapshot | null;
    threadRestore: ThreadRestoreState;
    retryThreadRestore: () => void;
    onThreadRestoreLoaded: () => void;
  }
>(function AgentKitAssistantChatBody(props, ref) {
  const { threadId, requestComposerFocus } = useAgentKit();
  const control = useAgentKitControl(threadId);
  const thread = useAgentThread(threadId);
  const history = useOptionalAgentKitHistory();
  const providerChecksEnabled = props.providerStatusChecksEnabled !== false;
  const readiness = useAgentEngineConfigured(providerChecksEnabled, {
    tabId: props.tabId,
    threadId,
  });
  const canChat = !providerChecksEnabled || readiness.canChat;
  const setupMissing = providerChecksEnabled && readiness.missing;
  const isRestoring =
    history?.isRestoring === true || props.threadRestore.status === "loading";
  const isSubmissionInFlight = history?.isSubmissionInFlight === true;
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
  const [setupBouncePulse, setSetupBouncePulse] = useState(0);
  const previousPrefillRevisionRef = useRef(prefillRevision);
  const [contextItems, setContextItems] = useState<AgentChatContextItem[]>([]);
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelectionContext | null>(null);
  const selectionRevisionRef = useRef(0);
  const selectionLength = pendingSelection?.text.length ?? null;
  const [voiceTranscriptMessages, setVoiceTranscriptMessages] = useState<
    AgentMessage[]
  >([]);
  const voiceTranscriptsRef = useRef<RealtimeVoiceTranscriptMessage[]>([]);
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
  const saveSnapshotRef = useRef<() => void>(() => undefined);
  const isUnmountingRef = useRef(false);
  const pendingSubmissionReleaseRef = useRef<(() => void) | null>(null);
  const localSubmissionRef = useRef(false);
  const latestAssistant = useMemo(
    () =>
      [...thread.messages]
        .reverse()
        .find((message) => message.role === "assistant"),
    [thread.messages],
  );
  const isRunning = thread.activeRunIds.length > 0;

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
  } | null>(null);

  useEffect(() => {
    const isCustomTransport = typeof props.createTransport === "function";
    const previous = lastCustomRunningStateRef.current;
    lastCustomRunningStateRef.current = {
      custom: isCustomTransport,
      isRunning,
    };
    if (
      !isCustomTransport ||
      (previous?.custom === true && previous.isRunning === isRunning)
    ) {
      return;
    }
    dispatchAgentChatRunning({
      isRunning,
      phase: isRunning ? "working" : "idle",
      threadId,
      tabId: props.tabId ?? threadId,
      ...(thread.activeRunIds[0] ? { runId: thread.activeRunIds[0] } : {}),
      reason: isRunning ? "run.started" : "run.completed",
    });
  }, [
    isRunning,
    props.createTransport,
    props.tabId,
    thread.activeRunIds,
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
        props.suggestionPlacement === "context-chips" ||
        thread.messages.length === 0,
    });
  const suggestions = resolveAgentKitSuggestionInputs(
    dynamicSuggestionPrompts,
    props.suggestions,
  );
  const showSuggestions =
    props.suggestionVisibility !== "after-agent-response" ||
    thread.messages.some((message) => message.role === "assistant");

  const clearPendingSelection = useCallback(() => {
    selectionRevisionRef.current += 1;
    setPendingSelection(null);
    void deleteClientAppState("pending-selection-context", {
      keepalive: true,
    }).catch(() => {});
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("agent-panel:selection-cleared"));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const selectionRevision = selectionRevisionRef.current;
    void readClientAppState<unknown>("pending-selection-context")
      .then((value) => {
        if (cancelled || selectionRevision !== selectionRevisionRef.current) {
          return;
        }
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
        setPendingSelection(
          text && Date.now() - capturedAt <= PENDING_SELECTION_TTL_MS
            ? { text, capturedAt }
            : null,
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    const onAttached = (event: Event) => {
      const detail = asRecord((event as CustomEvent).detail);
      if (typeof detail?.text === "string" && detail.text) {
        selectionRevisionRef.current += 1;
        setPendingSelection({ text: detail.text, capturedAt: Date.now() });
      }
    };
    const onCleared = () => {
      selectionRevisionRef.current += 1;
      setPendingSelection(null);
    };
    const onClearRequested = () => clearPendingSelection();
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
  }, [clearPendingSelection]);

  useEffect(() => {
    const apply = () => {
      if (!props.isActiveComposer && props.isActiveComposer !== undefined)
        return;
      setContextItems(
        filterAgentChatContextItems(
          getAgentChatContextState().items,
          props.contextNamespace,
        ),
      );
    };
    apply();
    void refreshAgentChatContext().then(apply);
    return subscribeAgentChatContext(apply);
  }, [props.contextNamespace, props.isActiveComposer]);

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

  useEffect(() => {
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
      props.onMessageCountChange?.(thread.messages.length);
      return;
    }
    let addedUserMessage = false;
    for (let index = 0; index < thread.messages.length; index += 1) {
      const message = thread.messages[index];
      if (!message) continue;
      if (observedMessagesRef.current.has(message.id)) continue;
      observedMessagesRef.current.add(message.id);
      if (message.role !== "user") continue;
      localSubmissionRef.current = false;
      addedUserMessage = true;
      const text = agentMessageText(message);
      if (
        !thread.messages.slice(0, index).some((item) => item.role === "user")
      ) {
        props.onGenerateTitle?.(threadId, text);
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
    if (
      addedUserMessage ||
      terminalEventAdded ||
      (!isRunning &&
        thread.messages.at(-1)?.role === "assistant" &&
        thread.messages.at(-1)?.status === "complete")
    ) {
      saveSnapshotRef.current();
    }
    props.onMessageCountChange?.(
      thread.messages.length +
        voiceTranscriptMessages.filter(
          (message) => !thread.messages.some((item) => item.id === message.id),
        ).length,
    );
  }, [isRunning, props, thread, threadId, voiceTranscriptMessages]);

  saveSnapshotRef.current = () => {
    const transcripts = voiceTranscriptsRef.current;
    if (thread.messages.length === 0 && transcripts.length === 0) {
      return;
    }
    const baseSnapshot = createAgentKitThreadSnapshot(thread);
    const snapshot = transcripts.length
      ? appendVoiceTranscriptsToThreadSnapshot(
          baseSnapshot,
          thread,
          transcripts,
        )
      : baseSnapshot;
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
    if (!props.onSaveThread) return;
    if (snapshot.threadData === lastSavedThreadDataRef.current) return;
    lastSavedThreadDataRef.current = snapshot.threadData;
    props.onSaveThread(threadId, snapshot);
  };

  useEffect(() => {
    isUnmountingRef.current = false;
    return () => {
      isUnmountingRef.current = true;
      saveSnapshotRef.current();
    };
  }, []);

  const appendRealtimeVoiceTranscript = useCallback(
    (transcript: RealtimeVoiceTranscriptMessage) => {
      if (isRestoring || isRunning) return false;
      if (
        thread.messages.some((message) => message.id === transcript.id) ||
        voiceTranscriptsRef.current.some(
          (message) => message.id === transcript.id,
        )
      ) {
        return true;
      }
      const transcripts = [...voiceTranscriptsRef.current, transcript];
      const messages = transcripts.map(realtimeVoiceTranscriptAgentMessage);
      voiceTranscriptsRef.current = transcripts;
      setVoiceTranscriptMessages(messages);
      const baseSnapshot = createAgentKitThreadSnapshot(thread);
      const snapshot = appendVoiceTranscriptsToThreadSnapshot(
        baseSnapshot,
        thread,
        transcripts,
      );
      if (props.onSaveThread) {
        lastSavedThreadDataRef.current = snapshot.threadData;
        props.onSaveThread(threadId, snapshot);
      }
      return true;
    },
    [isRestoring, isRunning, props, thread, threadId],
  );

  useEffect(() => {
    return realtimeVoiceTranscriptRegistry.register({
      threadId,
      active: props.isActiveComposer !== false,
      append: appendRealtimeVoiceTranscript,
    });
  }, [appendRealtimeVoiceTranscript, props.isActiveComposer, threadId]);

  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => saveSnapshotRef.current(), 5000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  const acquireSubmission = useCallback(async () => {
    if (isRestoring) return null;
    if (!canChat) {
      if (setupMissing) {
        bounceSetupCard();
        window.dispatchEvent(
          new CustomEvent("agent-chat:missing-api-key", {
            detail: { tabId: props.tabId, threadId },
          }),
        );
      }
      return null;
    }
    if (history) {
      const release = await history.beginSubmission();
      if (!release) return null;
      return release;
    }
    return () => undefined;
  }, [
    bounceSetupCard,
    canChat,
    history,
    isRestoring,
    props.tabId,
    setupMissing,
    threadId,
  ]);

  const beforeSubmit = useCallback(async () => {
    const release = await acquireSubmission();
    if (!release) return false;
    pendingSubmissionReleaseRef.current?.();
    pendingSubmissionReleaseRef.current = release;
    return true;
  }, [acquireSubmission]);

  const dispatch = useCallback(
    async (
      text: string,
      files: PromptComposerFile[],
      references: Reference[],
      composerOptions: PromptComposerSubmitOptions,
      options: AgentKitInternalSendOptions = {},
    ) => {
      const context = options.recoveryAction
        ? ""
        : [
            formatAgentChatContextItemsForPrompt(contextItems),
            pendingSelectionPromptContext(pendingSelection),
          ]
            .filter(Boolean)
            .join("\n\n");
      const message = appendAgentChatContextToMessage(text, context);
      const attachments = [
        ...(options.attachments ?? []),
        ...((composerOptions.attachments ?? []) as AgentChatAttachment[]),
      ];
      const fileParts = await uploadAgentChatAttachments(
        control,
        attachments,
        files,
      );
      if (!options.recoveryAction) {
        await deleteClientAppState("pending-selection-context", {
          keepalive: true,
        }).catch(() => {});
        selectionRevisionRef.current += 1;
        setPendingSelection(null);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("agent-panel:selection-cleared"));
        }
      }
      const requestMode =
        options.requestMode ??
        options.recoveryRequestMode ??
        (props.execMode === "plan" ? "plan" : "act");
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
      const actionScope = options.actionScope ?? props.contextScope;
      const metadata = {
        ...(options.submitMessageId
          ? { submitMessageId: options.submitMessageId }
          : {}),
        ...(options.usageLabel ? { usageLabel: options.usageLabel } : {}),
        ...(options.trackInRunsTray ? { trackInRunsTray: true } : {}),
        ...(actionScope ? { actionScope } : {}),
        ...(options.approvedToolCalls
          ? { approvedToolCalls: options.approvedToolCalls }
          : {}),
        ...(options.hideUserMessage ? { hideUserMessage: true } : {}),
        ...(options.recoveryAction
          ? {
              custom: {
                agentNativeRecoveryAction: options.recoveryAction,
              },
            }
          : {}),
        ...(options.recoveryAction === "continue"
          ? { agentNativeInternalContinuation: true }
          : {}),
        ...(props.contextScope ? { chatScope: props.contextScope } : {}),
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
        ...(props.selectedAgent ? { agentId: props.selectedAgent } : {}),
        requestMode,
      };
      localSubmissionRef.current = true;
      try {
        if (composerOptions.intent === "queued") {
          await control.queueMessage({
            text: message,
            attachments: fileParts,
            metadata,
          });
        } else {
          await control.sendMessage({
            text: message,
            attachments: fileParts,
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
        }
        reportAgentChatSubmitResult(options.submitMessageId, true);
        const usedKeys = new Set(contextItems.map((item) => item.key));
        publishAgentChatContextItems(
          getAgentChatContextState().items.filter(
            (item) => !usedKeys.has(item.key),
          ),
        );
        setContextItems((items) =>
          items.filter((item) => !usedKeys.has(item.key)),
        );
      } catch (error) {
        localSubmissionRef.current = false;
        throw error;
      }
    },
    [
      contextItems,
      control,
      props.contextScope,
      props.execMode,
      props.selectedAgent,
      props.selectedEffort,
      props.selectedEngine,
      props.selectedModel,
      pendingSelection,
    ],
  );

  const submitPrepared = useCallback(
    async (
      text: string,
      files: PromptComposerFile[],
      references: Reference[],
      composerOptions: PromptComposerSubmitOptions,
    ) => {
      let release: (() => void) | null = pendingSubmissionReleaseRef.current;
      pendingSubmissionReleaseRef.current = null;
      if (!release) release = await acquireSubmission();
      if (!release) return;
      try {
        await dispatch(text, files, references, composerOptions);
      } catch (error) {
        dispatchSetupRequiredEvent(error, props.tabId, threadId);
        throw error;
      } finally {
        release?.();
      }
    },
    [acquireSubmission, dispatch, props.tabId, threadId],
  );

  const submit = useCallback(
    async (
      text: string,
      files: PromptComposerFile[],
      references: Reference[],
      composerOptions: PromptComposerSubmitOptions,
      options: AgentKitInternalSendOptions = {},
    ): Promise<AssistantChatSubmitResult> => {
      const release = await acquireSubmission();
      if (!release) {
        const reason = setupMissing
          ? "engine-not-configured"
          : "submission-unavailable";
        reportAgentChatSubmitResult(options.submitMessageId, false, reason);
        return { status: "rejected", reason };
      }
      try {
        await dispatch(text, files, references, composerOptions, options);
        return { status: "submitted" };
      } catch (error) {
        reportAgentChatSubmitResult(
          options.submitMessageId,
          false,
          "submission-failed",
        );
        dispatchSetupRequiredEvent(error, props.tabId, threadId);
        throw error;
      } finally {
        release?.();
      }
    },
    [acquireSubmission, dispatch, props.tabId, setupMissing, threadId],
  );

  const send = useCallback(
    async (
      text: string,
      images?: string[],
      options?: AssistantChatSendOptions,
    ) =>
      submit(
        text,
        [],
        [],
        { intent: isRunning ? "queued" : "immediate" },
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
      ),
    [isRunning, submit],
  );
  const sendRecoveryMessage = useCallback(
    async (
      text: string,
      recoveryAction: "continue" | "retry",
      images?: string[],
      attachments?: AgentChatAttachment[],
      references?: Reference[],
      recoveryOptions?: Pick<
        AgentKitInternalSendOptions,
        | "recoveryModel"
        | "recoveryEngine"
        | "recoveryEffort"
        | "recoveryRequestMode"
      >,
    ) => {
      return submit(
        text,
        [],
        [],
        { intent: isRunning ? "queued" : "immediate" },
        {
          hideUserMessage: true,
          recoveryAction,
          recoveryReferences: references,
          ...recoveryOptions,
          attachments: [
            ...(attachments ?? []),
            ...(images ?? []).map((url) => ({
              type: "image",
              name: "image",
              url,
            })),
          ],
        },
      );
    },
    [isRunning, submit],
  );
  const resumeIntegrationPrompt = useCallback(
    (message: string) => {
      if (props.isActiveComposer === false) return;
      void send(message).catch((error) => {
        dispatchSetupRequiredEvent(error, props.tabId, threadId);
      });
    },
    [props.isActiveComposer, props.tabId, send, threadId],
  );
  const submitSuggestion = useCallback(
    (prompt: string) =>
      void submit(prompt, [], [], {
        intent: isRunning ? "queued" : "immediate",
      }).catch((error) => {
        dispatchSetupRequiredEvent(error, props.tabId, threadId);
      }),
    [isRunning, props.tabId, submit, threadId],
  );

  useEffect(
    () => () => {
      pendingSubmissionReleaseRef.current?.();
      pendingSubmissionReleaseRef.current = null;
    },
    [],
  );

  const setContextItem = useCallback(
    (rawItem: AgentChatContextItem, focus = true) => {
      const item = normalizeAgentChatContextItem(rawItem);
      if (!item) return;
      const current = getAgentChatContextState().items;
      const next = current
        .filter((candidate) => candidate.key !== item.key)
        .concat(item);
      publishAgentChatContextItems(next);
      setContextItems(
        filterAgentChatContextItems(next, props.contextNamespace),
      );
      if (focus) requestComposerFocus(threadId);
    },
    [props.contextNamespace, requestComposerFocus, threadId],
  );
  const removeContextItem = useCallback(
    (key: string) => {
      const next = getAgentChatContextState().items.filter(
        (item) => item.key !== key,
      );
      publishAgentChatContextItems(next);
      setContextItems(
        filterAgentChatContextItems(next, props.contextNamespace),
      );
    },
    [props.contextNamespace],
  );
  const implementPlan = useCallback(() => {
    const canImplement =
      props.execMode === "plan" &&
      getRequestModeMetadata(latestAssistant) === "plan";
    if (!canImplement) return false;
    props.onExecModeChange?.("build");
    void send("Implement the plan.", undefined, { requestMode: "act" });
    return true;
  }, [latestAssistant, props.execMode, props.onExecModeChange, send]);

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
      setComposerContextItem: (item, options) =>
        setContextItem(item, options?.focus !== false),
      removeComposerContextItem: removeContextItem,
      clearComposerContextItems: () => {
        for (const item of contextItems) removeContextItem(item.key);
      },
      sendRecoveryMessage: (text, recoveryAction, images) =>
        sendRecoveryMessage(text, recoveryAction, images),
      queueMessage: (text, images) =>
        submit(
          text,
          [],
          [],
          { intent: "queued" },
          {
            attachments: (images ?? []).map((url) => ({
              type: "image",
              name: "image",
              url,
            })),
          },
        ),
      isRunning: () => thread.activeRunIds.length > 0,
      hasInFlightWork: () =>
        Object.values(thread.tools).some((tool) => tool.status === "running") ||
        Object.values(thread.activities).some(
          (activity) => activity.status === "running",
        ),
      focusComposer: () => requestComposerFocus(threadId),
      exportThreadSnapshot: () => {
        if (
          thread.messages.length === 0 &&
          voiceTranscriptsRef.current.length === 0
        ) {
          return null;
        }
        const snapshot = appendVoiceTranscriptsToThreadSnapshot(
          createAgentKitThreadSnapshot(thread),
          thread,
          voiceTranscriptsRef.current,
        );
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
      beforeSubmit,
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
      setContextItem,
      submit,
      thread,
      threadId,
    ],
  );

  const surfaceContext: AgentKitSurfaceContextValue = {
    props,
    handoffSnapshot: props.handoffSnapshot,
    canChat,
    setupMissing,
    isRunning,
    isRestoring,
    threadRestore: props.threadRestore,
    retryThreadRestore: props.retryThreadRestore,
    authError,
    authSessionAvailable,
    setupBouncePulse,
    bounceSetupCard,
    isSubmissionInFlight,
    contextItems,
    voiceTranscriptMessages,
    selectionLength,
    suggestions: suggestions ?? [],
    showSuggestions,
    prefillRevision,
    text: composerText,
    onTextChange: onComposerTextChange,
    onRemoveContextItem: removeContextItem,
    onClearSelection: clearPendingSelection,
    onBeforeSubmit: beforeSubmit,
    onSubmit: submitPrepared,
    sendMessage: send,
    sendRecoveryMessage,
    submitSuggestion,
    onImplementPlan: implementPlan,
  };

  return (
    <AgentKitSurfaceContext.Provider value={surfaceContext}>
      {props.isActiveComposer === false ? null : (
        <McpAgentKitConnectionResume
          onResume={(
            { threadId: targetThreadId, runId, requestId },
            request,
          ) => {
            if (targetThreadId !== threadId) return;
            return control.resolveConnectionRequest(runId, requestId, {
              status: "connected",
              message: request.message,
            });
          }}
          onMessageResume={(request) => {
            resumeIntegrationPrompt(request.message);
          }}
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
        isAwaitingResponse={() => isRunning}
        onRetry={() =>
          void sendRecoveryMessage(RECOVERY_CONTINUE_PROMPT, "continue")
        }
      />
      <AgentKitChat
        className={props.className}
        emptyComposerPlacement={
          props.centerComposerWhenEmpty ? "center" : "bottom"
        }
        title={props.showHeader === false ? undefined : props.emptyStateText}
        toolbar={<AgentKitHistoryBeginningRevert />}
        autoScroll
      />
    </AgentKitSurfaceContext.Provider>
  );
});

function AgentKitComposerSlot({ threadId }: { threadId: string }) {
  const surface = useAgentKitSurface();
  return <AgentKitComposerSurface threadId={threadId} {...surface} />;
}

function AgentKitEmptyState({ threadId }: { threadId: string }) {
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
  const promptSuggestions =
    surface.props.suggestionPlacement !== "context-chips" &&
    surface.props.suggestionPlacement !== "hidden" &&
    surface.showSuggestions
      ? surface.suggestions
      : [];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-16">
      {showDefault ? (
        <>
          <IconMessage className="h-5 w-5 text-muted-foreground/60" />
          <p className="sr-only">
            {surface.props.emptyStateText ?? t("agentChat.empty.prompt")}
          </p>
          {promptSuggestions.length ? (
            <div className="flex w-full max-w-[320px] flex-col gap-1.5">
              {promptSuggestions.map((suggestion, index) => {
                const prompt = agentSuggestionPrompt(suggestion);
                return (
                  <button
                    key={
                      typeof suggestion === "string"
                        ? suggestion
                        : suggestion.id
                    }
                    type="button"
                    disabled={
                      !surface.canChat || surface.props.composerDisabled
                    }
                    onClick={() => surface.submitSuggestion(prompt)}
                    className="w-full rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 text-left text-[13px] text-muted-foreground shadow-sm transition-colors hover:border-border hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {typeof suggestion === "string"
                      ? suggestion
                      : suggestion.label || prompt || String(index)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </>
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
  const surface = useAgentKitSurface();
  const t = useT();
  const thread = useAgentThread(threadId);
  const handoffMessages =
    surface.threadRestore.status === "error"
      ? []
      : getAgentKitThreadHandoffMessages(thread, surface.handoffSnapshot);
  const guided = useGuidedQuestionFlow({
    enabled: surface.props.isActiveComposer !== false,
    stateKey: "guided-questions",
    queryKey: ["guided-questions", "agentkit"],
    browserTabId: surface.props.browserTabId,
    threadId,
    onSubmitMessage: async ({ message, context }) => {
      await surface.onSubmit(
        appendAgentChatContextToMessage(message, context),
        [],
        [],
        { intent: surface.isRunning ? "queued" : "immediate" },
      );
      return { delivered: true };
    },
    onSkipMessage: async ({ message, context }) => {
      await surface.onSubmit(
        appendAgentChatContextToMessage(message, context),
        [],
        [],
        { intent: surface.isRunning ? "queued" : "immediate" },
      );
      return { delivered: true };
    },
  });
  const threadMessageIds = new Set(
    thread.messages.map((message) => message.id),
  );
  const pendingVoiceMessages = surface.voiceTranscriptMessages.filter(
    (message) => !threadMessageIds.has(message.id),
  );
  const suggestionBar =
    surface.props.suggestionPlacement === "context-chips" &&
    surface.showSuggestions &&
    surface.suggestions.length > 0 ? (
      <AgentSuggestionBar
        ariaLabel={t("agentChat.composer.suggestedPrompts")}
        suggestions={surface.suggestions.map((suggestion, index) => ({
          ...(typeof suggestion === "string"
            ? {
                id: `host-suggestion-${index}-${suggestion}`,
                label: suggestion,
                prompt: suggestion,
              }
            : suggestion),
          disabled: Boolean(
            !surface.canChat ||
            surface.props.composerDisabled ||
            surface.isSubmissionInFlight,
          ),
        }))}
        onSelect={(suggestion) =>
          surface.submitSuggestion(agentSuggestionPrompt(suggestion))
        }
        className="agentkit-host-suggestions"
      />
    ) : null;
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
      <div
        className="flex h-full flex-col gap-3 p-4"
        aria-busy="true"
        role="status"
      >
        <span className="sr-only">{t("agentChat.empty.loadingChat")}</span>
        <div className="flex justify-end">
          <div className="h-8 w-32 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          <div className="h-4 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }
  if (
    surface.threadRestore.status === "error" &&
    thread.messages.length === 0 &&
    handoffMessages.length === 0
  ) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-16">
        <p className="max-w-[420px] text-center text-sm text-muted-foreground">
          {surface.threadRestore.notFound
            ? t("agentChat.message.threadNotFound")
            : t("agentChat.message.restoreRequestFailed")}
        </p>
        <button
          type="button"
          onClick={surface.retryThreadRestore}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {t("agentChat.common.retry")}
        </button>
      </div>
    );
  }
  return (
    <>
      {surface.threadRestore.status === "error" ? (
        <div
          className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"
          role="alert"
        >
          <span>
            {surface.threadRestore.notFound
              ? t("agentChat.message.threadNotFound")
              : t("agentChat.message.restoreRequestFailed")}
          </span>
          <button
            type="button"
            onClick={surface.retryThreadRestore}
            className="shrink-0 rounded px-2 py-1 hover:bg-accent hover:text-foreground"
          >
            {t("agentChat.common.retry")}
          </button>
        </div>
      ) : null}
      {renderThreadSlot(
        surface.props.threadContentSlot,
        threadId,
        surface.props.tabId,
      )}
      {children}
      {handoffMessages.map((message) => (
        <AgentMessageView
          key={message.id}
          value={message}
          threadId={threadId}
        />
      ))}
      {pendingVoiceMessages.map((message) => (
        <AgentMessageView
          key={message.id}
          value={message}
          threadId={threadId}
        />
      ))}
      {guided.questions?.length ? (
        <div className="px-3 pb-3">
          <GuidedQuestionFlow
            questions={guided.questions}
            onSubmit={guided.handleSubmit}
            onSkip={guided.handleSkip}
            isSubmitting={guided.isSubmitting}
            {...(guided.title ? { title: guided.title } : {})}
            {...(guided.description ? { description: guided.description } : {})}
            {...(guided.skipLabel ? { skipLabel: guided.skipLabel } : {})}
            {...(guided.submitLabel ? { submitLabel: guided.submitLabel } : {})}
            className="h-auto items-stretch justify-stretch bg-transparent"
          />
        </div>
      ) : null}
      {suggestionBar}
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
  canChat,
  setupMissing,
  isRunning,
  thread,
  t,
}: {
  props: AgentKitAssistantChatProps;
  canChat: boolean;
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
  return (
    props.composerPlaceholder ??
    (canChat ? "Ask the agent to explore, build, or explain…" : "")
  );
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

function AgentKitComposerSurface({
  threadId,
  props,
  canChat,
  setupMissing,
  isRunning,
  isRestoring,
  isSubmissionInFlight,
  setupBouncePulse,
  bounceSetupCard,
  contextItems,
  selectionLength,
  prefillRevision,
  text,
  onTextChange,
  onRemoveContextItem,
  onClearSelection,
  onBeforeSubmit,
  onSubmit,
  onImplementPlan,
}: {
  threadId: string;
  props: AgentKitAssistantChatProps;
  canChat: boolean;
  setupMissing: boolean;
  isRunning: boolean;
  isRestoring: boolean;
  isSubmissionInFlight: boolean;
  setupBouncePulse: number;
  bounceSetupCard: () => void;
  contextItems: AgentChatContextItem[];
  selectionLength: number | null;
  prefillRevision: number;
  text: string;
  onTextChange: (text: string) => void;
  onRemoveContextItem: (key: string) => void;
  onClearSelection: () => void;
  onBeforeSubmit: () => Promise<boolean>;
  onSubmit: PromptComposerProps["onSubmit"];
  onImplementPlan: () => boolean;
}) {
  const t = useT();
  const [composerError, setComposerError] = useState<string | null>(null);
  const thread = useAgentThread(threadId);
  const latestAssistant = [...thread.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const latestAssistantWasPlan =
    getRequestModeMetadata(latestAssistant) === "plan";
  const showPlanCallout =
    props.execMode === "plan" &&
    !props.planModeDisabled &&
    !props.composerDisabled;
  const control = useAgentKitControl(threadId);
  const integration = findMcpConnectionSuggestionIntegration({
    text,
    variant: "composer",
    requestedByUser: true,
  });
  return (
    <div className={cn("agentkit-host-composer", props.composerAreaClassName)}>
      {props.composerSlot}
      {showPlanCallout ? (
        <PlanModeCallout
          canImplementPlan={latestAssistantWasPlan}
          onImplementPlan={onImplementPlan}
          onSwitchToAct={() => props.onExecModeChange?.("build")}
        />
      ) : null}
      {setupMissing ? (
        <BuilderSetupCard
          fullWidth
          attached
          bouncePulse={setupBouncePulse}
          layout={props.missingApiKeySetupLayout ?? "default"}
          onConnected={() =>
            window.dispatchEvent(new Event("agent-engine:configured-changed"))
          }
          onRetry={() =>
            window.dispatchEvent(new Event("agent-engine:configured-changed"))
          }
        />
      ) : null}
      {integration ? (
        <McpConnectionSuggestion
          text={text}
          variant="composer"
          requestedByUser
          integrationId={integration.id}
        />
      ) : null}
      {selectionLength !== null && selectionLength > 0 ? (
        <AgentKitSelectionPill
          length={selectionLength}
          onClear={onClearSelection}
        />
      ) : null}
      <div className="relative">
        <AgentKitComposer
          threadId={threadId}
          disabled={
            !canChat ||
            props.composerDisabled ||
            isRestoring ||
            isSubmissionInFlight
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
          onTextChange={onTextChange}
          onBeforeSubmit={onBeforeSubmit}
          contextItems={contextItems}
          onRemoveContextItem={onRemoveContextItem}
          interceptBuildRequestsForBuilder={isInBuilderFrame()}
          selectedModel={props.selectedModel ?? props.defaultModel}
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
          mode={props.execMode === "plan" ? "plan" : "act"}
          planModeDisabled={props.planModeDisabled}
          planModeDisabledReason={props.planModeDisabledReason}
          onModeChange={(mode) =>
            props.onExecModeChange?.(mode === "plan" ? "plan" : "build")
          }
          layoutVariant={props.composerLayoutVariant}
          plusMenuMode={props.plusMenuMode}
          placeholder={composerPlaceholder({
            props,
            canChat,
            setupMissing,
            isRunning,
            thread,
            t,
          })}
          onConnectProvider={props.onConnectProvider}
          onConnectLocalRuntime={props.onConnectLocalRuntime}
          imageModelMenu={props.imageModelMenu}
          voiceEnabled
          toolbarSlot={props.composerToolbarSlot}
          extraActionButton={props.composerExtraActionButton}
          includeDefaultSlashCommands
          onSlashCommand={props.onSlashCommand}
          onAttachmentError={setComposerError}
          onSubmit={async (...args) => {
            setComposerError(null);
            await onSubmit(...args);
          }}
          stopButton={
            isRunning ? (
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    let hostStopSucceeded = true;
                    if (props.onStop) {
                      try {
                        hostStopSucceeded = (await props.onStop()) !== false;
                      } catch {
                        hostStopSucceeded = false;
                      }
                    }
                    if (!hostStopSucceeded) return;
                    await Promise.all(
                      thread.activeRunIds.map((runId) => control.cancel(runId)),
                    );
                  })();
                }}
                aria-label={t("agentChat.composer.stopResponse")}
                title={t("agentChat.composer.stopResponse")}
                data-agent-composer-slot="stop-button"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground"
              >
                <IconPlayerStopFilled className="h-3 w-3" />
              </button>
            ) : undefined
          }
        />
        {composerError ? (
          <div
            role="alert"
            className="mx-3 mb-1.5 flex shrink-0 items-start gap-2 rounded-md border border-border bg-muted/70 px-3 py-2 text-xs text-foreground shadow-sm"
          >
            <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1 leading-snug">{composerError}</span>
            <button
              type="button"
              aria-label={t("agentChat.common.dismissError")}
              onClick={() => setComposerError(null)}
              className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        <ExternalAgentNudge variant="prompt" />
      </div>
    </div>
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

function AgentKitMessageSupplement(props: AgentKitRenderProps<AgentMessage>) {
  const value = props.value;
  const t = useT();
  const thread = useAgentThread(props.threadId);
  const assistantIndex = thread.messages.findIndex(
    (message) => message.id === value.id,
  );
  const latestUser =
    assistantIndex < 0
      ? undefined
      : thread.messages
          .slice(0, assistantIndex)
          .reverse()
          .find((message) => message.role === "user");
  const contextText =
    latestUser?.parts
      .filter((part) => part.type === "text")
      .map((part) =>
        part.type === "text"
          ? splitAgentChatContextFromMessage(part.text).message
          : "",
      )
      .join("\n") ?? "";
  const text = value.parts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
  const integration =
    value.role === "assistant" &&
    value.status === "complete" &&
    thread.activeRunIds.length === 0
      ? findMcpConnectionSuggestionIntegration({
          text,
          contextText,
          variant: "response",
          requestedByAgent: true,
        })
      : null;
  const runWarning = asRecord(asRecord(value.metadata?.custom)?.runWarning);
  const missingFinalResponse =
    runWarning?.errorCode === "final_response_missing_after_tool";
  return (
    <>
      <AgentKitHistoryMessageSupplement {...props} />
      {missingFinalResponse ? (
        <div
          className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-xs text-muted-foreground"
          role="status"
        >
          {t("agentChat.message.missingFinal")}
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
          contextText={contextText}
          variant="response"
          requestedByAgent
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
  const output =
    typeof value.output === "string"
      ? value.output
      : value.output === undefined
        ? undefined
        : JSON.stringify(value.output);
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
          isRunning={value.status === "running"}
          outcome={value.status === "failed" ? "unknown" : undefined}
          structuredMeta={metadata}
          mcpApp={asRecord(metadata.mcpApp) as never}
          chatUI={asRecord(metadata.chatUI) as never}
          activity={metadata.activity === true}
          isActiveTail={active === true}
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
  if (!actions?.onDeny && !actions?.onAlwaysAllow) {
    return <AgentApprovalPrompt request={value} runId={runId} />;
  }
  if (value.options?.length || value.input) {
    return <AgentApprovalPrompt request={value} runId={runId} />;
  }
  const resolve = async (decision: "approve" | "deny") => {
    setPending(true);
    try {
      await control.resolveApproval(runId, value.id, {
        decision,
        optionIds: [decision],
      });
      if (decision === "deny") actions.onDeny?.(value.id);
    } finally {
      setPending(false);
    }
  };
  const alwaysAllow = async () => {
    if (!actions.onAlwaysAllow) return;
    setPending(true);
    setSaveFailed(false);
    try {
      await actions.onAlwaysAllow(value.id, toolName);
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
      onApprove={() => void resolve("approve").catch(() => undefined)}
      onDeny={() => void resolve("deny").catch(() => undefined)}
      onAlwaysAllow={actions.onAlwaysAllow ? alwaysAllow : undefined}
    />
  );
}

function AgentKitReasoning({
  value,
  active,
  resetKey,
  threadId,
}: AgentKitRenderProps<
  Extract<AgentMessage["parts"][number], { type: "reasoning" }>
>) {
  const thread = useAgentThread(threadId);
  if (value.visibility === "hidden") return null;
  const messageId = reasoningMessageIdFromResetKey(resetKey, threadId);
  const runId = messageId
    ? [...thread.events]
        .reverse()
        .find(
          (event) =>
            event.type === "reasoning.delta" && event.messageId === messageId,
        )?.runId
    : undefined;
  const run = runId ? thread.runs[runId] : undefined;
  const startedAt = run?.startedAt ? Date.parse(run.startedAt) : NaN;
  const completedAt = run?.completedAt ? Date.parse(run.completedAt) : NaN;
  const durationMs = Number.isFinite(startedAt)
    ? Number.isFinite(completedAt)
      ? completedAt - startedAt
      : active
        ? Date.now() - startedAt
        : undefined
    : undefined;
  return (
    <ReasoningCell
      text={value.text}
      isStreaming={active}
      defaultOpen={active}
      durationMs={durationMs}
      resetKey={resetKey}
    />
  );
}

function reasoningMessageIdFromResetKey(
  resetKey: string | undefined,
  threadId: string,
): string | undefined {
  const prefix = `${threadId}:`;
  if (!resetKey?.startsWith(prefix)) return undefined;
  const partIndexSeparator = resetKey.lastIndexOf(":");
  return partIndexSeparator > prefix.length
    ? resetKey.slice(prefix.length, partIndexSeparator)
    : undefined;
}

function AgentKitConnectionRequest({
  value,
  runId,
  threadId,
}: AgentKitRenderProps<AgentConnectionRequest> & { runId: string }) {
  const control = useAgentKitControl();
  return (
    <McpAgentKitConnectionRequestCard
      provider={value.provider}
      detail={value.detail}
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
  const control = useAgentKitControl(threadId);
  const thread = useAgentThread(threadId);
  const surface = useAgentKitSurface();
  const t = useT();
  const [dismissed, setDismissed] = useState<string | null>(null);
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
  if (dismissed === runId) return null;
  if (
    error.code === "AGENT_CHAT_AI_SETUP_REQUIRED" ||
    error.code === "missing_api_key"
  ) {
    return (
      <BuilderSetupCard
        fullWidth
        attached
        layout={surface.props.missingApiKeySetupLayout ?? "default"}
        onConnected={() =>
          window.dispatchEvent(new Event("agent-engine:configured-changed"))
        }
        onRetry={() =>
          window.dispatchEvent(new Event("agent-engine:configured-changed"))
        }
      />
    );
  }
  if (error.code === "loop_limit") {
    const details = asRecord(error.details);
    return (
      <LoopLimitContinueCard
        info={{
          ...(typeof details?.maxIterations === "number"
            ? { maxIterations: details.maxIterations }
            : {}),
        }}
        onContinue={() =>
          void surface.sendRecoveryMessage(RECOVERY_CONTINUE_PROMPT, "continue")
        }
      />
    );
  }
  const info: RunErrorInfo = {
    message: formatAgentKitErrorText(error, t),
    errorCode: error.code,
    details: formatErrorDetails(error.details),
    runId,
    recoverable: error.retryable,
  };
  const lastUserMessage = [...thread.messages]
    .reverse()
    .find((message) => message.role === "user");
  const retryText = lastUserMessage ? agentMessageText(lastUserMessage) : "";
  const retryMetadata = asRecord(lastUserMessage?.metadata);
  const retryCustomMetadata = asRecord(retryMetadata?.custom);
  const metadataString = (key: string) => {
    const value = retryMetadata?.[key] ?? retryCustomMetadata?.[key];
    return typeof value === "string" && value.trim() ? value : undefined;
  };
  const retryAttachments =
    lastUserMessage?.parts.flatMap((part) =>
      part.type === "file"
        ? [
            {
              type: "file",
              name: part.name,
              ...(part.mediaType ? { contentType: part.mediaType } : {}),
              ...(part.url ? { url: part.url } : {}),
            },
          ]
        : [],
    ) ?? [];
  const retryReferences = Array.isArray(retryMetadata?.references)
    ? (retryMetadata.references as Reference[])
    : [];
  const retryRequestMode = metadataString("requestMode");
  return (
    <RunErrorRecoveryCard
      info={info}
      onContinue={() =>
        void surface.sendRecoveryMessage(RECOVERY_CONTINUE_PROMPT, "continue")
      }
      onRetry={() =>
        void surface.sendRecoveryMessage(
          retryText || "Please retry the last request.",
          "retry",
          undefined,
          retryAttachments,
          retryReferences,
          {
            recoveryModel: metadataString("model"),
            recoveryEngine: metadataString("engine"),
            recoveryEffort: metadataString("effort"),
            ...(retryRequestMode === "plan" || retryRequestMode === "act"
              ? { recoveryRequestMode: retryRequestMode }
              : {}),
          },
        )
      }
      onFork={async () => {
        if (!lastUserMessage) return surface.props.onForkChat?.();
        const fork = await control.fork(lastUserMessage.id);
        surface.props.onForkedThread?.(fork.id);
        return true;
      }}
      onDismiss={() => setDismissed(runId)}
    />
  );
}

function AgentKitConnectionError({
  error,
  threadId,
  recover,
  recovering,
  recoveryError,
}: AgentConnectionErrorRenderProps) {
  const t = useT();
  return (
    <div
      className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"
      data-error-code={error.code}
      data-thread-id={threadId}
      role="alert"
    >
      <strong className="mr-2 font-medium text-foreground">
        {t("agentChat.error.failed")}
      </strong>
      <span>{formatAgentKitErrorText(error, t)}</span>
      {error.retryable ? (
        <button
          type="button"
          disabled={recovering}
          onClick={() => void recover().catch(() => undefined)}
          className="ml-3 rounded px-2 py-1 hover:bg-accent hover:text-foreground disabled:opacity-60"
        >
          {recovering
            ? t("agentChat.common.loading")
            : t("agentChat.agentPanel.chatgptSubscriptionReconnect")}
        </button>
      ) : null}
      {recoveryError ? (
        <span className="mt-2 block" role="alert">
          {formatAgentKitErrorText(
            { code: "runtime_error", message: recoveryError.message },
            t,
          )}
        </span>
      ) : null}
    </div>
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
  throw new Error(`Attachment ${attachment.name} has no uploadable content.`);
}

async function uploadAgentChatAttachments(
  control: ReturnType<typeof useAgentKitControl>,
  attachments: readonly AgentChatAttachment[],
  files: readonly PromptComposerFile[],
): Promise<FilePart[]> {
  const entries: Array<FilePart | File> = [];
  for (const attachment of attachments) {
    if (attachment.displayOnly) continue;
    if (attachment.url) {
      entries.push({
        type: "file",
        name: attachment.name,
        mediaType: attachment.contentType ?? attachment.type,
        url: attachment.url,
      });
    } else {
      const file = await attachmentToFile(attachment);
      if (file) entries.push(file);
    }
  }
  entries.push(...files);
  const pending = entries.filter(
    (entry): entry is File => entry instanceof File,
  );
  const uploaded = pending.length
    ? await control.uploadFiles(
        pending.map((file) => ({
          name: file.name,
          mediaType: file.type || "application/octet-stream",
          size: file.size,
          body: file,
        })),
      )
    : [];
  let uploadIndex = 0;
  return entries.map((entry) =>
    entry instanceof File ? uploaded[uploadIndex++]! : entry,
  );
}

function agentMessageText(message: AgentMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) =>
      part.type === "text"
        ? splitAgentChatContextFromMessage(part.text).message
        : "",
    )
    .join("\n");
}

function persistedAgentMessage(message: AgentMessage): AgentMessage {
  return {
    ...message,
    parts: message.parts.map((part) => {
      const record = asRecord(part);
      if (
        (record?.type === "file" || record?.type === "image") &&
        typeof record.data === "string" &&
        record.data.startsWith("data:")
      ) {
        const { data: _data, ...withoutInlineBody } = record;
        return withoutInlineBody as unknown as AgentMessage["parts"][number];
      }
      return part;
    }),
  };
}

function createAgentKitThreadSnapshot(thread: AgentThreadState) {
  const messages = thread.messages.map(persistedAgentMessage);
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
  const firstUserText =
    messages.find((message) => message.role === "user") &&
    agentMessageText(messages.find((message) => message.role === "user")!);
  const latestUserText =
    [...messages].reverse().find((message) => message.role === "user") &&
    agentMessageText(
      [...messages].reverse().find((message) => message.role === "user")!,
    );
  const title = thread.thread?.title ?? firstUserText?.slice(0, 80) ?? "";
  const runs = Object.entries(thread.runs).map(([id, run]) => ({
    ...run,
    id,
    threadId: thread.id,
  }));
  const agentKit = {
    messages,
    events: thread.events,
    runs,
    activeRunIds: thread.activeRunIds,
    toolCalls: Object.values(thread.tools),
    activities: Object.values(thread.activities),
  };
  return {
    threadData: JSON.stringify({
      headId: messages.at(-1)?.id ?? null,
      messages: repositoryMessages,
      queuedMessages: thread.queuedMessages,
      agentKit,
    }),
    title,
    preview: (latestUserText ?? "").slice(0, 280),
    messageCount: messages.length,
  };
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
): AgentThreadSnapshot | null {
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
  const handoff: AgentThreadSnapshot = {
    ...(thread.thread ?? {}),
    id: thread.id,
    title: snapshot.title || thread.thread?.title,
    createdAt: thread.thread?.createdAt ?? messages[0]?.createdAt ?? now,
    updatedAt: thread.thread?.updatedAt ?? messages.at(-1)?.createdAt ?? now,
    messages,
    queuedMessages: thread.queuedMessages,
    events: thread.events,
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
  };

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

function realtimeVoiceTranscriptAgentMessage(
  transcript: RealtimeVoiceTranscriptMessage,
): AgentMessage {
  const repository = appendRealtimeVoiceTranscriptToRepository(
    { messages: [] },
    transcript,
  ).repository;
  const messages = Array.isArray(repository.messages)
    ? repository.messages
    : [];
  const entry = asRecord(messages[0]);
  const message = asRecord(entry?.message);
  const createdAt =
    message?.createdAt instanceof Date
      ? message.createdAt.toISOString()
      : new Date(transcript.createdAt).toISOString();
  return {
    id: transcript.id,
    role: transcript.role,
    parts: [{ type: "text", text: transcript.text }],
    createdAt,
    status: "complete",
    ...(asRecord(message?.metadata)
      ? { metadata: asRecord(message?.metadata)! }
      : {}),
  };
}

function appendVoiceTranscriptsToThreadSnapshot(
  snapshot: ReturnType<typeof createAgentKitThreadSnapshot>,
  thread: AgentThreadState,
  transcripts: readonly RealtimeVoiceTranscriptMessage[],
): ReturnType<typeof createAgentKitThreadSnapshot> {
  const messagesById = new Map<string, AgentMessage>();
  for (const message of thread.messages) {
    messagesById.set(message.id, persistedAgentMessage(message));
  }
  for (const transcript of transcripts) {
    if (!messagesById.has(transcript.id)) {
      messagesById.set(
        transcript.id,
        realtimeVoiceTranscriptAgentMessage(transcript),
      );
    }
  }
  const messageOrder = new Map(
    [...messagesById.values()].map((message, index) => [message.id, index]),
  );
  const messages = [...messagesById.values()].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt ?? "");
    const rightTime = Date.parse(right.createdAt ?? "");
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      const difference = leftTime - rightTime;
      if (difference !== 0) return difference;
    }
    return (messageOrder.get(left.id) ?? 0) - (messageOrder.get(right.id) ?? 0);
  });

  const parsedRepository = asRecord(JSON.parse(snapshot.threadData));
  if (!parsedRepository) {
    throw new TypeError("AgentKit thread snapshot must contain a repository.");
  }
  const originalRepositoryMessages = Array.isArray(parsedRepository.messages)
    ? parsedRepository.messages
    : [];
  const originalById = new Map<string, Record<string, unknown>>();
  for (const entry of originalRepositoryMessages) {
    const record = asRecord(entry);
    const storedMessage = asRecord(record?.message ?? entry);
    if (typeof storedMessage?.id === "string") {
      originalById.set(storedMessage.id, record ?? { message: storedMessage });
    }
  }
  const voiceRepositoryMessages = new Map<string, Record<string, unknown>>();
  for (const transcript of transcripts) {
    const result = appendRealtimeVoiceTranscriptToRepository(
      { messages: [] },
      transcript,
    );
    const messages = Array.isArray(result.repository.messages)
      ? result.repository.messages
      : [];
    const entry = asRecord(messages[0]);
    if (entry) voiceRepositoryMessages.set(transcript.id, entry);
  }
  const repositoryMessages = messages.map((message, index) => {
    const existing =
      originalById.get(message.id) ?? voiceRepositoryMessages.get(message.id);
    const savedMessage = asRecord(existing?.message) ?? {
      id: message.id,
      role: message.role,
      status: message.status,
      content: message.parts,
      metadata: message.metadata,
      createdAt: message.createdAt,
    };
    return {
      ...(existing ?? {}),
      parentId: index > 0 ? (messages[index - 1]?.id ?? null) : null,
      message: savedMessage,
    };
  });
  const agentKit = asRecord(parsedRepository.agentKit) ?? {};
  const firstUser = messages.find((message) => message.role === "user");
  const latestUser = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  return {
    ...snapshot,
    threadData: JSON.stringify({
      ...parsedRepository,
      headId: messages.at(-1)?.id ?? null,
      messages: repositoryMessages,
      agentKit: {
        ...agentKit,
        messages,
      },
    }),
    title:
      snapshot.title ||
      (firstUser ? agentMessageText(firstUser).slice(0, 80) : ""),
    preview: latestUser ? agentMessageText(latestUser).slice(0, 280) : "",
    messageCount: messages.length,
  };
}
