import type { ActionCaller, ActionRunContext } from "./action.js";

export const ACTION_RECEIPT_SCHEMA_VERSION = "1" as const;
export const DOMAIN_EVENT_SPEC_VERSION = "1.0" as const;
export const DOMAIN_EVENT_CONTENT_TYPE = "application/json" as const;

export type ActionJsonPrimitive = string | number | boolean | null;
export type ActionJsonValue =
  | ActionJsonPrimitive
  | ActionJsonValue[]
  | { [key: string]: ActionJsonValue };

/** A CloudEvents 1.0-compatible event owned by the action that changed data. */
export interface ActionDomainEvent<
  TData extends ActionJsonValue = ActionJsonValue,
> {
  specversion: typeof DOMAIN_EVENT_SPEC_VERSION;
  id: string;
  source: string;
  type: string;
  time: string;
  subject?: string;
  datacontenttype: typeof DOMAIN_EVENT_CONTENT_TYPE;
  data: TData;
}

export interface ActionDomainEventDraft<
  TData extends ActionJsonValue = ActionJsonValue,
> {
  type: string;
  data: TData;
  source?: string;
  subject?: string;
  id?: string;
  time?: string;
}

export interface ActionDomainEventReference {
  id: string;
  source: string;
  type: string;
  time: string;
  subject?: string;
}

export interface ActionReceiptProvenance {
  caller: ActionCaller;
  appId?: string;
  orgId?: string;
  runId?: string;
  threadId?: string;
  turnId?: string;
  toolCallId?: string;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
}

/**
 * Proof that an action mutation and its staged domain events committed together.
 * A failed or rolled-back transaction throws and must never produce this shape.
 */
export interface ActionReceipt<
  TResult extends ActionJsonValue = ActionJsonValue,
> {
  schemaVersion: typeof ACTION_RECEIPT_SCHEMA_VERSION;
  receiptId: string;
  action: string;
  status: "committed";
  committedAt: string;
  provenance: ActionReceiptProvenance;
  result: TResult;
  events: ActionDomainEventReference[];
}

export interface ActionAtomicAdapter<TTransaction> {
  transaction<T>(
    operation: (transaction: TTransaction) => Promise<T>,
  ): Promise<T>;
  /** Stage the receipt and events durably using this transaction. Do not publish here. */
  stageActionOutcome(
    transaction: TTransaction,
    outcome: ActionAtomicOutcome,
  ): Promise<void>;
}

export interface ActionAtomicOutcome<
  TResult extends ActionJsonValue = ActionJsonValue,
> {
  receipt: ActionReceipt<TResult>;
  events: readonly ActionDomainEvent[];
}

export interface ActionAtomicContext<
  TTransaction,
  TEventData extends ActionJsonValue = ActionJsonValue,
> {
  transaction: TTransaction;
  emit(event: ActionDomainEventDraft<TEventData>): void;
}

export interface CommitActionOptions<
  TTransaction,
  TResult extends ActionJsonValue,
  TEventData extends ActionJsonValue = ActionJsonValue,
> {
  adapter: ActionAtomicAdapter<TTransaction>;
  action: string;
  source: string;
  context?: ActionRunContext;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
  now?: () => Date;
  idFactory?: () => string;
  mutate(
    context: ActionAtomicContext<TTransaction, TEventData>,
  ): Promise<TResult> | TResult;
}

export class ActionReceiptValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "ActionReceiptValidationError";
  }
}

/**
 * Execute one mutation and stage all emitted events in the same transaction.
 * The committed receipt is returned only after the adapter confirms commit.
 */
export async function commitAction<
  TTransaction,
  TResult extends ActionJsonValue,
  TEventData extends ActionJsonValue = ActionJsonValue,
>(
  options: CommitActionOptions<TTransaction, TResult, TEventData>,
): Promise<ActionReceipt<TResult>> {
  assertNonEmpty(options.action, "action");
  assertAbsoluteUri(options.source, "source");
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? defaultIdFactory;

  return options.adapter.transaction(async (transaction) => {
    const events: ActionDomainEvent<TEventData>[] = [];
    const eventIds = new Set<string>();
    const emit = (draft: ActionDomainEventDraft<TEventData>) => {
      const event = createActionDomainEvent(draft, {
        source: options.source,
        now,
        idFactory,
      });
      if (eventIds.has(event.id)) {
        throw new ActionReceiptValidationError(
          `Duplicate domain event id: ${event.id}`,
        );
      }
      eventIds.add(event.id);
      events.push(event);
    };
    const result = await options.mutate({ transaction, emit });
    assertJsonValue(result, "result");
    const receipt: ActionReceipt<TResult> = {
      schemaVersion: ACTION_RECEIPT_SCHEMA_VERSION,
      receiptId: checkedId(idFactory(), "receiptId"),
      action: options.action,
      status: "committed",
      committedAt: toTimestamp(now(), "committedAt"),
      provenance: provenanceFrom(options),
      result,
      events: events.map(toEventReference),
    };
    assertActionReceipt(receipt);
    await options.adapter.stageActionOutcome(transaction, { receipt, events });
    return receipt;
  });
}

export function createActionDomainEvent<TData extends ActionJsonValue>(
  draft: ActionDomainEventDraft<TData>,
  options: {
    source: string;
    now?: () => Date;
    idFactory?: () => string;
  },
): ActionDomainEvent<TData> {
  const source = draft.source ?? options.source;
  assertAbsoluteUri(source, "event.source");
  assertNonEmpty(draft.type, "event.type");
  assertJsonValue(draft.data, "event.data");
  if (draft.subject !== undefined)
    assertNonEmpty(draft.subject, "event.subject");
  const event: ActionDomainEvent<TData> = {
    specversion: DOMAIN_EVENT_SPEC_VERSION,
    id: checkedId(
      draft.id ?? (options.idFactory ?? defaultIdFactory)(),
      "event.id",
    ),
    source,
    type: draft.type,
    time:
      draft.time ??
      toTimestamp((options.now ?? (() => new Date()))(), "event.time"),
    ...(draft.subject === undefined ? {} : { subject: draft.subject }),
    datacontenttype: DOMAIN_EVENT_CONTENT_TYPE,
    data: cloneJson(draft.data) as TData,
  };
  assertActionDomainEvent(event);
  return event;
}

export function assertActionDomainEvent(
  value: unknown,
): asserts value is ActionDomainEvent {
  const record = strictRecord(
    value,
    "domain event",
    [
      "specversion",
      "id",
      "source",
      "type",
      "time",
      "subject",
      "datacontenttype",
      "data",
    ],
  );
  if (record.specversion !== DOMAIN_EVENT_SPEC_VERSION)
    invalid("domain event specversion");
  checkedId(record.id, "event.id");
  assertAbsoluteUri(record.source, "event.source");
  assertNonEmpty(record.type, "event.type");
  assertTimestamp(record.time, "event.time");
  if (record.subject !== undefined)
    assertNonEmpty(record.subject, "event.subject");
  if (record.datacontenttype !== DOMAIN_EVENT_CONTENT_TYPE)
    invalid("domain event datacontenttype");
  assertJsonValue(record.data, "event.data");
  assertOwnFields(record, "domain event", [
    "specversion",
    "id",
    "source",
    "type",
    "time",
    "datacontenttype",
    "data",
  ]);
}

export function assertActionReceipt(
  value: unknown,
): asserts value is ActionReceipt {
  const record = strictRecord(
    value,
    "action receipt",
    [
      "schemaVersion",
      "receiptId",
      "action",
      "status",
      "committedAt",
      "provenance",
      "result",
      "events",
    ],
  );
  if (record.schemaVersion !== ACTION_RECEIPT_SCHEMA_VERSION)
    invalid("receipt schemaVersion");
  checkedId(record.receiptId, "receiptId");
  assertNonEmpty(record.action, "action");
  if (record.status !== "committed") invalid("receipt status");
  assertTimestamp(record.committedAt, "committedAt");
  assertProvenance(record.provenance);
  assertJsonValue(record.result, "result");
  if (!Array.isArray(record.events)) invalid("receipt events");
  for (const event of record.events) assertEventReference(event);
  assertOwnFields(record, "action receipt", [
    "schemaVersion",
    "receiptId",
    "action",
    "status",
    "committedAt",
    "provenance",
    "result",
    "events",
  ]);
}

export function serializeActionReceipt(receipt: ActionReceipt): string {
  assertActionReceipt(receipt);
  return JSON.stringify(sortJson(receipt as unknown as ActionJsonValue));
}

export function parseActionReceipt(serialized: string): ActionReceipt {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new ActionReceiptValidationError("Invalid action receipt JSON");
  }
  assertActionReceipt(value);
  return value;
}

export function serializeActionDomainEvent(event: ActionDomainEvent): string {
  assertActionDomainEvent(event);
  return JSON.stringify(sortJson(event as unknown as ActionJsonValue));
}

export function parseActionDomainEvent(serialized: string): ActionDomainEvent {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new ActionReceiptValidationError("Invalid domain event JSON");
  }
  assertActionDomainEvent(value);
  return value;
}

function provenanceFrom(options: {
  context?: ActionRunContext;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
}): ActionReceiptProvenance {
  const context = options.context;
  const provenance: ActionReceiptProvenance = {
    caller: context?.caller ?? "cli",
  };
  copyString(provenance, "appId", context?.appId);
  copyString(provenance, "orgId", context?.orgId ?? undefined);
  copyString(provenance, "runId", context?.runId);
  copyString(provenance, "threadId", context?.threadId);
  copyString(provenance, "turnId", context?.turnId);
  copyString(provenance, "toolCallId", context?.toolCallId);
  copyString(provenance, "correlationId", options.correlationId);
  copyString(provenance, "causationId", options.causationId);
  copyString(provenance, "idempotencyKey", options.idempotencyKey);
  return provenance;
}

function assertProvenance(
  value: unknown,
): asserts value is ActionReceiptProvenance {
  const record = strictRecord(
    value,
    "receipt provenance",
    [
      "caller",
      "appId",
      "orgId",
      "runId",
      "threadId",
      "turnId",
      "toolCallId",
      "correlationId",
      "causationId",
      "idempotencyKey",
    ],
  );
  const callers: readonly ActionCaller[] = [
    "tool",
    "http",
    "frontend",
    "cli",
    "mcp",
    "webmcp",
    "a2a",
    "automation",
  ];
  if (!callers.includes(record.caller as ActionCaller))
    invalid("provenance caller");
  for (const key of Object.keys(record)) {
    if (key !== "caller") assertNonEmpty(record[key], `provenance ${key}`);
  }
  assertOwnFields(record, "receipt provenance", ["caller"]);
}

function assertEventReference(
  value: unknown,
): asserts value is ActionDomainEventReference {
  const record = strictRecord(
    value,
    "event reference",
    ["id", "source", "type", "time", "subject"],
  );
  checkedId(record.id, "event reference id");
  assertAbsoluteUri(record.source, "event reference source");
  assertNonEmpty(record.type, "event reference type");
  assertTimestamp(record.time, "event reference time");
  if (record.subject !== undefined)
    assertNonEmpty(record.subject, "event reference subject");
  assertOwnFields(record, "event reference", ["id", "source", "type", "time"]);
}

function toEventReference(
  event: ActionDomainEvent,
): ActionDomainEventReference {
  return {
    id: event.id,
    source: event.source,
    type: event.type,
    time: event.time,
    ...(event.subject === undefined ? {} : { subject: event.subject }),
  };
}

function assertJsonValue(
  value: unknown,
  label: string,
  seen = new Set<object>(),
): asserts value is ActionJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    invalid(label);
  }
  if (typeof value !== "object") invalid(label);
  if (seen.has(value)) invalid(`${label} (cyclic)`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) invalid(`${label}[${index}]`);
      assertJsonValue(value[index], `${label}[${index}]`, seen);
    }
  } else {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      invalid(label);
    for (const [key, item] of Object.entries(value))
      assertJsonValue(item, `${label}.${key}`, seen);
  }
  seen.delete(value);
}

function sortJson(value: ActionJsonValue): ActionJsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    ) as ActionJsonValue;
  }
  return value;
}

function cloneJson(value: ActionJsonValue): ActionJsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJson(item)]),
    );
  }
  return value;
}

function strictRecord(
  value: unknown,
  label: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(label);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(label);
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record).find((key) => !allowed.includes(key));
  if (extra)
    throw new ActionReceiptValidationError(
      `Invalid ${label}: unexpected ${extra}`,
    );
  return record;
}

function assertOwnFields(
  record: Record<string, unknown>,
  label: string,
  required: readonly string[],
): void {
  const missing = required.find((key) => !Object.hasOwn(record, key));
  if (missing)
    throw new ActionReceiptValidationError(
      `Invalid ${label}: missing ${missing}`,
    );
}

function assertNonEmpty(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) invalid(label);
}

function checkedId(value: unknown, label: string): string {
  assertNonEmpty(value, label);
  if (value.length > 255) invalid(label);
  return value;
}

function assertAbsoluteUri(
  value: unknown,
  label: string,
): asserts value is string {
  assertNonEmpty(value, label);
  try {
    new URL(value);
  } catch {
    invalid(label);
  }
}

function assertTimestamp(
  value: unknown,
  label: string,
): asserts value is string {
  assertNonEmpty(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
    value,
  );
  if (!match) invalid(label);
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute =
    offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 60 ||
    offsetHour > 23 ||
    offsetMinute > 59
  )
    invalid(label);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function toTimestamp(value: Date, label: string): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) invalid(label);
  return value.toISOString();
}

function copyString<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: unknown,
): void {
  if (value === undefined) return;
  assertNonEmpty(value, `provenance ${String(key)}`);
  target[key] = value as T[K];
}

function defaultIdFactory(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new ActionReceiptValidationError(
      "crypto.randomUUID is required; provide idFactory in this runtime",
    );
  }
  return globalThis.crypto.randomUUID();
}

function invalid(label: string): never {
  throw new ActionReceiptValidationError(`Invalid ${label}`);
}
