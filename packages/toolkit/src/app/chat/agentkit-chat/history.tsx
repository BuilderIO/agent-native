import type {
  AgentEvent,
  AgentMessage,
  ThreadId,
} from "@agent-native/agentkit/protocol";
import {
  coerceAssistantChatHistoryDate,
  isAssistantChatHistoryVersion,
  type AssistantChatHistoryVersion,
} from "@agent-native/core/client/agent-chat";
import { useDevMode } from "@agent-native/core/client/agent-chat";
import { captureError } from "@agent-native/core/client/analytics";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { cn } from "@agent-native/toolkit/utils";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconLoader2,
} from "@tabler/icons-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  useAgentKit,
  useAgentThread,
  type AgentKitRenderProps,
} from "../../agentkit/react/index.js";

export type AgentKitHistoryVersion = AssistantChatHistoryVersion;

export interface AgentKitHistoryScope {
  type: string;
  id: string;
}

export interface AgentKitHistoryMessage {
  id: string;
  createdAt: string | number | Date;
  threadId?: ThreadId;
  scope?: AgentKitHistoryScope;
  runId?: string;
  turnId?: string;
  hasCompletedSideEffect: boolean;
}

export interface AgentKitHistoryConfig<
  TListResult = unknown,
  TVersion extends AgentKitHistoryVersion = AgentKitHistoryVersion,
  TRestoreResult = unknown,
> {
  /** Flush host editor writes before an AgentKit composer submits a turn. */
  beforeStart?: () => void | Promise<void>;
  list: {
    action: string;
    args?:
      | Record<string, unknown>
      | ((threadId: ThreadId) => Record<string, unknown>);
    getVersions: (result: TListResult) => readonly TVersion[];
  };
  restore: {
    action: string;
    args: (
      version: TVersion,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>;
    beforeRestore?: () => void | Promise<void>;
    onRestored?: (
      result: TRestoreResult,
      version: TVersion,
    ) => void | Promise<void>;
  };
  createVersion?: {
    action: string;
    args:
      | Record<string, unknown>
      | ((message: AgentKitHistoryMessage) => Record<string, unknown>);
  };
  isEditable?: (version: TVersion) => boolean;
  scope?: AgentKitHistoryScope;
  matchVersion?: (
    version: TVersion,
    message: AgentKitHistoryMessage,
  ) => boolean;
}

export interface AgentKitHistoryContextValue {
  beginningVersion: AgentKitHistoryVersion | null;
  historyLoadFailed: boolean;
  isRetryingHistory: boolean;
  isBusy: boolean;
  isRestoring: boolean;
  isSubmissionInFlight: boolean;
  /** Pass to AgentKitComposer's onBeforeSubmit prop. */
  beforeStart: () => Promise<boolean>;
  /** Reserve host state until an accepted submission has reached the transport. */
  beginSubmission: () => Promise<(() => void) | null>;
  /** Wait until an in-flight restore has finished before mutating the host. */
  waitForRestore: () => Promise<void>;
  retryHistory: () => void;
  findVersion: (
    message: AgentKitHistoryMessage,
  ) => AgentKitHistoryVersion | null;
  toHistoryMessage: (message: AgentMessage) => AgentKitHistoryMessage | null;
  restoreVersion: (version: AgentKitHistoryVersion) => Promise<void>;
}

export function updateAgentKitSubmissionCounts(
  counts: ReadonlyMap<string, number>,
  threadId: string,
  change: number,
): Map<string, number> {
  const next = new Map(counts);
  const count = Math.max(0, (next.get(threadId) ?? 0) + change);
  if (count === 0) next.delete(threadId);
  else next.set(threadId, count);
  return next;
}

export interface AgentKitDevCheckpointContextValue {
  apiUrl: string;
  isDevMode: boolean;
  checkpointRunIds: ReadonlySet<string>;
  isBusy: boolean;
}

const AgentKitHistoryContext =
  createContext<AgentKitHistoryContextValue | null>(null);
const AgentKitDevCheckpointContext =
  createContext<AgentKitDevCheckpointContextValue | null>(null);

export function AgentKitDevCheckpointProvider({
  apiUrl,
  children,
}: {
  apiUrl: string;
  children: ReactNode;
}) {
  const { isDevMode } = useDevMode(apiUrl);
  const { threadId } = useAgentKit();
  const thread = useAgentThread(threadId);
  const hasActiveRuns = thread.activeRunIds.length > 0;
  const history = useOptionalAgentKitHistory();
  const [checkpointRunIds, setCheckpointRunIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  useEffect(() => {
    if (
      !isDevMode ||
      !threadId ||
      thread.messages.length === 0 ||
      hasActiveRuns
    ) {
      setCheckpointRunIds((current) =>
        current.size === 0 ? current : new Set<string>(),
      );
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `${apiUrl}/checkpoints?threadId=${encodeURIComponent(threadId)}`,
        );
        if (!response.ok) throw new Error(String(response.status));
        const rows: unknown = await response.json();
        if (cancelled) return;
        setCheckpointRunIds(
          new Set(
            Array.isArray(rows)
              ? rows
                  .map((row) => (row as { runId?: unknown })?.runId)
                  .filter(
                    (runId): runId is string =>
                      typeof runId === "string" && runId.length > 0,
                  )
              : [],
          ),
        );
      } catch {
        if (!cancelled) setCheckpointRunIds(new Set<string>());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, hasActiveRuns, isDevMode, thread.messages.length, threadId]);

  const value = useMemo<AgentKitDevCheckpointContextValue>(
    () => ({
      apiUrl,
      isDevMode,
      checkpointRunIds,
      isBusy: hasActiveRuns || Boolean(history?.isBusy),
    }),
    [apiUrl, checkpointRunIds, hasActiveRuns, history?.isBusy, isDevMode],
  );
  return (
    <AgentKitDevCheckpointContext.Provider value={value}>
      {children}
    </AgentKitDevCheckpointContext.Provider>
  );
}

export function shouldOfferAgentKitDevCheckpointRestore(input: {
  isDevMode: boolean;
  isComplete: boolean;
  isLastMessage: boolean;
  isBusy: boolean;
  runId?: string;
  checkpointRunIds: ReadonlySet<string>;
  hostname: string;
}): boolean {
  return Boolean(
    input.isDevMode &&
    input.isComplete &&
    !input.isLastMessage &&
    !input.isBusy &&
    input.runId &&
    input.checkpointRunIds.has(input.runId) &&
    ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(input.hostname),
  );
}

export function AgentKitDevCheckpointRestore({
  message,
}: {
  message: AgentMessage;
}) {
  const checkpoint = useContext(AgentKitDevCheckpointContext);
  const { threadId } = useAgentKit();
  const thread = useAgentThread(threadId);
  const t = useT();
  const [state, setState] = useState<
    "idle" | "confirming" | "restoring" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const metadata = messageMetadata(message);
  const custom = isRecord(metadata.custom) ? metadata.custom : undefined;
  const runId = stringValue(metadata.runId ?? custom?.runId);
  const offered =
    checkpoint !== null &&
    typeof window !== "undefined" &&
    shouldOfferAgentKitDevCheckpointRestore({
      isDevMode: checkpoint.isDevMode,
      isComplete: message.status === "complete",
      isLastMessage: thread.messages.at(-1)?.id === message.id,
      isBusy: checkpoint.isBusy,
      runId,
      checkpointRunIds: checkpoint.checkpointRunIds,
      hostname: window.location.hostname,
    });

  const restore = async () => {
    if (!checkpoint || !runId || checkpoint.isBusy || state === "restoring")
      return;
    setState("restoring");
    setError(null);
    try {
      const response = await fetch(`${checkpoint.apiUrl}/checkpoints/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      if (response.ok) {
        window.location.reload();
        return;
      }
      // coercion-ok: the response remains a failure and its status supplies the fallback detail.
      const payload: unknown = await response.json().catch(() => null);
      const detail =
        isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : t("agentChat.message.restoreFailed", { status: response.status });
      setError(detail);
      setState("error");
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : t("agentChat.message.restoreRequestFailed"),
      );
      setState("error");
    }
  };

  if (!offered) return null;
  return (
    <Popover
      open={
        state === "confirming" || state === "restoring" || state === "error"
      }
      onOpenChange={(open) => {
        if (checkpoint?.isBusy || state === "restoring") return;
        setState(open ? "confirming" : "idle");
        if (!open) setError(null);
      }}
    >
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("agentChat.message.revertHere")}
                disabled={checkpoint?.isBusy}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <IconArrowBackUp className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {t("agentChat.message.revertHere")}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-56 rounded-lg border-border p-3 shadow-xl"
      >
        {state === "confirming" ? (
          <div className="grid gap-2">
            <p className="text-xs font-medium text-foreground">
              {t("agentChat.message.restoreQuestion")}
            </p>
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setState("idle")}
                className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {t("agentChat.common.cancel")}
              </button>
              <button
                type="button"
                disabled={checkpoint?.isBusy}
                onClick={() => void restore()}
                className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
              >
                {t("agentChat.message.revertHere")}
              </button>
            </div>
          </div>
        ) : state === "restoring" ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <IconLoader2 className="h-3 w-3 animate-spin" />
            {t("agentChat.message.restoring")}
          </span>
        ) : (
          <div className="grid gap-2">
            <p className="text-xs text-destructive">
              {error ?? t("agentChat.message.restoreRequestFailed")}
            </p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setState("idle");
              }}
              className="justify-self-end rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {t("agentChat.common.dismiss")}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Convert host pre-submit work to PromptComposer's allow/deny callback shape. */
export async function runAgentKitHistoryBeforeStart(
  beforeStart?: () => void | Promise<void>,
): Promise<boolean> {
  await beforeStart?.();
  return true;
}

type EventRunMessage = Extract<
  AgentEvent,
  { type: "message.created" | "message.completed" }
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function messageMetadata(message: AgentMessage): Record<string, unknown> {
  return isRecord(message.metadata) ? message.metadata : {};
}

function messageScope(message: AgentMessage): AgentKitHistoryScope | undefined {
  const metadata = messageMetadata(message);
  const custom = isRecord(metadata.custom) ? metadata.custom : undefined;
  const value = metadata.chatScope ?? metadata.scope ?? custom?.chatScope;
  if (!isRecord(value)) return undefined;
  const type = stringValue(value.type);
  const id = stringValue(value.id);
  return type && id ? { type, id } : undefined;
}

function messageTurnId(message: AgentMessage): string | undefined {
  const metadata = messageMetadata(message);
  const chatContext = isRecord(metadata.chatContext)
    ? metadata.chatContext
    : undefined;
  return stringValue(metadata.turnId ?? chatContext?.turnId);
}

function carriesCompletedSideEffect(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.completedSideEffect === true ||
    (isRecord(value.data) && value.data.completedSideEffect === true)
  );
}

function messageRunId(message: AgentMessage): string | undefined {
  const metadata = messageMetadata(message);
  const custom = isRecord(metadata.custom) ? metadata.custom : undefined;
  return stringValue(metadata.runId ?? custom?.runId);
}

function isMessageRunEvent(event: AgentEvent): event is EventRunMessage {
  return event.type === "message.created" || event.type === "message.completed";
}

interface HistoryThreadLike {
  messages: AgentMessage[];
  events: AgentEvent[];
  runs: Record<string, { status: string; completedAt?: string }>;
  tools: Record<
    string,
    {
      status: string;
      metadata?: Record<string, unknown>;
      runId?: string;
    }
  >;
}

function runMessageIds(events: readonly AgentEvent[]) {
  const ids = new Map<string, string>();
  const createdAt = new Map<string, string>();
  for (const event of events) {
    if (!isMessageRunEvent(event)) continue;
    ids.set(event.message.id, event.runId);
    createdAt.set(event.message.id, event.occurredAt);
  }
  return { ids, createdAt };
}

function completedSideEffectRunIds(thread: HistoryThreadLike): Set<string> {
  const completed = new Set<string>();
  for (const event of thread.events) {
    if (
      isMessageRunEvent(event) &&
      carriesCompletedSideEffect(event.metadata)
    ) {
      completed.add(event.runId);
    }
    if (
      event.type === "tool.updated" &&
      event.toolCall.status === "completed" &&
      (carriesCompletedSideEffect(event.toolCall.metadata) ||
        carriesCompletedSideEffect(event.toolCall) ||
        carriesCompletedSideEffect(event.metadata))
    ) {
      if (event.runId) completed.add(event.runId);
    }
    if (
      event.type === "action.completed" &&
      event.result.status === "completed" &&
      (carriesCompletedSideEffect(event.result.metadata) ||
        carriesCompletedSideEffect(event.result) ||
        carriesCompletedSideEffect(event.metadata))
    ) {
      completed.add(event.runId);
    }
  }
  for (const tool of Object.values(thread.tools)) {
    if (
      tool.status === "completed" &&
      carriesCompletedSideEffect(tool.metadata) &&
      tool.runId
    ) {
      completed.add(tool.runId);
    }
  }
  for (const message of thread.messages) {
    const runId = messageRunId(message);
    if (
      runId &&
      (carriesCompletedSideEffect(messageMetadata(message)) ||
        message.parts.some(carriesCompletedSideEffect))
    ) {
      completed.add(runId);
    }
  }
  return completed;
}

/** Project AgentKit messages onto the legacy host history matching contract. */
export function getAgentKitHistoryMessages(
  threadId: ThreadId,
  thread: HistoryThreadLike,
  fallbackScope?: AgentKitHistoryScope,
): AgentKitHistoryMessage[] {
  const messageEvents = runMessageIds(thread.events);
  const completedSideEffectRuns = completedSideEffectRunIds(thread);
  const completedRuns = new Set(
    Object.entries(thread.runs)
      .filter(([, run]) =>
        ["completed", "cancelled", "failed"].includes(run.status),
      )
      .map(([runId]) => runId),
  );
  for (const event of thread.events) {
    if (
      event.type === "run.completed" ||
      event.type === "run.cancelled" ||
      event.type === "run.failed"
    ) {
      completedRuns.add(event.runId);
    }
  }

  const candidates = thread.messages.flatMap((message) => {
    if (message.role !== "assistant") return [];
    const runId = messageRunId(message) ?? messageEvents.ids.get(message.id);
    if (!runId || !completedRuns.has(runId)) return [];
    return [{ message, runId }];
  });
  const lastMessageByRun = new Map<string, string>();
  for (const { message, runId } of candidates)
    lastMessageByRun.set(runId, message.id);

  return candidates.map(({ message, runId }) => {
    const metadata = messageMetadata(message);
    const run = thread.runs[runId];
    const explicitSideEffect =
      carriesCompletedSideEffect(metadata) ||
      message.parts.some(carriesCompletedSideEffect);
    const createdAt =
      message.createdAt ??
      messageEvents.createdAt.get(message.id) ??
      run?.completedAt ??
      "";
    return {
      id: message.id,
      createdAt,
      threadId,
      scope: messageScope(message) ?? fallbackScope,
      runId,
      turnId: messageTurnId(message),
      hasCompletedSideEffect:
        explicitSideEffect ||
        (lastMessageByRun.get(runId) === message.id &&
          completedSideEffectRuns.has(runId)),
    };
  });
}

export function findAgentKitHistoryVersion<
  TVersion extends AgentKitHistoryVersion,
>(
  versions: readonly TVersion[],
  message: AgentKitHistoryMessage,
  options: Pick<
    AgentKitHistoryConfig<unknown, TVersion>,
    "isEditable" | "matchVersion" | "scope"
  > = {},
): TVersion | null {
  if (!message.hasCompletedSideEffect) return null;
  if (
    options.scope &&
    (!message.scope ||
      message.scope.type !== options.scope.type ||
      message.scope.id !== options.scope.id)
  ) {
    return null;
  }

  let match: TVersion | null = null;
  let matchTime = Number.NEGATIVE_INFINITY;
  for (const version of versions) {
    if (!isAssistantChatHistoryVersion(version)) continue;
    if (version.editable === false || options.isEditable?.(version) === false) {
      continue;
    }
    const context = version.chatContext;
    if (!context || context.phase === "start") continue;
    const matchesTurn = Boolean(
      (message.turnId && context.turnId && message.turnId === context.turnId) ||
      ((!message.turnId || !context.turnId) &&
        message.runId &&
        context.runId === message.runId),
    );
    if (!matchesTurn || options.matchVersion?.(version, message) === false) {
      continue;
    }
    const versionTime = coerceAssistantChatHistoryDate(
      version.createdAt,
    )?.getTime();
    if (versionTime == null || versionTime <= matchTime) continue;
    match = version;
    matchTime = versionTime;
  }
  return match;
}

export function findAgentKitHistoryBeginningVersion<
  TVersion extends AgentKitHistoryVersion,
>(
  versions: readonly TVersion[],
  threadId: ThreadId,
  isEditable?: (version: TVersion) => boolean,
): TVersion | null {
  let beginning: TVersion | null = null;
  let beginningTime = Number.POSITIVE_INFINITY;
  for (const version of versions) {
    const context = version.chatContext;
    if (
      !isAssistantChatHistoryVersion(version) ||
      version.editable === false ||
      isEditable?.(version) === false ||
      !context ||
      context.threadId !== threadId ||
      context.phase !== "start"
    ) {
      continue;
    }
    const versionTime = coerceAssistantChatHistoryDate(
      version.createdAt,
    )?.getTime();
    if (versionTime == null || versionTime >= beginningTime) continue;
    beginning = version;
    beginningTime = versionTime;
  }
  return beginning;
}

export function AgentKitHistoryProvider<
  TListResult,
  TVersion extends AgentKitHistoryVersion,
  TRestoreResult,
>({
  history,
  children,
}: {
  history: AgentKitHistoryConfig<TListResult, TVersion, TRestoreResult>;
  children: ReactNode;
}) {
  const { threadId } = useAgentKit();
  const thread = useAgentThread(threadId);
  const listArgs =
    typeof history.list.args === "function"
      ? history.list.args(threadId)
      : (history.list.args ?? {});
  const listQuery = useActionQuery<TListResult>(
    history.list.action,
    listArgs as never,
    { enabled: true },
  );
  const restoreMutation = useActionMutation<
    TRestoreResult,
    Record<string, unknown>
  >(history.restore.action);
  const createMutation = useActionMutation<unknown, Record<string, unknown>>(
    history.createVersion?.action ?? "create-resource-version",
    { skipActionQueryInvalidation: true },
  );
  const [isRestoring, setIsRestoring] = useState(false);
  const restoreInFlightRef = useRef(false);
  const restoreWaitersRef = useRef(new Set<() => void>());
  const submissionsInFlightRef = useRef(0);
  const [submissionsInFlight, setSubmissionsInFlight] = useState(0);
  const [submissionCountsByThread, setSubmissionCountsByThread] = useState(
    () => new Map<string, number>(),
  );
  const observedRunsRef = useRef(new Set<string>());
  const processedRunsRef = useRef(new Set<string>());
  const seenEventIdsRef = useRef(new Set<string>());
  const currentThreadRef = useRef(threadId);
  const initializedRef = useRef(false);

  const loadedVersions = useMemo(() => {
    if (listQuery.data == null) return null;
    const result = history.list.getVersions(listQuery.data);
    if (!Array.isArray(result)) return null;
    return result.filter((version): version is TVersion =>
      isAssistantChatHistoryVersion(version),
    );
  }, [history.list, listQuery.data]);
  const versions = loadedVersions ?? [];
  const retryHistory = useCallback(() => {
    void listQuery.refetch();
  }, [listQuery.refetch]);
  const historyMessages = useMemo(
    () => getAgentKitHistoryMessages(threadId, thread, history.scope),
    [history.scope, thread, threadId],
  );
  const waitForRestore = useCallback(async () => {
    while (restoreInFlightRef.current) {
      await new Promise<void>((resolve) => {
        restoreWaitersRef.current.add(resolve);
        if (!restoreInFlightRef.current) {
          restoreWaitersRef.current.delete(resolve);
          resolve();
        }
      });
    }
  }, []);
  const beforeStart = useCallback(async () => {
    await waitForRestore();
    return runAgentKitHistoryBeforeStart(history.beforeStart);
  }, [history.beforeStart, waitForRestore]);
  const beginSubmission = useCallback(async () => {
    const submissionThreadId = threadId;
    await waitForRestore();
    if (restoreInFlightRef.current) return null;
    submissionsInFlightRef.current += 1;
    setSubmissionsInFlight(submissionsInFlightRef.current);
    setSubmissionCountsByThread((counts) =>
      updateAgentKitSubmissionCounts(counts, submissionThreadId, 1),
    );
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      submissionsInFlightRef.current = Math.max(
        0,
        submissionsInFlightRef.current - 1,
      );
      setSubmissionsInFlight(submissionsInFlightRef.current);
      setSubmissionCountsByThread((counts) =>
        updateAgentKitSubmissionCounts(counts, submissionThreadId, -1),
      );
    };
    try {
      await history.beforeStart?.();
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }, [history.beforeStart, threadId, waitForRestore]);

  const restoreVersion = useCallback(
    async (version: AssistantChatHistoryVersion) => {
      if (restoreInFlightRef.current) {
        throw new Error("A chat history restore is already in progress.");
      }
      if (thread.activeRunIds.length > 0) {
        throw new Error("A chat run is already in progress.");
      }
      if (submissionsInFlightRef.current > 0) {
        throw new Error("A chat submission is already in progress.");
      }
      restoreInFlightRef.current = true;
      setIsRestoring(true);
      try {
        await history.restore.beforeRestore?.();
        const args = await history.restore.args(version as TVersion);
        const result = await restoreMutation.mutateAsync(args);
        let applicationError: unknown;
        let applicationFailed = false;
        try {
          await history.restore.onRestored?.(result, version as TVersion);
        } catch (error) {
          applicationFailed = true;
          applicationError = error;
        }
        try {
          await listQuery.refetch();
        } catch (error) {
          captureError(error, {
            tags: {
              source: "agentkit-chat-client",
              phase: "chat-history-refetch-after-restore",
            },
          });
        }
        if (applicationFailed) throw applicationError;
      } finally {
        restoreInFlightRef.current = false;
        setIsRestoring(false);
        for (const resolve of restoreWaitersRef.current) resolve();
        restoreWaitersRef.current.clear();
      }
    },
    [
      history.restore,
      listQuery.refetch,
      restoreMutation,
      thread.activeRunIds.length,
    ],
  );

  const createVersionForCompletedRun = useCallback(
    async (runId: string) => {
      const message = [...historyMessages]
        .reverse()
        .find((candidate) => candidate.runId === runId);
      if (history.createVersion && message?.hasCompletedSideEffect) {
        const args =
          typeof history.createVersion.args === "function"
            ? history.createVersion.args(message)
            : history.createVersion.args;
        try {
          await createMutation.mutateAsync(args);
        } catch (error) {
          captureError(error, {
            tags: {
              source: "agentkit-chat-client",
              phase: "chat-history-create-version",
            },
          });
        }
      }
      try {
        await listQuery.refetch();
      } catch (error) {
        captureError(error, {
          tags: {
            source: "agentkit-chat-client",
            phase: "chat-history-refetch-after-run",
          },
        });
      }
    },
    [createMutation, history.createVersion, historyMessages, listQuery.refetch],
  );

  useEffect(() => {
    if (currentThreadRef.current !== threadId) {
      currentThreadRef.current = threadId;
      observedRunsRef.current = new Set(thread.activeRunIds);
      processedRunsRef.current = new Set();
      seenEventIdsRef.current = new Set(thread.events.map((event) => event.id));
      initializedRef.current = true;
      return;
    }
    if (!initializedRef.current) {
      initializedRef.current = true;
      observedRunsRef.current = new Set(thread.activeRunIds);
      seenEventIdsRef.current = new Set(thread.events.map((event) => event.id));
      return;
    }

    for (const runId of thread.activeRunIds) observedRunsRef.current.add(runId);
    for (const event of thread.events) {
      if (seenEventIdsRef.current.has(event.id)) continue;
      seenEventIdsRef.current.add(event.id);
      if (event.type === "run.started") {
        observedRunsRef.current.add(event.runId);
      } else if (
        (event.type === "run.completed" ||
          event.type === "run.cancelled" ||
          event.type === "run.failed") &&
        observedRunsRef.current.has(event.runId) &&
        !processedRunsRef.current.has(event.runId)
      ) {
        processedRunsRef.current.add(event.runId);
        observedRunsRef.current.delete(event.runId);
        void createVersionForCompletedRun(event.runId);
      }
    }
  }, [
    createVersionForCompletedRun,
    thread.activeRunIds,
    thread.events,
    threadId,
  ]);

  const toHistoryMessage = useCallback(
    (message: AgentMessage) =>
      historyMessages.find((candidate) => candidate.id === message.id) ?? null,
    [historyMessages],
  );
  const findVersion = useCallback(
    (message: AgentKitHistoryMessage) =>
      findAgentKitHistoryVersion(versions, message, {
        isEditable: history.isEditable,
        scope: history.scope,
        matchVersion: history.matchVersion,
      }),
    [history.isEditable, history.matchVersion, history.scope, versions],
  );
  const value = useMemo<AgentKitHistoryContextValue>(
    () => ({
      beginningVersion: findAgentKitHistoryBeginningVersion(
        versions,
        threadId,
        history.isEditable,
      ),
      historyLoadFailed:
        listQuery.isError || (listQuery.isSuccess && loadedVersions == null),
      isRetryingHistory: listQuery.isFetching,
      isBusy:
        thread.activeRunIds.length > 0 ||
        isRestoring ||
        submissionsInFlight > 0,
      isRestoring,
      isSubmissionInFlight: (submissionCountsByThread.get(threadId) ?? 0) > 0,
      beforeStart,
      beginSubmission,
      waitForRestore,
      findVersion,
      toHistoryMessage,
      restoreVersion,
      retryHistory,
    }),
    [
      findVersion,
      beforeStart,
      beginSubmission,
      waitForRestore,
      history.isEditable,
      listQuery.isError,
      listQuery.isFetching,
      listQuery.isSuccess,
      loadedVersions,
      isRestoring,
      restoreVersion,
      retryHistory,
      submissionsInFlight,
      submissionCountsByThread,
      thread.activeRunIds.length,
      threadId,
      toHistoryMessage,
      versions,
    ],
  );

  return (
    <AgentKitHistoryContext.Provider value={value}>
      {children}
    </AgentKitHistoryContext.Provider>
  );
}

export function useAgentKitHistory(): AgentKitHistoryContextValue {
  const history = useContext(AgentKitHistoryContext);
  if (!history) {
    throw new Error(
      "useAgentKitHistory must be used inside AgentKitHistoryProvider.",
    );
  }
  return history;
}

export function useOptionalAgentKitHistory(): AgentKitHistoryContextValue | null {
  return useContext(AgentKitHistoryContext);
}

function AgentKitHistoryRevertButton({
  version,
  label,
}: {
  version: AssistantChatHistoryVersion;
  label: string;
}) {
  const t = useT();
  const history = useContext(AgentKitHistoryContext);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"confirming" | "restoring" | "error">(
    "confirming",
  );
  const [error, setError] = useState<string | null>(null);
  const isRestoring = Boolean(history?.isRestoring);
  const isBusy = Boolean(history?.isBusy);

  useEffect(() => {
    if (isBusy && state !== "restoring") setOpen(false);
  }, [isBusy, state]);

  const restore = useCallback(async () => {
    if (!history || isBusy) return;
    setState("restoring");
    setError(null);
    try {
      await history.restoreVersion(version);
      setOpen(false);
    } catch (restoreError) {
      const status = (restoreError as { status?: unknown } | undefined)?.status;
      setError(
        actionErrorMessage(restoreError) ??
          (typeof status === "number" || typeof status === "string"
            ? t("agentChat.message.restoreFailed", { status })
            : t("agentChat.message.restoreRequestFailed")),
      );
      setState("error");
    }
  }, [history, isBusy, t, version]);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen && isBusy) return;
        setOpen(nextOpen);
        if (nextOpen) {
          setState("confirming");
          setError(null);
        } else if (state !== "restoring") {
          setError(null);
        }
      }}
    >
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={label}
                disabled={isBusy}
                className={cn(
                  "flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                  open && "bg-accent text-foreground",
                )}
              >
                <IconArrowBackUp className="h-4 w-4" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-56 rounded-lg border-border p-3 shadow-xl"
      >
        {state === "confirming" ? (
          <div className="grid gap-2">
            <p className="text-xs font-medium text-foreground">
              {t("agentChat.message.revertQuestion")}
            </p>
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {t("agentChat.common.cancel")}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void restore()}
                className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {label}
              </button>
            </div>
          </div>
        ) : state === "restoring" || isRestoring ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <IconLoader2 className="h-3 w-3 animate-spin" />
            {t("agentChat.message.restoring")}
          </span>
        ) : (
          <div className="grid gap-2">
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error ?? t("agentChat.message.restoreRequestFailed")}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="justify-self-end rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {t("agentChat.common.dismiss")}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Install as AgentKit `slots.messageActionsTrailing`. */
export function AgentKitHistoryMessageSupplement({
  value,
}: AgentKitRenderProps<AgentMessage>) {
  const history = useContext(AgentKitHistoryContext);
  const t = useT();
  const message = history?.toHistoryMessage(value);
  if (!history || !message || !message.hasCompletedSideEffect) return null;
  const version = history.findVersion(message);
  if (!version) return null;
  return (
    <AgentKitHistoryRevertButton
      version={version}
      label={t("agentChat.message.revertHere")}
    />
  );
}

/** Render beside host toolbar children to expose the initial saved state. */
export function AgentKitHistoryBeginningRevert() {
  const history = useContext(AgentKitHistoryContext);
  const t = useT();
  const version = history?.beginningVersion;
  if (!history || !version) return null;
  return (
    <div className="flex justify-end">
      <AgentKitHistoryRevertButton
        version={version}
        label={t("agentChat.message.revertToBeginning")}
      />
    </div>
  );
}
