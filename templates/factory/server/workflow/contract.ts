import { z } from "zod";

import { FORBIDDEN_SEGMENTS } from "./expressions.js";

export const NODE_KINDS = [
  "trigger",
  "source",
  "lookup",
  "action",
  "filter",
  "switch",
  "combine",
  "split",
  "ai",
  "agent",
  "wait",
  "end",
] as const;
export const nodeKindSchema = z.enum(NODE_KINDS);
export type NodeKind = z.infer<typeof nodeKindSchema>;

export const RUN_MODES = ["live", "dry", "test"] as const;
export const runModeSchema = z.enum(RUN_MODES);
export type RunMode = z.infer<typeof runModeSchema>;

/**
 * What started a run, recorded when it starts. A live run is `schedule` or
 * `manual`; a dry run and a test run are always `dry_run` and `test`.
 */
export const RUN_TRIGGER_KINDS = [
  "schedule",
  "manual",
  "dry_run",
  "test",
] as const;
export const runTriggerKindSchema = z.enum(RUN_TRIGGER_KINDS);
export type RunTriggerKind = z.infer<typeof runTriggerKindSchema>;

/** What a scheduled run records as its starter; every other run records the email of whoever started it. */
export const SCHEDULE_STARTER = "schedule";

export const RUN_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "paused",
] as const;
export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const STEP_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "skipped",
  "needs_check",
] as const;
export const stepStatusSchema = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof stepStatusSchema>;

export const ITEM_EVENT_KINDS = [
  "taken",
  "entered",
  "output",
  "decision",
  "effect",
  "parked",
  "woke",
  "ended",
  "error",
] as const;
export const itemEventKindSchema = z.enum(ITEM_EVENT_KINDS);
export type ItemEventKind = z.infer<typeof itemEventKindSchema>;

export const END_OUTCOMES = [
  "done",
  "dismissed",
  "needsManual",
  "released",
] as const;
export const endOutcomeSchema = z.enum(END_OUTCOMES);
export type EndOutcome = z.infer<typeof endOutcomeSchema>;

export const WORKFLOW_ERROR_CODES = [
  "lookup_failed",
  "ai_invalid_output",
  "ai_cap_reached",
  "operation_not_allowed",
  "output_over_cap",
  "context_truncated",
  "graph_changed_while_waiting",
  "effect_needs_check",
  "credential_missing",
  "provider_error",
  "budget_paused",
  // The graph failed validation, or asks for something the engine cannot run.
  "graph_invalid",
  // The engine no longer raises this: Waits and loops run. It stays in the list
  // so a stored run or step that carries it still parses.
  "node_kind_unsupported",
  // A path, rule, or field binding had no usable value for this item.
  "expression_failed",
  // A source handed back an item that is not a valid normalized item.
  "item_invalid",
  // The engine or its store failed in a way no step can be blamed for.
  "engine_error",
  // A provider or poller reported more than it handed over, so a short list
  // would read as "nothing else".
  "partial_read",
  // The item changed under the write: a person or another run moved it first.
  "item_conflict",
  // A run row was still open long after the function running it could have stopped.
  "run_interrupted",
] as const;
export const workflowErrorCodeSchema = z.enum(WORKFLOW_ERROR_CODES);
export type WorkflowErrorCode = z.infer<typeof workflowErrorCodeSchema>;

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: WorkflowErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.details = details;
  }
}

export const MAX_NODES = 200;
export const MAX_EDGES = 400;
const MAX_JSON_VALUE_BYTES = 32 * 1024;

export type Port = string;
export const portSchema = z.string().min(1).max(130);

const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "use letters, digits, - and _");

export const identifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "use letters, digits and _")
  .refine(
    (value) => !(FORBIDDEN_SEGMENTS as readonly string[]).includes(value),
    "this name is reserved",
  );

export const operationIdSchema = z
  .string()
  .max(120)
  .regex(
    /^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9_-]*$/,
    'use "<provider>.<name>", such as "slack.postMessage"',
  );

const pathStringSchema = z.string().min(1).max(200);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

function isJsonWithin(value: unknown, maxBytes: number): boolean {
  try {
    const json = JSON.stringify(value);
    return (
      json === undefined || new TextEncoder().encode(json).length <= maxBytes
    );
  } catch {
    // coercion-ok: a value with no JSON form fails the schema check that calls this
    return false;
  }
}

const jsonValueSchema = z
  .unknown()
  .refine(
    (value) => isJsonWithin(value, MAX_JSON_VALUE_BYTES),
    "value must be JSON of at most 32 KB",
  );

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    // coercion-ok: an unknown zone fails the schema check that calls this
    return false;
  }
}

const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, "unknown time zone");

const fixedBindingSchema = z
  .strictObject({ mode: z.literal("fixed"), value: jsonValueSchema })
  .refine((binding) => "value" in binding, {
    message: "a fixed binding needs a value",
    path: ["value"],
  });
const pathBindingSchema = z.strictObject({
  mode: z.literal("path"),
  path: pathStringSchema,
});

export const fieldBindingSchema = z.discriminatedUnion("mode", [
  fixedBindingSchema,
  pathBindingSchema,
  z.strictObject({
    mode: z.literal("ai"),
    instruction: z.string().min(1).max(4000),
  }),
]);
export type FieldBinding = z.infer<typeof fieldBindingSchema>;

/** A value an End writes onto the item: typed in, or read from upstream; never model-written. */
export const recordBindingSchema = z.discriminatedUnion("mode", [
  fixedBindingSchema,
  pathBindingSchema,
]);
export type RecordBinding = z.infer<typeof recordBindingSchema>;

const argsSchema = z
  .record(identifierSchema, fieldBindingSchema)
  .refine((args) => Object.keys(args).length <= 50, "at most 50 arguments");

export const RULE_OPS = [
  "equals",
  "notEquals",
  "contains",
  "startsWith",
  "isEmpty",
  "isTrue",
  "inList",
  "gt",
  "lt",
  "between",
  "olderThan",
  "pastDue",
] as const;
export const ruleOpSchema = z.enum(RULE_OPS);
export type RuleOp = z.infer<typeof ruleOpSchema>;

const RULE_OPS_WITHOUT_OPERAND: readonly RuleOp[] = [
  "isEmpty",
  "isTrue",
  "pastDue",
];

export const ruleSchema = z
  .strictObject({
    left: pathStringSchema,
    op: ruleOpSchema,
    right: jsonValueSchema.optional(),
  })
  .superRefine((rule, ctx) => {
    const needsOperand = !RULE_OPS_WITHOUT_OPERAND.includes(rule.op);
    if (needsOperand && rule.right === undefined) {
      ctx.addIssue({
        code: "custom",
        message: `"${rule.op}" needs a right-hand value`,
        path: ["right"],
      });
    }
    if (!needsOperand && rule.right !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: `"${rule.op}" takes no right-hand value`,
        path: ["right"],
      });
    }
  });
export type Rule = z.infer<typeof ruleSchema>;

const combinatorSchema = z.enum(["all", "any"]);
const rulesSchema = z.array(ruleSchema).min(1).max(30);

const hhmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use 24-hour HH:MM");

const triggerSettingsSchema = z.strictObject({
  schedule: z.union([
    z.strictObject({ every: z.enum(["5m", "10m", "15m", "30m", "60m"]) }),
    z.strictObject({ daily: z.strictObject({ at: hhmmSchema }) }),
    z.strictObject({ weekdays: z.strictObject({ at: hhmmSchema }) }),
    z.strictObject({
      weekly: z.strictObject({
        day: z.number().int().min(0).max(6),
        at: hhmmSchema,
      }),
    }),
  ]),
  timezone: timezoneSchema.optional(),
});

const inboxFilterSchema = z.strictObject({
  scopes: z.array(z.string().min(1).max(120)).max(50).optional(),
  authors: z.array(z.string().min(1).max(120)).max(50).optional(),
  excludeAuthors: z.array(z.string().min(1).max(120)).max(50).optional(),
  claimReaction: z.string().min(1).max(60).optional(),
});

const sourceSettingsSchema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("inbox-poll"),
    poller: z.enum(["slack", "github", "sentry"]),
    takeLimit: z.number().int().min(1).max(10),
    filter: inboxFilterSchema.optional(),
  }),
  z.strictObject({
    source: z.literal("provider-query"),
    operation: operationIdSchema,
    args: argsSchema,
    memory: z.enum(["inbox", "none"]),
    maxItems: z.number().int().min(1).max(100).default(50),
  }),
  z.strictObject({
    source: z.literal("window"),
    operation: operationIdSchema,
    args: argsSchema,
    maxItems: z.number().int().min(1).max(100).default(50),
  }),
  z.strictObject({
    source: z.literal("status"),
    status: z.string().min(1).max(60),
    takeLimit: z.number().int().min(1).max(50),
  }),
]);

const lookupSettingsSchema = z.strictObject({
  operation: operationIdSchema,
  args: argsSchema,
  into: identifierSchema.optional(),
});

const actionSettingsSchema = z.strictObject({
  operation: operationIdSchema,
  args: argsSchema,
});

const filterSettingsSchema = z.strictObject({
  combinator: combinatorSchema,
  rules: rulesSchema,
});

const switchSettingsSchema = z.strictObject({
  routes: z
    .array(
      z.strictObject({
        id: slugSchema,
        label: z.string().min(1).max(120),
        combinator: combinatorSchema,
        rules: rulesSchema,
      }),
    )
    .min(1)
    .max(12),
});

const summarizeSchema = z
  .strictObject({
    group: pathStringSchema,
    value: pathStringSchema,
    agg: z.enum(["sum", "count", "avg"]),
    baseline: z
      .strictObject({
        window: z.number().int().min(1).max(90),
        bucket: z.enum(["day", "week"]),
      })
      .optional(),
    compare: z.literal("latestVsAverage").optional(),
  })
  .refine((summary) => !summary.compare || summary.baseline, {
    message: "a comparison needs a baseline",
    path: ["compare"],
  });

// `key` groups, `field` picks what a list collects (the whole item when omitted).
const combineSettingsSchema = z
  .strictObject({
    mode: z.enum(["list", "count", "groupBy", "summarize"]),
    key: pathStringSchema.optional(),
    field: pathStringSchema.optional(),
    summarize: summarizeSchema.optional(),
  })
  .superRefine((combine, ctx) => {
    const expect = (present: boolean, mode: string, name: string) => {
      const wanted = combine.mode === mode;
      if (wanted && !present) {
        ctx.addIssue({
          code: "custom",
          message: `"${mode}" needs ${name}`,
          path: [name],
        });
      }
      if (!wanted && present) {
        ctx.addIssue({
          code: "custom",
          message: `${name} only applies to "${mode}"`,
          path: [name],
        });
      }
    };
    expect(combine.key !== undefined, "groupBy", "key");
    expect(combine.summarize !== undefined, "summarize", "summarize");
    if (combine.field !== undefined && combine.mode !== "list") {
      ctx.addIssue({
        code: "custom",
        message: 'field only applies to "list"',
        path: ["field"],
      });
    }
  });

const splitSettingsSchema = z.strictObject({ field: pathStringSchema });

export const resultFieldSchema = z
  .strictObject({
    type: z.enum(["boolean", "string", "number", "enum", "array"]),
    enum: z.array(z.string().min(1).max(80)).min(1).max(30).optional(),
    description: z.string().max(500).optional(),
    optional: z.boolean().optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === "enum" && !field.enum) {
      ctx.addIssue({
        code: "custom",
        message: "an enum field lists its values",
        path: ["enum"],
      });
    }
    if (field.type !== "enum" && field.enum) {
      ctx.addIssue({
        code: "custom",
        message: "only an enum field lists values",
        path: ["enum"],
      });
    }
    if (field.enum && new Set(field.enum).size !== field.enum.length) {
      ctx.addIssue({
        code: "custom",
        message: "enum values must be unique",
        path: ["enum"],
      });
    }
  });
export type ResultField = z.infer<typeof resultFieldSchema>;

const aiSettingsSchema = z.strictObject({
  instruction: z.string().min(1).max(10_000),
  result: z.record(identifierSchema, resultFieldSchema).refine((result) => {
    const count = Object.keys(result).length;
    return count >= 1 && count <= 30;
  }, "declare between 1 and 30 result fields"),
  mode: z.enum(["perItem", "wholeList"]),
  tools: z.array(z.string().min(1).max(80)).max(10).default([]),
  batchSize: z.number().int().min(1).max(100).default(10),
  inputBudgetTokens: z.number().int().min(100).max(200_000).optional(),
});

const agentSettingsSchema = z.strictObject({
  agent: z.literal("builder"),
  op: z.enum(["start", "check", "followUp"]),
  args: argsSchema,
});

const MAX_WAIT_HOURS = 24 * 30;
const limitHoursSchema = z.number().positive().max(MAX_WAIT_HOURS);

const waitSettingsSchema = z.discriminatedUnion("wait", [
  z.strictObject({
    wait: z.literal("reply"),
    limitHours: limitHoursSchema.default(24),
    acceptFrom: z
      .union([
        z.enum(["anyone", "owner"]),
        z.strictObject({
          emails: z.array(z.email()).min(1).max(50),
        }),
      ])
      .default("anyone"),
    watch: z.strictObject({ fromNode: slugSchema }).optional(),
    ackReaction: z.string().min(1).max(60).optional(),
  }),
  z.strictObject({
    wait: z.literal("time"),
    duration: z
      .strictObject({
        amount: z.number().positive(),
        unit: z.enum(["minutes", "hours", "days"]),
      })
      .refine(
        ({ amount, unit }) =>
          amount * { minutes: 1, hours: 60, days: 1440 }[unit] <=
          MAX_WAIT_HOURS * 60,
        "a time wait is at most 30 days",
      ),
  }),
  z.strictObject({
    wait: z.literal("condition"),
    operation: operationIdSchema,
    args: argsSchema,
    rule: ruleSchema,
    everyMinutes: z.number().int().min(5).max(1440).default(15),
    limitHours: limitHoursSchema.default(24),
  }),
]);

// What a row's `extras` already holds from the engine's own reading of it, so a recorded value of the same name would be hidden.
export const RESERVED_RECORD_NAMES = ["status", "coverage", "headSha"] as const;
export const MAX_RECORDED_VALUES = 10;

const recordSchema = z
  .record(identifierSchema, recordBindingSchema)
  .refine(
    (record) => Object.keys(record).length <= MAX_RECORDED_VALUES,
    `an end records at most ${MAX_RECORDED_VALUES} values`,
  )
  .refine(
    (record) =>
      Object.keys(record).every(
        (name) => !(RESERVED_RECORD_NAMES as readonly string[]).includes(name),
      ),
    `${RESERVED_RECORD_NAMES.join(", ")} are written by Factory and cannot be recorded`,
  );

const endSettingsSchema = z
  .strictObject({
    outcome: endOutcomeSchema,
    reason: z.string().min(1).max(500).optional(),
    setStatus: z.string().min(1).max(60).optional(),
    // Written onto the item's extras in the same write that sets its status.
    record: recordSchema.optional(),
  })
  .refine((end) => end.outcome !== "dismissed" || end.reason, {
    message: "a dismissed end states its reason",
    path: ["reason"],
  })
  .refine((end) => end.outcome !== "released" || end.record === undefined, {
    message: "a released end writes nothing, so it records nothing",
    path: ["record"],
  });

const nodeBase = {
  id: slugSchema,
  name: identifierSchema,
  position: z.strictObject({
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
  }),
};

function nodeSchemaFor<K extends NodeKind, S extends z.ZodType>(
  kind: K,
  settings: S,
) {
  return z.strictObject({ ...nodeBase, kind: z.literal(kind), settings });
}

export const workflowNodeSchema = z.discriminatedUnion("kind", [
  nodeSchemaFor("trigger", triggerSettingsSchema),
  nodeSchemaFor("source", sourceSettingsSchema),
  nodeSchemaFor("lookup", lookupSettingsSchema),
  nodeSchemaFor("action", actionSettingsSchema),
  nodeSchemaFor("filter", filterSettingsSchema),
  nodeSchemaFor("switch", switchSettingsSchema),
  nodeSchemaFor("combine", combineSettingsSchema),
  nodeSchemaFor("split", splitSettingsSchema),
  nodeSchemaFor("ai", aiSettingsSchema),
  nodeSchemaFor("agent", agentSettingsSchema),
  nodeSchemaFor("wait", waitSettingsSchema),
  nodeSchemaFor("end", endSettingsSchema),
]);
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowNodeOfKind<K extends NodeKind> = Extract<
  WorkflowNode,
  { kind: K }
>;
export type WorkflowNodeSettings = WorkflowNode["settings"];

export const workflowEdgeSchema = z.strictObject({
  id: slugSchema,
  from: z.strictObject({ node: slugSchema, port: portSchema }),
  to: z.strictObject({ node: slugSchema }),
  back: z
    .strictObject({
      maxIterations: z.number().int().min(1).max(25).default(3),
    })
    .optional(),
});
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

export const workflowSettingsSchema = z.strictObject({
  timezone: timezoneSchema.optional(),
  checkCadenceMinutes: z.number().int().min(5).max(1440).default(15),
  // How far back a first run (or one with no stored last-trigger time) looks.
  lookbackMinutes: z.number().int().min(5).max(43_200).optional(),
  modelCallCap: z.number().int().min(1).max(1000).default(50),
  builderProjectId: z.string().min(1).max(120).optional(),
  // How long a Builder task may go without activity before it reads as stuck.
  builderStuckAfterMinutes: z.number().int().min(5).max(1440).optional(),
  triageOwnerEmail: z.email().optional(),
  findingsChannelId: z.string().min(1).max(120).optional(),
  extras: z
    .record(z.string().min(1).max(80), z.unknown())
    .refine(
      (extras) => isJsonWithin(extras, MAX_JSON_VALUE_BYTES),
      "extras must be JSON of at most 32 KB",
    )
    .optional(),
});
export type WorkflowSettings = z.infer<typeof workflowSettingsSchema>;

export const workflowGraphSchema = z.strictObject({
  nodes: z.array(workflowNodeSchema).max(MAX_NODES),
  edges: z.array(workflowEdgeSchema).max(MAX_EDGES),
  settings: workflowSettingsSchema,
});
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;
export type WorkflowGraphInput = z.input<typeof workflowGraphSchema>;

/**
 * The key a node's output is read under: `{{ nodes.<key>.field }}`. A lookup
 * can rename itself with `into`; every other node uses its name.
 */
export function nodeScopeKey(node: WorkflowNode): string {
  return node.kind === "lookup" && node.settings.into
    ? node.settings.into
    : node.name;
}

export const threadRefSchema = z.strictObject({
  channelId: z.string().min(1).max(200).optional(),
  threadTs: z.string().min(1).max(200).optional(),
  repo: z.string().min(1).max(200).optional(),
  number: z.number().int().min(0).optional(),
  ticketId: z.string().min(1).max(200).optional(),
});
export type ThreadRef = z.infer<typeof threadRefSchema>;

export const RECEIPT_STATUSES = ["started", "done", "failed"] as const;
export const receiptSchema = z.strictObject({
  key: z.string().min(1).max(600),
  status: z.enum(RECEIPT_STATUSES),
  externalRef: z.string().min(1).max(500).optional(),
  url: z.string().min(1).max(2048).optional(),
  summary: z.string().max(500).optional(),
  // What the call returned, cut down to fit `WORKFLOW_STORE_LIMITS.receiptOutputBytes`, so a run that finds this receipt done hands the next nodes what the first run did.
  output: z.record(z.string(), z.unknown()).optional(),
  // Set when `output` is only part of the response.
  outputTruncated: z.boolean().optional(),
  at: isoDateTimeSchema,
});
export type Receipt = z.infer<typeof receiptSchema>;

/**
 * `workflow:item:node:attempt`, and `:salt` after it for an item whose id stays
 * the same while what it stands for changes (a group of the day's rows). Each
 * part is URI-encoded so an id that contains a colon cannot collide with a
 * different (item, node) pair.
 */
export function receiptKey(parts: {
  workflowId: string;
  itemId: string;
  nodeId: string;
  attempt: number;
  salt?: string;
}): string {
  return [
    parts.workflowId,
    parts.itemId,
    parts.nodeId,
    String(parts.attempt),
    ...(parts.salt === undefined ? [] : [parts.salt]),
  ]
    .map(encodeURIComponent)
    .join(":");
}

/** Counters on an item are keyed by name: `attempts`, `nudges`, and one per loop. */
export function loopCounterKey(edgeId: string): string {
  return `loop:${edgeId}`;
}

export const wakeSchema = z.strictObject({
  // `retry` parks an item that failed at a node, or that a stopped run did not get to: it re-enters that node's input at `dueAt`.
  wait: z.enum(["reply", "time", "condition", "retry"]),
  dueAt: isoDateTimeSchema,
  nextCheckAt: isoDateTimeSchema.optional(),
  thread: threadRefSchema.optional(),
  // When the looks at this wait began failing; absent while the last look worked.
  readFailingSince: isoDateTimeSchema.optional(),
});
export type Wake = z.infer<typeof wakeSchema>;

export const itemStateSchema = z.strictObject({
  workflowId: z.string().min(1).max(200),
  graphVersion: z.number().int().min(1),
  itemId: z.string().min(1).max(200),
  parkedAtNode: slugSchema.optional(),
  wake: wakeSchema.optional(),
  context: z.record(z.string(), z.unknown()),
  counters: z.record(z.string(), z.number().int().min(0)),
  leasedBy: z.string().min(1).max(200).optional(),
  leaseUntil: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema,
});
export type ItemState = z.infer<typeof itemStateSchema>;

export const itemEventSchema = z
  .strictObject({
    workflowId: z.string().min(1).max(200),
    runId: z.string().min(1).max(200),
    itemId: z.string().min(1).max(200),
    nodeId: slugSchema.optional(),
    kind: itemEventKindSchema,
    at: isoDateTimeSchema,
    mode: runModeSchema,
    summary: z.string().max(2048),
    port: portSchema.optional(),
    receiptKey: z.string().min(1).max(600).optional(),
    threadId: z.string().min(1).max(200).optional(),
    // How an `ended` event ended the item, so no reader parses `summary`.
    outcome: endOutcomeSchema.optional(),
    // Why an `error` event failed the item.
    code: workflowErrorCodeSchema.optional(),
  })
  .superRefine((event, ctx) => {
    const structured = [
      ["outcome", "ended"],
      ["code", "error"],
    ] as const;
    for (const [field, kind] of structured) {
      const present = event[field] !== undefined;
      if (event.kind === kind && !present) {
        ctx.addIssue({
          code: "custom",
          message: `an "${kind}" event records its ${field}`,
          path: [field],
        });
      }
      if (event.kind !== kind && present) {
        ctx.addIssue({
          code: "custom",
          message: `${field} only applies to "${kind}" events`,
          path: [field],
        });
      }
    }
  });
export type ItemEvent = z.infer<typeof itemEventSchema>;

export const stepRecordSchema = z.strictObject({
  runId: z.string().min(1).max(200),
  nodeId: slugSchema,
  status: stepStatusSchema,
  mode: runModeSchema,
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.optional(),
  ports: z.record(
    portSchema,
    z.strictObject({
      count: z.number().int().min(0),
      itemIds: z.array(z.string().min(1).max(200)),
    }),
  ),
  fields: z.record(z.string(), z.unknown()).optional(),
  truncated: z
    .strictObject({ totalAvailable: z.number().int().min(0) })
    .optional(),
  inputTruncated: z.boolean().optional(),
  error: z
    .strictObject({
      code: workflowErrorCodeSchema,
      message: z.string().max(1000),
    })
    .optional(),
  receiptKeys: z.array(z.string().min(1).max(600)).optional(),
  agentThreadId: z.string().min(1).max(200).optional(),
});
export type StepRecord = z.infer<typeof stepRecordSchema>;
