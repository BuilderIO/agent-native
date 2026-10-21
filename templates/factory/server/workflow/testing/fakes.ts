import type {
  AiFailureCode,
  AiItemOutcome,
  AiTurnItem,
  AiTurnRequest,
  AiTurnResult,
  AiTurnRunner,
  Clock,
  IdSource,
  InboxReader,
  InboxRequest,
  InboxResult,
  ItemUpsertResult,
  ItemWriter,
  OperationExecutor,
  OperationRequest,
  OperationResult,
  RequeuedRequest,
  SideEffect,
  ThreadReader,
  ThreadReply,
  ThreadReplyRequest,
  ThreadReplyResult,
} from "../adapter.js";
import type { ThreadRef, WorkflowErrorCode } from "../contract.js";
import { MAX_ROW_EXTRAS_BYTES, jsonByteLength } from "../items.js";
import type { NormalizedItem } from "../items.js";

/** A clock a test moves by hand. `sleep` moves it for you and keeps the waits it was asked for. */
export class FakeClock implements Clock {
  private current: number;
  readonly sleeps: number[] = [];

  constructor(start: Date | string = "2026-10-19T12:00:00.000Z") {
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current += ms;
  }

  set(instant: Date | string): void {
    this.current = new Date(instant).getTime();
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.current += ms;
  }
}

/** `lease-1`, `lease-2`, ...: the same sequence on every run. */
export function createIdSource(): IdSource {
  const counts = new Map<string, number>();
  return {
    next(kind) {
      const next = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, next);
      return `${kind}-${next}`;
    },
  };
}

export type ScriptedOperation =
  | OperationResult
  | ((request: OperationRequest) => OperationResult | Promise<OperationResult>);

export const ok = (
  output: unknown,
  extra: Partial<Extract<OperationResult, { ok: true }>> = {},
): OperationResult => ({ ok: true, output, ...extra });

export const failure = (
  code: WorkflowErrorCode,
  options: {
    message?: string;
    retryable?: boolean;
    sideEffect?: SideEffect;
  } = {},
): OperationResult => ({
  ok: false,
  code,
  message: options.message ?? `${code} from the fake`,
  retryable: options.retryable ?? false,
  sideEffect: options.sideEffect ?? "none",
});

/**
 * Answers operations from a script and records every call. An operation with
 * no script, or whose script is used up, throws, so a call a test did not
 * expect fails the test instead of getting an invented answer.
 */
export class FakeOperationExecutor implements OperationExecutor {
  readonly calls: OperationRequest[] = [];
  private readonly queues = new Map<string, ScriptedOperation[]>();
  private readonly constants = new Map<string, ScriptedOperation>();

  /** Answers the next calls to `operationId`, one result each, in order. */
  script(operationId: string, ...results: ScriptedOperation[]): this {
    this.queues.set(operationId, [
      ...(this.queues.get(operationId) ?? []),
      ...results,
    ]);
    return this;
  }

  /** Answers every call to `operationId` once its queue is empty. */
  always(operationId: string, result: ScriptedOperation): this {
    this.constants.set(operationId, result);
    return this;
  }

  callsTo(operationId: string): OperationRequest[] {
    return this.calls.filter((call) => call.operation.id === operationId);
  }

  async execute(request: OperationRequest): Promise<OperationResult> {
    this.calls.push(request);
    const id = request.operation.id;
    const next = this.queues.get(id)?.shift() ?? this.constants.get(id);
    if (next === undefined) {
      throw new Error(`FakeOperationExecutor has no answer left for ${id}.`);
    }
    return typeof next === "function" ? next(request) : next;
  }
}

export type AiResponder = (request: AiTurnRequest) => AiTurnResult;

const usage = { modelCalls: 1 };

type PerItemAnswer =
  | Record<string, unknown>
  | { fail: AiFailureCode; reason?: string };

function isFailedAnswer(
  answer: PerItemAnswer,
): answer is { fail: AiFailureCode; reason?: string } {
  return typeof answer.fail === "string";
}

/** One answer per item, from a function of the item; return `{ fail }` for an item the model could not answer. */
export const aiPerItem =
  (
    answer: (item: AiTurnItem) => PerItemAnswer,
    extra: {
      threadId?: string;
      inputTruncated?: boolean;
      threadPersistError?: string;
      usageRecordError?: string;
    } = {},
  ): AiResponder =>
  (request) => ({
    ok: true,
    mode: "perItem",
    usage,
    ...extra,
    results: request.items.map((item): AiItemOutcome => {
      const result = answer(item);
      return isFailedAnswer(result)
        ? {
            itemId: item.id,
            ok: false,
            code: result.fail,
            reason: result.reason ?? "failed in the fake",
          }
        : { itemId: item.id, ok: true, fields: result };
    }),
  });

export const aiWholeList =
  (
    fields: Record<string, unknown>,
    extra: {
      threadId?: string;
      threadPersistError?: string;
      usageRecordError?: string;
    } = {},
  ): AiResponder =>
  () => ({ ok: true, mode: "wholeList", usage, fields, ...extra });

export const aiFailed =
  (code: AiFailureCode, reason = "failed in the fake"): AiResponder =>
  () => ({ ok: false, code, reason, usage });

/**
 * Picks the responder whose `when` text is in the request's instruction, so a
 * story can say what each node's model answers without caring in which order
 * the nodes ask. A turn nobody claimed throws: a model call a script did not
 * expect fails the run instead of getting an invented answer.
 */
export const aiRouter =
  (routes: readonly { when: string; respond: AiResponder }[]): AiResponder =>
  (request) => {
    const route = routes.find((entry) =>
      request.instruction.includes(entry.when),
    );
    if (!route) {
      throw new Error(
        `No AI route claims this instruction: ${request.instruction.slice(0, 80)}`,
      );
    }
    return route.respond(request);
  };

/**
 * Answers model turns from a script and records every request. Like a real
 * runner it takes a model call from the run's budget before it answers, and
 * answers `budget` when none is left.
 */
export class FakeAiTurnRunner implements AiTurnRunner {
  readonly requests: AiTurnRequest[] = [];
  private readonly queue: AiResponder[] = [];
  private constant: AiResponder | undefined;

  respond(...responders: AiResponder[]): this {
    this.queue.push(...responders);
    return this;
  }

  always(responder: AiResponder): this {
    this.constant = responder;
    return this;
  }

  async run(request: AiTurnRequest): Promise<AiTurnResult> {
    this.requests.push(request);
    if (!request.budget.takeModelCall()) {
      return {
        ok: false,
        code: "budget",
        reason: "no model calls left",
        usage: { modelCalls: 0 },
      };
    }
    const responder = this.queue.shift() ?? this.constant;
    if (!responder) {
      throw new Error("FakeAiTurnRunner has no answer left for this turn.");
    }
    return responder(request);
  }
}

/** Answers the two inbox sources from a script per source, and records requests. */
export class FakeInbox implements InboxReader {
  readonly requests: InboxRequest[] = [];
  private readonly queues = new Map<string, InboxResult[]>();
  private readonly constants = new Map<string, InboxResult>();

  script(source: "inbox-poll" | "status", ...results: InboxResult[]): this {
    this.queues.set(source, [...(this.queues.get(source) ?? []), ...results]);
    return this;
  }

  always(source: "inbox-poll" | "status", result: InboxResult): this {
    this.constants.set(source, result);
    return this;
  }

  readonly requeuedRequests: RequeuedRequest[] = [];
  private requeuedAnswer:
    | ((request: RequeuedRequest) => InboxResult | Promise<InboxResult>)
    | undefined;

  /** What the rows put back in the queue are: nothing, unless a test says. */
  requeued(
    answer: (request: RequeuedRequest) => InboxResult | Promise<InboxResult>,
  ): this {
    this.requeuedAnswer = answer;
    return this;
  }

  async takeRequeued(request: RequeuedRequest): Promise<InboxResult> {
    this.requeuedRequests.push(request);
    return this.requeuedAnswer
      ? this.requeuedAnswer(request)
      : { ok: true, items: [] };
  }

  async take(request: InboxRequest): Promise<InboxResult> {
    this.requests.push(request);
    const source = request.settings.source;
    const next = this.queues.get(source)?.shift() ?? this.constants.get(source);
    if (next === undefined) {
      throw new Error(`FakeInbox has no answer left for "${source}".`);
    }
    return next;
  }
}

interface RecordedStatus {
  runId: string;
  itemId: string;
  status: string;
  reason?: string;
  extras?: Readonly<Record<string, unknown>>;
}

/** The statuses an inbox row is handled in, which a source does not take again. */
const HANDLED = new Set(["resolved", "dismissed", "needs_manual"]);

/**
 * Records every status written and every item stored, and can be told to
 * refuse the next ones. `requireRows` makes it behave like the inbox: a status
 * for an item nobody stored is refused, which is what an End on an item a
 * source never wrote a row for gets. A row starts `received`, takes the status
 * an End writes, and is reported `terminal` once handled.
 */
export class FakeItemStatusWriter implements ItemWriter {
  readonly written: RecordedStatus[] = [];
  /** What a row of the inbox would hold, by item id. */
  readonly rows = new Map<string, NormalizedItem>();
  /** The status of each row. */
  readonly rowStatus = new Map<string, string>();
  /** What End nodes recorded on each item, with the row's own extras under it when it has a row. */
  readonly recordedExtras = new Map<string, Record<string, unknown>>();
  /** One entry per live `upsertItems` call, in order. */
  readonly upserts: NormalizedItem[][] = [];
  /** One entry per dry `upsertItems` call, which stores nothing. */
  readonly checks: NormalizedItem[][] = [];
  private strict = false;
  private refusals: { message: string; retryable: boolean }[] = [];
  private upsertRefusals: { message: string; retryable: boolean }[] = [];

  refuseNext(message = "the inbox is down", retryable = true): this {
    this.refusals.push({ message, retryable });
    return this;
  }

  refuseNextUpsert(message = "the inbox is down", retryable = true): this {
    this.upsertRefusals.push({ message, retryable });
    return this;
  }

  /** From now on, a status for an item with no row is refused. */
  requireRows(): this {
    this.strict = true;
    return this;
  }

  async setStatus(
    request: Parameters<ItemWriter["setStatus"]>[0],
  ): ReturnType<ItemWriter["setStatus"]> {
    const refusal = this.refusals.shift();
    if (refusal) {
      return { ok: false, code: "provider_error", ...refusal };
    }
    if (this.strict && !this.rows.has(request.itemId)) {
      return {
        ok: false,
        code: "item_invalid",
        message: `item_not_found: Item "${request.itemId}" is not in this factory's inbox.`,
        retryable: false,
      };
    }
    const row = this.rows.get(request.itemId);
    const extras =
      request.extras === undefined
        ? undefined
        : {
            ...row?.extras,
            ...this.recordedExtras.get(request.itemId),
            ...request.extras,
          };
    if (extras !== undefined && jsonByteLength(extras) > MAX_ROW_EXTRAS_BYTES) {
      return {
        ok: false,
        code: "output_over_cap",
        message: `Item "${request.itemId}" would hold ${jsonByteLength(extras)} bytes of extras; the cap is ${MAX_ROW_EXTRAS_BYTES}.`,
        retryable: false,
      };
    }
    this.written.push({
      runId: request.runId,
      itemId: request.itemId,
      status: request.status,
      ...(request.reason === undefined ? {} : { reason: request.reason }),
      ...(request.extras === undefined ? {} : { extras: request.extras }),
    });
    if (extras !== undefined) this.recordedExtras.set(request.itemId, extras);
    if (row) {
      this.rowStatus.set(request.itemId, request.status);
      if (extras !== undefined)
        this.rows.set(request.itemId, { ...row, extras });
    }
    return { ok: true };
  }

  async upsertItems(request: {
    items: readonly NormalizedItem[];
    dryRun?: boolean;
  }): Promise<ItemUpsertResult> {
    const refusal = this.upsertRefusals.shift();
    if (refusal) return { ok: false, code: "provider_error", ...refusal };
    const dry = request.dryRun === true;
    (dry ? this.checks : this.upserts).push([...request.items]);
    let inserted = 0;
    let unchanged = 0;
    const states: Extract<ItemUpsertResult, { ok: true }>["states"][number][] =
      [];
    for (const item of request.items) {
      const known = this.rowStatus.get(item.id);
      if (known === undefined) {
        inserted += 1;
        states.push({ id: item.id, state: "created" });
      } else {
        unchanged += 1;
        states.push({
          id: item.id,
          state: HANDLED.has(known) ? "terminal" : "open",
        });
      }
      if (!dry) {
        this.rows.set(item.id, item);
        if (known === undefined) this.rowStatus.set(item.id, "received");
      }
    }
    return { ok: true, inserted, updated: 0, unchanged, skipped: 0, states };
  }

  /** Puts a row in the inbox in a status, as if an earlier run or a person had left it so. */
  seedRow(item: NormalizedItem, status = "received"): this {
    this.rows.set(item.id, item);
    this.rowStatus.set(item.id, status);
    return this;
  }

  statusOf(itemId: string): string | undefined {
    const mine = this.written.filter((entry) => entry.itemId === itemId);
    return mine[mine.length - 1]?.status;
  }
}

interface FakeThreadMessage {
  id?: string;
  /** When it was posted. */
  at: string;
  author: string;
  text?: string;
  /** A bot's message never answers. */
  bot?: boolean;
  /** A reaction (its name) rather than a message. */
  reaction?: string;
  url?: string;
}

/** The same key the fake files a thread under; a test can name the thread however its provider does. */
function threadKey(thread: ThreadRef): string {
  if (thread.channelId !== undefined && thread.threadTs !== undefined) {
    return `slack:${thread.channelId}:${thread.threadTs}`;
  }
  if (thread.repo !== undefined && thread.number !== undefined) {
    return `github:${thread.repo}#${thread.number}`;
  }
  if (thread.ticketId !== undefined) return `ticket:${thread.ticketId}`;
  throw new Error(
    `A thread needs a channel and ts, a repo and number, or a ticket: ${JSON.stringify(thread)}`,
  );
}

/**
 * Holds the messages of each thread and answers a reply read the way a real
 * host must: humans only, after `since`, from the people the wait accepts. A
 * thread nobody filed is an empty thread, and a read can be made to fail so a
 * test can tell "nobody answered" from "could not read".
 */
export class FakeThreadReader implements ThreadReader {
  readonly requests: ThreadReplyRequest[] = [];
  private readonly threads = new Map<string, FakeThreadMessage[]>();
  private failures: {
    code: WorkflowErrorCode;
    message: string;
    retryable: boolean;
  }[] = [];
  private nextId = 0;
  /** What `acceptFrom: "owner"` means to this fake: these emails. */
  owners: readonly string[] = ["owner@example.test"];

  /** Adds messages to a thread. */
  post(thread: ThreadRef, ...messages: FakeThreadMessage[]): this {
    const key = threadKey(thread);
    this.threads.set(key, [...(this.threads.get(key) ?? []), ...messages]);
    return this;
  }

  /** Fails the next reads. A failing read is retried, so give one per attempt. */
  failNext(
    count = 1,
    failure: {
      code?: WorkflowErrorCode;
      message?: string;
      retryable?: boolean;
    } = {},
  ): this {
    for (let index = 0; index < count; index += 1) {
      this.failures.push({
        code: failure.code ?? "provider_error",
        message: failure.message ?? "Slack is down",
        retryable: failure.retryable ?? false,
      });
    }
    return this;
  }

  async readReplies(request: ThreadReplyRequest): Promise<ThreadReplyResult> {
    this.requests.push(request);
    const failure = this.failures.shift();
    if (failure) return { ok: false, ...failure };
    const since = Date.parse(request.since);
    const accepts = (author: string): boolean => {
      if (request.acceptFrom === "anyone") return true;
      if (request.acceptFrom === "owner") {
        return [...this.owners, request.ownerEmail].includes(author);
      }
      return request.acceptFrom.emails.includes(author);
    };
    const replies: ThreadReply[] = [];
    for (const message of this.threads.get(threadKey(request.thread)) ?? []) {
      if (message.bot || Date.parse(message.at) <= since) continue;
      if (!accepts(message.author)) continue;
      if (
        message.reaction !== undefined &&
        message.reaction !== request.ackReaction
      )
        continue;
      this.nextId += 1;
      replies.push({
        id: message.id ?? `reply-${this.nextId}`,
        at: message.at,
        kind: message.reaction === undefined ? "message" : "reaction",
        author: message.author,
        ...(message.text === undefined ? {} : { text: message.text }),
        ...(message.url === undefined ? {} : { url: message.url }),
      });
    }
    return { ok: true, replies };
  }
}
