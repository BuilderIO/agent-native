import {
  getDbExec,
  intType,
  isPostgres,
  retryOnDdlRace,
} from "../db/client.js";
import {
  ensureColumnExists,
  ensureTableExists,
  ensureIndexExists,
} from "../db/ddl-guard.js";
import {
  authorizeComputerOperation,
  ensureComputerApprovalStore,
} from "./computer-supervision-store.js";
import {
  assertValidComputerCommandEnvelope,
  ComputerSupervisionError,
} from "./computer-supervision.js";
import {
  getRemoteComputerCapabilities,
  getRemoteDeviceForOwner,
} from "./remote-devices-store.js";
import {
  assertNoBinaryPayload,
  serializeBoundedRemoteJson,
} from "./remote-json-safety.js";
import type {
  ComputerCommandEnvelope,
  ComputerOperationClass,
  RemoteCommand,
  RemoteCommandKind,
  RemoteCommandStatus,
} from "./remote-types.js";

let _initPromise: Promise<void> | undefined;

const REMOTE_COMMAND_KINDS: RemoteCommandKind[] = [
  "create-run",
  "list-runs",
  "get-run",
  "append-followup",
  "approve",
  "deny",
  "stop",
  "status",
];

const TERMINAL_STATUSES = new Set<RemoteCommandStatus>(["completed", "failed"]);

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createSql = `CREATE TABLE IF NOT EXISTS integration_remote_commands (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  kind TEXT NOT NULL,
  params_json TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  platform TEXT,
  external_thread_id TEXT,
  computer_task_id TEXT,
  computer_run_id TEXT,
  computer_sequence ${intType()},
  idempotency_key TEXT,
  operation_class TEXT,
  approval_scope TEXT,
  action_hash TEXT,
  lease_expires_at ${intType()},
  attempts ${intType()} NOT NULL DEFAULT 0,
  next_check_at ${intType()} NOT NULL,
  claimed_at ${intType()},
  completed_at ${intType()},
  error_message TEXT,
  created_at ${intType()} NOT NULL,
  updated_at ${intType()} NOT NULL
)`;

      if (isPostgres()) {
        // PG guard: probe via information_schema, only issue DDL if missing, bounded lock_timeout
        await ensureTableExists("integration_remote_commands", createSql);
        await ensureComputerCommandColumns();
        await ensureIndexExists(
          "idx_remote_commands_device_status_next",
          `CREATE INDEX IF NOT EXISTS idx_remote_commands_device_status_next ON integration_remote_commands(device_id, status, next_check_at)`,
        );
        await ensureIndexExists(
          "idx_remote_commands_owner",
          `CREATE INDEX IF NOT EXISTS idx_remote_commands_owner ON integration_remote_commands(owner_email, org_id)`,
        );
        await ensureComputerCommandIndexes();
        return;
      }

      // SQLite: keep existing behavior
      await retryOnDdlRace(() => client.execute(createSql));
      await ensureComputerCommandColumns();
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_remote_commands_device_status_next ON integration_remote_commands(device_id, status, next_check_at)`,
        ),
      );
      await ensureComputerCommandIndexes();
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_remote_commands_owner ON integration_remote_commands(owner_email, org_id)`,
        ),
      );
    })().catch((err) => {
      // Retry init on the next call after a failed startup.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

function rowToCommand(row: Record<string, unknown>): RemoteCommand {
  const params = parseJson(row.params_json, {});
  return {
    id: row.id as string,
    deviceId: row.device_id as string,
    ownerEmail: row.owner_email as string,
    orgId: (row.org_id as string | null) ?? null,
    kind: row.kind as RemoteCommandKind,
    params,
    status: row.status as RemoteCommandStatus,
    result: parseJson(row.result_json, null),
    platform: (row.platform as string | null) ?? null,
    externalThreadId: (row.external_thread_id as string | null) ?? null,
    computerOperation:
      row.kind === "computer-operation"
        ? ((params as { envelope?: ComputerCommandEnvelope })?.envelope ?? null)
        : null,
    attempts: Number(row.attempts ?? 0),
    nextCheckAt: Number(row.next_check_at ?? 0),
    claimedAt: row.claimed_at == null ? null : Number(row.claimed_at as number),
    completedAt:
      row.completed_at == null ? null : Number(row.completed_at as number),
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

async function ensureComputerCommandColumns(): Promise<void> {
  const columns: Array<[string, string]> = [
    ["computer_task_id", "TEXT"],
    ["computer_run_id", "TEXT"],
    ["computer_sequence", intType()],
    ["idempotency_key", "TEXT"],
    ["operation_class", "TEXT"],
    ["approval_scope", "TEXT"],
    ["action_hash", "TEXT"],
    ["lease_expires_at", intType()],
  ];
  for (const [name, definition] of columns) {
    const sql = `ALTER TABLE integration_remote_commands ADD COLUMN${isPostgres() ? " IF NOT EXISTS" : ""} ${name} ${definition}`;
    if (isPostgres()) {
      await ensureColumnExists("integration_remote_commands", name, sql);
      continue;
    }
    try {
      await retryOnDdlRace(() => getDbExec().execute(sql));
    } catch (error) {
      if (!isDuplicateColumnError(error)) throw error;
    }
  }
}

async function ensureComputerCommandIndexes(): Promise<void> {
  const indexes = [
    [
      "idx_remote_commands_computer_sequence",
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_commands_computer_sequence ON integration_remote_commands(device_id, computer_task_id, computer_run_id, computer_sequence)`,
    ],
    [
      "idx_remote_commands_idempotency",
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_commands_idempotency ON integration_remote_commands(device_id, idempotency_key)`,
    ],
  ] as const;
  for (const [name, sql] of indexes) {
    if (isPostgres()) await ensureIndexExists(name, sql);
    else await retryOnDdlRace(() => getDbExec().execute(sql));
  }
}

export function isRemoteCommandKind(
  value: unknown,
): value is RemoteCommandKind {
  return (
    typeof value === "string" &&
    REMOTE_COMMAND_KINDS.includes(value as RemoteCommandKind)
  );
}

export async function enqueueRemoteCommand(input: {
  deviceId: string;
  ownerEmail: string;
  orgId?: string | null;
  kind: RemoteCommandKind;
  params?: unknown;
  platform?: string | null;
  externalThreadId?: string | null;
  nextCheckAt?: number;
}): Promise<RemoteCommand> {
  if (input.kind === "computer-operation") {
    throw new ComputerSupervisionError(
      "invalid-envelope",
      "Computer operations must use enqueueComputerCommand",
    );
  }
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const id = `remote-command-${now}-${randomHex(8)}`;

  await client.execute({
    sql: `INSERT INTO integration_remote_commands
      (id, device_id, owner_email, org_id, kind, params_json, status, result_json,
       platform, external_thread_id, attempts, next_check_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.deviceId,
      input.ownerEmail,
      input.orgId ?? null,
      input.kind,
      JSON.stringify(input.params ?? {}),
      "pending",
      null,
      input.platform ?? null,
      input.externalThreadId ?? null,
      0,
      input.nextCheckAt ?? now,
      now,
      now,
    ],
  });

  const command = await getRemoteCommand(id);
  if (!command) throw new Error("remote command insert failed");
  return command;
}

export async function enqueueComputerCommand(input: {
  deviceId: string;
  ownerEmail: string;
  orgId?: string | null;
  envelope: ComputerCommandEnvelope;
  platform?: string | null;
}): Promise<RemoteCommand> {
  const envelope = await assertValidComputerCommandEnvelope(input.envelope);
  const device = await getRemoteDeviceForOwner({
    id: input.deviceId,
    ownerEmail: input.ownerEmail,
    orgId: input.orgId,
  });
  if (!device || device.status !== "active") {
    throw new ComputerSupervisionError(
      "approval-mismatch",
      "Computer device does not belong to this owner and organization",
    );
  }
  const capabilities = getRemoteComputerCapabilities(device);
  const [surface, mode] = envelope.operationClass.split(".") as [
    "browser" | "desktop",
    "observe" | "control",
  ];
  if (capabilities?.[surface]?.[mode] !== true) {
    throw new ComputerSupervisionError(
      "approval-denied",
      `Remote device did not advertise ${envelope.operationClass}`,
    );
  }
  await ensureTable();
  await ensureComputerApprovalStore();
  const client = getDbExec();
  const insert = async (tx: typeof client): Promise<string> => {
    await authorizeComputerOperation({ ...input, envelope }, tx);
    const now = Date.now();
    const id = `remote-command-${now}-${randomHex(8)}`;
    try {
      await tx.execute({
        sql: `INSERT INTO integration_remote_commands
          (id, device_id, owner_email, org_id, kind, params_json, status,
           result_json, platform, external_thread_id, computer_task_id,
           computer_run_id, computer_sequence, idempotency_key, operation_class,
           approval_scope, action_hash, lease_expires_at, attempts, next_check_at,
           created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          input.deviceId,
          input.ownerEmail,
          input.orgId ?? null,
          "computer-operation",
          JSON.stringify({ envelope }),
          "pending",
          null,
          input.platform ?? null,
          null,
          envelope.taskId,
          envelope.runId,
          envelope.sequence,
          envelope.idempotencyKey,
          envelope.operationClass,
          envelope.approval.scope,
          envelope.approval.actionHash,
          envelope.leaseExpiresAt,
          0,
          now,
          now,
          now,
        ],
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ComputerSupervisionError(
          "replay",
          "Computer operation sequence or idempotency key was already used",
        );
      }
      throw error;
    }
    return id;
  };
  const id = client.transaction
    ? await client.transaction((tx) => insert(tx))
    : await insert(client);
  const command = await getRemoteCommand(id);
  if (!command) throw new Error("computer command insert failed");
  return command;
}

export async function getRemoteCommand(
  id: string,
): Promise<RemoteCommand | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM integration_remote_commands WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return rows[0] ? rowToCommand(rows[0] as Record<string, unknown>) : null;
}

export async function listRemoteCommandsForOwner(input: {
  ownerEmail: string;
  orgId?: string | null;
  limit?: number;
}): Promise<RemoteCommand[]> {
  await ensureTable();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 250));
  if (!Object.prototype.hasOwnProperty.call(input, "orgId")) {
    const { rows } = await getDbExec().execute({
      sql: `SELECT * FROM integration_remote_commands
            WHERE owner_email = ?
            ORDER BY updated_at DESC
            LIMIT ?`,
      args: [input.ownerEmail, limit],
    });
    return rows.map((row) => rowToCommand(row as Record<string, unknown>));
  }
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM integration_remote_commands
          WHERE owner_email = ?
            AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)
          ORDER BY updated_at DESC
          LIMIT ?`,
    args: [input.ownerEmail, input.orgId ?? null, input.orgId ?? null, limit],
  });
  return rows.map((row) => rowToCommand(row as Record<string, unknown>));
}

export async function claimNextRemoteCommand(
  deviceId: string,
): Promise<RemoteCommand | null> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const { rows } = await client.execute({
    sql: `SELECT id FROM integration_remote_commands
          WHERE device_id = ?
            AND status = 'pending'
            AND kind <> 'computer-operation'
            AND next_check_at <= ?
          ORDER BY created_at ASC
          LIMIT 1`,
    args: [deviceId, now],
  });
  const id = rows[0]?.id as string | undefined;
  if (!id) return null;

  const result = await client.execute({
    sql: isPostgres()
      ? `UPDATE integration_remote_commands
          SET status = ?, attempts = attempts + 1, claimed_at = ?, updated_at = ?
          WHERE id = ? AND device_id = ? AND status = 'pending'
          RETURNING *`
      : `UPDATE integration_remote_commands
          SET status = ?, attempts = attempts + 1, claimed_at = ?, updated_at = ?
          WHERE id = ? AND device_id = ? AND status = 'pending'`,
    args: ["claimed", now, now, id, deviceId],
  });
  if (isPostgres()) {
    const row = result.rows?.[0];
    return row ? rowToCommand(row as Record<string, unknown>) : null;
  }
  const affected = result.rowsAffected ?? (result as any).rowCount;
  if (affected === 0) return null;

  const command = await getRemoteCommand(id);
  if (!command || command.status !== "claimed") return null;
  return command;
}

export async function claimNextComputerCommand(input: {
  deviceId: string;
  ownerEmail: string;
  orgId?: string | null;
  operationClasses?: ComputerOperationClass[];
  now?: number;
}): Promise<RemoteCommand | null> {
  await ensureTable();
  if (input.operationClasses?.length === 0) return null;
  const client = getDbExec();
  const now = input.now ?? Date.now();
  const operationClassClause = input.operationClasses?.length
    ? ` AND operation_class IN (${input.operationClasses.map(() => "?").join(", ")})`
    : "";
  const { rows } = await client.execute({
    sql: `SELECT * FROM integration_remote_commands
          WHERE device_id = ? AND owner_email = ?
            AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)
            AND kind = 'computer-operation' AND status = 'pending'
            AND next_check_at <= ?${operationClassClause}
          ORDER BY computer_sequence ASC, created_at ASC
          LIMIT 1`,
    args: [
      input.deviceId,
      input.ownerEmail,
      input.orgId ?? null,
      input.orgId ?? null,
      now,
      ...(input.operationClasses ?? []),
    ],
  });
  if (!rows[0]) return null;
  const candidate = rowToCommand(rows[0] as Record<string, unknown>);
  try {
    const envelope = await assertValidComputerCommandEnvelope(
      candidate.computerOperation,
      { now },
    );
    const row = rows[0] as Record<string, unknown>;
    if (
      envelope.taskId !== row.computer_task_id ||
      envelope.runId !== row.computer_run_id ||
      envelope.sequence !== Number(row.computer_sequence) ||
      envelope.idempotencyKey !== row.idempotency_key ||
      envelope.operationClass !== row.operation_class ||
      envelope.approval.scope !== row.approval_scope ||
      envelope.approval.actionHash !== row.action_hash ||
      envelope.leaseExpiresAt !== Number(row.lease_expires_at)
    ) {
      throw new ComputerSupervisionError(
        "action-hash-mismatch",
        "Stored computer command binding does not match its envelope",
      );
    }
  } catch (error) {
    await client.execute({
      sql: `UPDATE integration_remote_commands
            SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ?
            WHERE id = ? AND device_id = ? AND owner_email = ?
              AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)
              AND status = 'pending'`,
      args: [
        error instanceof Error
          ? error.message.slice(0, 2000)
          : "Invalid computer operation",
        now,
        now,
        candidate.id,
        input.deviceId,
        input.ownerEmail,
        input.orgId ?? null,
        input.orgId ?? null,
      ],
    });
    return null;
  }

  const result = await client.execute({
    sql: isPostgres()
      ? `UPDATE integration_remote_commands
          SET status = 'claimed', attempts = attempts + 1, claimed_at = ?, updated_at = ?
          WHERE id = ? AND device_id = ? AND owner_email = ?
            AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)
            AND status = 'pending' AND lease_expires_at > ?
          RETURNING *`
      : `UPDATE integration_remote_commands
          SET status = 'claimed', attempts = attempts + 1, claimed_at = ?, updated_at = ?
          WHERE id = ? AND device_id = ? AND owner_email = ?
            AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)
            AND status = 'pending' AND lease_expires_at > ?`,
    args: [
      now,
      now,
      candidate.id,
      input.deviceId,
      input.ownerEmail,
      input.orgId ?? null,
      input.orgId ?? null,
      now,
    ],
  });
  if (isPostgres()) {
    const row = result.rows?.[0];
    return row ? rowToCommand(row as Record<string, unknown>) : null;
  }
  if (affectedRows(result) === 0) return null;
  const command = await getRemoteCommand(candidate.id);
  return command?.status === "claimed" ? command : null;
}

export async function updateRemoteCommandResult(input: {
  deviceId: string;
  commandId: string;
  status: "running" | "completed" | "failed";
  result?: unknown;
  errorMessage?: string | null;
}): Promise<RemoteCommand | null> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const completedAt = TERMINAL_STATUSES.has(input.status) ? now : null;
  const resultJson =
    input.result === undefined
      ? undefined
      : serializeBoundedRemoteJson(input.result, {
          label: "Remote command result",
          maxBytes: 256_000,
        });
  if (input.errorMessage) {
    assertNoBinaryPayload(input.errorMessage, "Remote command error");
  }

  await client.execute({
    sql: `UPDATE integration_remote_commands
          SET status = ?,
              result_json = COALESCE(?, result_json),
              error_message = ?,
              completed_at = COALESCE(?, completed_at),
              updated_at = ?
          WHERE id = ? AND device_id = ?`,
    args: [
      input.status,
      resultJson ?? null,
      input.errorMessage ? input.errorMessage.slice(0, 2000) : null,
      completedAt,
      now,
      input.commandId,
      input.deviceId,
    ],
  });

  const command = await getRemoteCommand(input.commandId);
  if (!command || command.deviceId !== input.deviceId) return null;
  return command;
}

export async function retryStaleRemoteCommands(options?: {
  claimedStaleAfterMs?: number;
  runningStaleAfterMs?: number;
  maxAttempts?: number;
  limit?: number;
}): Promise<{ retried: number; failed: number }> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const claimedCutoff = now - (options?.claimedStaleAfterMs ?? 75_000);
  const runningCutoff = now - (options?.runningStaleAfterMs ?? 5 * 60_000);
  const maxAttempts = options?.maxAttempts ?? 3;
  const limit = options?.limit ?? 50;

  const { rows } = await client.execute({
    sql: `SELECT id, status, attempts FROM integration_remote_commands
          WHERE (status = 'claimed' AND updated_at <= ?)
             OR (status = 'running' AND updated_at <= ?)
          ORDER BY updated_at ASC
          LIMIT ?`,
    args: [claimedCutoff, runningCutoff, limit],
  });

  let retried = 0;
  let failed = 0;
  for (const row of rows) {
    const id = row.id as string;
    const status = row.status as RemoteCommandStatus;
    const attempts = Number(row.attempts ?? 0);
    if (attempts >= maxAttempts) {
      const result = await client.execute({
        sql: `UPDATE integration_remote_commands
              SET status = 'failed',
                  error_message = COALESCE(error_message, ?),
                  completed_at = ?,
                  updated_at = ?
              WHERE id = ? AND status = ?`,
        args: [
          `Retry job: exceeded ${maxAttempts} attempts`,
          now,
          now,
          id,
          status,
        ],
      });
      if ((result.rowsAffected ?? (result as any).rowCount) > 0) failed++;
      continue;
    }

    const result = await client.execute({
      sql: `UPDATE integration_remote_commands
            SET status = 'pending',
                next_check_at = ?,
                updated_at = ?
            WHERE id = ? AND status = ?`,
      args: [now, now, id, status],
    });
    if ((result.rowsAffected ?? (result as any).rowCount) > 0) retried++;
  }

  return { retried, failed };
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (value == null) return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function affectedRows(result: {
  rowsAffected?: number;
  rows?: unknown[];
}): number {
  return (
    result.rowsAffected ??
    Number((result as { rowCount?: unknown }).rowCount ?? 0)
  );
}

function isDuplicateColumnError(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? "");
  const message = String((error as { message?: unknown })?.message ?? error)
    .toLowerCase()
    .trim();
  return (
    code === "42701" ||
    message.includes("duplicate column") ||
    message.includes("already exists")
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? "");
  const message = String((error as { message?: unknown })?.message ?? error)
    .toLowerCase()
    .trim();
  return (
    code === "23505" ||
    code === "2067" ||
    message.includes("unique constraint") ||
    message.includes("duplicate key")
  );
}
