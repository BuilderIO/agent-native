import {
  hasActiveAgentRuns,
  type AgentKitController,
  type AgentThreadState,
} from "@agent-native/agentkit/client";
import type {
  AgentMessage,
  AgentMessagePart,
  ThreadId,
} from "@agent-native/agentkit/protocol";

/** Message metadata key that ties a sent message to its optimistic copy. */
export const AGENTKIT_CLIENT_REQUEST_ID_METADATA_KEY = "clientRequestId";

export type AgentKitPendingSubmissionFile = Extract<
  AgentMessagePart,
  { type: "file" }
>;

export interface AgentKitPendingSubmissionDraft {
  text: string;
  attachments?: readonly AgentKitPendingSubmissionFile[] | undefined;
  references?: readonly unknown[] | undefined;
  /** The send's own message metadata, so message slots render it alike. */
  metadata?: Record<string, unknown> | undefined;
}

export interface AgentKitPendingSubmission {
  /** Client request id; send it as message metadata so the copy can retire. */
  readonly id: string;
  /** Retires the copy. Safe to call more than once. */
  end(): void;
}

interface PendingEntry {
  threadId: ThreadId;
  message: AgentMessage;
  release?: (() => void) | undefined;
  adoptable: boolean;
  /** The copy's send reached the controller, past any preflight. */
  accepted: boolean;
  /** The send has its run (or failed), or the copy retired. */
  done: boolean;
  settled: Promise<void>;
  settle: () => void;
}

const NO_PENDING_MESSAGES: readonly AgentMessage[] = [];
const RESOLVED = Promise.resolve();
function noop() {}
let fallbackRequestCount = 0;

function createClientRequestId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `client-request-${crypto.randomUUID()}`;
  }
  fallbackRequestCount += 1;
  return `client-request-${Date.now().toString(36)}-${fallbackRequestCount}`;
}

export function agentKitClientRequestId(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  const value = metadata?.[AGENTKIT_CLIENT_REQUEST_ID_METADATA_KEY];
  return typeof value === "string" && value ? value : undefined;
}

export class AgentKitPendingSubmissionStore {
  private readonly entries = new Map<string, PendingEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly threadMessages = new Map<
    ThreadId,
    readonly AgentMessage[]
  >();

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public messages(threadId: ThreadId): readonly AgentMessage[] {
    return this.threadMessages.get(threadId) ?? NO_PENDING_MESSAGES;
  }

  public has(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * A send on this thread reached the controller but its run is not
   * registered yet. The turn has started: Stop and queueing apply, even with
   * no run id to act on.
   */
  public starting(threadId: ThreadId): boolean {
    return this.ahead({ threadId }).some((entry) => entry.accepted);
  }

  /**
   * Some earlier send on the thread has no run yet. From the moment its draft
   * is taken, before any preflight, the turn is that send's, and what follows
   * queues behind it.
   */
  public holdsTurn(threadId: ThreadId, ownId?: string): boolean {
    return this.ahead({ threadId, ownId }).length > 0;
  }

  /**
   * Settles once the sends ahead have their runs (or failed). `ownId` counts
   * only sends begun before that copy. A send still in its owner's preflight
   * may be waiting on this very send, so only `queued` sends, which never come
   * from inside another send's preflight, wait for those too.
   */
  public settled(
    threadId: ThreadId,
    options: { ownId?: string | undefined; queued?: boolean } = {},
  ): Promise<void> {
    const pending = this.ahead({ threadId, ...options }).map(
      (entry) => entry.settled,
    );
    return pending.length ? Promise.all(pending).then(noop) : RESOLVED;
  }

  /** Whether `settled` with the same options would wait. */
  public hasAhead(
    threadId: ThreadId,
    options: { ownId?: string | undefined; queued?: boolean } = {},
  ): boolean {
    return this.ahead({ threadId, ...options }).length > 0;
  }

  private ahead(options: {
    threadId: ThreadId;
    ownId?: string | undefined;
    queued?: boolean;
  }): PendingEntry[] {
    const ahead: PendingEntry[] = [];
    for (const [id, entry] of this.entries) {
      // Entries keep the order they began in.
      if (id === options.ownId) break;
      if (
        entry.threadId === options.threadId &&
        !entry.done &&
        (entry.accepted || options.queued !== false)
      )
        ahead.push(entry);
    }
    return ahead;
  }

  /**
   * Ties a send to its copy. The client registers the run before the send
   * resolves, so `settled` waiters see it as active.
   */
  public track<T>(id: string, send: Promise<T>): Promise<T> {
    const entry = this.entries.get(id);
    if (!entry) return send;
    entry.adoptable = false;
    entry.accepted = true;
    send.then(entry.settle, entry.settle);
    this.notify();
    return send;
  }

  /**
   * Hands a composer's copy to the first visible send on its thread that
   * carries no client request id, so a host that never forwards the id still
   * stamps the message the copy is waiting for.
   */
  public adopt(threadId: ThreadId): string | undefined {
    for (const [id, entry] of this.entries) {
      if (entry.threadId !== threadId || !entry.adoptable) continue;
      entry.adoptable = false;
      return id;
    }
    return undefined;
  }

  public begin(
    threadId: ThreadId,
    draft: AgentKitPendingSubmissionDraft,
    options: { id?: string; release?: () => void; adoptable?: boolean } = {},
  ): AgentKitPendingSubmission {
    const id = options.id ?? createClientRequestId();
    const parts: AgentMessagePart[] = [
      ...(draft.text.trim()
        ? [{ type: "text" as const, text: draft.text }]
        : []),
      ...(draft.attachments ?? []),
    ];
    const replaced = this.entries.get(id);
    replaced?.settle();
    replaced?.release?.();
    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const settle = () => {
      const entry = this.entries.get(id);
      if (entry?.settled === settled && !entry.done) {
        entry.done = true;
        this.notify();
      }
      resolveSettled();
    };
    this.entries.set(id, {
      threadId,
      release: options.release,
      adoptable: options.adoptable === true,
      accepted: false,
      done: false,
      settled,
      settle,
      message: {
        id: `pending-submission:${id}`,
        role: "user",
        status: "complete",
        createdAt: new Date().toISOString(),
        parts,
        metadata: {
          ...draft.metadata,
          ...(draft.references?.length
            ? { references: [...draft.references] }
            : {}),
          pendingSubmission: true,
          [AGENTKIT_CLIENT_REQUEST_ID_METADATA_KEY]: id,
        },
      },
    });
    this.publish(threadId);
    let ended = false;
    return {
      id,
      end: () => {
        if (ended) return;
        ended = true;
        const entry = this.entries.get(id);
        if (entry) entry.adoptable = false;
        // Thread snapshots reach React a macrotask after the client emits
        // them, so retiring the copy any sooner leaves a frame with neither.
        setTimeout(() => this.remove(id), 0);
      },
    };
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    entry.settle();
    entry.release?.();
    this.publish(entry.threadId);
  }

  private publish(threadId: ThreadId): void {
    const messages = [...this.entries.values()]
      .filter((entry) => entry.threadId === threadId)
      .map((entry) => entry.message);
    if (messages.length) this.threadMessages.set(threadId, messages);
    else this.threadMessages.delete(threadId);
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

const stores = new WeakMap<
  AgentKitController,
  AgentKitPendingSubmissionStore
>();

/** Shared by every composer and transcript that talks to this controller. */
export function agentKitPendingSubmissions(
  controller: AgentKitController,
): AgentKitPendingSubmissionStore {
  let store = stores.get(controller);
  if (!store) {
    store = new AgentKitPendingSubmissionStore();
    stores.set(controller, store);
  }
  return store;
}

/** A turn runs from the moment its draft is taken, not once it has a run id. */
export function agentKitTurnInProgress(
  controller: AgentKitController,
  threadId: ThreadId,
  ownId?: string,
): boolean {
  return (
    hasActiveAgentRuns(controller.getThread(threadId)) ||
    agentKitPendingSubmissions(controller).holdsTurn(threadId, ownId)
  );
}

/** Drops copies whose sent message, matched by client request id, has landed. */
export function visiblePendingSubmissions(
  pending: readonly AgentMessage[],
  thread: Pick<AgentThreadState, "messages" | "queuedMessages">,
): readonly AgentMessage[] {
  if (!pending.length) return NO_PENDING_MESSAGES;
  const arrived = new Set<string>();
  for (const message of thread.messages) {
    const id = agentKitClientRequestId(message.metadata);
    if (id) arrived.add(id);
  }
  for (const message of thread.queuedMessages) {
    const id = agentKitClientRequestId(message.metadata);
    if (id) arrived.add(id);
  }
  if (!arrived.size) return pending;
  const visible = pending.filter((message) => {
    const id = agentKitClientRequestId(message.metadata);
    return !id || !arrived.has(id);
  });
  return visible.length === pending.length
    ? pending
    : visible.length
      ? visible
      : NO_PENDING_MESSAGES;
}

/** Pending copies render as user messages; image previews use object URLs. */
export function pendingSubmissionFiles(
  files: readonly { name: string; contentType?: string; file?: Blob }[],
): { attachments: AgentKitPendingSubmissionFile[]; release: () => void } {
  const urls: string[] = [];
  const attachments = files.map((file): AgentKitPendingSubmissionFile => {
    const mediaType = file.contentType || file.file?.type || undefined;
    const url =
      file.file &&
      mediaType?.startsWith("image/") &&
      typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file.file)
        : undefined;
    if (url) urls.push(url);
    return {
      type: "file",
      name: file.name,
      ...(mediaType ? { mediaType } : {}),
      ...(url ? { url } : {}),
    };
  });
  return {
    attachments,
    release: () => {
      for (const url of urls) URL.revokeObjectURL(url);
    },
  };
}
