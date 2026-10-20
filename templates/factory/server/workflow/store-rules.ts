import { z } from "zod";

import {
  WORKFLOW_STORE_LIMITS,
  WorkflowStoreError,
  type CreateRunRequestInput,
  type CreateWorkflowInput,
  type FinishRunInput,
  type LeaseItemsInput,
  type ParkItemInput,
  type RunCounts,
  type RunError,
  type RunRecord,
  type RunRequest,
  type SaveWorkflowGraphInput,
  type StartRunInput,
  type WorkflowScope,
  type WorkflowVersionSource,
} from "./adapter.js";
import {
  WorkflowError,
  itemEventSchema,
  itemStateSchema,
  receiptSchema,
  runModeSchema,
  runStatusSchema,
  runTriggerKindSchema,
  stepRecordSchema,
  wakeSchema,
  workflowErrorCodeSchema,
  workflowGraphSchema,
  SCHEDULE_STARTER,
  type ItemEvent,
  type ItemState,
  type Receipt,
  type RunMode,
  type RunStatus,
  type RunTriggerKind,
  type StepRecord,
  type Wake,
  type WorkflowGraph,
} from "./contract.js";
import {
  MAX_ITEM_CONTEXT_BYTES,
  MAX_STEP_OUTPUT_BYTES,
  assertWithinStepCap,
  utf8ByteLength,
} from "./items.js";
import { receiptOutputProblem } from "./receipt-fields.js";

/**
 * Rules both `WorkflowStore` implementations apply, so the in-memory store the
 * engine tests run against and the database store production runs on accept,
 * reject, and return the same things. Pure: no database, no clock.
 */

export function invalidRecord(
  message: string,
  details?: Record<string, unknown>,
): WorkflowStoreError {
  return new WorkflowStoreError("invalid_record", message, details);
}

export function alreadyExists(
  workflowId: string,
  automationId: string | null,
): WorkflowStoreError {
  return new WorkflowStoreError(
    "already_exists",
    "A workflow with this id, or for this automation, already exists in this factory.",
    { workflowId, automationId },
  );
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** Validates caller input; a miss is `invalid_record`. */
function parseInput<S extends z.ZodType>(
  schema: S,
  value: unknown,
  label: string,
): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw invalidRecord(
      `${label} is not valid: ${describeIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

/** Reads a value that came out of storage; a miss is `corrupt_record`. */
export function parseStoredValue<S extends z.ZodType>(
  value: unknown,
  schema: S,
  what: string,
): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new WorkflowStoreError(
      "corrupt_record",
      `${what} no longer matches its schema: ${describeIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

/** Reads a stored JSON column; a miss is `corrupt_record`, never an empty value. */
export function parseStoredJson<S extends z.ZodType>(
  raw: unknown,
  schema: S,
  what: string,
): z.output<S> {
  if (typeof raw !== "string") {
    throw new WorkflowStoreError("corrupt_record", `${what} is missing.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new WorkflowStoreError(
      "corrupt_record",
      `${what} is not valid JSON.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  return parseStoredValue(value, schema, what);
}

/**
 * The JSON text a column would hold and the value read back from it, so a
 * caller never keeps a reference into stored state and `undefined` drops out
 * the same way in both stores.
 */
export function toStoredJson<T>(
  value: T,
  label: string,
): { json: string; value: T } {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    throw invalidRecord(`${label} cannot be stored as JSON.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (json === undefined) {
    throw invalidRecord(`${label} has no JSON form.`);
  }
  return { json, value: JSON.parse(json) as T };
}

const instantSchema = z.iso.datetime({ offset: true });

/** An ISO instant as UTC with milliseconds, so text comparison orders time. */
export function normalizeInstant(value: string, label: string): string {
  if (!instantSchema.safeParse(value).success) {
    throw invalidRecord(`${label} is not an ISO date-time.`, { value });
  }
  return new Date(value).toISOString();
}

const idSchema = z.string().min(1).max(200);

const scopeSchema = z.object({ orgId: idSchema, factoryId: idSchema });

/** Every call names the org and factory it acts in; an empty one would match nothing. */
export function assertScope(scope: WorkflowScope): WorkflowScope {
  const parsed = parseInput(scopeSchema, scope, "Scope");
  return { orgId: parsed.orgId, factoryId: parsed.factoryId };
}

export function assertId(value: string, label: string): string {
  return parseInput(idSchema, value, label);
}

const workflowIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "use letters, digits, - and _");

export function resolveLimit(
  limit: number | undefined,
  max: number,
  label: string,
): number {
  if (limit === undefined) return max;
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw invalidRecord(
      `${label} limit must be a whole number from 1 to ${max}.`,
      {
        limit,
        max,
      },
    );
  }
  return limit;
}

export function resolveLeaseTtlMs(ttlMs: number | undefined): number {
  if (ttlMs === undefined) return WORKFLOW_STORE_LIMITS.leaseTtlMs;
  if (
    !Number.isInteger(ttlMs) ||
    ttlMs < 1000 ||
    ttlMs > WORKFLOW_STORE_LIMITS.leaseMaxTtlMs
  ) {
    throw invalidRecord(
      `Lease ttl must be a whole number of milliseconds from 1000 to ${WORKFLOW_STORE_LIMITS.leaseMaxTtlMs}.`,
      { ttlMs },
    );
  }
  return ttlMs;
}

/** Ids in the order given, repeats dropped. */
export function uniqueItemIds(
  itemIds: readonly string[],
  label: string,
): string[] {
  if (itemIds.length === 0) {
    throw invalidRecord(`${label} needs at least one item id.`);
  }
  if (itemIds.length > WORKFLOW_STORE_LIMITS.itemBatchMax) {
    throw invalidRecord(
      `${label} takes at most ${WORKFLOW_STORE_LIMITS.itemBatchMax} items at once; got ${itemIds.length}.`,
      { count: itemIds.length, max: WORKFLOW_STORE_LIMITS.itemBatchMax },
    );
  }
  return [...new Set(itemIds.map((id) => assertId(id, "item id")))];
}

export function prepareGraph(graph: WorkflowGraph): {
  json: string;
  graph: WorkflowGraph;
} {
  const parsed = parseInput(
    workflowGraphSchema,
    toStoredJson(graph, "Graph").value,
    "Graph",
  );
  const stored = toStoredJson(parsed, "Graph");
  const bytes = utf8ByteLength(stored.json);
  if (bytes > WORKFLOW_STORE_LIMITS.graphJsonBytes) {
    throw invalidRecord(
      `Graph is ${bytes} bytes; a saved version is at most ${WORKFLOW_STORE_LIMITS.graphJsonBytes}.`,
      { bytes, maxBytes: WORKFLOW_STORE_LIMITS.graphJsonBytes },
    );
  }
  return { json: stored.json, graph: stored.value };
}

export function readGraph(raw: unknown, what: string): WorkflowGraph {
  return parseStoredJson(raw, workflowGraphSchema, what);
}

function prepareWake(wake: Wake): {
  wake: Wake;
  json: string;
  dueAt: string;
  nextCheckAt: string | null;
} {
  const stored = toStoredJson(
    parseInput(wakeSchema, toStoredJson(wake, "Wake").value, "Wake"),
    "Wake",
  );
  const normalized: Wake = {
    ...stored.value,
    dueAt: normalizeInstant(stored.value.dueAt, "wake.dueAt"),
  };
  if (stored.value.nextCheckAt !== undefined) {
    normalized.nextCheckAt = normalizeInstant(
      stored.value.nextCheckAt,
      "wake.nextCheckAt",
    );
  }
  return {
    wake: normalized,
    json: JSON.stringify(normalized),
    dueAt: normalized.dueAt,
    nextCheckAt: normalized.nextCheckAt ?? null,
  };
}

const contextSchema = z.record(z.string(), z.unknown());

/** Parked context is bounded to 8 KB. Over that is rejected, never cut. */
export function prepareContext(context: Record<string, unknown>): {
  json: string;
  value: Record<string, unknown>;
} {
  const stored = toStoredJson(context, "Parked context");
  const value = parseInput(contextSchema, stored.value, "Parked context");
  const bytes = utf8ByteLength(stored.json);
  if (bytes > MAX_ITEM_CONTEXT_BYTES) {
    throw new WorkflowError(
      "output_over_cap",
      `Parked context is ${bytes} bytes; the cap is ${MAX_ITEM_CONTEXT_BYTES}.`,
      { bytes, maxBytes: MAX_ITEM_CONTEXT_BYTES },
    );
  }
  return { json: stored.json, value };
}

const countersSchema = z.record(
  z.string().min(1).max(200),
  z.number().int().min(0),
);

function prepareCounters(counters: Record<string, number>): {
  json: string;
  value: Record<string, number>;
} {
  const stored = toStoredJson(counters, "Counters");
  const value = parseInput(countersSchema, stored.value, "Counters");
  return { json: JSON.stringify(value), value };
}

export function readCounters(
  raw: unknown,
  what: string,
): Record<string, number> {
  return parseStoredJson(raw, countersSchema, what);
}

export function readContext(
  raw: unknown,
  what: string,
): Record<string, unknown> {
  return parseStoredJson(raw, contextSchema, what);
}

export function readWake(raw: unknown, what: string): Wake {
  return parseStoredJson(raw, wakeSchema, what);
}

export function assertCounterIncrement(counter: string, by: number): void {
  assertId(counter, "counter name");
  if (!Number.isInteger(by) || by < 1 || by > 1000) {
    throw invalidRecord(
      "A counter increment is a whole number from 1 to 1000.",
      {
        by,
      },
    );
  }
}

/** The names of the counters to clear: ids, each once. */
export function assertCounterNames(counters: readonly string[]): string[] {
  const names = [...new Set(counters)];
  if (names.length === 0) {
    throw invalidRecord("Name at least one counter to clear.", {});
  }
  for (const name of names) assertId(name, "counter name");
  return names;
}

const runCountsSchema = z
  .record(z.string().min(1).max(40), z.number().int().min(0))
  .refine(
    (counts) =>
      Object.keys(counts).length <= WORKFLOW_STORE_LIMITS.runCountKeysMax,
    `at most ${WORKFLOW_STORE_LIMITS.runCountKeysMax} named totals`,
  );

function prepareRunCounts(counts: RunCounts | undefined): RunCounts {
  return parseInput(runCountsSchema, counts ?? {}, "Run counts");
}

export function readRunCounts(raw: unknown, what: string): RunCounts {
  return parseStoredJson(raw, runCountsSchema, what);
}

/** A run that did not succeed says why; one that succeeded does not claim to have failed. */
export function assertRunOutcome(
  status: Exclude<RunStatus, "running">,
  error: RunError | undefined,
): void {
  if (status === "succeeded" && error !== undefined) {
    throw invalidRecord("A succeeded run cannot carry an error.", {
      code: error.code,
    });
  }
  if ((status === "failed" || status === "paused") && error === undefined) {
    throw invalidRecord(`A ${status} run needs an error code and message.`);
  }
  if (error !== undefined && error.message.length > 1000) {
    throw invalidRecord("A run error message is at most 1000 characters.");
  }
}

/**
 * Validates, normalizes, and bounds a step. Ids and `fields` over the step
 * caps throw `output_over_cap`; a malformed step is `invalid_record`.
 */
export function prepareStep(step: StepRecord): StepRecord {
  const parsed = parseInput(
    stepRecordSchema,
    toStoredJson(step, "Step").value,
    "Step",
  );
  for (const [port, { count, itemIds }] of Object.entries(parsed.ports)) {
    if (count < itemIds.length) {
      throw invalidRecord(
        `Port "${port}" lists ${itemIds.length} item ids but counts ${count}.`,
        { port, count, listed: itemIds.length },
      );
    }
    assertWithinStepCap(itemIds);
  }
  assertWithinStepCap([parsed.ports], {
    maxItems: 1,
    maxBytes: MAX_STEP_OUTPUT_BYTES,
  });
  if (parsed.fields !== undefined) {
    assertWithinStepCap([parsed.fields], {
      maxItems: 1,
      maxBytes: WORKFLOW_STORE_LIMITS.stepFieldsBytes,
    });
  }
  if (parsed.receiptKeys !== undefined) assertWithinStepCap(parsed.receiptKeys);
  const prepared: StepRecord = {
    ...parsed,
    startedAt: normalizeInstant(parsed.startedAt, "step.startedAt"),
  };
  if (parsed.finishedAt !== undefined) {
    prepared.finishedAt = normalizeInstant(
      parsed.finishedAt,
      "step.finishedAt",
    );
  }
  return toStoredJson(prepared, "Step").value;
}

export function prepareEvent(event: ItemEvent): ItemEvent {
  const parsed = parseInput(
    itemEventSchema,
    toStoredJson(event, "Item event").value,
    "Item event",
  );
  return { ...parsed, at: normalizeInstant(parsed.at, "event.at") };
}

/**
 * A receipt's response is bounded to 2 KB, and keeps only fields that name a
 * thing (`receipt-fields.ts`). Over that, or anything else, is rejected, never
 * cut or kept.
 */
export function prepareReceipt(receipt: Receipt): Receipt {
  const stored = toStoredJson(receipt, "Receipt");
  const parsed = parseInput(receiptSchema, stored.value, "Receipt");
  if (parsed.output !== undefined) {
    const problem = receiptOutputProblem(parsed.output);
    if (problem !== null) {
      throw invalidRecord(
        `Receipt "${parsed.key}" holds a response that is more than identifiers: ${problem}.`,
        { key: parsed.key },
      );
    }
    const bytes = utf8ByteLength(JSON.stringify(parsed.output));
    if (bytes > WORKFLOW_STORE_LIMITS.receiptOutputBytes) {
      throw invalidRecord(
        `Receipt "${parsed.key}" holds ${bytes} bytes of response; a receipt keeps at most ${WORKFLOW_STORE_LIMITS.receiptOutputBytes}.`,
        { bytes, maxBytes: WORKFLOW_STORE_LIMITS.receiptOutputBytes },
      );
    }
  }
  return { ...parsed, at: normalizeInstant(parsed.at, "receipt.at") };
}

/**
 * The only legal moves are none to `started`, and `started` to `done` or
 * `failed`. Returns the failure for any other, or null when the move is legal.
 */
export function receiptTransitionError(
  existing: Pick<Receipt, "status"> | null,
  next: Pick<Receipt, "key" | "status">,
): WorkflowStoreError | null {
  if (next.status === "started") {
    return existing === null
      ? null
      : new WorkflowStoreError(
          "receipt_conflict",
          `Receipt "${next.key}" is already ${existing.status}; a second attempt may be repeating an effect that already ran.`,
          { key: next.key, existingStatus: existing.status },
        );
  }
  if (existing === null) {
    return new WorkflowStoreError(
      "invalid_transition",
      `Receipt "${next.key}" cannot become ${next.status}: it was never started.`,
      { key: next.key, to: next.status },
    );
  }
  if (existing.status !== "started") {
    return new WorkflowStoreError(
      "invalid_transition",
      `Receipt "${next.key}" is already ${existing.status} and cannot become ${next.status}.`,
      { key: next.key, from: existing.status, to: next.status },
    );
  }
  return null;
}

const emailSchema = z.string().min(1).max(320);
const nodeIdSchema = workflowIdSchema;

export function assertEmail(value: string, label: string): string {
  return parseInput(emailSchema, value, label);
}
const versionSchema = z.number().int().min(1);

const versionSourceSchema = z.enum(["save", "agent", "restore", "template"]);

const createWorkflowSchema = z.object({
  id: workflowIdSchema.optional(),
  automationId: idSchema.optional(),
  name: z.string().trim().min(1).max(200),
  ownerEmail: emailSchema,
  source: versionSourceSchema.default("save"),
  summary: z.string().max(1000).default(""),
});

export function prepareCreateWorkflow(input: CreateWorkflowInput): {
  id: string | undefined;
  automationId: string | null;
  name: string;
  ownerEmail: string;
  source: WorkflowVersionSource;
  summary: string;
} {
  const { graph: _graph, ...rest } = input;
  const parsed = parseInput(createWorkflowSchema, rest, "Workflow");
  return {
    id: parsed.id,
    automationId: parsed.automationId ?? null,
    name: parsed.name,
    ownerEmail: parsed.ownerEmail,
    source: parsed.source,
    summary: parsed.summary,
  };
}

const saveWorkflowSchema = z.object({
  workflowId: idSchema,
  expectedVersion: versionSchema,
  source: versionSourceSchema,
  summary: z.string().max(1000),
  createdBy: emailSchema,
});

export function prepareSaveWorkflowGraph(
  input: SaveWorkflowGraphInput,
): Omit<SaveWorkflowGraphInput, "graph"> {
  const { graph: _graph, ...rest } = input;
  return parseInput(saveWorkflowSchema, rest, "Workflow save");
}

export function assertVersion(version: number, label: string): number {
  return parseInput(versionSchema, version, label);
}

const MODE_TRIGGER_KINDS: Readonly<Record<RunMode, readonly RunTriggerKind[]>> =
  {
    live: ["schedule", "manual"],
    dry: ["dry_run"],
    test: ["test"],
  };

const startRunSchema = z
  .object({
    workflowId: idSchema,
    tickKey: idSchema,
    mode: runModeSchema,
    triggerKind: runTriggerKindSchema,
    startedBy: z.string().min(1).max(320),
    graphVersion: versionSchema,
    startedAt: z.string().optional(),
    historyRowId: idSchema.optional(),
  })
  .superRefine((run, ctx) => {
    if (!MODE_TRIGGER_KINDS[run.mode].includes(run.triggerKind)) {
      ctx.addIssue({
        code: "custom",
        message: `a ${run.mode} run cannot be started by "${run.triggerKind}"`,
        path: ["triggerKind"],
      });
    }
    if (
      (run.triggerKind === "schedule") !==
      (run.startedBy === SCHEDULE_STARTER)
    ) {
      ctx.addIssue({
        code: "custom",
        message: `only a scheduled run is started by "${SCHEDULE_STARTER}"; any other run records who started it`,
        path: ["startedBy"],
      });
    }
  });

export function prepareStartRun(
  input: StartRunInput,
  fallbackNow: string,
): {
  workflowId: string;
  tickKey: string;
  mode: RunMode;
  triggerKind: RunTriggerKind;
  startedBy: string;
  graphVersion: number;
  startedAt: string;
  historyRowId: string | null;
} {
  const parsed = parseInput(startRunSchema, input, "Run");
  return {
    workflowId: parsed.workflowId,
    tickKey: parsed.tickKey,
    mode: parsed.mode,
    triggerKind: parsed.triggerKind,
    startedBy: parsed.startedBy,
    graphVersion: parsed.graphVersion,
    startedAt:
      parsed.startedAt === undefined
        ? fallbackNow
        : normalizeInstant(parsed.startedAt, "run.startedAt"),
    historyRowId: parsed.historyRowId ?? null,
  };
}

const runErrorSchema = z.object({
  code: workflowErrorCodeSchema,
  message: z.string().min(1).max(1000),
});

const finishRunSchema = z.object({
  runId: idSchema,
  status: z.enum(["succeeded", "failed", "paused"]),
  error: runErrorSchema.optional(),
  finishedAt: z.string().optional(),
});

export function prepareFinishRun(
  input: FinishRunInput,
  fallbackNow: string,
): {
  runId: string;
  status: Exclude<RunStatus, "running">;
  counts: RunCounts;
  error: RunError | null;
  finishedAt: string;
} {
  const parsed = parseInput(finishRunSchema, input, "Run finish");
  assertRunOutcome(parsed.status, parsed.error);
  return {
    runId: parsed.runId,
    status: parsed.status,
    counts: prepareRunCounts(input.counts),
    error: parsed.error ?? null,
    finishedAt:
      parsed.finishedAt === undefined
        ? fallbackNow
        : normalizeInstant(parsed.finishedAt, "run.finishedAt"),
  };
}

const leaseSchema = z.object({
  workflowId: idSchema,
  graphVersion: versionSchema,
  leasedBy: idSchema,
  now: z.string(),
  skipParked: z.boolean().default(false),
});

export function prepareLeaseItems(input: LeaseItemsInput): {
  workflowId: string;
  graphVersion: number;
  itemIds: string[];
  leasedBy: string;
  now: string;
  leaseUntil: string;
  skipParked: boolean;
} {
  const parsed = parseInput(
    leaseSchema,
    {
      workflowId: input.workflowId,
      graphVersion: input.graphVersion,
      leasedBy: input.leasedBy,
      now: input.now,
      skipParked: input.skipParked,
    },
    "Lease",
  );
  const now = normalizeInstant(parsed.now, "lease.now");
  return {
    workflowId: parsed.workflowId,
    graphVersion: parsed.graphVersion,
    itemIds: uniqueItemIds(input.itemIds, "Lease"),
    leasedBy: parsed.leasedBy,
    now,
    leaseUntil: new Date(
      Date.parse(now) + resolveLeaseTtlMs(input.ttlMs),
    ).toISOString(),
    skipParked: parsed.skipParked,
  };
}

const parkSchema = z.object({
  workflowId: idSchema,
  itemId: idSchema,
  leasedBy: idSchema,
  graphVersion: versionSchema,
  nodeId: nodeIdSchema,
});

export function preparePark(input: ParkItemInput): {
  workflowId: string;
  itemId: string;
  leasedBy: string;
  graphVersion: number;
  nodeId: string;
  wake: ReturnType<typeof prepareWake>;
  context: ReturnType<typeof prepareContext>;
  counters: ReturnType<typeof prepareCounters> | null;
} {
  const parsed = parseInput(
    parkSchema,
    {
      workflowId: input.workflowId,
      itemId: input.itemId,
      leasedBy: input.leasedBy,
      graphVersion: input.graphVersion,
      nodeId: input.nodeId,
    },
    "Park",
  );
  return {
    ...parsed,
    wake: prepareWake(input.wake),
    context: prepareContext(input.context),
    counters:
      input.counters === undefined ? null : prepareCounters(input.counters),
  };
}

const cursorValueSchema = z.string().min(1);

export function prepareCursorValue(value: string): string {
  const parsed = parseInput(cursorValueSchema, value, "Cursor value");
  const bytes = utf8ByteLength(parsed);
  if (bytes > WORKFLOW_STORE_LIMITS.cursorValueBytes) {
    throw invalidRecord(
      `Cursor value is ${bytes} bytes; the cap is ${WORKFLOW_STORE_LIMITS.cursorValueBytes}.`,
      { bytes, maxBytes: WORKFLOW_STORE_LIMITS.cursorValueBytes },
    );
  }
  return parsed;
}

export function assertCursorRef(ref: { workflowId: string; nodeId: string }): {
  workflowId: string;
  nodeId: string;
} {
  return {
    workflowId: parseInput(
      workflowIdSchema,
      ref.workflowId,
      "Cursor workflow id",
    ),
    nodeId: parseInput(nodeIdSchema, ref.nodeId, "Cursor node id"),
  };
}

/** An item state read back from its columns. A row that no longer fits is `corrupt_record`. */
export function assembleItemState(fields: {
  workflowId: string;
  graphVersion: number;
  itemId: string;
  parkedAtNode: string | null;
  wake: Wake | null;
  context: Record<string, unknown>;
  counters: Record<string, number>;
  leasedBy: string | null;
  leaseUntil: string | null;
  updatedAt: string;
}): ItemState {
  const state = {
    workflowId: fields.workflowId,
    graphVersion: fields.graphVersion,
    itemId: fields.itemId,
    ...(fields.parkedAtNode === null
      ? {}
      : { parkedAtNode: fields.parkedAtNode }),
    ...(fields.wake === null ? {} : { wake: fields.wake }),
    context: fields.context,
    counters: fields.counters,
    ...(fields.leasedBy === null ? {} : { leasedBy: fields.leasedBy }),
    ...(fields.leaseUntil === null ? {} : { leaseUntil: fields.leaseUntil }),
    updatedAt: fields.updatedAt,
  };
  const parsed = itemStateSchema.safeParse(state);
  if (!parsed.success) {
    throw new WorkflowStoreError(
      "corrupt_record",
      `Item state for "${fields.itemId}" no longer matches its schema: ${describeIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function assembleRunRecord(fields: {
  id: string;
  workflowId: string;
  graphVersion: number;
  mode: string;
  tickKey: string;
  triggerKind: string | null;
  startedBy: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  counts: RunCounts;
  errorCode: string | null;
  errorMessage: string | null;
  historyRowId: string | null;
}): RunRecord {
  const mode = runModeSchema.safeParse(fields.mode);
  const status = runStatusSchema.safeParse(fields.status);
  if (!mode.success || !status.success) {
    throw new WorkflowStoreError(
      "corrupt_record",
      `Run "${fields.id}" has an unknown mode or status.`,
      { mode: fields.mode, status: fields.status },
    );
  }
  // A row with neither is not "started by nobody": the starter was never written.
  const triggerKind = runTriggerKindSchema.safeParse(fields.triggerKind);
  if (!triggerKind.success || fields.startedBy === null) {
    throw new WorkflowStoreError(
      "corrupt_record",
      `Run "${fields.id}" has no readable trigger kind or starter.`,
      { triggerKind: fields.triggerKind, startedBy: fields.startedBy },
    );
  }
  let error: RunError | undefined;
  if (fields.errorCode !== null || fields.errorMessage !== null) {
    const code = workflowErrorCodeSchema.safeParse(fields.errorCode);
    if (!code.success || fields.errorMessage === null) {
      throw new WorkflowStoreError(
        "corrupt_record",
        `Run "${fields.id}" has an incomplete error.`,
      );
    }
    error = { code: code.data, message: fields.errorMessage };
  }
  return {
    id: fields.id,
    workflowId: fields.workflowId,
    graphVersion: fields.graphVersion,
    mode: mode.data,
    tickKey: fields.tickKey,
    triggerKind: triggerKind.data,
    startedBy: fields.startedBy,
    status: status.data,
    startedAt: fields.startedAt,
    ...(fields.finishedAt === null ? {} : { finishedAt: fields.finishedAt }),
    counts: fields.counts,
    ...(error === undefined ? {} : { error }),
    ...(fields.historyRowId === null
      ? {}
      : { historyRowId: fields.historyRowId }),
  };
}

const runRequestSchema = z
  .object({
    workflowId: idSchema,
    mode: runModeSchema,
    testNodeId: nodeIdSchema.optional(),
    sampleItemIds: z
      .array(idSchema)
      .max(WORKFLOW_STORE_LIMITS.runRequestSampleItemsMax)
      .default([]),
    requestedBy: emailSchema,
  })
  .superRefine((request, ctx) => {
    if ((request.mode === "test") !== (request.testNodeId !== undefined)) {
      ctx.addIssue({
        code: "custom",
        message:
          request.mode === "test"
            ? "a test request names the node to run"
            : `a ${request.mode} request runs the whole graph and names no node`,
        path: ["testNodeId"],
      });
    }
    if (request.mode !== "test" && request.sampleItemIds.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `a ${request.mode} request pins no sample items`,
        path: ["sampleItemIds"],
      });
    }
  });

export function prepareRunRequest(input: CreateRunRequestInput): {
  workflowId: string;
  mode: RunMode;
  testNodeId: string | null;
  sampleItemIds: string[];
  requestedBy: string;
} {
  const parsed = parseInput(
    runRequestSchema,
    { ...input, sampleItemIds: input.sampleItemIds ?? [] },
    "Run request",
  );
  return {
    workflowId: parsed.workflowId,
    mode: parsed.mode,
    testNodeId: parsed.testNodeId ?? null,
    sampleItemIds: [...new Set(parsed.sampleItemIds)],
    requestedBy: parsed.requestedBy,
  };
}

const sampleItemIdsSchema = z.array(idSchema);

/** Reads the stored id list; one that no longer parses is `corrupt_record`, never an empty pin. */
export function readSampleItemIds(raw: unknown, what: string): string[] {
  return parseStoredJson(raw, sampleItemIdsSchema, what);
}

export function assembleRunRequest(fields: {
  id: string;
  workflowId: string;
  mode: string;
  testNodeId: string | null;
  sampleItemIds: string[];
  requestedBy: string;
  createdAt: string;
  claimedAt: string | null;
  claimedByHistoryId: string | null;
}): RunRequest {
  const mode = runModeSchema.safeParse(fields.mode);
  if (!mode.success) {
    throw new WorkflowStoreError(
      "corrupt_record",
      `Run request "${fields.id}" has an unknown mode.`,
      { mode: fields.mode },
    );
  }
  return {
    id: fields.id,
    workflowId: fields.workflowId,
    mode: mode.data,
    testNodeId: fields.testNodeId,
    sampleItemIds: fields.sampleItemIds,
    requestedBy: fields.requestedBy,
    createdAt: fields.createdAt,
    claimedAt: fields.claimedAt,
    claimedByHistoryId: fields.claimedByHistoryId,
  };
}
