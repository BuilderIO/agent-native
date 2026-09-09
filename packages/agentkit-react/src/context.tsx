import {
  selectActiveAgentRoster,
  type AgentKitController,
  type AgentKitSnapshot,
} from "@agent-native/agentkit-client";
import type {
  AgentActivity,
  AgentApprovalRequest,
  AgentApprovalResponse,
  AgentConnectionRequest,
  AgentConnectionResponse,
  AgentCapabilities,
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
} from "@agent-native/agentkit-protocol";
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

export interface AgentConnectionErrorRenderProps {
  error: AgentError;
  threadId: ThreadId;
  recover: () => Promise<unknown>;
  recovering: boolean;
  recoveryError?: Error;
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
  /** @deprecated Prefer `connectionError`. */
  error?: ComponentType<AgentConnectionErrorRenderProps>;
  connectionError?: ComponentType<AgentConnectionErrorRenderProps>;
  emptyState?: ComponentType<{ threadId: ThreadId }>;
  composer?: ComponentType<{ threadId: ThreadId }>;
  queue?: ComponentType<AgentKitQueueRenderProps>;
  suggestions?: ComponentType<AgentKitSuggestionsRenderProps>;
}

export interface AgentKitRegistry {
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
  connectionConnect: string;
  connectionConnecting: string;
  connectionConnected: string;
  connectionNotNow: string;
  connectionRetry: string;
  connectionFailed: string;
  connectionAdminRequired: string;
  activities: string;
  working: string;
  workingFor: string;
  worked: string;
  workedFor: string;
  durationHourShort: string;
  durationMinuteShort: string;
  durationSecondShort: string;
  agents: string;
  tasks: string;
  composerLabel: string;
  composerPlaceholder: string;
  queue: string;
  queueSteer: string;
  queueSteerHint: string;
  queueRemove: string;
  queueMore: string;
  suggestions: string;
  copy: string;
  copied: string;
  positiveFeedback: string;
  negativeFeedback: string;
  fork: string;
  copyUnavailable: string;
  error: string;
  renderError: string;
  runFailed: string;
  reconnect: string;
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
}

export const defaultAgentKitLabels: AgentKitLabels = {
  conversation: "Agent conversation",
  assistant: "Assistant",
  you: "You",
  approvalApprove: "Approve",
  approvalDeny: "Deny",
  approvalSubmit: "Submit",
  approvalOther: "Other",
  approvalOtherPlaceholder: "Type your answer",
  connectionConnect: "Connect",
  connectionConnecting: "Connecting…",
  connectionConnected: "Connected",
  connectionNotNow: "Not now",
  connectionRetry: "Try again",
  connectionFailed: "Connection failed",
  connectionAdminRequired: "Ask a workspace admin to connect this service.",
  activities: "Agent activity",
  working: "Working",
  workingFor: "Working for {{duration}}",
  worked: "Worked",
  workedFor: "Worked for {{duration}}",
  durationHourShort: "h",
  durationMinuteShort: "m",
  durationSecondShort: "s",
  agents: "Agent collaboration",
  tasks: "Agent tasks",
  composerLabel: "Message agent",
  composerPlaceholder: "Ask the agent to explore, build, or explain…",
  queue: "Queued messages",
  queueSteer: "Steer",
  queueSteerHint: "Send this message to the active run",
  queueRemove: "Remove queued message",
  queueMore: "More actions",
  suggestions: "Suggested next actions",
  copy: "Copy message",
  copied: "Copied",
  positiveFeedback: "Helpful",
  negativeFeedback: "Not helpful",
  fork: "Fork conversation",
  copyUnavailable: "Copying is unavailable in this browser.",
  error: "Something went wrong",
  renderError: "This content couldn’t be displayed.",
  runFailed: "Run failed",
  reconnect: "Reconnect",
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
};

export interface AgentKitProviderProps {
  controller: AgentKitController;
  threadId: ThreadId;
  slots?: AgentKitSlots;
  registry?: AgentKitRegistry;
  labels?: Partial<AgentKitLabels>;
  onOpenObject?: (object: AgentObjectReference) => void;
  onThreadForked?: (thread: AgentThread) => void;
  /**
   * Resolves a provider identifier through host-owned connection setup. The
   * callback, never the agent-authored request, owns OAuth URLs and scopes.
   */
  onConnectionRequest?: (
    request: AgentConnectionRequest,
  ) => Promise<AgentConnectionResponse>;
  /** Receives full renderer failures while the UI shows a safe fallback. */
  onRenderError?: (failure: AgentKitRenderFailure) => void;
  onClientEffect?: (effect: {
    type: "client.effect" | "client.deeplink";
    name: string;
    data?: Record<string, unknown>;
  }) => void;
  children: ReactNode;
}

export interface AgentKitContextValue {
  controller: AgentKitController;
  threadId: ThreadId;
  slots: AgentKitSlots;
  registry: AgentKitRegistry;
  labels: AgentKitLabels;
  onOpenObject?: (object: AgentObjectReference) => void;
  onThreadForked?: (thread: AgentThread) => void;
  onConnectionRequest?: AgentKitProviderProps["onConnectionRequest"];
  onRenderError?: (failure: AgentKitRenderFailure) => void;
  registerComposerFocus: (threadId: ThreadId, focus: () => void) => () => void;
  requestComposerFocus: (threadId: ThreadId) => void;
}

const AgentKitContext = createContext<AgentKitContextValue | null>(null);

export function AgentKitProvider({
  controller,
  threadId,
  slots = {},
  registry = {},
  labels,
  onOpenObject,
  onThreadForked,
  onConnectionRequest,
  onRenderError,
  onClientEffect,
  children,
}: AgentKitProviderProps) {
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
  const mergedLabels = useMemo(
    () => ({ ...defaultAgentKitLabels, ...labels }),
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
      onConnectionRequest,
      onRenderError,
      registerComposerFocus,
      requestComposerFocus,
    }),
    [
      controller,
      threadId,
      slots,
      registry,
      mergedLabels,
      onOpenObject,
      onThreadForked,
      onConnectionRequest,
      onRenderError,
      registerComposerFocus,
      requestComposerFocus,
    ],
  );
  const seenEffects = useRef({
    controller,
    threadId,
    ids: new Set<string>(),
  });
  if (
    seenEffects.current.controller !== controller ||
    seenEffects.current.threadId !== threadId
  ) {
    seenEffects.current = { controller, threadId, ids: new Set<string>() };
  }

  useEffect(() => {
    if (!onClientEffect) return;
    const scope = seenEffects.current;
    const deliver = () => {
      if (seenEffects.current !== scope) return;
      const events = controller.getSnapshot().threads[threadId]?.events ?? [];
      for (const event of events) {
        if (
          (event.type === "client.effect" ||
            event.type === "client.deeplink") &&
          !scope.ids.has(event.id)
        ) {
          scope.ids.add(event.id);
          onClientEffect({
            type: event.type,
            name: event.name,
            data: event.data,
          });
        }
      }
    };
    deliver();
    return controller.subscribe(deliver);
  }, [controller, onClientEffect, threadId]);

  return (
    <AgentKitContext.Provider value={value}>
      {children}
    </AgentKitContext.Provider>
  );
}

/** Coalesces same-turn transport bursts without dropping the latest snapshot. */
function subscribeToAgentKitUpdate(
  controller: AgentKitController,
  listener: () => void,
): () => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const notify = () => {
    timeout = undefined;
    listener();
  };
  const schedule = () => {
    if (timeout !== undefined) return;
    timeout = setTimeout(notify, 0);
  };
  const unsubscribe = controller.subscribe(schedule);
  return () => {
    unsubscribe();
    if (timeout !== undefined) clearTimeout(timeout);
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

export function useAgentCapabilities(): AgentCapabilities {
  return useAgentKitSelector((snapshot) => snapshot.capabilities);
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

export function useAgentKitControl(requestedThreadId?: ThreadId) {
  const { controller, threadId: contextThreadId } = useAgentKit();
  const threadId = requestedThreadId ?? contextThreadId;
  return useMemo(
    () => ({
      send: (
        text: string,
        options?: Parameters<AgentKitController["sendMessage"]>[0]["options"],
      ) => controller.sendMessage({ threadId, text, options }),
      sendMessage: (
        input: Omit<
          Parameters<AgentKitController["sendMessage"]>[0],
          "threadId"
        >,
      ) => controller.sendMessage({ ...input, threadId }),
      load: () => controller.loadThread(threadId),
      resubscribe: (runId: string) =>
        controller.resubscribeRun(threadId, runId),
      /** @deprecated Use `resubscribe`; this does not retry agent work. */
      resume: (runId: string) => controller.resubscribeRun(threadId, runId),
      queue: (text: string) => controller.queueMessage({ threadId, text }),
      queueMessage: (
        input: Omit<
          Parameters<AgentKitController["queueMessage"]>[0],
          "threadId"
        >,
      ) => controller.queueMessage({ ...input, threadId }),
      cancel: (runId: string) => controller.cancelRun(threadId, runId),
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
        controller.removeQueuedMessage(threadId, messageId),
      steerQueued: (messageId: string) =>
        controller.steerQueuedMessage(threadId, messageId),
      submitFeedback: (
        messageId: string,
        value: "positive" | "negative" | "dismissed",
      ) => controller.submitFeedback(threadId, messageId, value),
      fork: (fromMessageId: string) =>
        controller.forkThread(threadId, fromMessageId),
      updateThread: (
        patch: Parameters<AgentKitController["updateThread"]>[1],
      ) => controller.updateThread(threadId, patch),
      deleteThread: () => controller.deleteThread(threadId),
      uploadFiles: controller.uploadFiles.bind(controller, threadId),
      invokeAction: controller.invokeAction.bind(controller),
    }),
    [controller, threadId],
  );
}
