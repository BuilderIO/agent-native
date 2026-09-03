import type {
  AgentActionInvocation,
  AgentActionResult,
  AgentApprovalResponse,
  AgentConnectionResponse,
  AgentCapabilitiesDiscovery,
  AgentCapabilityDescriptor,
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
} from "@agent-native/agentkit-protocol";
import {
  AgentProtocolValidationError,
  AgentKitProtocolError,
  createRequestAbortedError,
  createAgentKitProtocolVersionOffer,
  parseAgentEvent,
} from "@agent-native/agentkit-protocol";

import {
  createAgentThreadState,
  reduceAgentEvent,
  type AgentKitSnapshot,
  type AgentThreadState,
} from "./state.js";

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
}

export interface AgentRunHandle {
  runId: RunId;
  completed: Promise<void>;
  cancel(): Promise<void>;
}

export interface AgentThreadLease {
  readonly threadId: ThreadId;
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
  /** @deprecated Use `resubscribeRun`; this operation does not retry a run. */
  resumeRun(threadId: ThreadId, runId: RunId): Promise<void>;
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
  ): Promise<AgentRunHandle | void>;
  removeQueuedMessage(
    threadId: ThreadId,
    messageId: string,
    context?: AgentRequestContext,
  ): Promise<void>;
  submitFeedback(
    threadId: ThreadId,
    messageId: string,
    value: "positive" | "negative" | "dismissed",
    options?: Pick<SubmitFeedbackInput, "reason" | "metadata">,
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
  private readonly upload: AgentKitUploadDriver;
  private readonly ownsTransport: boolean;
  private readonly retainActiveRunsOnThreadRelease: boolean;
  private readonly listeners = new Set<AgentKitListener>();
  private readonly consumers = new Map<string, Promise<void>>();
  private readonly consumerAbortControllers = new Map<
    string,
    AbortController
  >();
  private readonly threadLoads = new Map<ThreadId, Promise<AgentThreadState>>();
  private readonly threadLeaseCounts = new Map<ThreadId, number>();
  private readonly queuePromotions = new Set<ThreadId>();
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
    this.upload = options.upload ?? defaultUploadDriver;
    this.snapshot = {
      connection: "idle",
      capabilities: options.transport.capabilities ?? {},
      capabilitiesStatus:
        options.transport.discoverCapabilities ||
        options.transport.getCapabilities
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
      await this.loadThread(threadId, context);
      this.assertActive();
      return {
        threadId,
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
    const load = this.loadThreadProjection(threadId, requestContext);
    this.threadLoads.set(threadId, load);
    try {
      return await load;
    } finally {
      if (this.threadLoads.get(threadId) === load) {
        this.threadLoads.delete(threadId);
      }
    }
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
      const missingRunIds = (snapshot?.activeRunIds ?? []).filter(
        (runId) => !runSnapshots.has(runId),
      );
      const getRun = this.transport.getRun;
      const activeRuns = missingRunIds.length
        ? await Promise.all(
            missingRunIds.map(async (runId) =>
              getRun
                ? await this.invokeRequest(requestContext, (context) =>
                    getRun({ threadId, runId }, context),
                  )
                : undefined,
            ),
          )
        : [];
      this.assertActive();
      missingRunIds.forEach((runId, index) => {
        const run = activeRuns[index];
        runSnapshots.set(runId, run ?? this.runSnapshot(threadId, runId));
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
      if (snapshot) {
        thread = this.hydrateThread(snapshot, hydratedRuns, activeRunIds);
      } else if (getThreadSnapshot) {
        // A null durable snapshot is an authoritative missing thread, which is
        // also the expected initial state for a client-generated new-chat id.
        // Only transports without snapshot support need the legacy split reads.
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
        thread = {
          ...createAgentThreadState(threadId),
          thread: loadedThread === null ? undefined : loadedThread,
          queuedMessages,
        };
      }
      if (preserveRuntimeProjection) {
        const reconciliation = this.reconcileMessages(
          baseline.messages,
          thread.messages,
        );
        const runtimeProjection = this.remapThreadMessageReferences(
          baseline,
          reconciliation.idRemap,
        );
        const authoritative = {
          thread: thread.thread,
          messages: reconciliation.messages,
          // Queue mutations are already optimistic and independently durable.
          // A completed-run snapshot can lag the accepted steer/remove write,
          // so it must not resurrect work the client has already promoted.
          queuedMessages: baseline.queuedMessages,
        };
        thread = {
          ...this.mergeLoadedThread(
            createAgentThreadState(threadId),
            runtimeProjection,
            thread,
          ),
          ...authoritative,
        };
      }
      const current = this.getThread(threadId);
      if (current !== baseline) {
        thread = this.mergeLoadedThread(baseline, current, thread);
      }
      this.setThread(threadId, thread);
      this.setConnection("connected");
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
    const message: AgentMessage = {
      id: this.createId("message"),
      role: "user",
      createdAt: this.now(),
      status: "complete",
      parts: [{ type: "text", text: input.text }, ...(input.attachments ?? [])],
      metadata: input.metadata,
    };
    const current = this.getThread(input.threadId);
    this.setThread(input.threadId, {
      ...current,
      messages: [...current.messages, message],
      suggestions: [],
    });
    this.setConnection("connecting");

    try {
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
      const completed = this.consume(input.threadId, result.runId);
      this.consumers.set(this.runKey(input.threadId, result.runId), completed);
      return {
        runId: result.runId,
        completed,
        cancel: () => this.cancelRun(input.threadId, result.runId),
      };
    } catch (error) {
      if (this.disposed) throw error;
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
    const status = this.getThread(threadId).runs[runId]?.status;
    if (status && this.isTerminalStatus(status)) return Promise.resolve();
    const key = this.runKey(threadId, runId);
    const existing = this.consumers.get(key);
    if (existing) return existing;
    const consumer = this.consume(threadId, runId);
    this.consumers.set(key, consumer);
    return consumer;
  }

  /** @deprecated Use `resubscribeRun`; this operation does not retry a run. */
  public resumeRun(threadId: ThreadId, runId: RunId): Promise<void> {
    return this.resubscribeRun(threadId, runId);
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
    const resolveApproval = this.transport.resolveApproval;
    if (!resolveApproval) {
      throw new AgentKitCapabilityError("approvals");
    }
    await this.invokeRequest(requestContext, (context) =>
      resolveApproval(input, context),
    );
    this.assertActive();
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
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("messageQueue", requestContext);
    if (input.attachments?.length) {
      await this.requireCapability("attachments", requestContext);
    }
    const queueMessage = this.transport.queueMessage;
    if (!queueMessage) {
      throw new AgentKitCapabilityError("messageQueue");
    }
    const result = await this.invokeRequest(requestContext, (context) =>
      queueMessage(
        {
          threadId: input.threadId,
          text: input.text,
          attachments: input.attachments,
          metadata: input.metadata,
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
    return result.message;
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
    const previous = this.getThread(threadId);
    const removedIndex = previous.queuedMessages.findIndex(
      (message) => message.id === messageId,
    );
    const removed = previous.queuedMessages[removedIndex];
    this.setThread(threadId, {
      ...previous,
      queuedMessages: previous.queuedMessages.filter(
        (message) => message.id !== messageId,
      ),
    });
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
        }
      }
      throw error;
    }
  }

  public async steerQueuedMessage(
    threadId: ThreadId,
    messageId: string,
    context?: AgentRequestContext,
  ): Promise<AgentRunHandle | void> {
    this.assertActive();
    const requestContext = this.createRequestContext(context);
    await this.requireCapability("messageQueue", requestContext);
    const steerQueuedMessage = this.transport.steerQueuedMessage;
    if (!steerQueuedMessage) {
      throw new AgentKitCapabilityError("messageQueue");
    }
    const previous = this.getThread(threadId);
    const queued = previous.queuedMessages.find(
      (message) => message.id === messageId,
    );
    if (!queued) throw new Error(`Unknown queued message: ${messageId}`);
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
    const previousConnection = this.snapshot.connection;
    const previousError = this.snapshot.error;
    this.setThread(threadId, {
      ...previous,
      messages: [...previous.messages, message],
      queuedMessages: previous.queuedMessages.filter(
        (candidate) => candidate.id !== messageId,
      ),
      suggestions: [],
    });
    this.setConnection("connecting");
    try {
      const result = await this.invokeRequest(requestContext, (context) =>
        steerQueuedMessage({ threadId, messageId }, context),
      );
      this.assertActive();
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
      const completed = this.consume(threadId, result.runId);
      this.consumers.set(this.runKey(threadId, result.runId), completed);
      return {
        runId: result.runId,
        completed,
        cancel: () => this.cancelRun(threadId, result.runId),
      };
    } catch (error) {
      if (this.disposed) throw error;
      const current = this.getThread(threadId);
      const queuedMessages = current.queuedMessages.some(
        (candidate) => candidate.id === queued.id,
      )
        ? current.queuedMessages
        : [queued, ...current.queuedMessages];
      this.setThread(threadId, {
        ...current,
        messages: current.messages.filter(
          (candidate) => candidate.id !== message.id,
        ),
        queuedMessages,
      });
      this.patch({ connection: previousConnection, error: previousError });
      this.report(error, "queue_steer_failed");
      throw error;
    }
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
    options?: Pick<SubmitFeedbackInput, "reason" | "metadata">,
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
    const threads = { ...this.snapshot.threads };
    delete threads[threadId];
    this.patch({ threads });
  }

  public shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.disposed = true;
    this.requestAbortController.abort(new AgentKitDisposedError());
    for (const controller of this.consumerAbortControllers.values()) {
      controller.abort(new AgentKitConsumerStoppedError("disposed"));
    }
    this.consumerAbortControllers.clear();
    this.threadLeaseCounts.clear();
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

  private async consume(threadId: ThreadId, runId: RunId): Promise<void> {
    const key = this.runKey(threadId, runId);
    const abortController = new AbortController();
    this.consumerAbortControllers.set(key, abortController);
    let attempt = 0;
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
              event.type === "run.completed" ||
              event.type === "run.failed" ||
              event.type === "run.cancelled"
            ) {
              terminalEvent = event;
            }
          }
          if (!terminalEvent) {
            throw new Error(
              `AgentKit run ${runId} ended without a terminal event.`,
            );
          }
          this.setConnection("connected");
          if (terminalEvent.type === "run.completed") {
            if (
              !this.threadLoads.has(threadId) &&
              (this.transport.getThreadSnapshot || this.transport.getThread)
            ) {
              await this.loadThreadProjection(
                threadId,
                this.createRequestContext(),
                true,
              );
            }
            this.scheduleQueuePromotion(threadId);
          }
          return;
        } catch (error) {
          if (
            abortController.signal.reason instanceof
            AgentKitConsumerStoppedError
          ) {
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
      this.fail(error, "run_stream_failed");
      throw error;
    } finally {
      this.consumers.delete(key);
      this.consumerAbortControllers.delete(key);
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
          discovery.legacy ?? this.projectCapabilities(discovery);
        this.patch({
          capabilities,
          capabilityDiscovery: discovery,
          capabilitiesStatus: "ready",
        });
        return capabilities;
      }
      const getCapabilities = this.transport.getCapabilities;
      const capabilities = getCapabilities
        ? await this.invokeRequest(loadContext, (requestContext) =>
            getCapabilities(requestContext),
          )
        : (this.transport.capabilities ?? {});
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
    const mergedRuns = this.mergeRuns(hydrated.runs, runs);
    const currentActiveRunIds = activeRunIds.filter(
      (runId) => !this.isTerminalStatus(mergedRuns[runId]?.status ?? "running"),
    );
    return {
      ...hydrated,
      thread: snapshot,
      // The snapshot projection is authoritative. The event log rebuilds all
      // rich, non-message state without replaying text deltas twice.
      messages: snapshot.messages,
      queuedMessages: snapshot.queuedMessages ?? hydrated.queuedMessages,
      runs: mergedRuns,
      activeRunIds: currentActiveRunIds,
      activeRunId: currentActiveRunIds.at(-1),
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
      approvals: { ...hydrated.approvals, ...snapshotApprovals },
      approvalRunIds: {
        ...hydrated.approvalRunIds,
        ...snapshotApprovalRunIds,
      },
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
      agents: {
        ...hydrated.agents,
        ...Object.fromEntries(
          (snapshot.agents ?? []).map((agent) => [agent.id, agent]),
        ),
      },
      agentInteractions: snapshot.interactions ?? hydrated.agentInteractions,
      artifacts: snapshot.artifacts ?? hydrated.artifacts,
      suggestions: snapshot.suggestions ?? hydrated.suggestions,
    };
  }

  private projectCapabilities(
    discovery: AgentCapabilitiesDiscovery,
  ): AgentCapabilities {
    const projected: Record<string, unknown> = {
      protocolVersion:
        discovery.protocol.status === "compatible"
          ? discovery.protocol.selectedVersion
          : undefined,
    };
    for (const capability of discovery.capabilities) {
      if (capability.id === "reasoning") continue;
      if (capability.state === "available" || capability.state === "degraded") {
        projected[capability.id] = true;
      } else if (capability.state === "unsupported") {
        projected[capability.id] = false;
      }
    }
    return projected as AgentCapabilities;
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
  ): AgentThreadState {
    const runs =
      current.runs === baseline.runs
        ? loaded.runs
        : this.mergeRuns(loaded.runs, current.runs);
    const activeRunIds = Array.from(
      new Set([...loaded.activeRunIds, ...current.activeRunIds]),
    ).filter(
      (runId) => !this.isTerminalStatus(runs[runId]?.status ?? "running"),
    );
    return {
      ...loaded,
      thread:
        current.thread === baseline.thread ? loaded.thread : current.thread,
      messages:
        current.messages === baseline.messages
          ? loaded.messages
          : this.mergeItemsById(loaded.messages, current.messages),
      queuedMessages:
        current.queuedMessages === baseline.queuedMessages
          ? loaded.queuedMessages
          : this.mergeQueuedMessages(
              baseline.queuedMessages,
              loaded.queuedMessages,
              current.queuedMessages,
            ),
      runs,
      activeRunIds,
      activeRunId: activeRunIds.at(-1),
      events:
        current.events === baseline.events
          ? loaded.events
          : this.mergeEvents(loaded.events, current.events),
      agents:
        current.agents === baseline.agents
          ? loaded.agents
          : { ...loaded.agents, ...current.agents },
      agentInteractions:
        current.agentInteractions === baseline.agentInteractions
          ? loaded.agentInteractions
          : this.mergeItemsById(
              loaded.agentInteractions,
              current.agentInteractions,
            ),
      activities:
        current.activities === baseline.activities
          ? loaded.activities
          : { ...loaded.activities, ...current.activities },
      tasks:
        current.tasks === baseline.tasks
          ? loaded.tasks
          : { ...loaded.tasks, ...current.tasks },
      tools:
        current.tools === baseline.tools
          ? loaded.tools
          : { ...loaded.tools, ...current.tools },
      approvals:
        current.approvals === baseline.approvals
          ? loaded.approvals
          : current.approvals,
      approvalRunIds:
        current.approvalRunIds === baseline.approvalRunIds
          ? loaded.approvalRunIds
          : current.approvalRunIds,
      connectionRequests:
        current.connectionRequests === baseline.connectionRequests
          ? loaded.connectionRequests
          : { ...loaded.connectionRequests, ...current.connectionRequests },
      connectionRequestRunIds:
        current.connectionRequestRunIds === baseline.connectionRequestRunIds
          ? loaded.connectionRequestRunIds
          : {
              ...loaded.connectionRequestRunIds,
              ...current.connectionRequestRunIds,
            },
      artifacts:
        current.artifacts === baseline.artifacts
          ? loaded.artifacts
          : this.mergeItemsById(loaded.artifacts, current.artifacts),
      widgets:
        current.widgets === baseline.widgets
          ? loaded.widgets
          : { ...loaded.widgets, ...current.widgets },
      widgetMessageIds:
        current.widgetMessageIds === baseline.widgetMessageIds
          ? loaded.widgetMessageIds
          : { ...loaded.widgetMessageIds, ...current.widgetMessageIds },
      annotations:
        current.annotations === baseline.annotations
          ? loaded.annotations
          : { ...loaded.annotations, ...current.annotations },
      annotationMessageIds:
        current.annotationMessageIds === baseline.annotationMessageIds
          ? loaded.annotationMessageIds
          : {
              ...loaded.annotationMessageIds,
              ...current.annotationMessageIds,
            },
      suggestions:
        current.suggestions === baseline.suggestions
          ? loaded.suggestions
          : current.suggestions,
      actions:
        current.actions === baseline.actions
          ? loaded.actions
          : { ...loaded.actions, ...current.actions },
      uploads:
        current.uploads === baseline.uploads
          ? loaded.uploads
          : { ...loaded.uploads, ...current.uploads },
    };
  }

  private mergeRuns(
    first: AgentThreadState["runs"],
    second: AgentThreadState["runs"],
  ): AgentThreadState["runs"] {
    const merged = { ...first };
    for (const [runId, run] of Object.entries(second)) {
      const existing = merged[runId];
      if (!existing || run.lastSequence >= existing.lastSequence) {
        merged[runId] = run;
      }
    }
    return merged;
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
    if (durable.length === 0) {
      return { messages: current, idRemap: new Map() };
    }
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
    const optimistic: AgentMessage[] = [];
    const idRemap = new Map<string, string>();
    for (const message of current) {
      if (durableIds.has(message.id)) continue;
      const key = this.messageContentKey(message);
      const matches = unmatchedContent.get(key);
      const durableMatch = matches?.shift();
      if (durableMatch) {
        idRemap.set(message.id, durableMatch.id);
      } else {
        optimistic.push(message);
      }
    }
    return { messages: [...durable, ...optimistic], idRemap };
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
    const keys = new Set(
      first.map(
        (event) =>
          `${event.threadId}\u0000${event.runId}\u0000${event.sequence}`,
      ),
    );
    for (const event of second) {
      const key = `${event.threadId}\u0000${event.runId}\u0000${event.sequence}`;
      if (!keys.has(key)) {
        keys.add(key);
        merged.push(event);
      }
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

  private markRunCancelled(threadId: ThreadId, runId: RunId): void {
    const thread = this.getThread(threadId);
    const run = thread.runs[runId] ?? this.runState(runId);
    const activeRunIds = thread.activeRunIds.filter((id) => id !== runId);
    this.setThread(threadId, {
      ...thread,
      runs: {
        ...thread.runs,
        [runId]: {
          ...run,
          status: "cancelled",
          completedAt: this.now(),
        },
      },
      activeRunIds,
      activeRunId: activeRunIds.at(-1),
    });
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
      activeRunId: runId,
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

  private isTerminalStatus(status: AgentRunSnapshot["status"]): boolean {
    return ["completed", "failed", "cancelled"].includes(status);
  }

  private scheduleQueuePromotion(threadId: ThreadId): void {
    const thread = this.getThread(threadId);
    if (
      this.queuePromotions.has(threadId) ||
      !this.transport.steerQueuedMessage ||
      thread.activeRunIds.length > 0
    ) {
      return;
    }
    const queued = thread.queuedMessages[0];
    if (!queued) return;
    this.queuePromotions.add(threadId);
    void this.steerQueuedMessage(threadId, queued.id)
      .catch(() => {
        // `steerQueuedMessage` already restores state and reports the failure.
      })
      .finally(() => this.queuePromotions.delete(threadId));
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new AgentKitDisposedError();
    }
  }

  private applyEvent(event: AgentEvent): void {
    this.setThread(
      event.threadId,
      reduceAgentEvent(this.getThread(event.threadId), event),
    );
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

  private patch(patch: Partial<AgentKitSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      revision: this.snapshot.revision + 1,
    };
    for (const listener of this.listeners) listener();
  }
}
