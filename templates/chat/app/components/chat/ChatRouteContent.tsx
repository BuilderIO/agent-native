import type {
  AgentConnectionRequest,
  AgentMessage,
  AgentRunOptions,
  FilePart,
} from "@agent-native/agentkit";
import { appendAgentChatContextToMessage } from "@agent-native/agentkit";
import { hasActiveAgentRuns } from "@agent-native/agentkit/client";
import { createAgentKitIntegrityReporter } from "@agent-native/core/client/agentkit-chat/integrity";
import { createAgentNativeAgentKitTransport } from "@agent-native/core/client/agentkit-chat/transport";
import {
  captureException,
  trackEvent,
} from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";
import {
  AgentMessageView,
  AgentRunFailure,
  AgentConnectionRequestCard,
  AgentKitChat,
  useAgentKitStopButton,
} from "@agent-native/toolkit/app/agentkit/react/components";
import {
  useAgentKit,
  useAgentKitControl,
  useAgentThread,
  type AgentRunFailureRenderProps,
  type AgentKitRenderProps,
} from "@agent-native/toolkit/app/agentkit/react/context";
import { CoreComposerRuntimeProvider } from "@agent-native/toolkit/app/chat/agentkit-chat/composer";
import {
  McpAgentKitConnectionRequestCard,
  McpAgentKitConnectionResume,
} from "@agent-native/toolkit/app/chat/agentkit-chat/connections";
import { CoreAgentKitRoot } from "@agent-native/toolkit/app/chat/agentkit-chat/index";
import {
  GuidedQuestionFlow,
  useGuidedQuestionFlow,
} from "@agent-native/toolkit/app/chat/agentkit-chat/questions";
import {
  findMcpConnectionSuggestionIntegration,
  McpConnectionSuggestion,
} from "@agent-native/toolkit/app/chat/agentkit-chat/suggestions";
import {
  BuilderSetupCard,
  isMissingLlmProviderRunError,
} from "@agent-native/toolkit/app/chat/chat/run-recovery";
import type {
  PromptComposerFile,
  PromptComposerSubmitOptions,
  Reference,
} from "@agent-native/toolkit/composer";
import { IconLayoutSidebarRight, IconX } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import { consumeChatHomeThreadId } from "@/lib/chat-home-thread";
import {
  clearFailedChatHandoff,
  chatThreadPath,
  readFailedChatHandoff,
  type ChatInitialComposerOptions,
  type FailedChatHandoffClearResult,
  type FailedChatHandoffEnvelope,
  type FailedChatHandoffReadResult,
  type FailedChatHandoffWriteResult,
  initialComposerOptionsFromState,
  initialMessageFromState,
  writeFailedChatHandoff,
} from "@/lib/chat-paths";
import { TAB_ID } from "@/lib/tab-id";

// Module scope on purpose: CoreAgentKitRoot memoizes the client on its options, so
// a new callback each render would rebuild the client and drop the stream.
const reportStreamIntegrity = createAgentKitIntegrityReporter("chat");

type FailedInitialDraft = FailedChatHandoffEnvelope & {
  attempt: number;
  threadId: string;
  unsaved: boolean;
};

export default function ChatRouteContent({
  initialThreadId,
}: {
  initialThreadId?: string;
} = {}) {
  const { threadId: routeThreadId } = useParams();
  const navigate = useNavigate();
  const threadId = routeThreadId ?? initialThreadId;

  if (!threadId) return null;

  return (
    <ChatThreadRouteContent
      routeThreadId={routeThreadId}
      resolvedThreadId={threadId}
      navigate={navigate}
    />
  );
}

function ChatThreadRouteContent({
  routeThreadId,
  resolvedThreadId,
  navigate,
}: {
  routeThreadId?: string;
  resolvedThreadId: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const t = useT();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [handoffStorageRevision, setHandoffStorageRevision] = useState(0);
  const failedHandoffStorageFailureReportedRef = useRef(new Set<string>());
  const reportHandoffStorageFailure = useCallback(
    (
      result:
        | FailedChatHandoffReadResult
        | FailedChatHandoffWriteResult
        | FailedChatHandoffClearResult,
      message: string,
    ) => {
      if (result.status !== "invalid" && result.status !== "unavailable") {
        return;
      }
      if (
        failedHandoffStorageFailureReportedRef.current.has(resolvedThreadId)
      ) {
        return;
      }
      failedHandoffStorageFailureReportedRef.current.add(resolvedThreadId);
      captureException(
        result.status === "unavailable"
          ? result.cause
          : new Error(`${message}: ${result.reason}`),
        { tags: { area: "chat_handoff_storage" } },
      );
    },
    [resolvedThreadId],
  );
  const restoredHandoffResult = useMemo(
    () => readFailedChatHandoff(resolvedThreadId),
    [handoffStorageRevision, resolvedThreadId],
  );
  const restoredHandoff =
    restoredHandoffResult.status === "found"
      ? restoredHandoffResult.handoff
      : null;
  const [failedInitialDrafts, setFailedInitialDrafts] = useState<
    Map<string, FailedInitialDraft>
  >(() => {
    return restoredHandoff
      ? new Map([
          [
            resolvedThreadId,
            {
              text: restoredHandoff.text,
              options: restoredHandoff.options,
              attempt: 0,
              threadId: resolvedThreadId,
              unsaved: false,
            },
          ],
        ])
      : new Map();
  });
  const failedInitialDraftsRef = useRef(failedInitialDrafts);
  const restoredForRoute = restoredHandoff;
  const failedDraftForRoute =
    failedInitialDrafts.get(resolvedThreadId) ??
    (restoredForRoute
      ? {
          text: restoredForRoute.text,
          options: restoredForRoute.options,
          attempt: 0,
          threadId: resolvedThreadId,
          unsaved: false,
        }
      : null);
  const failedInitialDraftRef = useRef(failedDraftForRoute);
  failedInitialDraftRef.current = failedDraftForRoute;
  const failedInitialDraftAttemptRef = useRef(0);
  const setFailedInitialDraftForThread = useCallback(
    (threadId: string, draft: FailedInitialDraft | null) => {
      const next = new Map(failedInitialDraftsRef.current);
      if (draft) next.set(threadId, draft);
      else next.delete(threadId);
      failedInitialDraftsRef.current = next;
      setFailedInitialDrafts(next);
    },
    [],
  );
  useEffect(() => {
    reportHandoffStorageFailure(
      restoredHandoffResult,
      "Could not restore the failed Chat handoff",
    );
    if (failedInitialDraftsRef.current.has(resolvedThreadId)) return;
    if (!restoredHandoff) return;
    setFailedInitialDraftForThread(resolvedThreadId, {
      text: restoredHandoff.text,
      options: restoredHandoff.options,
      attempt: 0,
      threadId: resolvedThreadId,
      unsaved: false,
    });
  }, [
    reportHandoffStorageFailure,
    resolvedThreadId,
    restoredHandoff,
    restoredHandoffResult,
    setFailedInitialDraftForThread,
  ]);
  const handleInitialMessageFailure = useCallback(
    (
      text: string,
      options: ChatInitialComposerOptions,
      persistence = writeFailedChatHandoff(resolvedThreadId, text, options),
    ) => {
      failedInitialDraftAttemptRef.current += 1;
      reportHandoffStorageFailure(
        persistence,
        "Could not save the failed Chat handoff",
      );
      const failedDraft = {
        text,
        options,
        attempt: failedInitialDraftAttemptRef.current,
        threadId: resolvedThreadId,
        unsaved: persistence.status !== "stored",
      };
      failedInitialDraftRef.current = failedDraft;
      setFailedInitialDraftForThread(resolvedThreadId, failedDraft);
    },
    [
      reportHandoffStorageFailure,
      resolvedThreadId,
      setFailedInitialDraftForThread,
    ],
  );
  const handleInitialMessageAccepted = useCallback(() => {
    reportHandoffStorageFailure(
      clearFailedChatHandoff(resolvedThreadId),
      "Could not clear the accepted Chat handoff",
    );
    if (failedInitialDraftsRef.current.has(resolvedThreadId)) {
      if (failedInitialDraftRef.current?.threadId === resolvedThreadId) {
        failedInitialDraftRef.current = null;
      }
      setFailedInitialDraftForThread(resolvedThreadId, null);
    }
    setHandoffStorageRevision((revision) => revision + 1);
  }, [
    reportHandoffStorageFailure,
    resolvedThreadId,
    setFailedInitialDraftForThread,
  ]);
  const updateFailedInitialDraft = useCallback(
    (
      update: Partial<FailedChatHandoffEnvelope> & {
        options?: Partial<ChatInitialComposerOptions>;
      },
    ) => {
      const current = failedInitialDraftRef.current;
      if (current?.threadId !== resolvedThreadId) return;
      const next = {
        ...current,
        ...update,
        options: { ...current.options, ...update.options },
      };
      const persistence = writeFailedChatHandoff(
        next.threadId,
        next.text,
        next.options,
      );
      const nextDraft = {
        ...next,
        unsaved: persistence.status !== "stored",
      };
      failedInitialDraftRef.current = nextDraft;
      reportHandoffStorageFailure(
        persistence,
        "Could not save the failed Chat handoff",
      );
      setFailedInitialDraftForThread(resolvedThreadId, nextDraft);
    },
    [
      reportHandoffStorageFailure,
      resolvedThreadId,
      setFailedInitialDraftForThread,
    ],
  );

  const [transport] = useState(() =>
    createAgentNativeAgentKitTransport({
      browserTabId: TAB_ID,
      surface: "app",
      adapter: { textFormat: "markdown" },
    }),
  );

  return (
    <div
      className="relative flex h-full min-h-0 overflow-hidden bg-background"
      data-agent-chat-workspace-state={workspaceOpen ? "open" : "closed"}
    >
      <div
        className={`agent-kit-chat-canvas-body min-w-0 flex-none ${
          workspaceOpen ? "agent-kit-chat-canvas-body--workspace-open" : ""
        }`}
      >
        <CoreComposerRuntimeProvider>
          <CoreAgentKitRoot
            transport={transport}
            clientOptions={{
              transportOwnership: "owned",
              retainActiveRunsOnThreadRelease: true,
              onIntegrityReport: reportStreamIntegrity,
            }}
            threadId={resolvedThreadId}
            labels={{
              composerPlaceholder: t("chat.composerPlaceholder"),
              continueRun: t("agentChat.common.continue"), // i18n-key-ignore shared framework catalog
              continueRunUnavailable: t(
                // i18n-key-ignore shared framework catalog
                "agentChat.recovery.continueUnavailable",
              ),
            }}
            slots={{
              emptyState: ChatEmptyState,
              message: ChatMessage,
              messageSupplement: ChatMcpConnectionSuggestion,
              runFailure: ChatRunFailure,
              connectionRequest: ChatMcpConnectionRequest,
              footer: ChatAgentFooter,
            }}
            onThreadForked={(thread) => navigate(chatThreadPath(thread.id))}
          >
            <ChatLifecycleTracking threadId={resolvedThreadId} />
            <ChatInitialMessage
              threadId={resolvedThreadId}
              hasRestoredDraft={failedDraftForRoute !== null}
              onFailure={handleInitialMessageFailure}
              onAccepted={handleInitialMessageAccepted}
            />
            <ChatMcpConnectionResume />
            <ChatCanvas
              workspaceOpen={workspaceOpen}
              setWorkspaceOpen={setWorkspaceOpen}
              initialText={
                failedDraftForRoute ? failedDraftForRoute.text : undefined
              }
              initialTextKey={
                failedDraftForRoute
                  ? `${resolvedThreadId}:${failedDraftForRoute.attempt}`
                  : undefined
              }
              recoveryOptions={
                failedDraftForRoute ? failedDraftForRoute.options : undefined
              }
              recoveryDraftUnsaved={failedDraftForRoute?.unsaved ?? false}
              onRecoveryOptionsChange={(options) =>
                updateFailedInitialDraft({ options })
              }
              onRecoveryDraftChange={updateFailedInitialDraft}
              onRecoverySubmitAccepted={handleInitialMessageAccepted}
            />
          </CoreAgentKitRoot>
        </CoreComposerRuntimeProvider>
      </div>
      <aside
        data-agent-chat-workspace-panel=""
        data-state={workspaceOpen ? "open" : "closed"}
        aria-hidden={workspaceOpen ? undefined : true}
        inert={workspaceOpen ? undefined : true}
        className="agent-kit-workspace-panel absolute end-0 flex flex-col border-s border-border bg-background shadow-lg md:shadow-none"
      >
        <header className="agent-kit-workspace-panel__header flex shrink-0 items-center border-b border-border px-3">
          <h2 className="min-w-0 truncate text-xs font-medium text-foreground">
            {t("settings.workspaceTitle")}
          </h2>
        </header>
        <div data-agent-chat-workspace-slot="" className="min-h-0 flex-1" />
      </aside>
    </div>
  );
}

function ChatMessage({ value, threadId }: AgentKitRenderProps<AgentMessage>) {
  const metadata = value.metadata as
    | { custom?: { agentNativeRecoveryAction?: unknown } }
    | undefined;
  const recoveryAction = metadata?.custom?.agentNativeRecoveryAction;
  if (
    value.role === "user" &&
    (recoveryAction === "continue" || recoveryAction === "retry")
  ) {
    return null;
  }
  return <AgentMessageView value={value} threadId={threadId} />;
}

type ChatRetryError = {
  code: "attachment_id_unavailable";
  runId: string;
};

function RecoveryIncludedSources({
  references,
  attachments,
  onRemoveReference,
  onRemoveAttachment,
}: {
  references: readonly Reference[];
  attachments: readonly FilePart[];
  onRemoveReference: (index: number) => void;
  onRemoveAttachment: (index: number) => void;
}) {
  const t = useT();
  if (references.length === 0 && attachments.length === 0) return null;
  return (
    <div
      className="flex max-w-full flex-wrap gap-1.5"
      data-testid="recovery-included-sources"
    >
      {references.map((reference, index) => (
        <span
          key={`reference:${index}:${reference.path}`}
          className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs"
          data-recovery-source="reference"
        >
          <span className="max-w-48 truncate">
            {reference.name || reference.path}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="-me-1"
            aria-label={t("composer.removeReference", {
              name: reference.name || reference.path,
            })}
            data-testid={`remove-recovery-reference-${index}`}
            onClick={() => onRemoveReference(index)}
          >
            <IconX aria-hidden="true" className="size-3" />
          </Button>
        </span>
      ))}
      {attachments.map((attachment, index) => (
        <span
          key={`attachment:${index}:${attachment.name}`}
          className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs"
          data-recovery-source="attachment"
        >
          <span className="max-w-48 truncate">{attachment.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="-me-1"
            aria-label={t("composer.removeAttachment", {
              name: attachment.name,
            })}
            data-testid={`remove-recovery-attachment-${index}`}
            onClick={() => onRemoveAttachment(index)}
          >
            <IconX aria-hidden="true" className="size-3" />
          </Button>
        </span>
      ))}
    </div>
  );
}

function ChatRunFailure({
  error,
  runId,
  threadId,
}: AgentRunFailureRenderProps) {
  const thread = useAgentThread(threadId);
  const { controller } = useAgentKit();
  const t = useT();
  const [retryError, setRetryError] = useState<ChatRetryError | null>(null);
  const retryStartedForRunsRef = useRef(new Set<string>());
  const recoveryMetadata = (message: (typeof thread.messages)[number]) =>
    (
      message.metadata as
        | {
            custom?: {
              agentNativeRecoveryAction?: unknown;
              agentNativeRecoveryOfRunId?: unknown;
              agentNativeQueueWhileRunning?: unknown;
              agentNativeQueuedWhileRunActive?: unknown;
              agentNativeInterruptActiveRun?: unknown;
            };
          }
        | undefined
    )?.custom;
  const userRequests = thread.messages.filter((message) => {
    if (message.role !== "user") return false;
    const action = recoveryMetadata(message)?.agentNativeRecoveryAction;
    return action !== "continue" && action !== "retry";
  });
  const originalRequest = userRequests[0];
  const originalMetadata =
    originalRequest?.metadata &&
    typeof originalRequest.metadata === "object" &&
    !Array.isArray(originalRequest.metadata)
      ? (originalRequest.metadata as Record<string, unknown>)
      : {};
  const originalMode =
    originalMetadata.mode === "act" || originalMetadata.mode === "plan"
      ? originalMetadata.mode
      : originalMetadata.requestMode === "act" ||
          originalMetadata.requestMode === "plan"
        ? originalMetadata.requestMode
        : undefined;
  const originalComposerOptions = initialComposerOptionsFromState({
    initialComposerOptions: {
      ...(typeof originalMetadata.engine === "string"
        ? { engine: originalMetadata.engine }
        : {}),
      ...(typeof originalMetadata.model === "string"
        ? { model: originalMetadata.model }
        : {}),
      ...(typeof originalMetadata.effort === "string"
        ? { effort: originalMetadata.effort }
        : {}),
      ...(originalMode ? { mode: originalMode } : {}),
      ...(Array.isArray(originalMetadata.references)
        ? { references: originalMetadata.references }
        : {}),
      ...(Array.isArray(originalMetadata.contextItems)
        ? { contextItems: originalMetadata.contextItems }
        : {}),
    },
  });
  const originalComposerSettings: ChatInitialComposerOptions =
    originalComposerOptions.status === "valid"
      ? originalComposerOptions.options
      : { mode: "act" };
  const originalCustomMetadata = originalRequest
    ? recoveryMetadata(originalRequest)
    : undefined;
  const queueWhileRunning =
    typeof originalCustomMetadata?.agentNativeQueueWhileRunning === "boolean"
      ? originalCustomMetadata.agentNativeQueueWhileRunning
      : originalComposerSettings.intent !== "immediate";
  const queuedWhileRunActive =
    typeof originalCustomMetadata?.agentNativeQueuedWhileRunActive === "boolean"
      ? originalCustomMetadata.agentNativeQueuedWhileRunActive
      : originalComposerSettings.intent === "queued";
  const interruptActiveRun =
    typeof originalCustomMetadata?.agentNativeInterruptActiveRun === "boolean"
      ? originalCustomMetadata.agentNativeInterruptActiveRun
      : originalComposerSettings.steer === true;
  const originalReferences = originalComposerSettings.references ?? [];
  const hasOriginalExecutionSettings = Boolean(
    originalMode ||
    originalComposerSettings.engine ||
    originalComposerSettings.model ||
    originalComposerSettings.effort,
  );
  const originalAttachments =
    originalRequest?.parts?.filter((part) => part.type === "file") ?? [];
  const [retryItems, setRetryItems] = useState<{
    runId: string;
    references: Reference[];
    attachments: FilePart[];
  } | null>(null);
  const visibleRetryItems =
    retryItems?.runId === runId
      ? retryItems
      : {
          runId,
          references: originalReferences,
          attachments: originalAttachments,
        };
  const updateRetryItems = (update: {
    references?: Reference[];
    attachments?: FilePart[];
  }) => {
    setRetryError(null);
    setRetryItems((current) => ({
      ...(current?.runId === runId
        ? current
        : {
            runId,
            references: [...originalReferences],
            attachments: originalAttachments,
          }),
      ...update,
    }));
  };
  const hasRetryForThisRun = thread.messages.some(
    (message) =>
      recoveryMetadata(message)?.agentNativeRecoveryAction === "retry" &&
      recoveryMetadata(message)?.agentNativeRecoveryOfRunId === runId,
  );
  const retryFirstMessage = useCallback(async () => {
    if (retryStartedForRunsRef.current.has(runId)) return;
    const attachments = visibleRetryItems.attachments;
    if (attachments.some((part) => part.fileId && !part.url)) {
      setRetryError({ code: "attachment_id_unavailable", runId });
      return;
    }
    setRetryError(null);
    retryStartedForRunsRef.current.add(runId);
    const prompt =
      originalRequest?.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n") ?? "";
    const retryMetadata = {
      ...(originalComposerSettings.engine
        ? { engine: originalComposerSettings.engine }
        : {}),
      ...(originalComposerSettings.model
        ? { model: originalComposerSettings.model }
        : {}),
      ...(originalComposerSettings.effort
        ? { effort: originalComposerSettings.effort }
        : {}),
      ...(visibleRetryItems.references.length
        ? { references: visibleRetryItems.references }
        : {}),
      ...(originalComposerSettings.contextItems === undefined
        ? {}
        : { contextItems: originalComposerSettings.contextItems }),
      ...(originalMode
        ? { mode: originalMode, requestMode: originalMode }
        : {}),
      custom: {
        agentNativeRecoveryAction: "retry",
        agentNativeRecoveryOfRunId: runId,
        agentNativeQueueWhileRunning: queueWhileRunning,
        agentNativeQueuedWhileRunActive: queuedWhileRunActive,
        agentNativeInterruptActiveRun: interruptActiveRun,
      },
    };
    const retryRunOptions: AgentRunOptions = {
      ...(originalComposerSettings.model
        ? { model: originalComposerSettings.model }
        : {}),
      ...(originalMode ? { mode: originalMode } : {}),
      ...(originalComposerSettings.effort &&
      !["auto", "max"].includes(originalComposerSettings.effort)
        ? {
            reasoningEffort: originalComposerSettings.effort as NonNullable<
              AgentRunOptions["reasoningEffort"]
            >,
          }
        : {}),
      metadata: retryMetadata,
    };
    let send: unknown;
    try {
      send = controller.sendMessage({
        threadId,
        text: prompt || t("chat.retryPreviousRequest"),
        ...(attachments.length ? { attachments } : {}),
        ...(hasOriginalExecutionSettings ? { options: retryRunOptions } : {}),
        metadata: retryMetadata,
        queueWhileRunning,
        queuedWhileRunActive,
        ...(interruptActiveRun ? { interruptActiveRun: true } : {}),
      });
    } catch (error) {
      retryStartedForRunsRef.current.delete(runId);
      captureException(error, { tags: { area: "chat_retry" } });
      return;
    }
    void Promise.resolve(send).catch((error) => {
      retryStartedForRunsRef.current.delete(runId);
      captureException(error, { tags: { area: "chat_retry" } });
    });
  }, [
    controller,
    originalComposerSettings,
    queueWhileRunning,
    queuedWhileRunActive,
    interruptActiveRun,
    originalMode,
    originalRequest,
    runId,
    t,
    threadId,
    visibleRetryItems,
  ]);
  const isFirstMessage = userRequests.length === 1 && !hasRetryForThisRun;
  if (
    isFirstMessage &&
    isMissingLlmProviderRunError({
      message: error.message,
      details: typeof error.details === "string" ? error.details : undefined,
      errorCode: error.code,
    })
  ) {
    return (
      <>
        <BuilderSetupCard
          fullWidth
          layout="sidebar"
          onRetry={retryFirstMessage}
        />
        <RecoveryIncludedSources
          references={visibleRetryItems.references}
          attachments={visibleRetryItems.attachments}
          onRemoveReference={(index) =>
            updateRetryItems({
              references: visibleRetryItems.references.filter(
                (_reference, candidate) => candidate !== index,
              ),
            })
          }
          onRemoveAttachment={(index) =>
            updateRetryItems({
              attachments: visibleRetryItems.attachments.filter(
                (_attachment, candidate) => candidate !== index,
              ),
            })
          }
        />
        {retryError?.runId === runId &&
        retryError.code === "attachment_id_unavailable" ? (
          <p role="alert" className="mt-2 px-3 text-sm text-destructive">
            {t("chat.retryAttachmentUnavailable")}
          </p>
        ) : null}
      </>
    );
  }
  return <AgentRunFailure error={error} runId={runId} threadId={threadId} />;
}

function ChatInitialMessage({
  threadId,
  hasRestoredDraft,
  onFailure,
  onAccepted,
}: {
  threadId: string;
  hasRestoredDraft: boolean;
  onFailure: (
    text: string,
    options: ChatInitialComposerOptions,
    persistence?: FailedChatHandoffWriteResult,
  ) => void;
  onAccepted: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const control = useAgentKitControl(threadId);
  const thread = useAgentThread(threadId);
  const sentRef = useRef(false);
  const message = initialMessageFromState(location.state);
  const composerOptionsResult = initialComposerOptionsFromState(location.state);
  const invalidComposerOptions = composerOptionsResult.status === "invalid";
  const composerOptions =
    composerOptionsResult.status === "valid"
      ? composerOptionsResult.options
      : undefined;
  const engine = composerOptions?.engine;
  const model = composerOptions?.model;
  const effort = composerOptions?.effort;
  const mode = composerOptions?.mode ?? "act";
  const references = composerOptions?.references ?? [];
  const contextItems = composerOptions?.contextItems;
  const activeAtSubmit = hasActiveAgentRuns(thread);

  useEffect(() => {
    if (!message || sentRef.current) return;
    if (hasRestoredDraft) {
      sentRef.current = true;
      return;
    }
    sentRef.current = true;
    const clearRouteState = () =>
      navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: null },
      );
    if (invalidComposerOptions) {
      clearRouteState();
      onFailure(message, {});
      toast.error(t("chat.invalidHandoffOptions"));
      captureException(new Error("Invalid options in initial Chat handoff"), {
        tags: { area: "chat_initial_message" },
      });
      return;
    }
    const options = composerOptions ?? {};
    const persistence = writeFailedChatHandoff(threadId, message, options);
    if (persistence.status !== "stored") {
      clearRouteState();
      onFailure(message, options, persistence);
      if (
        persistence.status !== "invalid" ||
        persistence.reason !== "payload-too-large"
      ) {
        return;
      }
    } else {
      // Router state survives a reload, so drop it before sending or a refresh
      // cannot distinguish a pending send from a failed one.
      clearRouteState();
    }
    const context = [
      composerOptions?.composerModeContext,
      contextItems?.map((item) => item.context).join("\n\n"),
    ]
      .filter(Boolean)
      .join("\n\n");
    const requestText = context
      ? appendAgentChatContextToMessage(message, context)
      : message;
    const queuedIntent =
      composerOptions?.intent === "queued" ||
      (composerOptions?.intent !== "immediate" && activeAtSubmit);
    const metadata = {
      ...(engine ? { engine } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(references.length ? { references } : {}),
      ...(contextItems === undefined ? {} : { contextItems }),
      mode,
      requestMode: mode,
      custom: {
        agentNativeQueueWhileRunning: composerOptions?.intent !== "immediate",
        agentNativeQueuedWhileRunActive: queuedIntent,
        agentNativeInterruptActiveRun: composerOptions?.steer === true,
      },
    };
    const runOptions: AgentRunOptions = {
      ...(model ? { model } : {}),
      mode,
      ...(effort && !["auto", "max"].includes(effort)
        ? {
            reasoningEffort: effort as NonNullable<
              AgentRunOptions["reasoningEffort"]
            >,
          }
        : {}),
      metadata,
    };
    void Promise.resolve(
      control.sendMessage({
        text: requestText,
        attachments: [...(composerOptions?.uploadedAttachments ?? [])],
        options: runOptions,
        metadata,
        queueWhileRunning: metadata.custom.agentNativeQueueWhileRunning,
        queuedWhileRunActive: queuedIntent,
        ...(metadata.custom.agentNativeInterruptActiveRun
          ? { interruptActiveRun: true }
          : {}),
      }),
    )
      .then(onAccepted)
      .catch((error: unknown) => {
        onFailure(message, composerOptions ?? {});
        captureException(error, { tags: { area: "chat_initial_message" } });
        toast.error(error instanceof Error ? error.message : String(error));
      });
  }, [
    composerOptions,
    control,
    contextItems,
    activeAtSubmit,
    hasRestoredDraft,
    invalidComposerOptions,
    engine,
    effort,
    location.pathname,
    location.search,
    message,
    model,
    navigate,
    onAccepted,
    onFailure,
    t,
    threadId,
  ]);

  return null;
}

function ChatLifecycleTracking({ threadId }: { threadId: string }) {
  const thread = useAgentThread(threadId);
  const lifecycleRef = useRef({
    threadId: "",
    pendingCreation: false,
    observedMessages: false,
    messageCount: 0,
  });

  useEffect(() => {
    const pendingCreation = consumeChatHomeThreadId(threadId);
    lifecycleRef.current = {
      threadId,
      pendingCreation,
      observedMessages: false,
      messageCount: 0,
    };
    if (!pendingCreation) {
      trackEvent("thread_resumed", { thread_id: threadId });
    }
  }, [threadId]);

  useEffect(() => {
    const lifecycle = lifecycleRef.current;
    if (lifecycle.threadId !== threadId) return;
    const count = thread.messages.length;
    const initialObservation = !lifecycle.observedMessages;
    lifecycle.observedMessages = true;
    if (count <= lifecycle.messageCount) {
      lifecycle.messageCount = count;
      return;
    }
    const pendingCreation = lifecycle.pendingCreation;
    if (pendingCreation) {
      lifecycle.pendingCreation = false;
      trackEvent("thread_created", {
        output_id: threadId,
        output_type: "thread",
      });
    }
    if (!initialObservation || pendingCreation) {
      trackEvent("message_exchanged", {
        thread_id: threadId,
        msg_count: count,
      });
    }
    lifecycle.messageCount = count;
  }, [thread.messages.length, threadId]);

  return null;
}

function ChatAgentFooter({ children }: { children: ReactNode }) {
  const { controller, threadId } = useAgentKit();
  const submitAnswers = useCallback(
    async ({ formattedAnswers }: { formattedAnswers: string }) => {
      await controller.sendMessage({ threadId, text: formattedAnswers });
      return { delivered: true };
    },
    [controller, threadId],
  );
  const skipQuestions = useCallback(
    async ({ message }: { message: string }) => {
      await controller.sendMessage({ threadId, text: message });
      return { delivered: true };
    },
    [controller, threadId],
  );
  const {
    questions,
    title,
    description,
    skipLabel,
    submitLabel,
    isSubmissionBlocked,
    providerStatus,
    retryProviderStatus,
    handleSubmit,
    handleSkip,
  } = useGuidedQuestionFlow({
    stateKey: "guided-questions",
    queryKey: ["guided-questions", "agentkit"],
    browserTabId: TAB_ID,
    threadId,
    onSubmitMessage: submitAnswers,
    onSkipMessage: skipQuestions,
  });

  return (
    <div className="agent-kit-chat-footer-stack">
      {questions?.length ? (
        <div className="agent-kit-chat-guided-question">
          <GuidedQuestionFlow
            questions={questions}
            onSubmit={handleSubmit}
            onSkip={handleSkip}
            {...(title ? { title } : {})}
            {...(description ? { description } : {})}
            {...(skipLabel ? { skipLabel } : {})}
            {...(submitLabel ? { submitLabel } : {})}
            isSubmissionBlocked={isSubmissionBlocked}
            providerStatus={providerStatus}
            onRetryProviderStatus={retryProviderStatus}
            className="h-auto items-stretch justify-stretch bg-transparent"
          />
        </div>
      ) : null}
      {children}
    </div>
  );
}

function ChatMcpConnectionRequest({
  value: request,
  runId,
}: AgentKitRenderProps<AgentConnectionRequest> & { runId: string }) {
  const control = useAgentKitControl();
  const { threadId } = useAgentKit();
  if (request.status === "connected" || request.status === "declined") {
    return <AgentConnectionRequestCard request={request} runId={runId} />;
  }
  const resolve = (status: "connected" | "declined") =>
    control.resolveConnectionRequest(runId, request.id, { status });
  return (
    <McpAgentKitConnectionRequestCard
      provider={request.provider}
      reason={request.reason}
      status={request.status}
      appId={request.appId}
      source={request.source}
      {...(request.detail ? { detail: request.detail } : {})}
      target={{ threadId, runId, requestId: request.id }}
      onConnected={() => resolve("connected")}
      onDeclined={() => resolve("declined")}
      fallback={<AgentConnectionRequestCard request={request} runId={runId} />}
    />
  );
}

function ChatMcpConnectionResume() {
  const { controller, threadId } = useAgentKit();
  const onResume = useCallback(
    (target: { threadId: string; runId: string; requestId: string }) =>
      controller.resolveConnectionRequest({
        ...target,
        response: { status: "connected" },
      }),
    [controller],
  );
  const onMessageResume = useCallback(
    async (request: { message: string }) => {
      await controller.sendMessage({ threadId, text: request.message });
    },
    [controller, threadId],
  );
  return (
    <McpAgentKitConnectionResume
      onResume={onResume}
      onMessageResume={onMessageResume}
    />
  );
}

function messageText(message: AgentMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function ChatMcpConnectionSuggestion({
  value: message,
  threadId,
}: AgentKitRenderProps<AgentMessage>) {
  const thread = useAgentThread(threadId);
  if (message.role !== "assistant" || message.status === "streaming") {
    return null;
  }
  const responseText = messageText(message);
  const messageIndex = thread.messages.findIndex(
    (candidate) => candidate.id === message.id,
  );
  let contextText = "";
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const candidate = thread.messages[index];
    if (candidate?.role === "user") {
      contextText = messageText(candidate);
      break;
    }
  }
  const integration = findMcpConnectionSuggestionIntegration({
    text: responseText,
    contextText,
    variant: "response",
  });
  if (!integration) return null;
  const hasStructuredRequest = Object.values(
    thread.connectionRequests ?? {},
  ).some(
    (request) =>
      request.provider.trim().toLowerCase() === integration.id.toLowerCase() ||
      request.provider.trim().toLowerCase() ===
        integration.provider.toLowerCase(),
  );
  if (hasStructuredRequest) return null;
  return (
    <McpConnectionSuggestion
      text={responseText}
      contextText={contextText}
      variant="response"
      requestedByAgent
      integrationId={integration.id}
    />
  );
}

function ChatEmptyState() {
  const t = useT();
  return (
    <div className="agentkit-chat-empty-copy">
      <h1>{t("chat.heroTitle")}</h1>
    </div>
  );
}

function ChatCanvas({
  workspaceOpen,
  setWorkspaceOpen,
  initialText,
  initialTextKey,
  recoveryOptions,
  onRecoveryOptionsChange,
  onRecoveryDraftChange,
  onRecoverySubmitAccepted,
  recoveryDraftUnsaved,
}: {
  workspaceOpen: boolean;
  setWorkspaceOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  initialText?: string;
  initialTextKey?: string;
  recoveryOptions?: ChatInitialComposerOptions;
  recoveryDraftUnsaved: boolean;
  onRecoveryOptionsChange: (
    options: Partial<ChatInitialComposerOptions>,
  ) => void;
  onRecoveryDraftChange: (
    update: Partial<FailedChatHandoffEnvelope> & {
      options?: Partial<ChatInitialComposerOptions>;
    },
  ) => void;
  onRecoverySubmitAccepted: () => void;
}) {
  const t = useT();
  const { threadId } = useAgentKit();
  const thread = useAgentThread();
  const control = useAgentKitControl(threadId);
  const stopButton = useAgentKitStopButton({
    label: t("agentChat.composer.stopResponse"), // i18n-key-ignore shared framework catalog
    onError: (error) => toast.error(error.message),
  });
  const hasConversation = thread.messages.length > 0;
  const activeAtSubmit = hasActiveAgentRuns(thread);

  const retryInitialDraft = useCallback(
    async (
      text: string,
      files: PromptComposerFile[],
      references: Reference[],
      options: PromptComposerSubmitOptions,
    ) => {
      if (!recoveryOptions) return;
      const contextItems = options.contextItems ?? recoveryOptions.contextItems;
      const composerModeContext =
        options.composerModeContext ?? recoveryOptions.composerModeContext;
      const context = [
        composerModeContext,
        contextItems?.map((item) => item.context).join("\n\n"),
      ]
        .filter(Boolean)
        .join("\n\n");
      const requestText = context
        ? appendAgentChatContextToMessage(text, context)
        : text;
      const runMode = recoveryOptions.mode ?? "act";
      const model = options.model ?? recoveryOptions.model;
      const engine = options.engine ?? recoveryOptions.engine;
      const effort = options.effort ?? recoveryOptions.effort;
      const mergedReferences = [
        ...(recoveryOptions.references ?? []),
        ...references,
      ].filter(
        (reference, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.type === reference.type &&
              candidate.source === reference.source &&
              candidate.path === reference.path &&
              candidate.refId === reference.refId,
          ) === index,
      );
      const retryIntent = options.intent ?? recoveryOptions.intent;
      const queuedIntent =
        retryIntent === "queued" ||
        (retryIntent === undefined && activeAtSubmit);
      const retrySteer = options.steer ?? recoveryOptions.steer;
      const retryOptions: ChatInitialComposerOptions = {
        ...recoveryOptions,
        mode: runMode,
        ...(model ? { model } : {}),
        ...(engine ? { engine } : {}),
        ...(effort ? { effort } : {}),
        ...(retryIntent === undefined ? {} : { intent: retryIntent }),
        ...(retrySteer === undefined ? {} : { steer: retrySteer }),
        ...(contextItems === undefined ? {} : { contextItems }),
        ...(composerModeContext === undefined ? {} : { composerModeContext }),
        references: mergedReferences,
        uploadedAttachments: recoveryOptions.uploadedAttachments ?? [],
      };
      onRecoveryDraftChange({ text, options: retryOptions });
      const uploadedAttachments = files.length
        ? await control.uploadFiles(
            files.map((file) => ({
              name: file.name,
              mediaType: file.type || "application/octet-stream",
              size: file.size,
              body: file,
            })),
          )
        : [];
      const acceptedOptions = {
        ...retryOptions,
        uploadedAttachments: [
          ...(recoveryOptions.uploadedAttachments ?? []),
          ...uploadedAttachments,
        ],
      };
      onRecoveryDraftChange({ text, options: acceptedOptions });
      const metadata = {
        ...(engine ? { engine } : {}),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(mergedReferences.length ? { references: mergedReferences } : {}),
        ...(contextItems === undefined ? {} : { contextItems }),
        mode: runMode,
        requestMode: runMode,
      };
      const runOptions: AgentRunOptions = {
        ...(model ? { model } : {}),
        mode: runMode,
        ...(effort && !["auto", "max"].includes(effort)
          ? {
              reasoningEffort: effort as NonNullable<
                AgentRunOptions["reasoningEffort"]
              >,
            }
          : {}),
        metadata,
      };
      await control.sendMessage({
        text: requestText,
        attachments: [
          ...(recoveryOptions.uploadedAttachments ?? []),
          ...uploadedAttachments,
        ],
        options: runOptions,
        metadata,
        queueWhileRunning: retryIntent !== "immediate",
        queuedWhileRunActive: queuedIntent,
        ...(retrySteer ? { interruptActiveRun: true } : {}),
        onLocalSubmit: options.onLocalSubmit,
      });
      onRecoverySubmitAccepted();
    },
    [
      activeAtSubmit,
      control,
      threadId,
      onRecoveryDraftChange,
      onRecoverySubmitAccepted,
      recoveryOptions,
    ],
  );

  useEffect(() => {
    if (!hasConversation) setWorkspaceOpen(false);
  }, [hasConversation, setWorkspaceOpen]);

  const toolbar = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-agent-page-workspace-toggle=""
          aria-label={t("settings.workspaceTitle")}
          aria-expanded={workspaceOpen}
          onClick={() => setWorkspaceOpen((open) => !open)}
        >
          <IconLayoutSidebarRight className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("settings.workspaceTitle")}</TooltipContent>
    </Tooltip>
  );

  return (
    <AgentKitChat
      className="h-full"
      title={thread.thread?.title?.trim() || APP_TITLE}
      toolbar={toolbar}
      emptyComposerPlacement="center"
      composerProps={{
        requireAgentEngine: true,
        initialText,
        initialTextKey,
        ...(recoveryOptions
          ? {
              mode: recoveryOptions.mode ?? "act",
              selectedModel: recoveryOptions.model,
              selectedEngine: recoveryOptions.engine,
              selectedEffort: recoveryOptions.effort,
              contextItems: recoveryOptions.contextItems,
              onModeChange: (mode: "act" | "plan") =>
                onRecoveryOptionsChange({ mode }),
              onModelChange: (model: string, engine: string) =>
                onRecoveryOptionsChange({ model, engine }),
              onEffortChange: (
                effort: NonNullable<ChatInitialComposerOptions["effort"]>,
              ) => onRecoveryOptionsChange({ effort }),
              onRemoveContextItem: (key: string) =>
                onRecoveryOptionsChange({
                  contextItems: recoveryOptions.contextItems?.filter(
                    (item) => item.key !== key,
                  ),
                }),
              onTextChange: (text: string) => onRecoveryDraftChange({ text }),
              toolbarSlot: (
                <>
                  {recoveryDraftUnsaved ? (
                    <p
                      className="px-2 text-xs text-destructive"
                      data-testid="chat-recovery-draft-unsaved"
                      role="status"
                    >
                      {t("chat.recoveryDraftUnsaved")}
                    </p>
                  ) : null}
                  <RecoveryIncludedSources
                    references={recoveryOptions.references ?? []}
                    attachments={recoveryOptions.uploadedAttachments ?? []}
                    onRemoveReference={(index) =>
                      onRecoveryOptionsChange({
                        references: recoveryOptions.references?.filter(
                          (_reference, candidate) => candidate !== index,
                        ),
                      })
                    }
                    onRemoveAttachment={(index) =>
                      onRecoveryOptionsChange({
                        uploadedAttachments:
                          recoveryOptions.uploadedAttachments?.filter(
                            (_attachment, candidate) => candidate !== index,
                          ),
                      })
                    }
                  />
                </>
              ),
              onSubmit: retryInitialDraft,
            }
          : {}),
        stopButton,
        queueWhileRunning: true,
        autoFocus: true,
        plusMenuMode: "full",
        voiceEnabled: true,
        includeDefaultSlashCommands: false,
        includeDefaultSlashSkills: false,
      }}
    />
  );
}
