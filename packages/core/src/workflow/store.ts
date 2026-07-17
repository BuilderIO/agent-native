import type { DbExec } from "../db/client.js";
import { getDbExec, intType, isPostgres, safeJsonParse } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import type {
  ClaimedWorkflowExecution,
  WorkflowDeliveryStatus,
  WorkflowEffectStatus,
  WorkflowEvent,
  WorkflowEventInput,
  WorkflowExecutionStatus,
  WorkflowStoreOptions,
  WorkflowSubscription,
  WorkflowSubscriptionInput,
  WorkflowRuntimeControlContext,
  WorkflowRuntimeControls,
  WorkflowRuntimeControlTarget,
  WorkflowRuntimeControlValue,
} from "./types.js";
import {
  listVirtualWorkflowSubscriptionProviders,
  type VirtualWorkflowSubscriptionSnapshot,
} from "./virtual-subscriptions.js";
import { emitWorkflowWake } from "./wake.js";

let schemaPromise: Promise<void> | undefined;

function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

const TABLES: Array<{ name: string; sql: () => string }> = [
  {
    name: "workflow_sequence_counters",
    sql: () => `CREATE TABLE IF NOT EXISTS workflow_sequence_counters (
      name TEXT PRIMARY KEY, value ${intType()} NOT NULL
    )`,
  },
  {
    name: "workflow_virtual_provider_state",
    sql: () => `CREATE TABLE IF NOT EXISTS workflow_virtual_provider_state (
      provider_id TEXT PRIMARY KEY,
      evaluation_start_sequence ${intType()} NOT NULL,
      created_at ${intType()} NOT NULL
    )`,
  },
  {
    name: "workflow_events",
    sql: () => `CREATE TABLE IF NOT EXISTS workflow_events (
      id TEXT PRIMARY KEY, event_sequence ${intType()} NOT NULL,
      topic TEXT NOT NULL, subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL, subject_key TEXT NOT NULL,
      owner_email TEXT NOT NULL, org_id TEXT, payload TEXT NOT NULL,
      actor_context TEXT NOT NULL, causal_event_id TEXT,
      occurred_at ${intType()} NOT NULL, available_at ${intType()} NOT NULL,
      created_at ${intType()} NOT NULL, materialized_at ${intType()}
    )`,
  },
  {
    name: "workflow_subscriptions",
    sql: () => `CREATE TABLE IF NOT EXISTS workflow_subscriptions (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, event_pattern TEXT NOT NULL,
      owner_email TEXT NOT NULL, org_id TEXT, config TEXT NOT NULL,
      enabled ${isPostgres() ? "BOOLEAN" : "INTEGER"} NOT NULL, created_at ${intType()} NOT NULL,
      updated_at ${intType()} NOT NULL
    )`,
  },
  {
    name: "workflow_subscription_versions",
    sql: () => `CREATE TABLE IF NOT EXISTS workflow_subscription_versions (
      id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL,
      version ${intType()} NOT NULL, kind TEXT NOT NULL,
      event_pattern TEXT NOT NULL, owner_email TEXT NOT NULL, org_id TEXT,
      config TEXT NOT NULL,
      enabled ${isPostgres() ? "BOOLEAN" : "INTEGER"} NOT NULL,
      active_after_sequence ${intType()} NOT NULL,
      active_at ${intType()} NOT NULL, created_at ${intType()} NOT NULL
    )`,
  },
  {
    name: "workflow_materialization_backlog",
    sql: () => `CREATE TABLE IF NOT EXISTS workflow_materialization_backlog (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, subscription_id TEXT NOT NULL,
      subscription_version ${intType()} NOT NULL, subject_key TEXT NOT NULL,
      created_at ${intType()} NOT NULL
    )`,
  },
  {
    name: "workflow_executions",
    sql: () => `CREATE TABLE IF NOT EXISTS workflow_executions (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, subscription_id TEXT NOT NULL,
      subscription_version ${intType()},
      subject_key TEXT NOT NULL, status TEXT NOT NULL,
      attempt ${intType()} NOT NULL DEFAULT 0, lease_token TEXT,
      lease_expires_at ${intType()}, fence_version ${intType()} NOT NULL DEFAULT 0,
      error_message TEXT, created_at ${intType()} NOT NULL,
      updated_at ${intType()} NOT NULL, completed_at ${intType()}
    )`,
  },
  {
    name: "workflow_scheduled_work",
    sql: () => `CREATE TABLE IF NOT EXISTS workflow_scheduled_work (
      id TEXT PRIMARY KEY, work_type TEXT NOT NULL, subject_key TEXT NOT NULL,
      event_id TEXT, subscription_id TEXT, payload TEXT NOT NULL,
      dedupe_key TEXT, due_at ${intType()} NOT NULL, status TEXT NOT NULL,
      attempt ${intType()} NOT NULL DEFAULT 0, lease_token TEXT,
      lease_expires_at ${intType()}, fence_version ${intType()} NOT NULL DEFAULT 0,
      error_message TEXT, completed_at ${intType()},
      created_at ${intType()} NOT NULL, updated_at ${intType()} NOT NULL
    )`,
  },
  {
    name: "workflow_effects",
    sql: () => `CREATE TABLE IF NOT EXISTS workflow_effects (
      id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, kind TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, status TEXT NOT NULL, result TEXT,
      error_message TEXT, created_at ${intType()} NOT NULL,
      updated_at ${intType()} NOT NULL
    )`,
  },
  {
    name: "workflow_runtime_controls",
    sql: () => `CREATE TABLE IF NOT EXISTS workflow_runtime_controls (
      id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, org_id TEXT NOT NULL,
      domain TEXT NOT NULL, scope TEXT NOT NULL, scope_id TEXT NOT NULL,
      evaluator_paused ${isPostgres() ? "BOOLEAN" : "INTEGER"} NOT NULL,
      effects_paused ${isPostgres() ? "BOOLEAN" : "INTEGER"} NOT NULL,
      created_at ${intType()} NOT NULL, updated_at ${intType()} NOT NULL
    )`,
  },
  {
    name: "notification_delivery_attempts",
    sql: () => `CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
      id TEXT PRIMARY KEY, effect_id TEXT NOT NULL, notification_id TEXT,
      channel TEXT NOT NULL, attempt ${intType()} NOT NULL,
      status TEXT NOT NULL, error_message TEXT,
      created_at ${intType()} NOT NULL, updated_at ${intType()} NOT NULL
    )`,
  },
];

const INDEXES = [
  [
    "workflow_events_materialization_idx",
    "CREATE INDEX IF NOT EXISTS workflow_events_materialization_idx ON workflow_events (materialized_at, available_at, event_sequence)",
  ],
  [
    "workflow_materialization_backlog_uidx",
    "CREATE UNIQUE INDEX IF NOT EXISTS workflow_materialization_backlog_uidx ON workflow_materialization_backlog (event_id, subscription_id)",
  ],
  [
    "workflow_materialization_backlog_order_idx",
    "CREATE INDEX IF NOT EXISTS workflow_materialization_backlog_order_idx ON workflow_materialization_backlog (created_at, id)",
  ],
  [
    "workflow_events_available_idx",
    "CREATE INDEX IF NOT EXISTS workflow_events_available_idx ON workflow_events (available_at, event_sequence)",
  ],
  [
    "workflow_events_sequence_uidx",
    "CREATE UNIQUE INDEX IF NOT EXISTS workflow_events_sequence_uidx ON workflow_events (event_sequence)",
  ],
  [
    "workflow_events_subject_idx",
    "CREATE INDEX IF NOT EXISTS workflow_events_subject_idx ON workflow_events (subject_key, event_sequence)",
  ],
  [
    "workflow_subscriptions_match_idx",
    "CREATE INDEX IF NOT EXISTS workflow_subscriptions_match_idx ON workflow_subscriptions (enabled, event_pattern)",
  ],
  [
    "workflow_subscription_versions_uidx",
    "CREATE UNIQUE INDEX IF NOT EXISTS workflow_subscription_versions_uidx ON workflow_subscription_versions (subscription_id, version)",
  ],
  [
    "workflow_subscription_versions_active_idx",
    "CREATE INDEX IF NOT EXISTS workflow_subscription_versions_active_idx ON workflow_subscription_versions (subscription_id, active_after_sequence, version)",
  ],
  [
    "workflow_executions_event_subscription_uidx",
    "CREATE UNIQUE INDEX IF NOT EXISTS workflow_executions_event_subscription_uidx ON workflow_executions (event_id, subscription_id)",
  ],
  [
    "workflow_executions_claim_idx",
    "CREATE INDEX IF NOT EXISTS workflow_executions_claim_idx ON workflow_executions (status, lease_expires_at, created_at)",
  ],
  [
    "workflow_executions_subject_idx",
    "CREATE INDEX IF NOT EXISTS workflow_executions_subject_idx ON workflow_executions (subject_key, status, created_at)",
  ],
  [
    "workflow_scheduled_work_due_idx",
    "CREATE INDEX IF NOT EXISTS workflow_scheduled_work_due_idx ON workflow_scheduled_work (status, due_at)",
  ],
  [
    "workflow_scheduled_work_dedupe_uidx",
    "CREATE UNIQUE INDEX IF NOT EXISTS workflow_scheduled_work_dedupe_uidx ON workflow_scheduled_work (dedupe_key)",
  ],
  [
    "workflow_effects_idempotency_uidx",
    "CREATE UNIQUE INDEX IF NOT EXISTS workflow_effects_idempotency_uidx ON workflow_effects (idempotency_key)",
  ],
  [
    "workflow_runtime_controls_scope_uidx",
    "CREATE UNIQUE INDEX IF NOT EXISTS workflow_runtime_controls_scope_uidx ON workflow_runtime_controls (owner_email, org_id, domain, scope, scope_id)",
  ],
  [
    "workflow_runtime_controls_lookup_idx",
    "CREATE INDEX IF NOT EXISTS workflow_runtime_controls_lookup_idx ON workflow_runtime_controls (owner_email, org_id, domain)",
  ],
  [
    "notification_delivery_effect_idx",
    "CREATE INDEX IF NOT EXISTS notification_delivery_effect_idx ON notification_delivery_attempts (effect_id, channel, attempt)",
  ],
  [
    "notification_delivery_attempt_uidx",
    "CREATE UNIQUE INDEX IF NOT EXISTS notification_delivery_attempt_uidx ON notification_delivery_attempts (effect_id, channel, attempt)",
  ],
] as const;

const COLUMNS = [
  {
    table: "workflow_events",
    column: "materialized_at",
    sql: () =>
      `ALTER TABLE workflow_events ADD COLUMN${isPostgres() ? " IF NOT EXISTS" : ""} materialized_at ${intType()}`,
  },
  {
    table: "workflow_events",
    column: "event_sequence",
    sql: () =>
      `ALTER TABLE workflow_events ADD COLUMN${isPostgres() ? " IF NOT EXISTS" : ""} event_sequence ${intType()}`,
  },
  {
    table: "workflow_subscription_versions",
    column: "active_after_sequence",
    sql: () =>
      `ALTER TABLE workflow_subscription_versions ADD COLUMN${isPostgres() ? " IF NOT EXISTS" : ""} active_after_sequence ${intType()}`,
  },
  {
    table: "workflow_executions",
    column: "subscription_version",
    sql: () =>
      `ALTER TABLE workflow_executions ADD COLUMN${isPostgres() ? " IF NOT EXISTS" : ""} subscription_version ${intType()}`,
  },
] as const;

/** Install the additive, provider-portable workflow schema. */
export async function ensureWorkflowSchema(
  options: { db?: DbExec } = {},
): Promise<void> {
  if (options.db) {
    for (const definition of TABLES) await options.db.execute(definition.sql());
    await ensureWorkflowColumns(options.db);
    await backfillWorkflowSequences(options.db);
    for (const [, sql] of INDEXES) await options.db.execute(sql);
    await backfillWorkflowSubscriptionVersions(options.db);
    return;
  }
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = getDbExec();
      for (const definition of TABLES) {
        if (isPostgres()) {
          await ensureTableExists(definition.name, definition.sql());
        } else {
          await db.execute(definition.sql());
        }
      }
      await ensureWorkflowColumns(db);
      await backfillWorkflowSequences(db);
      for (const [name, sql] of INDEXES) {
        if (isPostgres()) await ensureIndexExists(name, sql);
        else await db.execute(sql);
      }
      await backfillWorkflowSubscriptionVersions(db);
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  await schemaPromise;
}

async function ensureWorkflowColumns(db: DbExec): Promise<void> {
  for (const definition of COLUMNS) {
    const sql = definition.sql();
    if (isPostgres()) {
      await ensureColumnExists(definition.table, definition.column, sql, {
        injectedClient: db,
      });
      continue;
    }
    try {
      await db.execute(sql);
    } catch (error) {
      if (!/duplicate column/i.test(String(error))) throw error;
    }
  }
}

async function currentWorkflowEventSequence(db: DbExec): Promise<number> {
  const { rows } = await db.execute({
    sql: "SELECT value FROM workflow_sequence_counters WHERE name = ? LIMIT 1",
    args: ["events"],
  });
  return Number(rows[0]?.value ?? 0);
}

/** Allocate commit order inside the same transaction as the domain mutation. */
export async function allocateWorkflowEventSequence(
  db: DbExec,
): Promise<number> {
  await db.execute({
    sql: `INSERT INTO workflow_sequence_counters (name, value) VALUES (?, 0)
      ON CONFLICT (name) DO NOTHING`,
    args: ["events"],
  });
  const { rows } = await db.execute({
    sql: `UPDATE workflow_sequence_counters SET value = value + 1
      WHERE name = ? RETURNING value`,
    args: ["events"],
  });
  const sequence = Number(rows[0]?.value);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Workflow event sequence allocation failed");
  }
  return sequence;
}

export async function ensureVirtualWorkflowProviderEvaluationStart(
  providerId: string,
  options: { now?: number } = {},
): Promise<number> {
  await ensureWorkflowSchema();
  const id = providerId.trim();
  if (!id) throw new Error("Virtual workflow provider id is required");
  const db = getDbExec();
  const start = await currentWorkflowEventSequence(db);
  await db.execute({
    sql: `INSERT INTO workflow_virtual_provider_state
      (provider_id, evaluation_start_sequence, created_at)
      VALUES (?, ?, ?) ON CONFLICT (provider_id) DO NOTHING`,
    args: [id, start, options.now ?? Date.now()],
  });
  const { rows } = await db.execute({
    sql: `SELECT evaluation_start_sequence FROM workflow_virtual_provider_state
      WHERE provider_id = ? LIMIT 1`,
    args: [id],
  });
  const persisted = Number(rows[0]?.evaluation_start_sequence);
  if (!Number.isSafeInteger(persisted) || persisted < 0) {
    throw new Error(`Virtual workflow provider "${id}" has invalid state`);
  }
  return persisted;
}

async function backfillWorkflowSequences(db: DbExec): Promise<void> {
  const { rows: existing } = await db.execute(
    `SELECT COALESCE(MAX(event_sequence), 0) AS sequence
      FROM workflow_events WHERE event_sequence IS NOT NULL`,
  );
  let sequence = Number(existing[0]?.sequence ?? 0);
  const { rows: events } = await db.execute(
    `SELECT id FROM workflow_events WHERE event_sequence IS NULL
      ORDER BY created_at ASC, id ASC`,
  );
  for (const event of events) {
    sequence += 1;
    await db.execute({
      sql: "UPDATE workflow_events SET event_sequence = ? WHERE id = ?",
      args: [sequence, event.id],
    });
  }
  const current = await currentWorkflowEventSequence(db);
  const counter = Math.max(current, sequence);
  await db.execute({
    sql: `INSERT INTO workflow_sequence_counters (name, value) VALUES (?, ?)
      ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
    args: ["events", counter],
  });

  const { rows: versions } = await db.execute(
    `SELECT id, active_at FROM workflow_subscription_versions
      WHERE active_after_sequence IS NULL ORDER BY active_at ASC, version ASC`,
  );
  for (const version of versions) {
    const { rows: prior } = await db.execute({
      sql: `SELECT COALESCE(MAX(event_sequence), 0) AS sequence
        FROM workflow_events WHERE created_at < ?`,
      args: [version.active_at],
    });
    await db.execute({
      sql: `UPDATE workflow_subscription_versions
        SET active_after_sequence = ? WHERE id = ?`,
      args: [Number(prior[0]?.sequence ?? 0), version.id],
    });
  }
}

async function backfillWorkflowSubscriptionVersions(db: DbExec): Promise<void> {
  const { rows } = await db.execute(`SELECT s.id, s.kind, s.event_pattern,
    s.owner_email, s.org_id, s.config, s.enabled, s.created_at
    FROM workflow_subscriptions s WHERE NOT EXISTS (
      SELECT 1 FROM workflow_subscription_versions v
      WHERE v.subscription_id = s.id
    )`);
  for (const row of rows) {
    await db.execute({
      sql: `INSERT INTO workflow_subscription_versions
        (id, subscription_id, version, kind, event_pattern, owner_email,
         org_id, config, enabled, active_after_sequence, active_at, created_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (subscription_id, version) DO NOTHING`,
      args: [
        randomUUID(),
        row.id,
        row.kind,
        row.event_pattern,
        row.owner_email,
        row.org_id ?? null,
        row.config,
        row.enabled,
        await currentWorkflowEventSequence(db),
        row.created_at,
        row.created_at,
      ],
    });
  }
  const { rows: executions } = await db.execute(`SELECT x.id, x.subscription_id,
    e.event_sequence FROM workflow_executions x
    JOIN workflow_events e ON e.id = x.event_id
    WHERE x.subscription_version IS NULL`);
  for (const execution of executions) {
    const version = await db.execute({
      sql: `SELECT version FROM workflow_subscription_versions
        WHERE subscription_id = ? AND active_after_sequence < ?
        ORDER BY active_after_sequence DESC, version DESC LIMIT 1`,
      args: [execution.subscription_id, execution.event_sequence],
    });
    if (version.rows[0]?.version != null) {
      await db.execute({
        sql: `UPDATE workflow_executions SET subscription_version = ?
          WHERE id = ? AND subscription_version IS NULL`,
        args: [version.rows[0].version, execution.id],
      });
    }
  }
}

export const workflowSchemaMigrations = {
  tables: TABLES,
  columns: COLUMNS,
  indexes: INDEXES,
};

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function booleanValue(value: boolean): boolean | number {
  return isPostgres() ? value : value ? 1 : 0;
}

const ACTIVE_WORKFLOW_CONTROL: WorkflowRuntimeControlValue = {
  evaluatorPaused: false,
  effectsPaused: false,
};

function normalizedOrgId(orgId: string | null | undefined) {
  return orgId ?? "";
}

function workflowControlScopeId(target: WorkflowRuntimeControlTarget) {
  if (target.scope === "global") return "*";
  const resourceId = target.resourceId?.trim();
  if (!resourceId) {
    throw new Error("A resource-scoped workflow control requires resourceId.");
  }
  return resourceId;
}

function runtimeContextFromConfig(input: {
  ownerEmail: string;
  orgId?: string | null;
  config: unknown;
}): WorkflowRuntimeControlContext | null {
  const config =
    input.config && typeof input.config === "object"
      ? (input.config as Record<string, unknown>)
      : safeJsonParse<Record<string, unknown>>(String(input.config ?? ""), {});
  const domain = typeof config.domain === "string" ? config.domain.trim() : "";
  if (!domain) return null;
  return {
    ownerEmail: input.ownerEmail,
    orgId: input.orgId,
    domain,
    resourceId:
      typeof config.resourceId === "string" && config.resourceId.trim()
        ? config.resourceId
        : null,
  };
}

export async function setWorkflowRuntimeControl(
  target: WorkflowRuntimeControlTarget &
    WorkflowRuntimeControlValue & {
      now?: number;
    },
): Promise<WorkflowRuntimeControls> {
  await ensureWorkflowSchema();
  const ownerEmail = target.ownerEmail.trim();
  const domain = target.domain.trim();
  if (!ownerEmail || !domain) {
    throw new Error("Workflow controls require ownerEmail and domain.");
  }
  const orgId = normalizedOrgId(target.orgId);
  const scopeId = workflowControlScopeId(target);
  const now = target.now ?? Date.now();
  await getDbExec().execute({
    sql: `INSERT INTO workflow_runtime_controls
      (id, owner_email, org_id, domain, scope, scope_id, evaluator_paused,
       effects_paused, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner_email, org_id, domain, scope, scope_id) DO UPDATE SET
        evaluator_paused = excluded.evaluator_paused,
        effects_paused = excluded.effects_paused,
        updated_at = excluded.updated_at`,
    args: [
      randomUUID(),
      ownerEmail,
      orgId,
      domain,
      target.scope,
      scopeId,
      booleanValue(target.evaluatorPaused),
      booleanValue(target.effectsPaused),
      now,
      now,
    ],
  });
  return getWorkflowRuntimeControls({
    ownerEmail,
    orgId,
    domain,
    resourceId: target.resourceId,
  });
}

export async function getWorkflowRuntimeControls(
  context: WorkflowRuntimeControlContext,
): Promise<WorkflowRuntimeControls> {
  await ensureWorkflowSchema();
  const resourceId = context.resourceId?.trim() ?? "";
  const { rows } = await getDbExec().execute({
    sql: `SELECT scope, scope_id, evaluator_paused, effects_paused
      FROM workflow_runtime_controls
      WHERE owner_email = ? AND org_id = ? AND domain = ?
        AND ((scope = 'global' AND scope_id = '*')
          OR (scope = 'resource' AND scope_id = ?))`,
    args: [
      context.ownerEmail.trim(),
      normalizedOrgId(context.orgId),
      context.domain.trim(),
      resourceId,
    ],
  });
  const value = (scope: "global" | "resource") => {
    const row = rows.find((candidate) => candidate.scope === scope);
    return row
      ? {
          evaluatorPaused: Boolean(row.evaluator_paused),
          effectsPaused: Boolean(row.effects_paused),
        }
      : ACTIVE_WORKFLOW_CONTROL;
  };
  const global = value("global");
  const resource = resourceId ? value("resource") : ACTIVE_WORKFLOW_CONTROL;
  return {
    global,
    resource,
    effective: {
      evaluatorPaused: global.evaluatorPaused || resource.evaluatorPaused,
      effectsPaused: global.effectsPaused || resource.effectsPaused,
    },
  };
}

async function workflowControlForSubscription(input: {
  ownerEmail: string;
  orgId?: string | null;
  config: unknown;
}) {
  const context = runtimeContextFromConfig(input);
  return context ? getWorkflowRuntimeControls(context) : null;
}

function subjectKey(type: string, id: string): string {
  if (!type.trim() || !id.trim())
    throw new Error("Workflow subject is required");
  return `${type}:${id}`;
}

/** Values accepted by `tx.insert(workflowEvents).values(...)`. */
export function createWorkflowEventValues(
  input: WorkflowEventInput & { eventSequence: number },
  committedAt = Date.now(),
) {
  if (!input.topic.trim()) throw new Error("Workflow event topic is required");
  if (!input.ownerEmail.trim())
    throw new Error("Workflow event owner is required");
  const now = input.occurredAt ?? Date.now();
  return {
    id: input.id ?? randomUUID(),
    eventSequence: input.eventSequence,
    topic: input.topic,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    subjectKey: subjectKey(input.subjectType, input.subjectId),
    ownerEmail: input.ownerEmail,
    orgId: input.orgId ?? null,
    payload: json(input.payload),
    actorContext: json(input.actorContext),
    causalEventId: input.causalEventId ?? null,
    occurredAt: now,
    availableAt: input.availableAt ?? now,
    createdAt: committedAt,
  };
}

/**
 * Append a committed event. Pass an existing transaction executor to make the
 * domain write and event append atomic. Call `ensureWorkflowSchema()` before
 * opening that transaction.
 */
export async function insertWorkflowEvent(
  input: WorkflowEventInput,
  options: WorkflowStoreOptions = {},
): Promise<WorkflowEvent> {
  if (!options.db) await ensureWorkflowSchema();
  const db = options.db ?? getDbExec();
  const write = async (tx: DbExec) => {
    const eventSequence =
      input.eventSequence ?? (await allocateWorkflowEventSequence(tx));
    const values = createWorkflowEventValues(
      { ...input, eventSequence },
      options.now ?? Date.now(),
    );
    await tx.execute({
      sql: `INSERT INTO workflow_events
        (id, event_sequence, topic, subject_type, subject_id, subject_key,
         owner_email, org_id, payload, actor_context, causal_event_id,
         occurred_at, available_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        values.id,
        values.eventSequence,
        values.topic,
        values.subjectType,
        values.subjectId,
        values.subjectKey,
        values.ownerEmail,
        values.orgId,
        values.payload,
        values.actorContext,
        values.causalEventId,
        values.occurredAt,
        values.availableAt,
        values.createdAt,
      ],
    });
    return values;
  };
  const values = options.db
    ? await write(db)
    : db.transaction
      ? await db.transaction(write)
      : await write(db);
  if (!options.db) {
    emitWorkflowWake({ topic: "workflow.event.available", rowId: values.id });
  }
  return eventFromRow({
    ...values,
    event_sequence: values.eventSequence,
    subject_type: values.subjectType,
    subject_id: values.subjectId,
    subject_key: values.subjectKey,
    owner_email: values.ownerEmail,
    org_id: values.orgId,
    actor_context: values.actorContext,
    causal_event_id: values.causalEventId,
    occurred_at: values.occurredAt,
    available_at: values.availableAt,
    created_at: values.createdAt,
  });
}

const SUBSCRIPTION_WRITE_LOCK = Symbol.for(
  "@agent-native/core/workflow.subscription-write-lock",
);

async function withWorkflowSubscriptionWriteLock<T>(
  task: () => Promise<T>,
): Promise<T> {
  const global = globalThis as typeof globalThis & {
    [SUBSCRIPTION_WRITE_LOCK]?: Promise<void>;
  };
  const previous = global[SUBSCRIPTION_WRITE_LOCK] ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => current);
  global[SUBSCRIPTION_WRITE_LOCK] = chained;
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (global[SUBSCRIPTION_WRITE_LOCK] === chained) {
      delete global[SUBSCRIPTION_WRITE_LOCK];
    }
  }
}

export async function upsertWorkflowSubscription(
  input: WorkflowSubscriptionInput,
  options: { now?: number } = {},
): Promise<WorkflowSubscription> {
  return withWorkflowSubscriptionWriteLock(() =>
    upsertWorkflowSubscriptionUnlocked(input, options),
  );
}

async function upsertWorkflowSubscriptionUnlocked(
  input: WorkflowSubscriptionInput,
  options: { now?: number },
): Promise<WorkflowSubscription> {
  await ensureWorkflowSchema();
  if (
    !input.id.trim() ||
    !input.eventPattern.trim() ||
    !input.ownerEmail.trim()
  ) {
    throw new Error(
      "Workflow subscription id, pattern, and owner are required",
    );
  }
  const db = getDbExec();
  const now = options.now ?? Date.now();
  const config = canonicalJson(input.config ?? {});
  const enabled = input.enabled !== false;
  const existing = await db.execute({
    sql: `SELECT id, kind, event_pattern, owner_email, org_id, config, enabled,
      created_at, updated_at FROM workflow_subscriptions WHERE id = ? LIMIT 1`,
    args: [input.id],
  });
  if (existing.rows.length) {
    const row = existing.rows[0];
    const unchanged =
      String(row.kind) === input.kind &&
      String(row.event_pattern) === input.eventPattern &&
      String(row.owner_email) === input.ownerEmail &&
      (row.org_id == null ? null : String(row.org_id)) ===
        (input.orgId ?? null) &&
      canonicalJson(safeJsonParse(String(row.config ?? "{}"), {})) === config &&
      (row.enabled === true || Number(row.enabled) === 1) === enabled;
    if (unchanged) return (await getWorkflowSubscription(input.id))!;

    const latest = await db.execute({
      sql: `SELECT version FROM workflow_subscription_versions
        WHERE subscription_id = ? ORDER BY version DESC LIMIT 1`,
      args: [input.id],
    });
    const version = Number(latest.rows[0]?.version ?? 0) + 1;
    const write = async (tx: DbExec) => {
      const activeAfterSequence = await currentWorkflowEventSequence(tx);
      await tx.execute({
        sql: `INSERT INTO workflow_subscription_versions
          (id, subscription_id, version, kind, event_pattern, owner_email,
           org_id, config, enabled, active_after_sequence, active_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          randomUUID(),
          input.id,
          version,
          input.kind,
          input.eventPattern,
          input.ownerEmail,
          input.orgId ?? null,
          config,
          booleanValue(enabled),
          activeAfterSequence,
          now,
          now,
        ],
      });
      await tx.execute({
        sql: `UPDATE workflow_subscriptions SET kind = ?, event_pattern = ?,
          owner_email = ?, org_id = ?, config = ?, enabled = ?, updated_at = ?
          WHERE id = ?`,
        args: [
          input.kind,
          input.eventPattern,
          input.ownerEmail,
          input.orgId ?? null,
          config,
          booleanValue(enabled),
          now,
          input.id,
        ],
      });
    };
    if (db.transaction) await db.transaction(write);
    else await write(db);
  } else {
    const write = async (tx: DbExec) => {
      const activeAfterSequence = await currentWorkflowEventSequence(tx);
      await tx.execute({
        sql: `INSERT INTO workflow_subscriptions
          (id, kind, event_pattern, owner_email, org_id, config, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          input.id,
          input.kind,
          input.eventPattern,
          input.ownerEmail,
          input.orgId ?? null,
          config,
          booleanValue(enabled),
          now,
          now,
        ],
      });
      await tx.execute({
        sql: `INSERT INTO workflow_subscription_versions
          (id, subscription_id, version, kind, event_pattern, owner_email,
           org_id, config, enabled, active_after_sequence, active_at, created_at)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          randomUUID(),
          input.id,
          input.kind,
          input.eventPattern,
          input.ownerEmail,
          input.orgId ?? null,
          config,
          booleanValue(enabled),
          activeAfterSequence,
          now,
          now,
        ],
      });
    };
    if (db.transaction) await db.transaction(write);
    else await write(db);
  }
  return (await getWorkflowSubscription(input.id))!;
}

export async function getWorkflowSubscription(
  id: string,
): Promise<WorkflowSubscription | null> {
  await ensureWorkflowSchema();
  const { rows } = await getDbExec().execute({
    sql: `SELECT s.id, s.kind, s.event_pattern, s.owner_email, s.org_id,
      s.config, s.enabled, s.created_at, s.updated_at,
      COALESCE(MAX(v.version), 1) AS version
      FROM workflow_subscriptions s LEFT JOIN workflow_subscription_versions v
        ON v.subscription_id = s.id WHERE s.id = ?
      GROUP BY s.id, s.kind, s.event_pattern, s.owner_email, s.org_id,
        s.config, s.enabled, s.created_at, s.updated_at LIMIT 1`,
    args: [id],
  });
  return rows[0] ? subscriptionFromRow(rows[0]) : null;
}

export async function listWorkflowSubscriptions(
  options: {
    kind?: WorkflowSubscription["kind"];
    ownerEmail?: string;
    enabled?: boolean;
    limit?: number;
  } = {},
): Promise<WorkflowSubscription[]> {
  await ensureWorkflowSchema();
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (options.kind) {
    clauses.push("s.kind = ?");
    args.push(options.kind);
  }
  if (options.ownerEmail) {
    clauses.push("s.owner_email = ?");
    args.push(options.ownerEmail);
  }
  if (options.enabled != null) {
    clauses.push("s.enabled = ?");
    args.push(booleanValue(options.enabled));
  }
  args.push(Math.min(Math.max(options.limit ?? 100, 1), 500));
  const { rows } = await getDbExec().execute({
    sql: `SELECT s.id, s.kind, s.event_pattern, s.owner_email, s.org_id,
      s.config, s.enabled, s.created_at, s.updated_at,
      COALESCE(MAX(v.version), 1) AS version
      FROM workflow_subscriptions s LEFT JOIN workflow_subscription_versions v
        ON v.subscription_id = s.id
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      GROUP BY s.id, s.kind, s.event_pattern, s.owner_email, s.org_id,
        s.config, s.enabled, s.created_at, s.updated_at
      ORDER BY s.updated_at DESC LIMIT ?`,
    args,
  });
  return rows.map(subscriptionFromRow);
}

export async function listWorkflowEvents(
  options: {
    topic?: string;
    subjectKey?: string;
    limit?: number;
  } = {},
): Promise<WorkflowEvent[]> {
  await ensureWorkflowSchema();
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (options.topic) {
    clauses.push("topic = ?");
    args.push(options.topic);
  }
  if (options.subjectKey) {
    clauses.push("subject_key = ?");
    args.push(options.subjectKey);
  }
  args.push(Math.min(Math.max(options.limit ?? 100, 1), 500));
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, event_sequence, topic, subject_type, subject_id, subject_key, owner_email,
      org_id, payload, actor_context, causal_event_id, occurred_at, available_at,
      created_at FROM workflow_events ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY event_sequence ASC LIMIT ?`,
    args,
  });
  return rows.map(eventFromRow);
}

export async function getWorkflowEvent(
  id: string,
): Promise<WorkflowEvent | null> {
  await ensureWorkflowSchema();
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, event_sequence, topic, subject_type, subject_id, subject_key, owner_email,
      org_id, payload, actor_context, causal_event_id, occurred_at, available_at,
      created_at FROM workflow_events WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return rows[0] ? eventFromRow(rows[0]) : null;
}

function patternMatches(pattern: string, topic: string): boolean {
  return (
    pattern === "*" ||
    pattern === topic ||
    (pattern.endsWith(".*") && topic.startsWith(pattern.slice(0, -1)))
  );
}

async function persistVirtualSubscriptionSnapshot(input: {
  db: DbExec;
  event: WorkflowEvent;
  providerId: string;
  evaluationStartSequence: number;
  snapshot: VirtualWorkflowSubscriptionSnapshot;
}): Promise<void> {
  const { db, event, snapshot } = input;
  if (
    !Number.isSafeInteger(snapshot.version) ||
    snapshot.version < 1 ||
    snapshot.ownerEmail !== event.ownerEmail ||
    (snapshot.orgId ?? null) !== event.orgId ||
    !patternMatches(snapshot.eventPattern, event.topic)
  ) {
    throw new Error(
      `Virtual workflow provider "${input.providerId}" returned an invalid subscription snapshot`,
    );
  }
  const config = canonicalJson(snapshot.config ?? {});
  const enabled = snapshot.enabled !== false;
  const activeAfterSequence = Math.max(
    input.evaluationStartSequence,
    event.eventSequence - 1,
  );
  const existing = await db.execute({
    sql: `SELECT owner_email, org_id FROM workflow_subscriptions
      WHERE id = ? LIMIT 1`,
    args: [snapshot.id],
  });
  if (
    existing.rows[0] &&
    (String(existing.rows[0].owner_email) !== snapshot.ownerEmail ||
      (existing.rows[0].org_id == null
        ? null
        : String(existing.rows[0].org_id)) !== (snapshot.orgId ?? null))
  ) {
    throw new Error(
      `Virtual workflow subscription "${snapshot.id}" collides across authorities`,
    );
  }
  await db.execute({
    sql: `INSERT INTO workflow_subscriptions
      (id, kind, event_pattern, owner_email, org_id, config, enabled,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO NOTHING`,
    args: [
      snapshot.id,
      snapshot.kind,
      snapshot.eventPattern,
      snapshot.ownerEmail,
      snapshot.orgId ?? null,
      config,
      booleanValue(enabled),
      event.createdAt,
      event.createdAt,
    ],
  });
  await db.execute({
    sql: `INSERT INTO workflow_subscription_versions
      (id, subscription_id, version, kind, event_pattern, owner_email, org_id,
       config, enabled, active_after_sequence, active_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (subscription_id, version) DO NOTHING`,
    args: [
      randomUUID(),
      snapshot.id,
      snapshot.version,
      snapshot.kind,
      snapshot.eventPattern,
      snapshot.ownerEmail,
      snapshot.orgId ?? null,
      config,
      booleanValue(enabled),
      activeAfterSequence,
      event.createdAt,
      event.createdAt,
    ],
  });
  await db.execute({
    sql: `UPDATE workflow_subscriptions SET kind = ?, event_pattern = ?,
      owner_email = ?, org_id = ?, config = ?, enabled = ?, updated_at = ?
      WHERE id = ? AND NOT EXISTS (
        SELECT 1 FROM workflow_subscription_versions newer
        WHERE newer.subscription_id = ? AND newer.version > ?
      )`,
    args: [
      snapshot.kind,
      snapshot.eventPattern,
      snapshot.ownerEmail,
      snapshot.orgId ?? null,
      config,
      booleanValue(enabled),
      event.createdAt,
      snapshot.id,
      snapshot.id,
      snapshot.version,
    ],
  });
}

async function materializeVirtualSubscriptionsForEvents(
  db: DbExec,
  events: WorkflowEvent[],
): Promise<void> {
  for (const provider of listVirtualWorkflowSubscriptionProviders()) {
    for (const event of events) {
      if (event.eventSequence <= provider.evaluationStartSequence) continue;
      const snapshots = await provider.subscriptionsForEvent(event);
      for (const snapshot of snapshots) {
        await persistVirtualSubscriptionSnapshot({
          db,
          event,
          providerId: provider.id,
          evaluationStartSequence: provider.evaluationStartSequence,
          snapshot,
        });
      }
    }
  }
}

/** Materialize the unique `(event_id, subscription_id)` work units. */
export async function materializeWorkflowExecutions(
  options: { eventId?: string; limit?: number; now?: number } = {},
): Promise<number> {
  await ensureWorkflowSchema();
  const db = getDbExec();
  const now = options.now ?? Date.now();
  const args: unknown[] = [now];
  let eventWhere = "e.available_at <= ? AND e.materialized_at IS NULL";
  if (options.eventId) {
    eventWhere += " AND e.id = ?";
    args.push(options.eventId);
  }
  args.push(Math.min(Math.max(options.limit ?? 100, 1), 500));
  const { rows: eventRows } = await db.execute({
    sql: `SELECT e.id, e.event_sequence, e.topic, e.subject_type, e.subject_id,
      e.subject_key, e.owner_email, e.org_id, e.payload, e.actor_context,
      e.causal_event_id, e.occurred_at, e.available_at, e.created_at,
      e.materialized_at
      FROM workflow_events e WHERE ${eventWhere}
      ORDER BY e.event_sequence ASC LIMIT ?`,
    args,
  });
  await materializeVirtualSubscriptionsForEvents(
    db,
    eventRows.map(eventFromRow),
  );
  const eventIds = eventRows.map((row) => String(row.id));
  const { rows: candidates } = eventIds.length
    ? await db.execute({
        sql: `SELECT e.id AS event_id, e.topic, e.subject_key,
      e.owner_email AS event_owner_email, e.org_id AS event_org_id,
      e.event_sequence, e.occurred_at, v.subscription_id,
      v.version AS subscription_version,
      v.event_pattern, v.owner_email AS subscription_owner_email,
      v.org_id AS subscription_org_id, v.config AS subscription_config
      FROM workflow_events e JOIN workflow_subscription_versions v
        ON v.active_after_sequence < e.event_sequence
      WHERE e.id IN (${eventIds.map(() => "?").join(", ")})
        AND v.enabled = ? AND NOT EXISTS (
        SELECT 1 FROM workflow_subscription_versions newer
        WHERE newer.subscription_id = v.subscription_id
          AND newer.active_after_sequence < e.event_sequence
          AND (newer.active_after_sequence > v.active_after_sequence OR
            (newer.active_after_sequence = v.active_after_sequence
              AND newer.version > v.version))
      ) ORDER BY e.event_sequence ASC, v.subscription_id ASC`,
        args: [...eventIds, booleanValue(true)],
      })
    : { rows: [] };
  let inserted = 0;
  const ready: Record<string, any>[] = [];
  const deferred: Record<string, any>[] = [];
  for (const candidate of candidates) {
    if (
      !patternMatches(String(candidate.event_pattern), String(candidate.topic))
    )
      continue;
    if (
      String(candidate.subscription_owner_email) !==
      String(candidate.event_owner_email)
    )
      continue;
    if (
      candidate.subscription_org_id != null &&
      String(candidate.subscription_org_id) !==
        String(candidate.event_org_id ?? "")
    )
      continue;
    const controls = await workflowControlForSubscription({
      ownerEmail: String(candidate.subscription_owner_email),
      orgId:
        candidate.subscription_org_id == null
          ? null
          : String(candidate.subscription_org_id),
      config: candidate.subscription_config,
    });
    if (controls?.effective.evaluatorPaused) deferred.push(candidate);
    else ready.push(candidate);
  }
  const persistMaterialization = async (tx: DbExec) => {
    for (const candidate of ready) {
      const result = await tx.execute({
        sql: `INSERT INTO workflow_executions
        (id, event_id, subscription_id, subscription_version, subject_key,
         status, attempt, lease_token, lease_expires_at, fence_version,
         error_message, created_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, 0, NULL, ?, ?, NULL)
        ON CONFLICT (event_id, subscription_id) DO NOTHING`,
        args: [
          randomUUID(),
          candidate.event_id,
          candidate.subscription_id,
          candidate.subscription_version,
          candidate.subject_key,
          now,
          now,
        ],
      });
      inserted += result.rowsAffected ?? 0;
    }
    for (const candidate of deferred) {
      await tx.execute({
        sql: `INSERT INTO workflow_materialization_backlog
          (id, event_id, subscription_id, subscription_version, subject_key, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (event_id, subscription_id) DO NOTHING`,
        args: [
          randomUUID(),
          candidate.event_id,
          candidate.subscription_id,
          candidate.subscription_version,
          candidate.subject_key,
          now,
        ],
      });
    }
    if (eventIds.length) {
      await tx.execute({
        sql: `UPDATE workflow_events SET materialized_at = ?
          WHERE id IN (${eventIds.map(() => "?").join(", ")})
          AND materialized_at IS NULL`,
        args: [now, ...eventIds],
      });
    }
  };
  if (db.transaction) await db.transaction(persistMaterialization);
  else await persistMaterialization(db);

  const { rows: backlog } = await db.execute({
    sql: `SELECT b.id, b.event_id, b.subscription_id, b.subscription_version,
      b.subject_key, v.owner_email AS subscription_owner_email,
      v.org_id AS subscription_org_id, v.config AS subscription_config
      FROM workflow_materialization_backlog b
      JOIN workflow_subscription_versions v
        ON v.subscription_id = b.subscription_id
        AND v.version = b.subscription_version
      ORDER BY b.created_at ASC LIMIT ?`,
    args: [Math.min(Math.max(options.limit ?? 100, 1), 500)],
  });
  for (const [backlogIndex, candidate] of backlog.entries()) {
    const controls = await workflowControlForSubscription({
      ownerEmail: String(candidate.subscription_owner_email),
      orgId:
        candidate.subscription_org_id == null
          ? null
          : String(candidate.subscription_org_id),
      config: candidate.subscription_config,
    });
    if (controls?.effective.evaluatorPaused) {
      await db.execute({
        sql: `UPDATE workflow_materialization_backlog SET created_at = ?
          WHERE id = ?`,
        args: [now + backlogIndex + 1, candidate.id],
      });
      continue;
    }
    const release = async (tx: DbExec) => {
      const result = await tx.execute({
        sql: `INSERT INTO workflow_executions
          (id, event_id, subscription_id, subscription_version, subject_key,
           status, attempt, lease_token, lease_expires_at, fence_version,
           error_message, created_at, updated_at, completed_at)
          VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, 0, NULL, ?, ?, NULL)
          ON CONFLICT (event_id, subscription_id) DO NOTHING`,
        args: [
          randomUUID(),
          candidate.event_id,
          candidate.subscription_id,
          candidate.subscription_version,
          candidate.subject_key,
          now,
          now,
        ],
      });
      await tx.execute({
        sql: "DELETE FROM workflow_materialization_backlog WHERE id = ?",
        args: [candidate.id],
      });
      inserted += result.rowsAffected ?? 0;
    };
    if (db.transaction) await db.transaction(release);
    else await release(db);
  }
  return inserted;
}

export async function getWorkflowExecution(id: string): Promise<{
  id: string;
  eventId: string;
  subscriptionId: string;
  subscriptionVersion: number;
  status: WorkflowExecutionStatus;
  attempt: number;
  fenceVersion: number;
  leaseExpiresAt: number | null;
  errorMessage: string | null;
} | null> {
  await ensureWorkflowSchema();
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, event_id, subscription_id, subscription_version, status, attempt,
      fence_version, lease_expires_at, error_message
      FROM workflow_executions WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    subscriptionId: String(row.subscription_id),
    subscriptionVersion: Number(row.subscription_version),
    status: String(row.status) as WorkflowExecutionStatus,
    attempt: Number(row.attempt),
    fenceVersion: Number(row.fence_version),
    leaseExpiresAt:
      row.lease_expires_at == null ? null : Number(row.lease_expires_at),
    errorMessage: row.error_message == null ? null : String(row.error_message),
  };
}

/** Queue an explicit operator retry without introducing a second worker. */
export async function retryWorkflowExecution(input: {
  executionId: string;
  now?: number;
}): Promise<boolean> {
  await ensureWorkflowSchema();
  const now = input.now ?? Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE workflow_executions SET status = 'pending', lease_token = NULL,
      lease_expires_at = NULL, error_message = NULL, completed_at = NULL,
      updated_at = ? WHERE id = ? AND status IN ('failed', 'unknown')`,
    args: [now, input.executionId],
  });
  if ((result.rowsAffected ?? 0) > 0) {
    emitWorkflowWake({
      topic: "workflow.event.available",
      rowId: input.executionId,
    });
    return true;
  }
  return false;
}

/** Accept an indeterminate outcome as terminal without pretending it delivered. */
export async function acknowledgeWorkflowExecution(input: {
  executionId: string;
  now?: number;
}): Promise<boolean> {
  await ensureWorkflowSchema();
  const now = input.now ?? Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE workflow_executions SET status = 'acknowledged',
      lease_token = NULL, lease_expires_at = NULL, updated_at = ?,
      completed_at = COALESCE(completed_at, ?)
      WHERE id = ? AND status = 'unknown'`,
    args: [now, now, input.executionId],
  });
  return (result.rowsAffected ?? 0) > 0;
}

export async function listWorkflowExecutions(
  options: {
    eventId?: string;
    subscriptionId?: string;
    status?: WorkflowExecutionStatus;
    limit?: number;
  } = {},
) {
  await ensureWorkflowSchema();
  const clauses: string[] = [];
  const args: unknown[] = [];
  for (const [column, value] of [
    ["event_id", options.eventId],
    ["subscription_id", options.subscriptionId],
    ["status", options.status],
  ] as const) {
    if (value) {
      clauses.push(`${column} = ?`);
      args.push(value);
    }
  }
  args.push(Math.min(Math.max(options.limit ?? 100, 1), 500));
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, event_id, subscription_id, subscription_version,
      subject_key, status, attempt,
      lease_token, lease_expires_at, fence_version, error_message, created_at,
      updated_at, completed_at FROM workflow_executions
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY created_at DESC LIMIT ?`,
    args,
  });
  return rows.map((row) => ({
    id: String(row.id),
    eventId: String(row.event_id),
    subscriptionId: String(row.subscription_id),
    subscriptionVersion: Number(row.subscription_version),
    subjectKey: String(row.subject_key),
    status: String(row.status) as WorkflowExecutionStatus,
    attempt: Number(row.attempt),
    leaseToken: row.lease_token == null ? null : String(row.lease_token),
    leaseExpiresAt:
      row.lease_expires_at == null ? null : Number(row.lease_expires_at),
    fenceVersion: Number(row.fence_version),
    errorMessage: row.error_message == null ? null : String(row.error_message),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
  }));
}

export async function claimNextWorkflowExecution(options: {
  workerId: string;
  leaseMs?: number;
  now?: number;
}): Promise<ClaimedWorkflowExecution | null> {
  await ensureWorkflowSchema();
  const db = getDbExec();
  const now = options.now ?? Date.now();
  const leaseMs = Math.min(
    Math.max(options.leaseMs ?? 60_000, 1_000),
    15 * 60_000,
  );
  await materializeWorkflowExecutions({ now });
  await db.execute({
    sql: `UPDATE workflow_executions SET status = 'pending', lease_token = NULL,
      lease_expires_at = NULL, updated_at = ?
      WHERE status = 'running' AND lease_expires_at <= ?`,
    args: [now, now],
  });

  for (let race = 0; race < 5; race += 1) {
    const { rows } = await db.execute({
      sql: `SELECT x.id, x.fence_version,
        v.owner_email AS subscription_owner_email,
        v.org_id AS subscription_org_id, v.config AS subscription_config
        FROM workflow_executions x
        JOIN workflow_events e ON e.id = x.event_id
        JOIN workflow_subscription_versions v
          ON v.subscription_id = x.subscription_id
          AND v.version = x.subscription_version
        WHERE x.status = 'pending'
          AND e.available_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM workflow_executions prior
            JOIN workflow_events pe ON pe.id = prior.event_id
            WHERE prior.subject_key = x.subject_key
              AND prior.status IN ('pending', 'retrying', 'running', 'unknown')
              AND pe.event_sequence < e.event_sequence
          )
        ORDER BY e.event_sequence ASC, x.created_at ASC LIMIT 25`,
      args: [now],
    });
    if (!rows[0]) return null;
    let foundEligible = false;
    for (const row of rows) {
      const controls = await workflowControlForSubscription({
        ownerEmail: String(row.subscription_owner_email),
        orgId:
          row.subscription_org_id == null
            ? null
            : String(row.subscription_org_id),
        config: row.subscription_config,
      });
      if (controls?.effective.effectsPaused) continue;
      foundEligible = true;
      const id = String(row.id);
      const fence = Number(row.fence_version ?? 0);
      const leaseToken = `${options.workerId}:${randomUUID()}`;
      const result = await db.execute({
        sql: `UPDATE workflow_executions SET status = 'running',
          attempt = attempt + 1, lease_token = ?, lease_expires_at = ?,
          fence_version = fence_version + 1, updated_at = ?
          WHERE id = ? AND fence_version = ? AND status = 'pending'`,
        args: [leaseToken, now + leaseMs, now, id, fence],
      });
      if ((result.rowsAffected ?? 0) === 0) continue;
      const claimed = await getClaimedExecution(id, leaseToken, fence + 1);
      if (claimed) return claimed;
    }
    if (!foundEligible) return null;
  }
  return null;
}

async function getClaimedExecution(
  id: string,
  leaseToken: string,
  fenceVersion: number,
): Promise<ClaimedWorkflowExecution | null> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT x.id AS execution_id, x.event_id, x.subscription_id,
      x.subscription_version,
      x.status, x.attempt, x.lease_token, x.lease_expires_at, x.fence_version,
      e.id, e.event_sequence, e.topic, e.subject_type, e.subject_id, e.subject_key,
      e.owner_email AS event_owner_email, e.org_id AS event_org_id,
      e.payload, e.actor_context, e.causal_event_id, e.occurred_at,
      e.available_at, e.created_at AS event_created_at,
      v.kind, v.event_pattern, v.owner_email AS subscription_owner_email,
      v.org_id AS subscription_org_id, v.config, v.enabled,
      v.created_at AS subscription_created_at,
      v.active_at AS subscription_updated_at
      FROM workflow_executions x
      JOIN workflow_events e ON e.id = x.event_id
      JOIN workflow_subscription_versions v
        ON v.subscription_id = x.subscription_id
        AND v.version = x.subscription_version
      WHERE x.id = ? AND x.lease_token = ? AND x.fence_version = ? LIMIT 1`,
    args: [id, leaseToken, fenceVersion],
  });
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    id: String(row.execution_id),
    eventId: String(row.event_id),
    subscriptionId: String(row.subscription_id),
    subscriptionVersion: Number(row.subscription_version),
    status: "running",
    attempt: Number(row.attempt),
    leaseToken: String(row.lease_token),
    leaseExpiresAt: Number(row.lease_expires_at),
    fenceVersion: Number(row.fence_version),
    event: eventFromRow({
      ...row,
      owner_email: row.event_owner_email,
      org_id: row.event_org_id,
      created_at: row.event_created_at,
    }),
    subscription: subscriptionFromRow({
      id: row.subscription_id,
      version: row.subscription_version,
      kind: row.kind,
      event_pattern: row.event_pattern,
      owner_email: row.subscription_owner_email,
      org_id: row.subscription_org_id,
      config: row.config,
      enabled: row.enabled,
      created_at: row.subscription_created_at,
      updated_at: row.subscription_updated_at,
    }),
  };
}

export async function finalizeWorkflowExecution(input: {
  executionId: string;
  leaseToken: string;
  fenceVersion: number;
  status: Exclude<WorkflowExecutionStatus, "pending" | "running">;
  errorMessage?: string;
  now?: number;
}): Promise<boolean> {
  await ensureWorkflowSchema();
  const now = input.now ?? Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE workflow_executions SET status = ?, error_message = ?,
      lease_token = NULL, lease_expires_at = NULL, updated_at = ?,
      completed_at = ? WHERE id = ? AND status = 'running'
      AND lease_token = ? AND fence_version = ?`,
    args: [
      input.status,
      input.errorMessage?.slice(0, 2_000) ?? null,
      now,
      input.status === "retrying" ? null : now,
      input.executionId,
      input.leaseToken,
      input.fenceVersion,
    ],
  });
  return (result.rowsAffected ?? 0) > 0;
}

export interface WorkflowEffect {
  id: string;
  executionId: string;
  kind: string;
  idempotencyKey: string;
  status: WorkflowEffectStatus;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Reserve an effect before I/O. A replay receives the existing ledger row. */
export async function recordWorkflowEffect(input: {
  executionId: string;
  kind: string;
  idempotencyKey: string;
  now?: number;
}): Promise<{ effect: WorkflowEffect; created: boolean }> {
  await ensureWorkflowSchema();
  const db = getDbExec();
  const now = input.now ?? Date.now();
  const id = randomUUID();
  const inserted = await db.execute({
    sql: `INSERT INTO workflow_effects
      (id, execution_id, kind, idempotency_key, status, result, error_message,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, 'unknown', NULL, NULL, ?, ?)
      ON CONFLICT (idempotency_key) DO NOTHING`,
    args: [id, input.executionId, input.kind, input.idempotencyKey, now, now],
  });
  const effect = await getWorkflowEffectByIdempotencyKey(input.idempotencyKey);
  if (!effect) throw new Error("Workflow effect reservation was not persisted");
  return { effect, created: (inserted.rowsAffected ?? 0) > 0 };
}

export async function finalizeWorkflowEffect(input: {
  effectId: string;
  status: WorkflowEffectStatus;
  result?: Record<string, unknown>;
  errorMessage?: string;
  now?: number;
}): Promise<boolean> {
  await ensureWorkflowSchema();
  const result = await getDbExec().execute({
    sql: `UPDATE workflow_effects SET status = ?, result = ?,
      error_message = ?, updated_at = ? WHERE id = ?`,
    args: [
      input.status,
      input.result ? json(input.result) : null,
      input.errorMessage?.slice(0, 2_000) ?? null,
      input.now ?? Date.now(),
      input.effectId,
    ],
  });
  return (result.rowsAffected ?? 0) > 0;
}

/**
 * Claim a known-failed effect for one retry before provider I/O. A crash after
 * this transition leaves the effect unknown, which blocks automatic replay.
 */
export async function claimWorkflowEffectRetry(input: {
  effectId: string;
  now?: number;
}): Promise<boolean> {
  await ensureWorkflowSchema();
  const result = await getDbExec().execute({
    sql: `UPDATE workflow_effects SET status = 'unknown', result = NULL,
      error_message = NULL, updated_at = ? WHERE id = ? AND status = 'failed'`,
    args: [input.now ?? Date.now(), input.effectId],
  });
  return (result.rowsAffected ?? 0) > 0;
}

export async function getWorkflowEffectByIdempotencyKey(
  idempotencyKey: string,
): Promise<WorkflowEffect | null> {
  await ensureWorkflowSchema();
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, execution_id, kind, idempotency_key, status, result,
      error_message, created_at, updated_at FROM workflow_effects
      WHERE idempotency_key = ? LIMIT 1`,
    args: [idempotencyKey],
  });
  return rows[0] ? effectFromRow(rows[0]) : null;
}

export async function recordNotificationDeliveryAttempt(input: {
  effectId: string;
  notificationId?: string | null;
  channel: string;
  attempt: number;
  status: WorkflowDeliveryStatus;
  errorMessage?: string;
  now?: number;
}): Promise<string> {
  await ensureWorkflowSchema();
  const db = getDbExec();
  const now = input.now ?? Date.now();
  const existing = await db.execute({
    sql: `SELECT id FROM notification_delivery_attempts
      WHERE effect_id = ? AND channel = ? AND attempt = ? LIMIT 1`,
    args: [input.effectId, input.channel, input.attempt],
  });
  const id = existing.rows[0]?.id ? String(existing.rows[0].id) : randomUUID();
  if (existing.rows.length) {
    await db.execute({
      sql: `UPDATE notification_delivery_attempts SET notification_id = ?,
        status = ?, error_message = ?, updated_at = ? WHERE id = ?`,
      args: [
        input.notificationId ?? null,
        input.status,
        input.errorMessage?.slice(0, 2_000) ?? null,
        now,
        id,
      ],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO notification_delivery_attempts
        (id, effect_id, notification_id, channel, attempt, status,
         error_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.effectId,
        input.notificationId ?? null,
        input.channel,
        input.attempt,
        input.status,
        input.errorMessage?.slice(0, 2_000) ?? null,
        now,
        now,
      ],
    });
  }
  return id;
}

export async function listNotificationDeliveryAttempts(effectId: string) {
  await ensureWorkflowSchema();
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, effect_id, notification_id, channel, attempt, status,
      error_message, created_at, updated_at FROM notification_delivery_attempts
      WHERE effect_id = ? ORDER BY channel ASC, attempt ASC`,
    args: [effectId],
  });
  return rows.map((row) => ({
    id: String(row.id),
    effectId: String(row.effect_id),
    notificationId:
      row.notification_id == null ? null : String(row.notification_id),
    channel: String(row.channel),
    attempt: Number(row.attempt),
    status: String(row.status) as WorkflowEffectStatus,
    errorMessage: row.error_message == null ? null : String(row.error_message),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
}

export async function scheduleWorkflowWork(input: {
  id?: string;
  workType: string;
  subjectKey: string;
  eventId?: string | null;
  subscriptionId?: string | null;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
  dueAt: number;
  now?: number;
}): Promise<string> {
  await ensureWorkflowSchema();
  const db = getDbExec();
  const now = input.now ?? Date.now();
  if (input.dedupeKey) {
    const existing = await db.execute({
      sql: `SELECT id FROM workflow_scheduled_work WHERE dedupe_key = ? LIMIT 1`,
      args: [input.dedupeKey],
    });
    if (existing.rows[0]?.id) {
      const id = String(existing.rows[0].id);
      await db.execute({
        sql: `UPDATE workflow_scheduled_work SET work_type = ?, subject_key = ?,
          event_id = ?, subscription_id = ?, payload = ?, due_at = ?,
          status = 'pending', lease_token = NULL, lease_expires_at = NULL,
          attempt = 0, error_message = NULL, completed_at = NULL,
          updated_at = ? WHERE id = ? AND status <> 'running'`,
        args: [
          input.workType,
          input.subjectKey,
          input.eventId ?? null,
          input.subscriptionId ?? null,
          json(input.payload),
          input.dueAt,
          now,
          id,
        ],
      });
      emitWorkflowWake({
        topic: "workflow.scheduled-work.available",
        rowId: id,
      });
      return id;
    }
  }
  const id = input.id ?? randomUUID();
  await db.execute({
    sql: `INSERT INTO workflow_scheduled_work
      (id, work_type, subject_key, event_id, subscription_id, payload,
       dedupe_key, due_at, status, attempt, lease_token, lease_expires_at,
       fence_version, error_message, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, 0, NULL, NULL, ?, ?)`,
    args: [
      id,
      input.workType,
      input.subjectKey,
      input.eventId ?? null,
      input.subscriptionId ?? null,
      json(input.payload),
      input.dedupeKey ?? null,
      input.dueAt,
      now,
      now,
    ],
  });
  emitWorkflowWake({ topic: "workflow.scheduled-work.available", rowId: id });
  return id;
}

export async function cancelWorkflowWork(
  id: string,
  options: { now?: number } = {},
): Promise<boolean> {
  await ensureWorkflowSchema();
  const result = await getDbExec().execute({
    sql: `UPDATE workflow_scheduled_work SET status = 'cancelled',
      updated_at = ? WHERE id = ? AND status = 'pending'`,
    args: [options.now ?? Date.now(), id],
  });
  return (result.rowsAffected ?? 0) > 0;
}

export interface ClaimedScheduledWork {
  id: string;
  workType: string;
  subjectKey: string;
  eventId: string | null;
  subscriptionId: string | null;
  payload: Record<string, unknown>;
  attempt: number;
  leaseToken: string;
  leaseExpiresAt: number;
  fenceVersion: number;
}

export async function claimNextScheduledWork(input: {
  workerId: string;
  leaseMs?: number;
  now?: number;
}): Promise<ClaimedScheduledWork | null> {
  await ensureWorkflowSchema();
  const db = getDbExec();
  const now = input.now ?? Date.now();
  const leaseMs = Math.min(
    Math.max(input.leaseMs ?? 60_000, 1_000),
    15 * 60_000,
  );
  await db.execute({
    sql: `UPDATE workflow_scheduled_work SET status = 'pending',
      lease_token = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE status = 'running' AND lease_expires_at <= ?`,
    args: [now, now],
  });
  for (let race = 0; race < 5; race += 1) {
    const { rows } = await db.execute({
      sql: `SELECT w.id, w.fence_version,
        s.owner_email AS subscription_owner_email,
        s.org_id AS subscription_org_id, s.config AS subscription_config
        FROM workflow_scheduled_work w
        LEFT JOIN workflow_subscriptions s ON s.id = w.subscription_id
        WHERE w.status = 'pending' AND w.due_at <= ?
        ORDER BY w.due_at ASC, w.id ASC LIMIT 25`,
      args: [now],
    });
    if (!rows[0]) return null;
    let foundEligible = false;
    for (const candidate of rows) {
      const controls = candidate.subscription_owner_email
        ? await workflowControlForSubscription({
            ownerEmail: String(candidate.subscription_owner_email),
            orgId:
              candidate.subscription_org_id == null
                ? null
                : String(candidate.subscription_org_id),
            config: candidate.subscription_config,
          })
        : null;
      if (controls?.effective.effectsPaused) continue;
      foundEligible = true;
      const id = String(candidate.id);
      const fence = Number(candidate.fence_version ?? 0);
      const token = `${input.workerId}:${randomUUID()}`;
      const result = await db.execute({
        sql: `UPDATE workflow_scheduled_work SET status = 'running',
          attempt = attempt + 1, lease_token = ?, lease_expires_at = ?,
          fence_version = fence_version + 1, updated_at = ?
          WHERE id = ? AND status = 'pending' AND fence_version = ?`,
        args: [token, now + leaseMs, now, id, fence],
      });
      if ((result.rowsAffected ?? 0) === 0) continue;
      const fetched = await db.execute({
        sql: `SELECT id, work_type, subject_key, event_id, subscription_id,
          payload, attempt, lease_token, lease_expires_at, fence_version
          FROM workflow_scheduled_work WHERE id = ? AND lease_token = ? LIMIT 1`,
        args: [id, token],
      });
      const row = fetched.rows[0];
      if (!row) continue;
      return {
        id,
        workType: String(row.work_type),
        subjectKey: String(row.subject_key),
        eventId: row.event_id == null ? null : String(row.event_id),
        subscriptionId:
          row.subscription_id == null ? null : String(row.subscription_id),
        payload: safeJsonParse(String(row.payload), {}),
        attempt: Number(row.attempt),
        leaseToken: token,
        leaseExpiresAt: Number(row.lease_expires_at),
        fenceVersion: Number(row.fence_version),
      };
    }
    if (!foundEligible) return null;
  }
  return null;
}

export async function finalizeScheduledWork(input: {
  id: string;
  leaseToken: string;
  fenceVersion: number;
  status: "completed" | "failed" | "dead_letter" | "pending";
  errorMessage?: string;
  dueAt?: number;
  now?: number;
}): Promise<boolean> {
  await ensureWorkflowSchema();
  const result = await getDbExec().execute({
    sql: `UPDATE workflow_scheduled_work SET status = ?, lease_token = NULL,
      lease_expires_at = NULL, error_message = ?,
      due_at = COALESCE(?, due_at), updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'running'
      AND lease_token = ? AND fence_version = ?`,
    args: [
      input.status,
      input.errorMessage?.slice(0, 2_000) ?? null,
      input.dueAt ?? null,
      input.now ?? Date.now(),
      input.status === "pending" ? null : (input.now ?? Date.now()),
      input.id,
      input.leaseToken,
      input.fenceVersion,
    ],
  });
  return (result.rowsAffected ?? 0) > 0;
}

/** Release an execution only when its durable retry timer fires. */
export async function releaseWorkflowExecutionRetry(input: {
  executionId: string;
  expectedAttempt: number;
  now?: number;
}): Promise<boolean> {
  await ensureWorkflowSchema();
  const result = await getDbExec().execute({
    sql: `UPDATE workflow_executions SET status = 'pending', lease_token = NULL,
      lease_expires_at = NULL, updated_at = ? WHERE id = ? AND attempt = ?
      AND (status = 'retrying' OR
        (status = 'running' AND lease_expires_at <= ?))`,
    args: [
      input.now ?? Date.now(),
      input.executionId,
      input.expectedAttempt,
      input.now ?? Date.now(),
    ],
  });
  return (result.rowsAffected ?? 0) > 0;
}

function eventFromRow(row: Record<string, unknown>): WorkflowEvent {
  return {
    id: String(row.id),
    eventSequence: Number(row.event_sequence),
    topic: String(row.topic),
    subjectType: String(row.subject_type),
    subjectId: String(row.subject_id),
    subjectKey: String(row.subject_key),
    ownerEmail: String(row.owner_email),
    orgId: row.org_id == null ? null : String(row.org_id),
    payload: safeJsonParse(String(row.payload ?? "{}"), {}),
    actorContext: safeJsonParse(String(row.actor_context ?? "{}"), {}),
    causalEventId:
      row.causal_event_id == null ? null : String(row.causal_event_id),
    occurredAt: Number(row.occurred_at),
    availableAt: Number(row.available_at),
    createdAt: Number(row.created_at),
  };
}

function subscriptionFromRow(
  row: Record<string, unknown>,
): WorkflowSubscription {
  return {
    id: String(row.id),
    version: Number(row.version ?? 1),
    kind: String(row.kind) as WorkflowSubscription["kind"],
    eventPattern: String(row.event_pattern),
    ownerEmail: String(row.owner_email),
    orgId: row.org_id == null ? null : String(row.org_id),
    config: safeJsonParse(String(row.config ?? "{}"), {}),
    enabled: row.enabled === true || Number(row.enabled) === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function effectFromRow(row: Record<string, unknown>): WorkflowEffect {
  return {
    id: String(row.id),
    executionId: String(row.execution_id),
    kind: String(row.kind),
    idempotencyKey: String(row.idempotency_key),
    status: String(row.status) as WorkflowDeliveryStatus,
    result: row.result ? safeJsonParse(String(row.result), null) : null,
    errorMessage: row.error_message == null ? null : String(row.error_message),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function __resetWorkflowSchemaForTests(): void {
  schemaPromise = undefined;
}
