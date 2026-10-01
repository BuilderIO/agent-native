import type {
  AgentActionInvocation,
  AgentActionResult,
  AgentAnnotationSnapshot,
  AgentApprovalResponse,
  AgentConnectionResponse,
  AgentCapabilityDescriptor,
  AgentStreamIntegrityReport,
  AgentCapabilityId,
  AgentCapabilities,
  AgentError,
  AgentEvent,
  AgentMessage,
  AgentQueuedMessage,
  AgentRequestContext,
  AgentRunSnapshot,
  AgentRunOptions,
  AgentThread,
  AgentThreadSnapshot,
  AgentTransport,
  AgentUploadDescriptor,
  AgentUploadTarget,
  CreateThreadInput,
  FilePart,
  ForkThreadInput,
  ListThreadsInput,
  ListThreadsResult,
  RunId,
  SubmitFeedbackInput,
  ThreadId,
  UpdateThreadInput,
  UploadId,
} from "../protocol/index.js";
import {
  AgentProtocolValidationError,
  AgentKitProtocolError,
  createRequestAbortedError,
  createAgentKitProtocolVersionOffer,
  parseAgentEvent,
  projectAgentCapabilities,
  resumeEntryFromApproval,
} from "../protocol/index.js";
import {
  classifyAgentEvent,
  createAgentThreadState,
  hasActiveAgentRuns,
  selectLatestAgentRun,
  reduceAgentEvent,
  settleRunProjection,
  type AgentKitSnapshot,
  type AgentRunState,
  type AgentThreadState,
} from "./state.js";

type TerminalRunState = AgentRunState & {
  status: Extract<
    AgentRunState["status"],
    "completed" | "failed" | "cancelled"
  >;
};

export interface AgentKitClientOptions {
  transport: AgentTransport;
  /**
   * Borrowed transports are never disposed by the client and are the safe
   * default for shared application services. Choose `owned` only when this
   * client created the transport exclusively for its own lifecycle.
   */
  transportOwnership?: "borrowed" | "owned";
  /**
   * Keep accepted run subscriptions alive when their last visible thread lease
   * releases. Chat shells use this so navigation changes presentation without
   * cancelling agent work; disposal still stops every retained consumer.
   */
  retainActiveRunsOnThreadRelease?: boolean;
  createId?: (prefix: string) => string;
  now?: () => string;
  reconnect?: {
    attempts?: number;
    delayMs?: (attempt: number) => number;
  };
  onError?: (error: AgentError) => void;
  /**
   * Called for stream integrity problems the client detects but cannot fix.
   * Hosts route these to their own counters; failures here are swallowed so
   * observability can never break the run it observes.
   */
  onIntegrityReport?: (report: AgentStreamIntegrityReport) => void;
  upload?: AgentKitUploadDriver;
}

export interface AgentKitUploadFile {
  name: string;
  mediaType: string;
  size: number;
  body: Blob;
}

export type AgentKitUploadDriver = (
  target: AgentUploadTarget,
  file: AgentKitUploadFile,
  context?: AgentRequestContext,
) => Promise<void>;

/**
 * Creates the deterministic AgentKit controller used by every UI binding.
 * Prefer this factory at application boundaries; the class remains public for
 * dependency injection, extension, and test harnesses.
 */
export function createAgentKitClient(
  options: AgentKitClientOptions,
): AgentKitClient {
  return new AgentKitClient(options);
}

export interface SendMessageInput {
  threadId: ThreadId;
  text: string;
  attachments?: FilePart[];
  options?: AgentRunOptions;
  metadata?: Record<string, unknown>;
  /** Host snapshot for queued submits that follow a run through async preparation. */
  queuedWhileRunActive?: boolean;
  /** Host intent for a send that must interrupt the active run if it hits a server-side slot conflict. */
  interruptActiveRun?: boolean;
  /** Host-only acknowledgement after the recoverable message enters local state; never sent to the transport. */
  onLocalSubmit?: () => void;
}

export interface AgentRunHandle {
  runId: RunId;
  completed: Promise<void>;
  cancel(): Promise<void>;
}

function isTerminalRunEvent(event: AgentEvent): boolean {
  return (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.cancelled" ||
    (event.type === "run.status" &&
      (event.status === "completed" ||
        event.status === "failed" ||
        event.status === "cancelled"))
  );
}

function metadataRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sameQueuedMessageIds(
  first: AgentQueuedMessage[],
  second: AgentQueuedMessage[],
): boolean {
  return (
    first.length === second.length &&
    first.every((message, index) => message.id === second[index]?.id)
  );
}

interface QueuedMessageOverride {
  messages: AgentQueuedMessage[];
  removedIds: Set<string>;
}

function mergeQueuedMessageOverride(
  override: QueuedMessageOverride,
  durable: AgentQueuedMessage[],
): AgentQueuedMessage[] {
  const expectedIds = new Set(override.messages.map((message) => message.id));
  const durableVisible = durable.filter(
    (message) => !override.removedIds.has(message.id),
  );
  const merged = [...override.messages];
  for (let index = 0; index < durableVisible.length; index += 1) {
    const message = durableVisible[index];
    if (expectedIds.has(message.id)) continue;
    let nextExpectedIndex = -1;
    for (
      let nextIndex = index + 1;
      nextIndex < durableVisible.length;
      nextIndex += 1
    ) {
      const candidateIndex = merged.findIndex(
        (current) => current.id === durableVisible[nextIndex]?.id,
      );
      if (candidateIndex >= 0) {
        nextExpectedIndex = candidateIndex;
        break;
      }
    }
    if (nextExpectedIndex >= 0) {
      merged.splice(nextExpectedIndex, 0, message);
      continue;
    }
    let previousExpectedIndex = -1;
    for (
      let previousIndex = index - 1;
      previousIndex >= 0;
      previousIndex -= 1
    ) {
      const candidateIndex = merged.findIndex(
        (current) => current.id === durableVisible[previousIndex]?.id,
      );
      if (candidateIndex >= 0) {
        previousExpectedIndex = candidateIndex;
        break;
      }
    }
    if (previousExpectedIndex >= 0) {
      merged.splice(previousExpectedIndex + 1, 0, message);
    } else {
      merged.push(message);
    }
  }
  return merged;
}

function mergeRuntimeRecordMap<T>(
  loaded: Record<string, T>,
  baseline: Record<string, T>,
  current: Record<string, T>,
): Record<string, T> {
  if (current === baseline) return loaded;
  const merged = { ...loaded };
  for (const id of Object.keys(baseline)) {
    if (!Object.prototype.hasOwnProperty.call(current, id)) delete merged[id];
  }
  for (const [id, record] of Object.entries(current)) {
    if (
      !Object.prototype.hasOwnProperty.call(baseline, id) ||
      baseline[id] !== record
    ) {
      merged[id] = record;
    }
  }
  return merged;
}

export interface AgentThreadLease {
  readonly threadId: ThreadId;
  /** False when the durable read completed but the requested thread was absent. */
  readonly threadFound?: boolean;
  getSnapshot(): AgentThreadState;
  release(): void;
  /** Alias for hosts whose lifecycle primitive uses disposable resources. */
  dispose(): void;
}

export interface AgentKitController {
  getSnapshot(): AgentKitSnapshot;
  subscribe(listener: AgentKitListener): () => void;
  getThread(threadId: ThreadId): AgentThreadState;
  openThread(
    threadId: ThreadId,
    context?: AgentRequestContext,
  ): Promise<AgentThreadLease>;
  loadThread(
    threadId: ThreadId,
    context?: AgentRequestContext,
  ): Promise<AgentThreadState>;
  getCapabilities(context?: AgentRequestContext): Promise<AgentCapabilities>;
  createThread(
    input?: CreateThreadInput,
    context?: AgentRequestContext,
  ): Promise<AgentThread>;
  listThreads(
    input?: ListThreadsInput,
    context?: AgentRequestContext,
  ): Promise<ListThreadsResult>;
  sendMessage(
    input: SendMessageInput,
    context?: AgentRequestContext,
  ): Promise<AgentRunHandle>;
  /** Reattaches to an existing run stream; it never retries agent work. */
  resubscribeRun(threadId: ThreadId, runId: RunId): Promise<void>;
  cancelRun(
    threadId: ThreadId,
    runId: RunId,
    context?: AgentRequestContext,
  ): Promise<void>;
  resolveApproval(
    input: {
      threadId: ThreadId;
      runId: RunId;
      approvalId: string;
      optionId?: string;
      response: AgentApprovalResponse;
    },
    context?: AgentRequestContext,
  ): Promise<void>;
  resolveConnectionRequest(
    input: {
      threadId: ThreadId;
      runId: RunId;
      requestId: string;
      response: AgentConnectionResponse;
    },
    context?: AgentRequestContext,
  ): Promise<void>;
  invokeAction(
    invocation: AgentActionInvocation,
    context?: AgentRequestContext,
  ): Promise<AgentActionResult>;
  uploadFiles(
    threadId: ThreadId,
    files: AgentKitUploadFile[],
    context?: AgentRequestContext,
  ): Promise<FilePart[]>;
  createUpload(
    threadId: ThreadId,
    descriptor: AgentUploadDescriptor,
    context?: AgentRequestContext,
  ): Promise<AgentUploadTarget>;
  completeUpload(
    threadId: ThreadId,
    uploadId: UploadId,
    context?: AgentRequestContext,
  ): Promise<FilePart>;
  cancelUpload(
    threadId: ThreadId,
    uploadId: UploadId,
    context?: AgentRequestContext,
  ): Promise<void>;
  queueMessage(
    input: SendMessageInput,
    context?: AgentRequestContext,
  ): Promise<AgentQueuedMessage>;
  steerQueuedMessage(
    threadId: ThreadId,
    messageId: string,
    context?: AgentRequestContext,
    options?: { interruptActiveRun?: boolean },
  ): Promise<AgentRunHandle | void>;
  removeQueuedMessage(
    threadId: ThreadId,
    messageId: string,
    context?: AgentRequestContext,
  ): Promise<void>;
  moveQueuedMessageToTop?(
    threadId: ThreadId,
    messageId: string,
    context?: AgentRequestContext,
  ): Promise<void>;
  supportsQueuedMessageReordering?(): boolean;
  submitFeedback(
    threadId: ThreadId,
    messageId: string,
    value: "positive" | "negative" | "dismissed",
    options?: Pick<
      SubmitFeedbackInput,
      "metadata" | "messageSeq" | "reason" | "runId"
    >,
    context?: AgentRequestContext,
  ): Promise<void>;
  forkThread(
    threadId: ThreadId,
    fromMessageId?: string,
    options?: Omit<ForkThreadInput, "threadId" | "fromMessageId">,
    context?: AgentRequestContext,
  ): Promise<AgentThread>;
  updateThread(
    threadId: ThreadId,
    patch: Omit<UpdateThreadInput, "threadId">,
    context?: AgentRequestContext,
  ): Promise<AgentThread>;
  deleteThread(
    threadId: ThreadId,
    context?: AgentRequestContext,
  ): Promise<void>;
  /**
   * Stops client work and awaits cleanup of an owned transport. Borrowed
   * transports remain untouched.
   */
  shutdown(): Promise<void>;
  /** Alias for hosts whose lifecycle primitive uses disposable resources. */
  dispose(): Promise<void>;
}

export type AgentKitListener = () => void;

function defaultCreateId(prefix: string): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorProperty(error: unknown, property: string): unknown {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)[property]
    : undefined;
}

function errorIsRetryable(error: unknown, fallback = true): boolean {
  const explicit = errorProperty(error, "retryable");
  if (typeof explicit === "boolean") return explicit;
  if (
    error instanceof AgentKitCapabilityError ||
    error instanceof AgentKitOperationError ||
    error instanceof AgentKitDisposedError ||
    error instanceof AgentProtocolValidationError ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return false;
  }
  const status = errorProperty(error, "status");
  if (typeof status === "number") {
    return (
      status === 408 ||
      status === 425 ||
      status === 429 ||
      (status >= 500 && status !== 501 && status !== 505)
    );
  }
  return fallback;
}

function isAbortFailure(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function toError(error: unknown, code = "agentkit_client_error"): AgentError {
  const errorCode = errorProperty(error, "code");
  const correlationId = errorProperty(error, "correlationId");
  const details = errorProperty(error, "details");
  return {
    code: typeof errorCode === "string" ? errorCode : code,
    message: error instanceof Error ? error.message : String(error),
    retryable: errorIsRetryable(error),
    ...(typeof correlationId === "string" ? { correlationId } : {}),
    ...(details === undefined ? {} : { details }),
  };
}

export class AgentKitCapabilityError extends Error {
  public readonly code: "capability_unsupported" | "capability_unavailable";
  public readonly retryable: boolean;

  public constructor(
    public readonly capability: AgentCapabilityId,
    public readonly state: "unsupported" | "unavailable" = "unsupported",
    message?: string,
    retryable = state === "unavailable",
    public readonly correlationId?: string,
    public readonly details?: unknown,
  ) {
    super(
      message ??
        `This AgentKit controller does not support the ${capability} capability.`,
    );
    this.name = "AgentKitCapabilityError";
    this.code =
      state === "unavailable"
        ? "capability_unavailable"
        : "capability_unsupported";
    this.retryable = retryable;
  }
}

export class AgentKitRunSlotBusyError extends Error {
  public readonly code = "run_slot_busy" as const;
  public readonly retryable = true;

  public constructor(public readonly activeRunId?: RunId) {
    super("The current agent run still owns this thread.");
    this.name = "AgentKitRunSlotBusyError";
  }
}

function isAgentKitRunSlotBusyError(
  error: unknown,
): error is AgentKitRunSlotBusyError {
  return (
    error instanceof AgentKitRunSlotBusyError ||
    (!!error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "run_slot_busy")
  );
}

export class AgentKitOperationError extends Error {
  public readonly code = "operation_unsupported" as const;
  public readonly retryable = false;

  public constructor(public readonly operation: string) {
    super(`This AgentKit controller does not support ${operation}.`);
    this.name = "AgentKitOperationError";
  }
}

export class AgentKitDisposedError extends Error {
  public readonly code = "client_disposed" as const;
  public readonly retryable = false;

  public constructor() {
    super("This AgentKit client has been disposed.");
    this.name = "AgentKitDisposedError";
  }
}

export class AgentKitHandshakeError extends Error {
  public readonly retryable = false;

  public constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "AgentKitHandshakeError";
  }
}

class AgentKitConsumerStoppedError extends Error {
  public constructor(
    public readonly reason: "cancelled" | "released" | "deleted" | "disposed",
  ) {
    super(`AgentKit run subscription stopped: ${reason}.`);
    this.name = "AgentKitConsumerStoppedError";
  }
}

async function defaultUploadDriver(
  target: AgentUploadTarget,
  file: AgentKitUploadFile,
  context?: AgentRequestContext,
): Promise<void> {
  const body = target.fields
    ? (() => {
        const data = new FormData();
        for (const [key, value] of Object.entries(target.fields)) {
          data.set(key, value);
        }
        data.set("file", file.body, file.name);
        return data;
      })()
    : file.body;
  const response = await fetch(target.url, {
    method: target.method,
    headers: target.headers,
    body,
    signal: context?.signal,
  });
  if (!response.ok) {
    throw new Error(`Upload failed with ${response.status}.`);
  }
}

export class AgentKitClient implements AgentKitController {
  readonly transport: AgentTransport;

  private readonly createId: (prefix: string) => string;
  private readonly now: () => string;
  private readonly reconnectAttempts: number;
  private readonly reconnectDelay: (attempt: number) => number;
  private readonly onError?: (error: AgentError) => void;
  private readonly onIntegrityReport?: (
    report: AgentStreamIntegrityReport,
  ) => void;
  private readonly upload: AgentKitUploadDriver;
  private readonly ownsTransport: boolean;
  private readonly retainActiveRunsOnThreadRelease: boolean;
  private readonly listeners = new Set<AgentKitListener>();
  private readonly consumers = new Map<string, Promise<void>>();
  private readonly submittedUserMessages = new Map<string, string>();
  private readonly consumerAbortControllers = new Map<
    string,
    AbortController
  >();
  private readonly threadLoads = new Map<ThreadId, Promise<AgentThreadState>>();
  private readonly missingThreadStates = new WeakSet<AgentThreadState>();
  private readonly threadLeaseCounts = new Map<ThreadId, number>();
  private readonly queuedMessageOverrides = new Map<
    ThreadId,
    QueuedMessageOverride
  >();
  private readonly queueMutationChains = new Map<ThreadId, Promise<void>>();
  private readonly queueSteerings = new Map<
    string,
    Promise<AgentRunHandle | void>
  >();
  private readonly queuePromotions = new Set<ThreadId>();
  private readonly queuePromotionTerminalExpedites = new Set<ThreadId>();
  private readonly queuePromotionAfterReconciliation = new Set<ThreadId>();
  private readonly queuePromotionTimers = new Map<
    ThreadId,
    ReturnType<typeof setTimeout>
  >();
  private readonly queuePromotionRetryAttempts = new Map<ThreadId, number>();
  private readonly requestAbortController = new AbortController();
  private capabilitiesLoad?: Promise<AgentCapabilities>;
  private shutdownPromise?: Promise<void>;
  private disposed = false;
  private snapshot: AgentKitSnapshot;

  public constructor(options: AgentKitClientOptions) {
    this.transport = options.transport;
    this.ownsTransport = options.transportOwnership === "owned";
    this.retainActiveRunsOnThreadRelease =
      options.retainActiveRunsOnThreadRelease ?? false;
    this.createId = options.createId ?? defaultCreateId;
    this.now = options.now ?? (() => new Date().toISOString());
    this.reconnectAttempts = options.reconnect?.attempts ?? 3;
    this.reconnectDelay =
      options.reconnect?.delayMs ??
      ((attempt) => Math.min(250 * 2 ** attempt, 4_000));
    this.onError = options.onError;
    this.onIntegrityReport = options.onIntegrityReport;
    this.upload = options.upload ?? defaultUploadDriver;
    this.snapshot = {
      connection: "idle",
      capabilities: options.transport.capabilities ?? {},
      capabilitiesStatus: options.transport.discoverCapabilities
        ? "unknown"
        : "ready",
      threads: {},
      revision: 0,
    };
  }

  private createRequestContext(
    context?: AgentRequestContext,
  ): AgentRequestContext {
    const lifetimeSignal = this.requestAbortController.signal;
    const signal = context?.signal
      ? context.signal === lifetimeSignal
        ? lifetimeSignal
        : AbortSignal.any([lifetimeSignal, context.signal])
      : lifetimeSignal;
    const requestContext: AgentRequestContext = {
      signal,
      correlationId: context?.correlationId ?? defaultCreateId("request"),
    };
    this.assertRequestActive(requestContext);
    return requestContext;
  }

  private assertRequestActive(context: AgentRequestContext): void {
    if (context.signal?.aborted) {
      throw new AgentKitProtocolError(
        createRequestAbortedError({ correlationId: context.correlationId }),
      );
    }
  }

  private invokeRequest<T>(
    context: AgentRequestContext,
    operation: (requestContext: AgentRequestContext) => Promise<T>,
  ): Promise<T> {
    this.assertRequestActive(context);
    const signal = context.signal;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        callback();
      };
      const abortError = () =>
        new AgentKitProtocolError(
          createRequestAbortedError({ correlationId: context.correlationId }),
        );
      const onAbort = () => finish(() => reject(abortError()));
      signal?.addEventListener("abort", onAbort, { once: true });
      void Promise.resolve()
        .then(() => operation(context))
        .then(
          (value) => {
            if (signal?.aborted) onAbort();
            else finish(() => resolve(value));
          },
          (error: unknown) => {
            if (signal?.aborted || isAbortFailure(error)) {
              finish(() => reject(abortError()));
            } else {
              finish(() => reject(error));
            }
          },
        );
    });
  }

  public getSnapshot = (): AgentKitSnapshot => this.snapshot;

  public subscribe = (listener: AgentKitListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getThread(threadId: ThreadId): AgentThreadState {
    return this.snapshot.threads[threadId] ?? createAgentThreadState(threadId);
  }

  public async openThread(
    threadId: ThreadId,
    context?: AgentRequestContext,
  ): Promise<AgentThreadLease> {
    this.assertActive();
    this.threadLeaseCounts.set(
      threadId,
      (this.threadLeaseCounts.get(threadId) ?? 0) + 1,
    );
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.releaseThreadLease(threadId);
    };
    try {
      const state = await this.loadThread(threadId, context);
      this.assertActive();
      return {
        threadId,
        threadFound: !this.missingThreadStates.has(state),
        getSnapshot: () => this.getThread(threadId),
        release,
        dispose: release,
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  public async loadThread(
    threadId: ThreadId,
    context?: AgentRequestContext,
  ): Promise<AgentThreadState> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    const existing = this.threadLoads.get(threadId);
    if (existing) {
      return this.invokeRequest(requestContext, () => existing);
    }
    // Durable projections can lag an accepted stream. Preserve the local
    // cursor and event boundaries so refresh cannot reorder the transcript or
    // turn the next streamed event into an artificial sequence gap.
    const load = this.loadThreadProjection(threadId, requestContext, true);
    this.threadLoads.set(threadId, load);
    try {
      return await load;
    } finally {
      if (this.threadLoads.get(threadId) === load) {
        this.threadLoads.delete(threadId);
      }
    }
  }

  private enqueueQueueMutation<T>(
    threadId: ThreadId,
    mutation: () => Promise<T>,
  ): Promise<T> {
    const previous =
      this.queueMutationChains.get(threadId) ?? Promise.resolve();
    const next = previous.then(mutation);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.queueMutationChains.set(threadId, settled);
    return next.finally(() => {
      if (this.queueMutationChains.get(threadId) === settled) {
        this.queueMutationChains.delete(threadId);
      }
    });
  }

  private async loadThreadProjection(
    threadId: ThreadId,
    requestContext: AgentRequestContext,
    preserveRuntimeProjection = false,
  ): Promise<AgentThreadState> {
    const baseline =
      this.snapshot.threads[threadId] ?? createAgentThreadState(threadId);
    if (!this.snapshot.threads[threadId]) this.setThread(threadId, baseline);
    this.setConnection("connecting");
    try {
      await this.ensureCapabilities(requestContext);
      this.assertActive();
      if (!this.transport.getThreadSnapshot && !this.transport.getThread) {
        throw new AgentKitOperationError("thread reads");
      }
      const getThreadSnapshot = this.transport.getThreadSnapshot;
      const snapshot = getThreadSnapshot
        ? await this.invokeRequest(requestContext, (context) =>
            getThreadSnapshot({ threadId }, context),
          )
        : undefined;
      this.assertActive();
      const runSnapshots = new Map(
        (snapshot?.runs ?? []).map((run) => [run.id, run] as const),
      );
      const durableQueuedMessages = snapshot?.queuedMessages;
      const queuedOverride = this.queuedMessageOverrides.get(threadId);
      const queuedOverrideMessages = queuedOverride
        ? durableQueuedMessages
          ? mergeQueuedMessageOverride(queuedOverride, durableQueuedMessages)
          : queuedOverride.messages
        : undefined;
      if (
        queuedOverride &&
        durableQueuedMessages &&
        queuedOverrideMessages &&
        sameQueuedMessageIds(queuedOverrideMessages, durableQueuedMessages) &&
        queuedOverride.removedIds.size === 0
      ) {
        this.queuedMessageOverrides.delete(threadId);
      }
      const snapshotActiveRunIds = snapshot?.activeRunIds ?? [];
      const getRun = this.transport.getRun;
      const runIdsToRefresh = getRun
        ? snapshotActiveRunIds.filter(
            (runId) =>
              !this.isTerminalStatus(
                runSnapshots.get(runId)?.status ?? "running",
              ),
          )
        : snapshotActiveRunIds.filter((runId) => !runSnapshots.has(runId));
      const activeRuns = runIdsToRefresh.length
        ? await Promise.all(
            runIdsToRefresh.map(async (runId) =>
              getRun
                ? await this.invokeRequest(requestContext, (context) =>
                    getRun({ threadId, runId }, context),
                  )
                : undefined,
            ),
          )
        : [];
      this.assertActive();
      const refreshedRuns = new Map<RunId, AgentRunSnapshot>();
      runIdsToRefresh.forEach((runId, index) => {
        const run = activeRuns[index];
        const appliedSequence = Math.max(
          this.getThread(threadId).runs[runId]?.lastSequence ?? 0,
          runSnapshots.get(runId)?.lastSequence ?? 0,
          snapshot?.events?.reduce(
            (sequence, event) =>
              event.runId === runId
                ? Math.max(sequence, event.sequence)
                : sequence,
            0,
          ) ?? 0,
        );
        if (
          run &&
          !this.isTerminalStatus(run.status) &&
          run.lastSequence >= appliedSequence
        ) {
          const refreshedRun = { ...run, lastSequence: appliedSequence };
          runSnapshots.set(runId, refreshedRun);
          refreshedRuns.set(runId, refreshedRun);
        } else if (
          run &&
          this.isTerminalStatus(run.status) &&
          run.lastSequence <= appliedSequence
        ) {
          runSnapshots.set(runId, { ...run, lastSequence: appliedSequence });
        } else if (!runSnapshots.has(runId)) {
          runSnapshots.set(runId, this.runSnapshot(threadId, runId));
        }
      });
      const hydratedRuns = Object.fromEntries(
        [...runSnapshots.entries()].map(([runId, run]) => [
          runId,
          this.runState(runId, run),
        ]),
      );
      const activeRunIds = Array.from(
        new Set([
          ...(snapshot?.activeRunIds ?? []),
          ...Object.values(hydratedRuns)
            .filter((run) => !this.isTerminalStatus(run.status))
            .map((run) => run.id),
        ]),
      ).filter(
        (runId) =>
          !this.isTerminalStatus(hydratedRuns[runId]?.status ?? "running"),
      );
      let thread: AgentThreadState;
      let threadMissing = false;
      if (snapshot) {
        thread = this.hydrateThread(snapshot, hydratedRuns, activeRunIds);
      } else if (getThreadSnapshot) {
        threadMissing = true;
        thread = createAgentThreadState(threadId);
      } else {
        const listQueuedMessages = this.transport.listQueuedMessages;
        const getThread = this.transport.getThread;
        const [queuedMessages, loadedThread] = await Promise.all([
          listQueuedMessages
            ? this.invokeRequest(requestContext, (context) =>
                listQueuedMessages({ threadId }, context),
              )
            : Promise.resolve([]),
          getThread
            ? this.invokeRequest(requestContext, (context) =>
                getThread({ threadId }, context),
              )
            : Promise.resolve(undefined),
        ]);
        this.assertActive();
        threadMissing = loadedThread === null;
        thread = {
          ...createAgentThreadState(threadId),
          thread: loadedThread === null ? undefined : loadedThread,
          queuedMessages,
        };
      }
      if (preserveRuntimeProjection && snapshot) {
        const current = this.getThread(threadId);
        thread = this.mergeLoadedThread(
          baseline,
          current,
          thread,
          this.hasLiveMessageProjection(current, thread),
        );
        if (queuedOverrideMessages) {
          // Queue mutations are already optimistic and independently durable.
          // A completed-run snapshot can lag the accepted steer/remove write,
          // so it must not resurrect work the client has already promoted.
          thread = { ...thread, queuedMessages: queuedOverrideMessages };
        }
      }
      const current = this.getThread(threadId);
      if (current !== baseline || current.activeRunIds.length > 0) {
        thread = this.mergeLoadedThread(
          baseline,
          current,
          thread,
          this.hasLiveMessageProjection(current, thread),
        );
      }
      for (const [runId, run] of refreshedRuns) {
        const currentRun = thread.runs[runId];
        if (currentRun && this.isTerminalStatus(currentRun.status)) continue;
        const refreshedRun = this.mergeRunState(
          currentRun,
          this.runState(runId, run),
        );
        if (refreshedRun === currentRun) continue;
        const activeRunIds = this.isTerminalStatus(refreshedRun.status)
          ? thread.activeRunIds.filter((id) => id !== runId)
          : Array.from(new Set([...thread.activeRunIds, runId]));
        thread = {
          ...thread,
          runs: { ...thread.runs, [runId]: refreshedRun },
          activeRunIds,
        };
      }
      thread = this.settleTerminalThread(thread, snapshot);
      if (threadMissing) this.missingThreadStates.add(thread);
      this.setThread(threadId, thread);
      this.setConnection("connected");
      this.scheduleQueuePromotionIfIdle(threadId);
      for (const runId of thread.activeRunIds) {
        void this.resubscribeRun(threadId, runId).catch(() => {
          // The consumer records the typed stream error in the client snapshot.
        });
      }
      return thread;
    } catch (error) {
      if (this.disposed) throw error;
      if (this.snapshot.capabilitiesStatus === "loading") {
        this.patch({ capabilitiesStatus: "error" });
      }
      this.fail(error, "thread_load_failed");
      throw error;
    }
  }

  public async getCapabilities(
    context?: AgentRequestContext,
  ): Promise<AgentCapabilities> {
    this.assertActive();
    return this.ensureCapabilities(this.createRequestContext(context));
  }

  public async createThread(
    input?: CreateThreadInput,
    context?: AgentRequestContext,
  ): Promise<AgentThread> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.ensureCapabilities(requestContext);
    const createThread = this.transport.createThread;
    if (!createThread) {
      throw new AgentKitOperationError("thread creation");
    }
    const thread = await this.invokeRequest(requestContext, (context) =>
      createThread(input, context),
    );
    this.assertActive();
    const current = this.getThread(thread.id);
    this.setThread(thread.id, { ...current, thread });
    return thread;
  }

  public async listThreads(
    input?: ListThreadsInput,
    context?: AgentRequestContext,
  ): Promise<ListThreadsResult> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.ensureCapabilities(requestContext);
    const listThreads = this.transport.listThreads;
    if (!listThreads) {
      throw new AgentKitOperationError("thread listing");
    }
    const result = await this.invokeRequest(requestContext, (context) =>
      listThreads(input, context),
    );
    this.assertActive();
    return result;
  }

  public async sendMessage(
    input: SendMessageInput,
    context?: AgentRequestContext,
  ): Promise<AgentRunHandle> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.ensureCapabilities(requestContext);
    if (input.attachments?.length) {
      await this.requireCapability("attachments", requestContext);
    }
    if (input.options?.model) {
      await this.requireCapability("modelSelection", requestContext);
    }
    if (input.options?.toolChoice) {
      await this.requireCapability("toolSelection", requestContext);
    }
    this.assertActive();
    const current = this.getThread(input.threadId);
    const activeRunId = current.activeRunIds.at(-1);
    if (
      activeRunId &&
      hasActiveAgentRuns(current) &&
      this.transport.queueMessage
    ) {
      const queued = await this.queueMessage(
        { ...input, queuedWhileRunActive: true },
        requestContext,
      );
      if (input.interruptActiveRun) {
        try {
          const steered = await this.steerQueuedMessage(
            input.threadId,
            queued.id,
            requestContext,
            { interruptActiveRun: true },
          );
          if (steered) return steered;
        } catch {
          this.scheduleQueuePromotion(input.threadId);
        }
      }
      return {
        runId: activeRunId,
        completed: this.resubscribeRun(input.threadId, activeRunId),
        cancel: () => this.cancelRun(input.threadId, activeRunId),
      };
    }
    const message: AgentMessage = {
      id: this.createId("message"),
      role: "user",
      createdAt: this.now(),
      status: "complete",
      parts: [{ type: "text", text: input.text }, ...(input.attachments ?? [])],
      metadata: input.metadata,
    };
    this.setThread(input.threadId, {
      ...current,
      messages: [...current.messages, message],
      suggestions: [],
      suggestionsPendingTurn: true,
    });
    this.setConnection("connecting");

    try {
      input.onLocalSubmit?.();
      const result = await this.invokeRequest(requestContext, (context) =>
        this.transport.startRun(
          {
            threadId: input.threadId,
            messages: [...current.messages, message],
            options: input.options,
            metadata: input.metadata,
          },
          context,
        ),
      );
      this.assertActive();
      if (result.capabilities) {
        this.patch({
          capabilities: result.capabilities,
          capabilitiesStatus: "ready",
        });
      }
      this.markRunStarted(input.threadId, result.runId);
      this.submittedUserMessages.set(
        this.runKey(input.threadId, result.runId),
        message.id,
      );
      const completed = this.consume(input.threadId, result.runId);
      this.trackConsumer(input.threadId, result.runId, completed);
      return {
        runId: result.runId,
        completed,
        cancel: () => this.cancelRun(input.threadId, result.runId),
      };
    } catch (error) {
      if (this.disposed) throw error;
      if (isAgentKitRunSlotBusyError(error)) {
        try {
          let activeRunId = error.activeRunId;
          if (
            !activeRunId &&
            (this.transport.getThreadSnapshot || this.transport.getThread)
          ) {
            try {
              activeRunId = (
                await this.loadThread(input.threadId, requestContext)
              ).activeRunIds.at(-1);
            } catch {
              activeRunId = this.getThread(input.threadId).activeRunIds.at(-1);
            }
          }
          const queued = await this.queueMessage(
            {
              ...input,
              onLocalSubmit: undefined,
              queuedWhileRunActive: false,
            },
            requestContext,
          );
          const thread = this.getThread(input.threadId);
          this.setThread(input.threadId, {
            ...thread,
            messages: thread.messages.filter(
              (candidate) => candidate.id !== message.id,
            ),
          });
          if (activeRunId) this.markRunStarted(input.threadId, activeRunId);
          else this.setConnection("connected");
          if (input.interruptActiveRun) {
            try {
              const steered = await this.steerQueuedMessage(
                input.threadId,
                queued.id,
                requestContext,
                { interruptActiveRun: true },
              );
              if (steered) return steered;
            } catch {
              this.scheduleQueuePromotion(input.threadId);
            }
          }
          if (!activeRunId) {
            this.scheduleQueuePromotion(input.threadId);
            return {
              runId: queued.id,
              completed: Promise.resolve(),
              cancel: () =>
                this.removeQueuedMessage(
                  input.threadId,
                  queued.id,
                  requestContext,
                ),
            };
          }
          return {
            runId: activeRunId,
            completed: this.resubscribeRun(input.threadId, activeRunId),
            cancel: () => this.cancelRun(input.threadId, activeRunId),
          };
        } catch (queueError) {
          error = queueError;
        }
      }
      const failed = this.getThread(input.threadId);
      this.setThread(input.threadId, {
        ...failed,
        messages: failed.messages.map((candidate) =>
          candidate.id === message.id
            ? { ...candidate, status: "error" }
            : candidate,
        ),
      });
      this.fail(error, "run_start_failed");
      throw error;
    }
  }

  public resubscribeRun(threadId: ThreadId, runId: RunId): Promise<void> {
    this.assertActive();
    const thread = this.getThread(threadId);
    const status = thread.runs[runId]?.status;
    // A failed stream can be explicitly reattached to recover from a
    // transient disconnect. Completed and cancelled runs have no live work to
    // resume.
    if (
      status === "completed" ||
      status === "cancelled" ||
      (status === "failed" &&
        thread.events.some(
          (event) => event.runId === runId && isTerminalRunEvent(event),
        ))
    ) {
      return Promise.resolve();
    }
    const key = this.runKey(threadId, runId);
    const existing = this.consumers.get(key);
    if (existing) return existing;
    const consumer = this.consume(threadId, runId);
    this.trackConsumer(threadId, runId, consumer);
    return consumer;
  }

  public async resolveApproval(
    input: {
      threadId: ThreadId;
      runId: RunId;
      approvalId: string;
      optionId?: string;
      response: AgentApprovalResponse;
    },
    context?: AgentRequestContext,
  ): Promise<void> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("approvals", requestContext);
    const resumeRun = this.transport.resumeRun;
    const resolveApproval = this.transport.resolveApproval;
    if (!resumeRun && !resolveApproval) {
      throw new AgentKitCapabilityError("approvals");
    }
    if (!resumeRun) {
      await this.invokeRequest(requestContext, (context) =>
        resolveApproval!(input, context),
      );
      this.assertActive();
      this.scheduleQueuePromotion(input.threadId);
      return;
    }
    const result = await this.invokeRequest(requestContext, (context) =>
      resumeRun(
        {
          threadId: input.threadId,
          runId: input.runId,
          resume: [resumeEntryFromApproval(input)],
        },
        context,
      ),
    );
    this.assertActive();
    if (result.runId !== input.runId) {
      this.retireInterruptedRun(input.threadId, input.runId);
    }
    // A runtime that suspends rather than terminates answers with the run that
    // was already streaming, so adopting it blindly would open a second reader
    // on one stream.
    const key = this.runKey(input.threadId, result.runId);
    const existingConsumer = this.consumers.get(key);
    if (existingConsumer) {
      this.scheduleQueuePromotion(input.threadId);
      void (async () => {
        await Promise.allSettled([existingConsumer]);
        if (!this.disposed) {
          await this.resubscribeRun(input.threadId, result.runId);
        }
      })().catch(() => {
        // The consumer records the typed stream error in the client snapshot.
      });
      return;
    }
    this.markRunStarted(input.threadId, result.runId);
    this.trackConsumer(
      input.threadId,
      result.runId,
      this.consume(input.threadId, result.runId),
    );
    this.scheduleQueuePromotion(input.threadId);
  }

  public async resolveConnectionRequest(
    input: {
      threadId: ThreadId;
      runId: RunId;
      requestId: string;
      response: AgentConnectionResponse;
    },
    context?: AgentRequestContext,
  ): Promise<void> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("connectionRequests", requestContext);
    const resolveConnectionRequest = this.transport.resolveConnectionRequest;
    if (!resolveConnectionRequest) {
      throw new AgentKitCapabilityError("connectionRequests");
    }
    await this.invokeRequest(requestContext, (context) =>
      resolveConnectionRequest(input, context),
    );
    this.assertActive();
    const existingConsumer = this.consumers.get(
      this.runKey(input.threadId, input.runId),
    );
    void (async () => {
      // Wait off the UI path: an interrupted reader can close after resolution.
      if (existingConsumer) await Promise.allSettled([existingConsumer]);
      if (!this.disposed) {
        await this.resubscribeRun(input.threadId, input.runId);
      }
    })().catch(() => {
      // The consumer records the typed stream error in the client snapshot.
    });
  }

  public async invokeAction(
    invocation: AgentActionInvocation,
    context?: AgentRequestContext,
  ): Promise<AgentActionResult> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("actions", requestContext);
    const invokeAction = this.transport.invokeAction;
    if (!invokeAction) {
      throw new AgentKitCapabilityError("actions");
    }
    const thread = this.getThread(invocation.threadId);
    this.setThread(invocation.threadId, {
      ...thread,
      actions: {
        ...thread.actions,
        [invocation.id]: { invocation },
      },
    });
    try {
      const result = await this.invokeRequest(requestContext, (context) =>
        invokeAction({ invocation }, context),
      );
      this.assertActive();
      const current = this.getThread(invocation.threadId);
      this.setThread(invocation.threadId, {
        ...current,
        actions: {
          ...current.actions,
          [invocation.id]: {
            ...current.actions[invocation.id],
            invocation,
            result,
          },
        },
      });
      return result;
    } catch (error) {
      if (this.disposed) throw error;
      const current = this.getThread(invocation.threadId);
      this.setThread(invocation.threadId, {
        ...current,
        actions: {
          ...current.actions,
          [invocation.id]: {
            ...current.actions[invocation.id],
            invocation,
            result: {
              invocationId: invocation.id,
              status: "failed",
              error: toError(error, "action_failed"),
            },
          },
        },
      });
      throw error;
    }
  }

  public async uploadFiles(
    threadId: ThreadId,
    files: AgentKitUploadFile[],
    context?: AgentRequestContext,
  ): Promise<FilePart[]> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("uploads", requestContext);
    return Promise.all(
      files.map(async (file) => {
        const target = await this.createUpload(
          threadId,
          {
            name: file.name,
            mediaType: file.mediaType,
            size: file.size,
            purpose: "message",
          },
          requestContext,
        );
        try {
          await this.invokeRequest(requestContext, (context) =>
            this.upload(target, file, context),
          );
          this.assertActive();
          return await this.completeUpload(
            threadId,
            target.uploadId,
            requestContext,
          );
        } catch (error) {
          if (this.transport.cancelUpload) {
            const cleanupContext = this.createRequestContext();
            await Promise.allSettled([
              this.transport.cancelUpload(
                {
                  threadId,
                  uploadId: target.uploadId,
                },
                cleanupContext,
              ),
            ]);
          }
          throw error;
        }
      }),
    );
  }

  public async createUpload(
    threadId: ThreadId,
    descriptor: AgentUploadDescriptor,
    context?: AgentRequestContext,
  ): Promise<AgentUploadTarget> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("uploads", requestContext);
    const createUpload = this.transport.createUpload;
    if (!createUpload) {
      throw new AgentKitCapabilityError("uploads");
    }
    const target = await this.invokeRequest(requestContext, (context) =>
      createUpload({ threadId, descriptor }, context),
    );
    this.assertActive();
    return target;
  }

  public async completeUpload(
    threadId: ThreadId,
    uploadId: UploadId,
    context?: AgentRequestContext,
  ): Promise<FilePart> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("uploads", requestContext);
    const completeUpload = this.transport.completeUpload;
    if (!completeUpload) {
      throw new AgentKitCapabilityError("uploads");
    }
    const file = await this.invokeRequest(requestContext, (context) =>
      completeUpload({ threadId, uploadId }, context),
    );
    this.assertActive();
    return file;
  }

  public async cancelUpload(
    threadId: ThreadId,
    uploadId: UploadId,
    context?: AgentRequestContext,
  ): Promise<void> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("uploads", requestContext);
    const cancelUpload = this.transport.cancelUpload;
    if (!cancelUpload) {
      throw new AgentKitCapabilityError("uploads");
    }
    await this.invokeRequest(requestContext, (context) =>
      cancelUpload({ threadId, uploadId }, context),
    );
    this.assertActive();
  }

  public async queueMessage(
    input: SendMessageInput,
    context?: AgentRequestContext,
  ): Promise<AgentQueuedMessage> {
    this.assertActive();
    const threadAtSubmit = this.getThread(input.threadId);
    const runWasActive =
      input.queuedWhileRunActive || hasActiveAgentRuns(threadAtSubmit);
    const runIdsBeforeWrite = new Set(Object.keys(threadAtSubmit.runs));
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("messageQueue", requestContext);
    if (input.attachments?.length) {
      await this.requireCapability("attachments", requestContext);
    }
    const queueMessage = this.transport.queueMessage;
    if (!queueMessage) {
      throw new AgentKitCapabilityError("messageQueue");
    }
    return this.enqueueQueueMutation(input.threadId, async () => {
      this.assertActive();
      const result = await this.invokeRequest(requestContext, (context) =>
        queueMessage(
          {
            threadId: input.threadId,
            text: input.text,
            attachments: input.attachments,
            metadata: input.metadata,
            options: input.options,
          },
          context,
        ),
      );
      this.assertActive();
      const thread = this.getThread(input.threadId);
      this.setThread(input.threadId, {
        ...thread,
        queuedMessages: [...thread.queuedMessages, result.message],
      });
      const queueOverride = this.queuedMessageOverrides.get(input.threadId);
      const removedIds = new Set(queueOverride?.removedIds);
      removedIds.delete(result.message.id);
      this.queuedMessageOverrides.set(input.threadId, {
        messages: [...thread.queuedMessages, result.message],
        removedIds,
      });
      input.onLocalSubmit?.();
      const updatedThread = this.getThread(input.threadId);
      const runStartedDuringWrite = Object.keys(updatedThread.runs).some(
        (runId) => !runIdsBeforeWrite.has(runId),
      );
      if (
        !hasActiveAgentRuns(updatedThread) &&
        (runWasActive || runStartedDuringWrite)
      ) {
        this.scheduleQueuePromotion(input.threadId);
      }
      return result.message;
    });
  }

  public async removeQueuedMessage(
    threadId: ThreadId,
    messageId: string,
    context?: AgentRequestContext,
  ): Promise<void> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("messageQueue", requestContext);
    const removeQueuedMessage = this.transport.removeQueuedMessage;
    if (!removeQueuedMessage) {
      throw new AgentKitCapabilityError("messageQueue");
    }
    return this.enqueueQueueMutation(threadId, async () => {
      this.assertActive();
      const previous = this.getThread(threadId);
      const removedIndex = previous.queuedMessages.findIndex(
        (message) => message.id === messageId,
      );
      const removed = previous.queuedMessages[removedIndex];
      const previousOverride = this.queuedMessageOverrides.get(threadId);
      if (removed) {
        const queuedMessages = previous.queuedMessages.filter(
          (message) => message.id !== messageId,
        );
        this.setThread(threadId, { ...previous, queuedMessages });
        const removedIds = new Set(previousOverride?.removedIds);
        removedIds.add(messageId);
        this.queuedMessageOverrides.set(threadId, {
          messages: queuedMessages,
          removedIds,
        });
      }
      try {
        await this.invokeRequest(requestContext, (context) =>
          removeQueuedMessage({ threadId, messageId }, context),
        );
        this.assertActive();
      } catch (error) {
        if (this.disposed) throw error;
        if (removed) {
          const current = this.getThread(threadId);
          if (
            !current.queuedMessages.some((message) => message.id === messageId)
          ) {
            const queuedMessages = [...current.queuedMessages];
            queuedMessages.splice(
              Math.min(removedIndex, queuedMessages.length),
              0,
              removed,
            );
            this.setThread(threadId, { ...current, queuedMessages });
            const currentOverride = this.queuedMessageOverrides.get(threadId);
            const removedIds = new Set(currentOverride?.removedIds);
            removedIds.delete(messageId);
            if (currentOverride || removedIds.size > 0) {
              this.queuedMessageOverrides.set(threadId, {
                messages: queuedMessages,
                removedIds,
              });
            } else {
              this.queuedMessageOverrides.delete(threadId);
            }
          }
        }
        throw error;
      }
    });
  }

  public supportsQueuedMessageReordering(): boolean {
    return typeof this.transport.moveQueuedMessageToTop === "function";
  }

  public async moveQueuedMessageToTop(
    threadId: ThreadId,
    messageId: string,
    context?: AgentRequestContext,
  ): Promise<void> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("messageQueue", requestContext);
    const moveQueuedMessageToTop = this.transport.moveQueuedMessageToTop;
    if (!moveQueuedMessageToTop) {
      throw new AgentKitOperationError("queue reordering");
    }
    return this.enqueueQueueMutation(threadId, async () => {
      this.assertActive();
      const previous = this.getThread(threadId);
      const index = previous.queuedMessages.findIndex(
        (message) => message.id === messageId,
      );
      if (index < 0) throw new Error(`Unknown queued message: ${messageId}`);
      if (index === 0) return;

      const queued = previous.queuedMessages[index]!;
      const queuedMessages = [
        queued,
        ...previous.queuedMessages.filter(
          (message) => message.id !== messageId,
        ),
      ];
      const previousOverride = this.queuedMessageOverrides.get(threadId);
      const removedIds = new Set(previousOverride?.removedIds);
      this.setThread(threadId, { ...previous, queuedMessages });
      this.queuedMessageOverrides.set(threadId, {
        messages: queuedMessages,
        removedIds,
      });

      try {
        await this.invokeRequest(requestContext, (request) =>
          moveQueuedMessageToTop({ threadId, messageId }, request),
        );
        this.assertActive();
      } catch (error) {
        if (this.disposed) throw error;
        const current = this.getThread(threadId);
        const previousOrder = new Map(
          previous.queuedMessages.map((message, itemIndex) => [
            message.id,
            itemIndex,
          ]),
        );
        const restoredQueue = current.queuedMessages
          .map((message, itemIndex) => ({ message, itemIndex }))
          .sort((left, right) => {
            const leftIndex = previousOrder.get(left.message.id);
            const rightIndex = previousOrder.get(right.message.id);
            if (leftIndex === undefined) {
              return rightIndex === undefined
                ? left.itemIndex - right.itemIndex
                : 1;
            }
            if (rightIndex === undefined) return -1;
            return leftIndex - rightIndex;
          })
          .map(({ message }) => message);
        this.setThread(threadId, {
          ...current,
          queuedMessages: restoredQueue,
        });
        if (previousOverride) {
          this.queuedMessageOverrides.set(threadId, previousOverride);
        } else {
          this.queuedMessageOverrides.delete(threadId);
        }
        throw error;
      }
    });
  }

  public steerQueuedMessage(
    threadId: ThreadId,
    messageId: string,
    context?: AgentRequestContext,
    options?: { interruptActiveRun?: boolean },
  ): Promise<AgentRunHandle | void> {
    const steeringKey = JSON.stringify([
      threadId,
      messageId,
      options?.interruptActiveRun === true,
    ]);
    const existing = this.queueSteerings.get(steeringKey);
    if (existing) return existing;
    const steering = this.steerQueuedMessageNow(
      threadId,
      messageId,
      context,
      options,
    );
    this.queueSteerings.set(steeringKey, steering);
    const clearSteering = () => {
      if (this.queueSteerings.get(steeringKey) === steering) {
        this.queueSteerings.delete(steeringKey);
      }
    };
    void steering.then(clearSteering, clearSteering);
    return steering;
  }

  private async steerQueuedMessageNow(
    threadId: ThreadId,
    messageId: string,
    context?: AgentRequestContext,
    options?: { interruptActiveRun?: boolean },
  ): Promise<AgentRunHandle | void> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("messageQueue", requestContext);
    const steerQueuedMessage = this.transport.steerQueuedMessage;
    if (!steerQueuedMessage) {
      throw new AgentKitCapabilityError("messageQueue");
    }
    return this.enqueueQueueMutation(threadId, async () => {
      this.assertActive();
      const previous = this.getThread(threadId);
      const queued = previous.queuedMessages.find(
        (message) => message.id === messageId,
      );
      if (!queued) {
        if (previous.messages.some((message) => message.id === messageId))
          return;
        throw new Error(`Unknown queued message: ${messageId}`);
      }
      const message: AgentMessage = {
        id: queued.id,
        role: "user",
        createdAt: queued.createdAt,
        status: "complete",
        parts: [
          { type: "text", text: queued.text },
          ...(queued.attachments ?? []),
        ],
        metadata: queued.metadata,
      };
      const interruptedRunIds = new Set<RunId>();
      const previousConnection = this.snapshot.connection;
      const previousError = this.snapshot.error;
      this.setConnection("connecting");
      try {
        if (options?.interruptActiveRun) {
          for (const runId of previous.activeRunIds) {
            await this.cancelRun(threadId, runId, requestContext);
            interruptedRunIds.add(runId);
          }
        }
        let result: Awaited<ReturnType<typeof steerQueuedMessage>>;
        for (let attempt = 0; ; attempt += 1) {
          try {
            result = await this.invokeRequest(requestContext, (context) =>
              steerQueuedMessage(
                {
                  threadId,
                  messageId,
                  ...(options?.interruptActiveRun
                    ? { interruptActiveRun: true }
                    : {}),
                },
                context,
              ),
            );
            break;
          } catch (error) {
            const activeRunId = errorProperty(error, "activeRunId");
            if (
              !options?.interruptActiveRun ||
              !isAgentKitRunSlotBusyError(error) ||
              attempt >= 3
            ) {
              throw error;
            }
            if (
              typeof activeRunId !== "string" ||
              interruptedRunIds.has(activeRunId)
            ) {
              await new Promise((resolve) => setTimeout(resolve, 250));
            } else {
              await this.cancelRun(threadId, activeRunId, requestContext);
              interruptedRunIds.add(activeRunId);
            }
          }
        }
        this.assertActive();
        const current = this.getThread(threadId);
        const queuedMessages = current.queuedMessages.filter(
          (candidate) => candidate.id !== messageId,
        );
        this.setThread(threadId, {
          ...current,
          messages: current.messages.some(
            (candidate) => candidate.id === messageId,
          )
            ? current.messages
            : [...current.messages, message],
          queuedMessages,
          suggestions: [],
          suggestionsPendingTurn: true,
        });
        const override = this.queuedMessageOverrides.get(threadId);
        const removedIds = new Set(override?.removedIds);
        removedIds.add(messageId);
        this.queuedMessageOverrides.set(threadId, {
          messages: queuedMessages,
          removedIds,
        });
        if (!result) {
          this.setConnection("connected");
          return;
        }
        if (result.capabilities) {
          this.patch({
            capabilities: result.capabilities,
            capabilitiesStatus: "ready",
          });
        }
        this.markRunStarted(threadId, result.runId);
        this.submittedUserMessages.set(
          this.runKey(threadId, result.runId),
          message.id,
        );
        const completed = this.consume(threadId, result.runId);
        this.trackConsumer(threadId, result.runId, completed);
        return {
          runId: result.runId,
          completed,
          cancel: () => this.cancelRun(threadId, result.runId),
        };
      } catch (error) {
        if (this.disposed) throw error;
        this.patch({ connection: previousConnection, error: previousError });
        if (
          error instanceof Error &&
          error.message === `Unknown queued message: ${messageId}`
        ) {
          const current = this.getThread(threadId);
          const queuedMessages = current.queuedMessages.filter(
            (candidate) => candidate.id !== messageId,
          );
          this.setThread(threadId, { ...current, queuedMessages });
          const override = this.queuedMessageOverrides.get(threadId);
          const removedIds = new Set(override?.removedIds);
          removedIds.add(messageId);
          this.queuedMessageOverrides.set(threadId, {
            messages: queuedMessages,
            removedIds,
          });
          if (this.queuePromotions.has(threadId)) {
            this.queuePromotionAfterReconciliation.add(threadId);
          } else {
            this.scheduleQueuePromotionIfIdle(threadId);
          }
          return;
        }
        if (
          !isAgentKitRunSlotBusyError(error) ||
          !this.queuePromotions.has(threadId)
        ) {
          this.report(error, "queue_steer_failed");
        }
        throw error;
      }
    });
  }

  public async cancelRun(
    threadId: ThreadId,
    runId: RunId,
    context?: AgentRequestContext,
  ): Promise<void> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.invokeRequest(requestContext, (context) =>
      this.transport.cancelRun({ threadId, runId }, context),
    );
    this.assertActive();
    const status = this.getThread(threadId).runs[runId]?.status;
    if (status && this.isTerminalStatus(status)) return;
    this.markRunCancelled(threadId, runId);
    const key = this.runKey(threadId, runId);
    const hasOtherConsumers = [...this.consumers.keys()].some(
      (candidate) => candidate !== key,
    );
    this.stopConsumer(threadId, runId, "cancelled");
    if (!hasOtherConsumers) this.setConnection("connected");
  }

  public async submitFeedback(
    threadId: ThreadId,
    messageId: string,
    value: "positive" | "negative" | "dismissed",
    options?: Pick<
      SubmitFeedbackInput,
      "metadata" | "messageSeq" | "reason" | "runId"
    >,
    context?: AgentRequestContext,
  ): Promise<void> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("feedback", requestContext);
    const submitFeedback = this.transport.submitFeedback;
    if (!submitFeedback) {
      throw new AgentKitCapabilityError("feedback");
    }
    await this.invokeRequest(requestContext, (context) =>
      submitFeedback(
        {
          threadId,
          messageId,
          value,
          ...options,
        },
        context,
      ),
    );
    this.assertActive();
  }

  public async forkThread(
    threadId: ThreadId,
    fromMessageId?: string,
    options?: Omit<ForkThreadInput, "threadId" | "fromMessageId">,
    context?: AgentRequestContext,
  ): Promise<AgentThread> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("threadForking", requestContext);
    const forkThread = this.transport.forkThread;
    if (!forkThread) {
      throw new AgentKitCapabilityError("threadForking");
    }
    const forked = await this.invokeRequest(requestContext, (context) =>
      forkThread(
        {
          threadId,
          fromMessageId,
          ...options,
        },
        context,
      ),
    );
    this.assertActive();
    const current = this.getThread(forked.id);
    this.setThread(forked.id, { ...current, thread: forked });
    return forked;
  }

  public async updateThread(
    threadId: ThreadId,
    patch: Omit<UpdateThreadInput, "threadId">,
    context?: AgentRequestContext,
  ): Promise<AgentThread> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.ensureCapabilities(requestContext);
    const updateThread = this.transport.updateThread;
    if (!updateThread) {
      throw new AgentKitOperationError("thread updates");
    }
    const updated = await this.invokeRequest(requestContext, (context) =>
      updateThread({ ...patch, threadId }, context),
    );
    this.assertActive();
    const current = this.getThread(threadId);
    this.setThread(threadId, { ...current, thread: updated });
    return updated;
  }

  public async deleteThread(
    threadId: ThreadId,
    context?: AgentRequestContext,
  ): Promise<void> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.ensureCapabilities(requestContext);
    const deleteThread = this.transport.deleteThread;
    if (!deleteThread) {
      throw new AgentKitOperationError("thread deletion");
    }
    await this.invokeRequest(requestContext, (context) =>
      deleteThread({ threadId }, context),
    );
    this.assertActive();
    this.stopThreadConsumers(threadId, "deleted");
    this.clearSubmittedUserMessages(threadId);
    this.queuedMessageOverrides.delete(threadId);
    const threads = { ...this.snapshot.threads };
    delete threads[threadId];
    this.patch({ threads });
  }

  public shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.disposed = true;
    this.requestAbortController.abort(new AgentKitDisposedError());
    for (const timer of this.queuePromotionTimers.values()) {
      clearTimeout(timer);
    }
    this.queuePromotionTimers.clear();
    this.queuePromotionRetryAttempts.clear();
    this.queuePromotionTerminalExpedites.clear();
    this.queuePromotionAfterReconciliation.clear();
    for (const controller of this.consumerAbortControllers.values()) {
      controller.abort(new AgentKitConsumerStoppedError("disposed"));
    }
    this.consumerAbortControllers.clear();
    this.threadLeaseCounts.clear();
    this.queueMutationChains.clear();
    this.queuedMessageOverrides.clear();
    this.submittedUserMessages.clear();
    this.patch({ connection: "offline" });
    this.listeners.clear();
    this.consumers.clear();
    this.shutdownPromise = this.ownsTransport
      ? (async () => {
          await this.transport.dispose?.();
        })()
      : Promise.resolve();
    return this.shutdownPromise;
  }

  public dispose(): Promise<void> {
    return this.shutdown();
  }

  private trackConsumer(
    threadId: ThreadId,
    runId: RunId,
    completed: Promise<void>,
  ): void {
    this.consumers.set(this.runKey(threadId, runId), completed);
    // `consume` reports failures through snapshot state and `onError` before it
    // rejects. Observe internally-owned continuations here so a caller that
    // cannot receive their completion promise never triggers an unhandled
    // rejection; APIs that return `completed` still expose the original promise.
    void completed.catch(() => undefined);
  }

  private persistThreadSnapshot(
    threadId: ThreadId,
  ): Promise<{ error: unknown } | undefined> {
    const persist = this.transport.persistThreadSnapshot;
    if (!persist) return Promise.resolve(undefined);
    const thread = this.getThread(threadId);
    const updatedAt = this.now();
    const messageIds = new Set(thread.messages.map((message) => message.id));
    const annotations: AgentAnnotationSnapshot[] = Object.entries(
      thread.annotations,
    ).flatMap(([id, annotation]) => {
      const messageId = thread.annotationMessageIds[id];
      return messageId && messageIds.has(messageId)
        ? [{ messageId, annotation }]
        : [];
    });
    const snapshot: AgentThreadSnapshot = {
      ...(thread.thread ?? {
        id: threadId,
        createdAt: updatedAt,
        updatedAt,
      }),
      id: threadId,
      updatedAt,
      messages: thread.messages,
      queuedMessages: thread.queuedMessages,
      events: thread.events,
      runs: Object.values(thread.runs).map((run) => ({
        ...run,
        threadId,
      })),
      activeRunIds: thread.activeRunIds,
      suggestions: thread.suggestions,
      activities: Object.values(thread.activities),
      annotations,
      toolCalls: Object.values(thread.tools),
      widgets: Object.entries(thread.widgets).flatMap(([id, widget]) => {
        const messageId = thread.widgetMessageIds[id];
        return messageId ? [{ messageId, widget }] : [];
      }),
    };
    return this.invokeRequest(this.createRequestContext(), (requestContext) =>
      persist({ threadId, snapshot }, requestContext),
    )
      .then(() => undefined)
      .catch((error) => ({ error }));
  }

  private async consume(threadId: ThreadId, runId: RunId): Promise<void> {
    const key = this.runKey(threadId, runId);
    const abortController = new AbortController();
    this.consumerAbortControllers.set(key, abortController);
    let attempt = 0;
    let interruptedForContinuation = [
      "awaiting_approval",
      "awaiting_input",
    ].includes(this.getThread(threadId).runs[runId]?.status ?? "");
    try {
      while (true) {
        const afterSequence =
          this.getThread(threadId).runs[runId]?.lastSequence ?? 0;
        let terminalEvent: AgentEvent | undefined;
        try {
          this.setConnection(attempt === 0 ? "connected" : "reconnecting");
          for await (const value of this.transport.subscribeToRun({
            threadId,
            runId,
            afterSequence,
            signal: abortController.signal,
          })) {
            if (
              abortController.signal.reason instanceof
              AgentKitConsumerStoppedError
            ) {
              return;
            }
            const event = parseAgentEvent(value);
            if (event.threadId !== threadId) {
              throw new AgentProtocolValidationError(
                "event.threadId",
                "must match the subscribed thread",
              );
            }
            if (event.runId !== runId) {
              throw new AgentProtocolValidationError(
                "event.runId",
                "must match the subscribed run",
              );
            }
            this.applyEvent(event);
            if (
              event.type === "approval.requested" ||
              event.type === "connection.requested"
            ) {
              interruptedForContinuation = true;
            } else if (event.type === "approval.resolved") {
              interruptedForContinuation = false;
            } else if (
              event.type === "connection.updated" &&
              (event.request.status === "connected" ||
                event.request.status === "declined" ||
                event.request.status === "failed")
            ) {
              interruptedForContinuation = false;
            }
            if (isTerminalRunEvent(event)) {
              terminalEvent = event;
            }
          }
          if (!terminalEvent) {
            if (interruptedForContinuation) {
              this.setConnection("connected");
              return;
            }
            this.reportIntegrity({
              code: "run_missing_terminal",
              threadId,
              runId,
            });
            throw new Error(
              `AgentKit run ${runId} ended without a terminal event.`,
            );
          }
          this.setConnection("connected");
          await this.finishTerminalRun(threadId, terminalEvent);
          return;
        } catch (error) {
          if (
            abortController.signal.reason instanceof
            AgentKitConsumerStoppedError
          ) {
            return;
          }
          if (terminalEvent) {
            await this.finishTerminalRun(threadId, terminalEvent);
            this.fail(error, "run_stream_failed");
            return;
          }
          if (
            abortController.signal.aborted ||
            !errorIsRetryable(error) ||
            attempt >= this.reconnectAttempts
          ) {
            throw error;
          }
          attempt += 1;
          this.setConnection("reconnecting");
          await this.waitForReconnect(
            this.reconnectDelay(attempt),
            abortController.signal,
          );
        }
      }
    } catch (error) {
      if (
        abortController.signal.reason instanceof AgentKitConsumerStoppedError
      ) {
        return;
      }
      const runError = toError(error, "run_stream_failed");
      this.markRunFailed(threadId, runId, runError);
      this.fail(error, "run_stream_failed");
      throw error;
    } finally {
      this.consumers.delete(key);
      this.consumerAbortControllers.delete(key);
    }
  }

  private async finishTerminalRun(
    threadId: ThreadId,
    terminalEvent: AgentEvent,
  ): Promise<void> {
    this.submittedUserMessages.delete(
      this.runKey(threadId, terminalEvent.runId),
    );
    const snapshotPersistence = this.persistThreadSnapshot(threadId);
    const completed =
      terminalEvent.type === "run.completed" ||
      (terminalEvent.type === "run.status" &&
        terminalEvent.status === "completed");
    const terminalThread = this.getThread(threadId);
    const queuedWorkKnown =
      terminalThread.queuedMessages.length > 0 &&
      !hasActiveAgentRuns(terminalThread);
    if (queuedWorkKnown) this.scheduleQueuePromotion(threadId, true);
    const persistenceError = await snapshotPersistence;
    if (completed) {
      const shouldRefreshProjection =
        !this.threadLoads.has(threadId) &&
        (this.transport.getThreadSnapshot || this.transport.getThread);
      if (shouldRefreshProjection) {
        try {
          await this.loadThreadProjection(
            threadId,
            this.createRequestContext(),
            true,
          );
        } catch (error) {
          // History hydration reports its own failure; it cannot undo a terminal run.
          if (this.disposed) throw error;
        }
      }
      if (!queuedWorkKnown && !hasActiveAgentRuns(this.getThread(threadId))) {
        this.scheduleQueuePromotion(threadId, true);
      }
    }
    if (persistenceError) {
      this.fail(persistenceError.error, "thread_snapshot_persist_failed");
    }
  }

  private waitForReconnect(
    duration: number,
    signal: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeout);
        reject(signal.reason ?? this.abortError());
      };
      const timeout = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, duration);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private abortError(): Error {
    const error = new Error("Aborted");
    error.name = "AbortError";
    return error;
  }

  private async ensureCapabilities(
    context: AgentRequestContext,
  ): Promise<AgentCapabilities> {
    this.assertRequestActive(context);
    if (
      this.snapshot.capabilitiesStatus === "ready" &&
      !this.capabilitiesExpired()
    ) {
      return this.snapshot.capabilities;
    }
    if (this.capabilitiesLoad) {
      return this.invokeRequest(
        context,
        () => this.capabilitiesLoad as Promise<AgentCapabilities>,
      );
    }
    this.patch({ capabilitiesStatus: "loading" });
    const loadContext = this.createRequestContext({
      correlationId: context.correlationId,
    });
    const load = (async () => {
      if (this.transport.discoverCapabilities) {
        const discoverCapabilities = this.transport.discoverCapabilities;
        const discovery = await this.invokeRequest(
          loadContext,
          (requestContext) =>
            discoverCapabilities(
              { protocol: createAgentKitProtocolVersionOffer() },
              requestContext,
            ),
        );
        if (discovery.protocol.status === "incompatible") {
          throw new AgentKitHandshakeError(
            discovery.protocol.error.code,
            discovery.protocol.error.message,
            discovery.protocol.error.details,
            discovery.protocol.error.correlationId,
          );
        }
        const capabilities =
          discovery.legacy ?? projectAgentCapabilities(discovery);
        this.patch({
          capabilities,
          capabilityDiscovery: discovery,
          capabilitiesStatus: "ready",
        });
        return capabilities;
      }
      const capabilities = this.transport.capabilities ?? {};
      this.patch({ capabilities, capabilitiesStatus: "ready" });
      return capabilities;
    })().catch((error) => {
      if (!this.disposed) this.patch({ capabilitiesStatus: "error" });
      throw error;
    });
    this.capabilitiesLoad = load;
    try {
      return await this.invokeRequest(context, () => load);
    } finally {
      if (this.capabilitiesLoad === load) this.capabilitiesLoad = undefined;
    }
  }

  private capabilitiesExpired(): boolean {
    const expiresAt = this.snapshot.capabilityDiscovery?.expiresAt;
    if (!expiresAt) return false;
    const expiration = Date.parse(expiresAt);
    const current = Date.parse(this.now());
    return (
      Number.isFinite(expiration) &&
      Number.isFinite(current) &&
      expiration <= current
    );
  }

  private settleTerminalThread(
    thread: AgentThreadState,
    snapshot?: AgentThreadSnapshot | null,
  ): AgentThreadState {
    const runs = Object.values(thread.runs);
    const terminalRuns = runs.filter((run): run is TerminalRunState =>
      this.isTerminalStatus(run.status),
    );
    const settled = terminalRuns.reduce(
      (currentThread, run) =>
        settleRunProjection(
          currentThread,
          run.id,
          run.status,
          run.completedAt ?? this.now(),
          run.activeMessageId,
        ),
      thread,
    );
    if (
      thread.activeRunIds.length > 0 ||
      runs.some((run) => !this.isTerminalStatus(run.status))
    ) {
      return settled;
    }

    const snapshotHasNoActiveRuns =
      snapshot?.activeRunIds?.length === 0 ||
      (snapshot?.activeRunIds === undefined &&
        snapshot?.runs !== undefined &&
        snapshot.runs.length > 0 &&
        snapshot.runs.every((run) => this.isTerminalStatus(run.status)));
    if (!snapshotHasNoActiveRuns) return settled;

    // A snapshot can outlive the event association for its assistant message.
    // If any known run failed or was cancelled, settle an unassociated message
    // as an error rather than presenting a partial response as successful.
    const settledMessageStatus =
      terminalRuns.length > 0 &&
      terminalRuns.every((run) => run.status === "completed")
        ? "complete"
        : "error";
    // Lifecycle events can age out independently of the message projection.
    // Once the snapshot proves that no run remains active, any assistant
    // message still marked streaming is stale rather than in-flight work.
    return {
      ...settled,
      messages: settled.messages.map((message) =>
        message.role === "assistant" && message.status === "streaming"
          ? { ...message, status: settledMessageStatus }
          : message,
      ),
    };
  }

  private hydrateThread(
    snapshot: AgentThreadSnapshot,
    runs: AgentThreadState["runs"],
    activeRunIds: RunId[],
  ): AgentThreadState {
    let hydrated = createAgentThreadState(snapshot.id);
    for (const event of snapshot.events ?? []) {
      hydrated = reduceAgentEvent(hydrated, event);
    }
    const snapshotApprovals = Object.fromEntries(
      (snapshot.approvals ?? [])
        .filter((approval) => approval.status === "pending")
        .map((approval) => [approval.request.id, approval.request]),
    );
    const snapshotApprovalRunIds = Object.fromEntries(
      (snapshot.approvals ?? [])
        .filter(
          (approval) =>
            approval.status === "pending" && approval.runId !== undefined,
        )
        .map((approval) => [approval.request.id, approval.runId as RunId]),
    );
    const snapshotConnectionRequests = Object.fromEntries(
      (snapshot.connectionRequests ?? []).map((entry) => [
        entry.request.id,
        entry.request,
      ]),
    );
    const snapshotConnectionRequestRunIds = Object.fromEntries(
      (snapshot.connectionRequests ?? [])
        .filter((entry) => entry.runId !== undefined)
        .map((entry) => [entry.request.id, entry.runId as RunId]),
    );
    const snapshotWidgets = Object.fromEntries(
      (snapshot.widgets ?? []).map((entry) => [entry.widget.id, entry.widget]),
    );
    const snapshotWidgetMessageIds = Object.fromEntries(
      (snapshot.widgets ?? []).map((entry) => [
        entry.widget.id,
        entry.messageId,
      ]),
    );
    const snapshotAnnotations = Object.fromEntries(
      (snapshot.annotations ?? []).map((entry) => [
        entry.annotation.id,
        entry.annotation,
      ]),
    );
    const snapshotAnnotationMessageIds = Object.fromEntries(
      (snapshot.annotations ?? []).map((entry) => [
        entry.annotation.id,
        entry.messageId,
      ]),
    );
    const mergedRuns = this.mergeRuns(hydrated.runs, runs);
    const currentActiveRunIds = activeRunIds.filter(
      (runId) => !this.isTerminalStatus(mergedRuns[runId]?.status ?? "running"),
    );
    const projected: AgentThreadState = {
      ...hydrated,
      thread: snapshot,
      // The snapshot projection is authoritative. The event log rebuilds all
      // rich, non-message state without replaying text deltas twice.
      messages: snapshot.messages,
      queuedMessages: snapshot.queuedMessages ?? hydrated.queuedMessages,
      runs: mergedRuns,
      activeRunIds: currentActiveRunIds,
      tools: {
        ...hydrated.tools,
        ...Object.fromEntries(
          (snapshot.toolCalls ?? []).map((tool) => [tool.id, tool]),
        ),
      },
      activities: {
        ...hydrated.activities,
        ...Object.fromEntries(
          (snapshot.activities ?? []).map((activity) => [
            activity.id,
            activity,
          ]),
        ),
      },
      tasks: {
        ...hydrated.tasks,
        ...Object.fromEntries(
          (snapshot.tasks ?? []).map((task) => [task.id, task]),
        ),
      },
      approvals:
        snapshot.approvals === undefined
          ? hydrated.approvals
          : snapshotApprovals,
      approvalRunIds:
        snapshot.approvals === undefined
          ? hydrated.approvalRunIds
          : snapshotApprovalRunIds,
      connectionRequests: {
        ...hydrated.connectionRequests,
        ...snapshotConnectionRequests,
      },
      connectionRequestRunIds: {
        ...hydrated.connectionRequestRunIds,
        ...snapshotConnectionRequestRunIds,
      },
      widgets: { ...hydrated.widgets, ...snapshotWidgets },
      widgetMessageIds: {
        ...hydrated.widgetMessageIds,
        ...snapshotWidgetMessageIds,
      },
      annotations: { ...hydrated.annotations, ...snapshotAnnotations },
      annotationMessageIds: {
        ...hydrated.annotationMessageIds,
        ...snapshotAnnotationMessageIds,
      },
      agents: {
        ...hydrated.agents,
        ...Object.fromEntries(
          (snapshot.agents ?? []).map((agent) => [agent.id, agent]),
        ),
      },
      agentInteractions: snapshot.interactions ?? hydrated.agentInteractions,
      artifacts: snapshot.artifacts ?? hydrated.artifacts,
      suggestions:
        snapshot.suggestions?.map((suggestion) => ({
          ...suggestion,
          runId:
            suggestion.runId ??
            hydrated.suggestions.find((item) => item.id === suggestion.id)
              ?.runId,
        })) ?? hydrated.suggestions,
    };
    const latestUserIndex = projected.messages.findLastIndex(
      (message) => message.role === "user",
    );
    const latestAssistantIndex = projected.messages.findLastIndex(
      (message) => message.role === "assistant",
    );
    const latestUser = projected.messages[latestUserIndex];
    const latestRun = selectLatestAgentRun(projected);
    projected.suggestionsUserMessageId =
      latestAssistantIndex > latestUserIndex ||
      (latestUser?.createdAt &&
        latestRun?.startedAt &&
        latestUser.createdAt <= latestRun.startedAt)
        ? latestUser?.id
        : hydrated.suggestionsUserMessageId;
    return this.settleTerminalThread(projected, snapshot);
  }

  private async requireCapability(
    capability: AgentCapabilityId,
    context: AgentRequestContext,
  ): Promise<void> {
    const capabilities = await this.ensureCapabilities(context);
    this.assertActive();
    const descriptor = this.snapshot.capabilityDiscovery?.capabilities.find(
      (candidate) => candidate.id === capability,
    );
    if (descriptor?.state === "unsupported") {
      throw this.capabilityError(descriptor);
    }
    if (descriptor?.state === "unavailable") {
      throw this.capabilityError(descriptor);
    }
    if (this.snapshot.capabilityDiscovery && !descriptor) {
      throw new AgentKitCapabilityError(
        capability,
        "unavailable",
        `The ${JSON.stringify(capability)} capability was not included in discovery.`,
        true,
      );
    }
    if (capabilities[capability] === false) {
      throw new AgentKitCapabilityError(capability);
    }
  }

  private capabilityError(
    descriptor: AgentCapabilityDescriptor,
  ): AgentKitCapabilityError {
    const unavailable = descriptor.state === "unavailable";
    return new AgentKitCapabilityError(
      descriptor.id,
      unavailable ? "unavailable" : "unsupported",
      descriptor.error?.message ?? descriptor.description,
      descriptor.error?.retryable ?? unavailable,
      descriptor.error?.correlationId,
      descriptor.error?.details,
    );
  }

  private mergeLoadedThread(
    baseline: AgentThreadState,
    current: AgentThreadState,
    loaded: AgentThreadState,
    preserveLiveMessages = false,
  ): AgentThreadState {
    const messagesChanged = current.messages !== baseline.messages;
    const reconciliation =
      loaded.messages.length > 0
        ? this.reconcileMessages(current.messages, loaded.messages)
        : undefined;
    const hasMessageIdRemap = (reconciliation?.idRemap.size ?? 0) > 0;
    // Keep the live projection as the winner only for identities accepted by
    // a concurrent stream. A content match still needs the durable identity
    // when the stream finished before this refresh established its baseline.
    const live = reconciliation
      ? this.remapThreadMessageReferences(current, reconciliation.idRemap)
      : current;
    const loadedSnapshot = loaded.thread as AgentThreadSnapshot | undefined;
    const snapshotIncludes = (key: keyof AgentThreadSnapshot) =>
      loadedSnapshot !== undefined &&
      Object.prototype.hasOwnProperty.call(loadedSnapshot, key);
    const snapshotIncludesRuntimeProjection = (
      key: keyof AgentThreadSnapshot,
    ) => snapshotIncludes(key) || snapshotIncludes("events");
    const mergeRecordProjection = <T>(
      loadedProjection: Record<string, T>,
      baselineProjection: Record<string, T>,
      currentProjection: Record<string, T>,
      snapshotKey: keyof AgentThreadSnapshot,
    ) =>
      currentProjection === baselineProjection &&
      !snapshotIncludesRuntimeProjection(snapshotKey)
        ? currentProjection
        : mergeRuntimeRecordMap(
            loadedProjection,
            baselineProjection,
            currentProjection,
          );
    const mergeListProjection = <T extends { id: string }>(
      loadedProjection: T[],
      baselineProjection: T[],
      currentProjection: T[],
      snapshotKey: keyof AgentThreadSnapshot,
    ) => {
      if (
        currentProjection === baselineProjection &&
        !snapshotIncludesRuntimeProjection(snapshotKey)
      ) {
        return currentProjection;
      }
      if (currentProjection === baselineProjection) return loadedProjection;

      const baselineById = new Map(
        baselineProjection.map((item) => [item.id, item]),
      );
      const currentById = new Map(
        currentProjection.map((item) => [item.id, item]),
      );
      const removedIds = new Set(
        [...baselineById.keys()].filter((id) => !currentById.has(id)),
      );
      const changedItems = currentProjection.filter((item) => {
        const baselineItem = baselineById.get(item.id);
        return baselineItem === undefined || baselineItem !== item;
      });
      return this.mergeItemsById(
        loadedProjection.filter((item) => !removedIds.has(item.id)),
        changedItems,
      );
    };
    const runs = this.mergeRuns(loaded.runs, live.runs);
    const activeRunIds = Array.from(
      new Set([...loaded.activeRunIds, ...live.activeRunIds]),
    ).filter(
      (runId) => !this.isTerminalStatus(runs[runId]?.status ?? "running"),
    );
    return {
      ...loaded,
      thread:
        current.thread === baseline.thread ? loaded.thread : current.thread,
      // A snapshot can trail accepted events even when no event arrives
      // during this load.
      messages:
        reconciliation &&
        (preserveLiveMessages || messagesChanged || hasMessageIdRemap)
          ? reconciliation.messages
          : loaded.messages.length > 0 || current.messages.length === 0
            ? loaded.messages
            : current.messages,
      queuedMessages:
        current.queuedMessages === baseline.queuedMessages &&
        !snapshotIncludes("queuedMessages")
          ? current.queuedMessages
          : this.mergeQueuedMessages(
              baseline.queuedMessages,
              loaded.queuedMessages,
              live.queuedMessages,
            ),
      runs,
      activeRunIds,
      events: reconciliation
        ? this.mergeEvents(loaded.events, live.events)
        : current.events === baseline.events && !snapshotIncludes("events")
          ? live.events
          : current.events === baseline.events
            ? loaded.events
            : this.mergeEvents(loaded.events, live.events),
      agents: mergeRecordProjection(
        loaded.agents,
        baseline.agents,
        live.agents,
        "agents",
      ),
      agentInteractions: mergeListProjection(
        loaded.agentInteractions,
        baseline.agentInteractions,
        live.agentInteractions,
        "interactions",
      ),
      activities: mergeRecordProjection(
        loaded.activities,
        baseline.activities,
        live.activities,
        "activities",
      ),
      tasks: mergeRecordProjection(
        loaded.tasks,
        baseline.tasks,
        live.tasks,
        "tasks",
      ),
      taskGroups: mergeRecordProjection(
        loaded.taskGroups,
        baseline.taskGroups,
        live.taskGroups,
        "taskGroups",
      ),
      tools: mergeRecordProjection(
        loaded.tools,
        baseline.tools,
        live.tools,
        "toolCalls",
      ),
      approvals: mergeRecordProjection(
        loaded.approvals,
        baseline.approvals,
        live.approvals,
        "approvals",
      ),
      approvalRunIds: mergeRecordProjection(
        loaded.approvalRunIds,
        baseline.approvalRunIds,
        live.approvalRunIds,
        "approvals",
      ),
      connectionRequests: mergeRecordProjection(
        loaded.connectionRequests,
        baseline.connectionRequests,
        live.connectionRequests,
        "connectionRequests",
      ),
      connectionRequestRunIds: mergeRecordProjection(
        loaded.connectionRequestRunIds,
        baseline.connectionRequestRunIds,
        live.connectionRequestRunIds,
        "connectionRequests",
      ),
      artifacts: mergeListProjection(
        loaded.artifacts,
        baseline.artifacts,
        live.artifacts,
        "artifacts",
      ),
      widgets: mergeRecordProjection(
        loaded.widgets,
        baseline.widgets,
        live.widgets,
        "widgets",
      ),
      widgetMessageIds: mergeRecordProjection(
        loaded.widgetMessageIds,
        baseline.widgetMessageIds,
        live.widgetMessageIds,
        "widgets",
      ),
      annotations: mergeRecordProjection(
        loaded.annotations,
        baseline.annotations,
        live.annotations,
        "annotations",
      ),
      annotationMessageIds: mergeRecordProjection(
        loaded.annotationMessageIds,
        baseline.annotationMessageIds,
        live.annotationMessageIds,
        "annotations",
      ),
      suggestions: snapshotIncludesRuntimeProjection("suggestions")
        ? current.suggestions === baseline.suggestions
          ? loaded.suggestions
          : live.suggestions
        : current.suggestions,
      suggestionsPendingTurn: current.suggestionsPendingTurn,
      suggestionsUserMessageId:
        snapshotIncludesRuntimeProjection("suggestions") &&
        current.suggestions === baseline.suggestions
          ? loaded.suggestionsUserMessageId
          : live.suggestionsUserMessageId,
      actions: mergeRecordProjection(
        loaded.actions,
        baseline.actions,
        live.actions,
        "events",
      ),
      uploads: mergeRecordProjection(
        loaded.uploads,
        baseline.uploads,
        live.uploads,
        "events",
      ),
    };
  }

  private hasLiveMessageProjection(
    thread: AgentThreadState,
    loaded: AgentThreadState,
  ): boolean {
    if (thread.activeRunIds.length > 0) return true;
    const loadedMessages = new Map(
      loaded.messages.map((message) => [message.id, message]),
    );
    return thread.events.some((event) => {
      if (event.type !== "message.completed") return false;
      const currentMessage = thread.messages.find(
        (message) => message.id === event.message.id,
      );
      const loadedMessage = loadedMessages.get(event.message.id);
      return (
        currentMessage !== undefined &&
        (loadedMessage === undefined ||
          currentMessage.status !== loadedMessage.status ||
          this.messageContentKey(currentMessage) !==
            this.messageContentKey(loadedMessage))
      );
    });
  }

  private mergeRuns(
    first: AgentThreadState["runs"],
    second: AgentThreadState["runs"],
  ): AgentThreadState["runs"] {
    const merged = { ...first };
    for (const [runId, run] of Object.entries(second)) {
      merged[runId] = this.mergeRunState(merged[runId], run);
    }
    return merged;
  }

  private mergeRunState(
    current: AgentRunState | undefined,
    incoming: AgentRunState,
  ): AgentRunState {
    if (!current) return incoming;
    const currentIsTerminal = this.isTerminalStatus(current.status);
    const incomingIsTerminal = this.isTerminalStatus(incoming.status);
    const preferred =
      currentIsTerminal !== incomingIsTerminal
        ? incomingIsTerminal
          ? incoming
          : current
        : incoming.lastSequence >= current.lastSequence
          ? incoming
          : current;
    const lastSequence = Math.max(current.lastSequence, incoming.lastSequence);
    return preferred.lastSequence === lastSequence
      ? preferred
      : { ...preferred, lastSequence };
  }

  private mergeQueuedMessages(
    baseline: AgentQueuedMessage[],
    loaded: AgentQueuedMessage[],
    current: AgentQueuedMessage[],
  ): AgentQueuedMessage[] {
    const currentIds = new Set(current.map((message) => message.id));
    const removedIds = new Set(
      baseline
        .filter((message) => !currentIds.has(message.id))
        .map((message) => message.id),
    );
    return this.mergeItemsById(
      loaded.filter((message) => !removedIds.has(message.id)),
      current,
    );
  }

  private mergeItemsById<T extends { id: string }>(
    first: T[],
    second: T[],
  ): T[] {
    const merged = [...first];
    const indexById = new Map(merged.map((item, index) => [item.id, index]));
    for (const item of second) {
      const index = indexById.get(item.id);
      if (index === undefined) {
        indexById.set(item.id, merged.length);
        merged.push(item);
      } else {
        merged[index] = item;
      }
    }
    return merged;
  }

  private reconcileMessages(
    current: AgentMessage[],
    durable: AgentMessage[],
  ): { messages: AgentMessage[]; idRemap: Map<string, string> } {
    if (durable.length === 0) return { messages: current, idRemap: new Map() };
    const durableIds = new Set(durable.map((message) => message.id));
    const currentIds = new Set(current.map((message) => message.id));
    const unmatchedContent = new Map<string, AgentMessage[]>();
    for (const message of durable) {
      // An explicit durable identity already present in the local projection
      // owns its match. Content fallback is only for still-unidentified work.
      if (currentIds.has(message.id)) continue;
      const key = this.messageContentKey(message);
      unmatchedContent.set(key, [
        ...(unmatchedContent.get(key) ?? []),
        message,
      ]);
    }
    const idRemap = new Map<string, string>();
    let hasMatchedMessage = false;
    const liveMessages = current.map((message) => {
      if (durableIds.has(message.id)) {
        hasMatchedMessage = true;
        return message;
      }
      const key = this.messageContentKey(message);
      const matches = unmatchedContent.get(key);
      const durableMatch = matches?.shift();
      if (durableMatch) {
        hasMatchedMessage = true;
        idRemap.set(message.id, durableMatch.id);
        return durableMatch;
      }
      return message;
    });

    if (!hasMatchedMessage) {
      return { messages: [...durable, ...current], idRemap };
    }

    const presentIds = new Set(liveMessages.map((message) => message.id));
    const messages = [...liveMessages];
    for (let durableIndex = 0; durableIndex < durable.length; durableIndex++) {
      const message = durable[durableIndex];
      if (presentIds.has(message.id)) continue;
      let insertBefore = -1;
      for (
        let nextIndex = durableIndex + 1;
        nextIndex < durable.length;
        nextIndex++
      ) {
        const nextId = durable[nextIndex]?.id;
        if (!nextId) continue;
        const candidateIndex = messages.findIndex(
          (currentMessage) => currentMessage.id === nextId,
        );
        if (candidateIndex >= 0) {
          insertBefore = candidateIndex;
          break;
        }
      }
      if (insertBefore >= 0) {
        messages.splice(insertBefore, 0, message);
      } else {
        let previousDurableIndex = -1;
        for (
          let previousIndex = durableIndex - 1;
          previousIndex >= 0;
          previousIndex -= 1
        ) {
          const previousId = durable[previousIndex]?.id;
          if (!previousId) continue;
          const candidateIndex = messages.findIndex(
            (currentMessage) => currentMessage.id === previousId,
          );
          if (candidateIndex >= 0) {
            previousDurableIndex = candidateIndex;
            break;
          }
        }
        if (previousDurableIndex >= 0) {
          messages.splice(previousDurableIndex + 1, 0, message);
        } else {
          messages.unshift(message);
        }
      }
      presentIds.add(message.id);
    }
    return { messages, idRemap };
  }

  private remapThreadMessageReferences(
    thread: AgentThreadState,
    idRemap: Map<string, string>,
  ): AgentThreadState {
    if (idRemap.size === 0) return thread;
    const remap = (messageId: string | undefined) =>
      messageId ? (idRemap.get(messageId) ?? messageId) : undefined;
    const events = thread.events.map((event): AgentEvent => {
      switch (event.type) {
        case "message.created":
        case "message.completed":
          return {
            ...event,
            message: {
              ...event.message,
              id: remap(event.message.id)!,
            },
          };
        case "message.delta":
        case "reasoning.delta":
          return { ...event, messageId: remap(event.messageId)! };
        case "tool.started":
        case "tool.updated":
          return {
            ...event,
            toolCall: {
              ...event.toolCall,
              ...(event.toolCall.messageId
                ? { messageId: remap(event.toolCall.messageId) }
                : {}),
            },
          };
        case "widget.created":
        case "widget.updated":
        case "annotation.created":
        case "annotation.updated":
          return event.messageId
            ? { ...event, messageId: remap(event.messageId) }
            : event;
        case "action.started":
          return event.invocation.messageId
            ? {
                ...event,
                invocation: {
                  ...event.invocation,
                  messageId: remap(event.invocation.messageId),
                },
              }
            : event;
        default:
          return event;
      }
    });
    const remapRecord = (record: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(record).map(([id, messageId]) => [
          id,
          remap(messageId)!,
        ]),
      );
    return {
      ...thread,
      suggestionsUserMessageId: remap(thread.suggestionsUserMessageId),
      events,
      tools: Object.fromEntries(
        Object.entries(thread.tools).map(([id, tool]) => [
          id,
          tool.messageId ? { ...tool, messageId: remap(tool.messageId) } : tool,
        ]),
      ),
      widgetMessageIds: remapRecord(thread.widgetMessageIds),
      annotationMessageIds: remapRecord(thread.annotationMessageIds),
      actions: Object.fromEntries(
        Object.entries(thread.actions).map(([id, action]) => [
          id,
          action.invocation?.messageId
            ? {
                ...action,
                invocation: {
                  ...action.invocation,
                  messageId: remap(action.invocation.messageId),
                },
              }
            : action,
        ]),
      ),
    };
  }

  private messageContentKey(message: AgentMessage): string {
    const text = message.parts
      .filter(
        (
          part,
        ): part is Extract<AgentMessage["parts"][number], { type: "text" }> =>
          part.type === "text",
      )
      .map((part) => part.text)
      .join("");
    return text
      ? JSON.stringify([message.role, "text", text])
      : JSON.stringify([message.role, "parts", message.parts]);
  }

  private mergeEvents(first: AgentEvent[], second: AgentEvent[]): AgentEvent[] {
    const merged = [...first];
    const indexByKey = new Map(
      first.map((event, index) => [
        `${event.threadId}\u0000${event.runId}\u0000${event.sequence}`,
        index,
      ]),
    );
    for (const event of second) {
      const key = `${event.threadId}\u0000${event.runId}\u0000${event.sequence}`;
      const existingIndex = indexByKey.get(key);
      if (existingIndex === undefined) {
        indexByKey.set(key, merged.length);
        merged.push(event);
      } else {
        // The second projection is the live stream. It may contain richer
        // payloads than a snapshot captured before that event was persisted.
        merged[existingIndex] = event;
      }
    }

    // Sequences are scoped to a run, so there is no valid global numeric sort.
    // Keep cross-run interleaving stable while repairing each run's local
    // order in the slots it already occupies.
    const positionsByRun = new Map<string, number[]>();
    merged.forEach((event, index) => {
      const positions = positionsByRun.get(event.runId) ?? [];
      positions.push(index);
      positionsByRun.set(event.runId, positions);
    });
    for (const positions of positionsByRun.values()) {
      const events = positions.map((index) => merged[index]);
      events.sort((left, right) => left.sequence - right.sequence);
      positions.forEach((index, position) => {
        merged[index] = events[position];
      });
    }
    return merged;
  }

  private releaseThreadLease(threadId: ThreadId): void {
    const count = this.threadLeaseCounts.get(threadId) ?? 0;
    if (count <= 1) {
      this.threadLeaseCounts.delete(threadId);
      if (!this.retainActiveRunsOnThreadRelease) {
        this.stopThreadConsumers(threadId, "released");
      }
      return;
    }
    this.threadLeaseCounts.set(threadId, count - 1);
  }

  private stopThreadConsumers(
    threadId: ThreadId,
    reason: "released" | "deleted",
  ): void {
    for (const [key, controller] of this.consumerAbortControllers) {
      if (key.startsWith(`${threadId}\u0000`)) {
        controller.abort(new AgentKitConsumerStoppedError(reason));
      }
    }
  }

  private stopConsumer(
    threadId: ThreadId,
    runId: RunId,
    reason: "cancelled",
  ): void {
    this.consumerAbortControllers
      .get(this.runKey(threadId, runId))
      ?.abort(new AgentKitConsumerStoppedError(reason));
  }

  private clearSubmittedUserMessages(threadId: ThreadId, runId?: RunId): void {
    const prefix = `${threadId}\u0000`;
    for (const key of this.submittedUserMessages.keys()) {
      if (
        runId ? key === this.runKey(threadId, runId) : key.startsWith(prefix)
      ) {
        this.submittedUserMessages.delete(key);
      }
    }
  }

  private markRunCancelled(threadId: ThreadId, runId: RunId): void {
    this.clearSubmittedUserMessages(threadId, runId);
    const thread = this.getThread(threadId);
    const run = thread.runs[runId] ?? this.runState(runId);
    const activeRunIds = thread.activeRunIds.filter((id) => id !== runId);
    const completedAt = this.now();
    this.setThread(
      threadId,
      settleRunProjection(
        {
          ...thread,
          runs: {
            ...thread.runs,
            [runId]: {
              ...run,
              status: "cancelled",
              completedAt,
            },
          },
          activeRunIds,
        },
        runId,
        "cancelled",
        completedAt,
        run.activeMessageId,
      ),
    );
    this.scheduleQueuePromotionIfIdle(threadId);
  }

  private markRunFailed(
    threadId: ThreadId,
    runId: RunId,
    error: AgentError,
  ): void {
    this.clearSubmittedUserMessages(threadId, runId);
    const thread = this.getThread(threadId);
    const run = thread.runs[runId] ?? this.runState(runId);
    const completedAt = this.now();
    this.setThread(
      threadId,
      settleRunProjection(
        {
          ...thread,
          runs: {
            ...thread.runs,
            [runId]: {
              ...run,
              status: "failed",
              completedAt,
              error,
            },
          },
          activeRunIds: thread.activeRunIds.filter((id) => id !== runId),
        },
        runId,
        "failed",
        completedAt,
        run.activeMessageId,
      ),
    );
    this.scheduleQueuePromotionIfIdle(threadId);
  }

  private markRunStarted(threadId: ThreadId, runId: RunId): void {
    const thread = this.getThread(threadId);
    const run = thread.runs[runId] ?? this.runState(runId);
    const activeRunIds = Array.from(new Set([...thread.activeRunIds, runId]));
    this.setThread(threadId, {
      ...thread,
      runs: {
        ...thread.runs,
        [runId]: { ...run, status: "running" },
      },
      activeRunIds,
      suggestions: [],
      suggestionsPendingTurn: false,
    });
  }

  private retireInterruptedRun(threadId: ThreadId, runId: RunId): void {
    this.submittedUserMessages.delete(this.runKey(threadId, runId));
    const thread = this.getThread(threadId);
    const run = thread.runs[runId];
    this.setThread(threadId, {
      ...thread,
      runs:
        run && !this.isTerminalStatus(run.status)
          ? {
              ...thread.runs,
              [runId]: {
                ...run,
                status: "completed",
                completedAt: run.completedAt ?? this.now(),
              },
            }
          : thread.runs,
      activeRunIds: thread.activeRunIds.filter((id) => id !== runId),
    });
  }

  private runKey(threadId: ThreadId, runId: RunId): string {
    return `${threadId}\u0000${runId}`;
  }

  private runState(runId: RunId, run?: AgentRunSnapshot | null) {
    return {
      id: runId,
      status: run?.status ?? ("running" as const),
      lastSequence: run?.lastSequence ?? 0,
      startedAt: run?.startedAt,
      completedAt: run?.completedAt,
      usage: run?.usage,
      error: run?.error,
      activeMessageId: run?.activeMessageId,
    };
  }

  private runSnapshot(threadId: ThreadId, runId: RunId): AgentRunSnapshot {
    return {
      id: runId,
      threadId,
      status: "running",
      lastSequence: 0,
    };
  }

  private isTerminalStatus(
    status: AgentRunSnapshot["status"],
  ): status is "completed" | "failed" | "cancelled" {
    return ["completed", "failed", "cancelled"].includes(status);
  }

  private scheduleQueuePromotion(threadId: ThreadId, expedite = false): void {
    if (this.disposed) return;
    const thread = this.getThread(threadId);
    const queued = thread.queuedMessages[0];
    if (!queued) {
      const timer = this.queuePromotionTimers.get(threadId);
      if (timer) clearTimeout(timer);
      this.queuePromotionTimers.delete(threadId);
      this.queuePromotionRetryAttempts.delete(threadId);
      this.queuePromotionTerminalExpedites.delete(threadId);
      return;
    }
    const retryTimer = this.queuePromotionTimers.get(threadId);
    if (retryTimer) {
      if (!expedite) return;
      clearTimeout(retryTimer);
      this.queuePromotionTimers.delete(threadId);
    }
    if (this.queuePromotions.has(threadId)) {
      if (expedite) this.queuePromotionTerminalExpedites.add(threadId);
      return;
    }
    if (!this.transport.steerQueuedMessage) {
      this.reportIntegrity({
        code: "queue_promotion_dropped",
        threadId,
        reason: "transport-cannot-steer",
      });
      return;
    }
    this.queuePromotions.add(threadId);
    let retryAfterBusy = false;
    void this.steerQueuedMessage(threadId, queued.id)
      .catch((error) => {
        if (isAgentKitRunSlotBusyError(error) && !this.disposed) {
          if (!this.getThread(threadId).queuedMessages.length) {
            return;
          }
          retryAfterBusy = true;
          const attempts =
            (this.queuePromotionRetryAttempts.get(threadId) ?? 0) + 1;
          this.queuePromotionRetryAttempts.set(threadId, attempts);
          const delay = Math.min(500 * 2 ** (attempts - 1), 5_000);
          const activeRunId = errorProperty(error, "activeRunId");
          if (typeof activeRunId === "string") {
            this.markRunStarted(threadId, activeRunId);
            void this.resubscribeRun(threadId, activeRunId).catch(() => {
              // A short promotion retry remains active if the run cannot resume.
            });
          }
          const timer = setTimeout(() => {
            this.queuePromotionTimers.delete(threadId);
            this.scheduleQueuePromotion(threadId);
          }, delay);
          this.queuePromotionTimers.set(threadId, timer);
          return;
        }
        // `steerQueuedMessage` already restores state and reports the failure.
      })
      .finally(() => {
        this.queuePromotions.delete(threadId);
        const terminalExpedite =
          this.queuePromotionTerminalExpedites.delete(threadId);
        if (
          !retryAfterBusy ||
          this.getThread(threadId).queuedMessages[0]?.id !== queued.id
        ) {
          this.queuePromotionRetryAttempts.delete(threadId);
        }
        if (
          this.queuePromotionAfterReconciliation.delete(threadId) &&
          !this.disposed
        ) {
          this.scheduleQueuePromotionIfIdle(threadId);
        }
        if (terminalExpedite && retryAfterBusy && !this.disposed) {
          this.scheduleQueuePromotion(threadId, true);
        }
      });
  }

  private scheduleQueuePromotionIfIdle(threadId: ThreadId): void {
    const thread = this.getThread(threadId);
    if (thread.queuedMessages.length > 0 && !hasActiveAgentRuns(thread)) {
      this.scheduleQueuePromotion(threadId);
    }
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new AgentKitDisposedError();
    }
  }

  private applyEvent(event: AgentEvent): void {
    const thread = this.reconcileSubmittedUserMessage(
      this.getThread(event.threadId),
      event,
    );
    const admission = classifyAgentEvent(thread, event);
    if (admission.status === "duplicate") {
      this.reportIntegrity({
        code: "duplicate_event",
        threadId: event.threadId,
        runId: event.runId,
        expectedSequence: admission.lastSequence + 1,
        receivedSequence: event.sequence,
      });
    }
    if (admission.status === "gap") {
      this.reportIntegrity({
        code: "sequence_gap",
        threadId: event.threadId,
        runId: event.runId,
        expectedSequence: admission.expectedSequence,
        receivedSequence: admission.receivedSequence,
      });
    }
    const next = reduceAgentEvent(thread, event);
    if (event.type === "queue.updated") {
      // A replayed queue snapshot is the ordered server view. It supersedes
      // the temporary protection used while a queue mutation catches up.
      this.queuedMessageOverrides.delete(event.threadId);
    }
    this.setThread(event.threadId, next);
  }

  private reconcileSubmittedUserMessage(
    thread: AgentThreadState,
    event: AgentEvent,
  ): AgentThreadState {
    if (
      (event.type !== "message.created" &&
        event.type !== "message.completed") ||
      event.message.role !== "user"
    ) {
      return thread;
    }
    const runKey = this.runKey(event.threadId, event.runId);
    const submittedMessageId = this.submittedUserMessages.get(runKey);
    if (!submittedMessageId) return thread;
    const submittedMessage = thread.messages.find(
      (message) => message.id === submittedMessageId,
    );
    if (
      submittedMessage?.role !== "user" ||
      this.messageContentKey(submittedMessage) !==
        this.messageContentKey(event.message)
    ) {
      return thread;
    }

    const idRemap = new Map([[submittedMessage.id, event.message.id]]);
    const remapped = this.remapThreadMessageReferences(thread, idRemap);
    const localCustom = metadataRecord(submittedMessage.metadata?.custom);
    const confirmedCustom = metadataRecord(event.message.metadata?.custom);
    const hasCustomMetadata =
      localCustom !== undefined || confirmedCustom !== undefined;
    const mergedMetadata = {
      ...submittedMessage.metadata,
      ...event.message.metadata,
      ...(hasCustomMetadata
        ? { custom: { ...localCustom, ...confirmedCustom } }
        : {}),
    };
    const metadata =
      Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined;
    const confirmedMessage: AgentMessage = {
      ...submittedMessage,
      ...event.message,
      id: event.message.id,
      parts: submittedMessage.parts,
      metadata,
    };
    this.submittedUserMessages.set(runKey, event.message.id);
    return {
      ...remapped,
      messages: remapped.messages.map((message) =>
        message.id === event.message.id || message.id === submittedMessage.id
          ? confirmedMessage
          : message,
      ),
    };
  }

  private setThread(threadId: ThreadId, thread: AgentThreadState): void {
    this.patch({
      threads: { ...this.snapshot.threads, [threadId]: thread },
      error: undefined,
    });
  }

  private setConnection(connection: AgentKitSnapshot["connection"]): void {
    if (this.snapshot.connection !== connection) this.patch({ connection });
  }

  private fail(error: unknown, code: string): void {
    const agentError = toError(error, code);
    this.patch({ connection: "error", error: agentError });
    this.onError?.(agentError);
  }

  private report(error: unknown, code: string): void {
    this.onError?.(toError(error, code));
  }

  private reportIntegrity(report: AgentStreamIntegrityReport): void {
    try {
      this.onIntegrityReport?.(report);
      // coercion-ok: a counter must never affect the stream it counts.
    } catch {}
  }

  private patch(patch: Partial<AgentKitSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      revision: this.snapshot.revision + 1,
    };
    for (const listener of this.listeners) listener();
  }
}
