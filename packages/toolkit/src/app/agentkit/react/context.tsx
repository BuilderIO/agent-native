import {
  selectActiveAgentRoster,
  type AgentKitController,
  type AgentKitSnapshot,
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
  composer?: ComponentType<{ threadId: ThreadId }>;
  queue?: ComponentType<AgentKitQueueRenderProps>;
  suggestions?: ComponentType<AgentKitSuggestionsRenderProps>;
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
  queueMoveToTop: string;
  queueRemove: string;
  queueMore: string;
  suggestions: string;
  copy: string;
  copied: string;
  messageActions: string;
  copyRequestId: string;
  requestIdUnavailable: string;
  positiveFeedback: string;
  negativeFeedback: string;
  feedbackSubmitted: string;
  feedbackWhatWentWrong: string;
  feedbackPlaceholder: string;
  feedbackKeyboardHint: string;
  feedbackSubmit: string;
  fork: string;
  previousBranch: string;
  nextBranch: string;
  branchPosition: string;
  copyUnavailable: string;
  messageUnavailable: string;
  navigationUnavailable: string;
  editMessage: string;
  cancelEditing: string;
  regenerateResponse: string;
  expandMessage: string;
  collapseMessage: string;
  previewAttachment: string;
  pastedText: string;
  imagePreview: string;
  closePreview: string;
  dropFilesToAttach: string;
  scrollToBottom: string;
  formatTimestamp?: (createdAt: string) => string;
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
  queueMoveToTop: "Move to top",
  queueRemove: "Remove queued message",
  queueMore: "More actions",
  suggestions: "Suggested next actions",
  copy: "Copy message",
  copied: "Copied",
  messageActions: "Message actions",
  copyRequestId: "Copy request ID",
  requestIdUnavailable: "Request ID unavailable",
  positiveFeedback: "Helpful",
  negativeFeedback: "Not helpful",
  feedbackSubmitted: "Feedback submitted",
  feedbackWhatWentWrong: "What went wrong?",
  feedbackPlaceholder: "Describe what went wrong",
  feedbackKeyboardHint: "Press {{shortcut}}+Enter to submit",
  feedbackSubmit: "Submit feedback",
  fork: "Fork conversation",
  previousBranch: "Previous branch",
  nextBranch: "Next branch",
  branchPosition: "{{index}}/{{count}}",
  copyUnavailable: "Copying is unavailable in this browser.",
  messageUnavailable:
    "The message is no longer available in this conversation.",
  navigationUnavailable: "Conversation navigation is unavailable.",
  editMessage: "Edit message",
  cancelEditing: "Cancel editing",
  regenerateResponse: "Regenerate response",
  expandMessage: "Expand",
  collapseMessage: "Collapse",
  previewAttachment: "Preview {{name}}",
  pastedText: "Pasted text",
  imagePreview: "Image preview",
  closePreview: "Close preview",
  dropFilesToAttach: "Drop files to attach",
  scrollToBottom: "Scroll to bottom",
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
  branchNavigation?: AgentKitBranchNavigation;
  onCopyMessage?: AgentKitCopyMessageHandler;
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
  branchNavigation,
  onCopyMessage,
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
      branchNavigation,
      onCopyMessage,
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
      branchNavigation,
      onCopyMessage,
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

export function useAgentKitControl(requestedThreadId?: ThreadId) {
  const { controller, labels, threadId: contextThreadId } = useAgentKit();
  const threadId = requestedThreadId ?? contextThreadId;
  return useMemo(
    () => ({
      send: (
        text: string,
        options?: Parameters<AgentKitController["sendMessage"]>[0]["options"],
      ) => controller.sendMessage({ threadId, text, options }),
      sendMessage: (input: Omit<SendMessageInput, "threadId">) =>
        controller.sendMessage({ ...input, threadId }),
      load: () => controller.loadThread(threadId),
      resubscribe: (runId: string) =>
        controller.resubscribeRun(threadId, runId),
      queue: (text: string) => controller.queueMessage({ threadId, text }),
      queueMessage: (input: Omit<SendMessageInput, "threadId">) =>
        controller.queueMessage({ ...input, threadId }),
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
      moveQueuedMessageToTop: (messageId: string) =>
        controller.moveQueuedMessageToTop
          ? controller.moveQueuedMessageToTop(threadId, messageId)
          : Promise.reject(new Error(labels.error)),
      steerQueued: (
        messageId: string,
        options?: { interruptActiveRun?: boolean },
      ) =>
        controller.steerQueuedMessage(threadId, messageId, undefined, options),
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
    [controller, labels.error, threadId],
  );
}
