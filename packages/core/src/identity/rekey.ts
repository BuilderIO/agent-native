import { randomUUID } from "node:crypto";

import { jwtVerify } from "jose";

import { AGENT_AUDIT_LOG_CREATE_SQL } from "../audit/store.js";
import {
  decryptSecretValue,
  encryptSecretValue,
  isEncryptedSecretValue,
} from "../secrets/crypto.js";

export interface IdentityRekeyDb {
  unsafe(
    sql: string,
    args?: unknown[],
  ): Promise<Array<Record<string, unknown>> & { count?: number }>;
  transaction?<T>(fn: (tx: IdentityRekeyDb) => Promise<T>): Promise<T>;
}

export type IdentityColumn = {
  table: string;
  column: string;
  mode?:
    | "email"
    | "user-scope"
    | "secret-scope"
    | "user-share"
    | "group-json"
    | "state-session"
    | "email-user-id"
    | "viewer-consent"
    | "owner"
    | "typed-scope"
    | "custom-scope"
    | "scope-key"
    | "unsupported-oauth";
  /** Email-change behavior. Omitted means rewrite the value to the new address. */
  emailChange?: IdentityEmailChange;
  /** Offboarding behavior. Omitted means offboard.ts derives it from `mode`. */
  offboard?: IdentityOffboard;
  /** How an organization-scoped offboard finds this organization's rows. Omitted means an `org_id` column. */
  orgScope?: IdentityOrgScope;
};

export type IdentityEmailChange = "rekey" | "delete" | "retain";
export type IdentityOffboard = "transfer" | "delete" | "retain";

export type IdentityOrgScope =
  | { column: string }
  | {
      column: string;
      references: { table: string; column: string; orgColumn: string };
    };

/**
 * An app-owned column that matches the identity-column naming pattern. Every
 * such column must be declared, including ones that are not member
 * identities, so a new column cannot silently escape email change or
 * offboarding.
 */
export type AppIdentityColumn = {
  table: string;
  column: string;
  /** What an email change does to rows holding the old address. */
  emailChange: IdentityEmailChange;
  /** What removing the member does to rows holding their address. */
  offboard: IdentityOffboard;
  /** `secret-scope` values are scoped by a sibling `secret_scope` column, as in `integration_installations`. */
  mode?: "email" | "secret-scope";
  orgScope?: IdentityOrgScope;
  /** Why this policy is right for the data. Required so every declaration is a visible decision. */
  reason: string;
};

/** Mutable identity references only. Historical actor/creator fields are intentionally retained. */
export const IDENTITY_REKEY_COLUMNS: readonly IdentityColumn[] = [
  { table: "user", column: "email" },
  { table: "invitation", column: "email" },
  { table: "org_members", column: "email" },
  { table: "org_invitations", column: "email" },
  { table: "org_invitations", column: "invited_by" },
  { table: "app_member_roles", column: "email" },
  { table: "app_member_roles", column: "updated_by" },
  { table: "app_permission_overrides", column: "updated_by" },
  { table: "context_directives", column: "owner_email" },
  { table: "observational_memory", column: "owner_email" },
  { table: "agent_tool_approvals", column: "owner_email" },
  { table: "agent_tool_approval_policies", column: "owner_email" },
  { table: "agent_trace_spans", column: "user_id", mode: "email-user-id" },
  {
    table: "agent_trace_summaries",
    column: "user_id",
    mode: "email-user-id",
  },
  { table: "agent_feedback", column: "user_id", mode: "email-user-id" },
  {
    table: "agent_satisfaction_scores",
    column: "user_id",
    mode: "email-user-id",
  },
  {
    table: "agent_instruction_updates",
    column: "user_id",
    mode: "email-user-id",
  },
  { table: "agent_evals", column: "user_id", mode: "email-user-id" },
  {
    table: "agent_experiment_assignments",
    column: "user_id",
    mode: "email-user-id",
  },
  { table: "chat_threads", column: "owner_email" },
  { table: "chat_thread_shares", column: "principal_id", mode: "user-share" },
  { table: "chat_thread_shares", column: "created_by" },
  { table: "data_programs", column: "owner_email" },
  { table: "data_program_shares", column: "principal_id", mode: "user-share" },
  { table: "data_program_shares", column: "created_by" },
  { table: "tool_slot_installs", column: "owner_email" },
  { table: "integration_remote_devices", column: "owner_email" },
  { table: "agent_harness_sessions", column: "owner_email" },
  { table: "workspace_apps", column: "owner_email" },
  { table: "application_state", column: "session_id", mode: "state-session" },
  { table: "oauth_tokens", column: "owner", mode: "unsupported-oauth" },
  { table: "workspace_connections", column: "owner_email" },
  { table: "workspace_connection_grants", column: "owner_email" },
  { table: "workspace_connection_grants", column: "granted_by_email" },
  { table: "usage_alert_rules", column: "owner_email" },
  { table: "agent_experiments", column: "owner_email" },
  { table: "tools", column: "owner_email" },
  { table: "tool_data", column: "owner_email" },
  { table: "tool_hidden_extensions", column: "owner_email" },
  { table: "tool_consents", column: "viewer_email", mode: "viewer-consent" },
  { table: "integration_identity_links", column: "user_email" },
  {
    table: "workspace_user_groups",
    column: "member_emails_json",
    mode: "group-json",
  },
  { table: "workspace_app_shares", column: "principal_id", mode: "user-share" },
  { table: "workspace_app_shares", column: "created_by" },
  { table: "tool_shares", column: "principal_id", mode: "user-share" },
  { table: "tool_shares", column: "created_by" },
  { table: "app_secrets", column: "scope_id", mode: "user-scope" },
  {
    table: "integration_installations",
    column: "secret_scope_id",
    mode: "secret-scope",
  },
  {
    table: "automation_webhook_tokens",
    column: "secret_scope_id",
    mode: "secret-scope",
  },
  { table: "a2a_tasks", column: "owner_email" },
  { table: "a2a_approvals", column: "owner_email" },
  { table: "agent_resource_versions", column: "owner_email" },
  { table: "integration_a2a_continuations", column: "owner_email" },
  { table: "integration_computer_approvals", column: "owner_email" },
  { table: "integration_configs", column: "owner", mode: "owner" },
  { table: "integration_controls", column: "owner_email" },
  { table: "integration_pending_tasks", column: "owner_email" },
  { table: "integration_remote_commands", column: "owner_email" },
  { table: "integration_remote_push_registrations", column: "owner_email" },
  { table: "integration_remote_push_notifications", column: "owner_email" },
  { table: "integration_conversation_scopes", column: "owner_email" },
  { table: "integration_usage_budgets", column: "owner_email" },
  { table: "mcp_device_codes", column: "owner_email" },
  { table: "mcp_connect_tokens", column: "owner_email" },
  { table: "mcp_connect_tokens", column: "created_by" },
  { table: "mcp_oauth_codes", column: "owner_email" },
  { table: "mcp_oauth_refresh_tokens", column: "owner_email" },
  { table: "notifications", column: "owner", mode: "owner" },
  { table: "progress_runs", column: "owner", mode: "owner" },
  { table: "provider_corpus_jobs", column: "owner_email" },
  { table: "custom_api_providers", column: "scope_id", mode: "custom-scope" },
  { table: "staged_datasets", column: "owner_email" },
  { table: "resources", column: "owner", mode: "owner" },
  { table: "agent_review_comments", column: "author_email" },
  { table: "agent_review_comments", column: "owner_email" },
  { table: "agent_review_notification_deliveries", column: "recipient_email" },
  { table: "agent_review_statuses", column: "updated_by" },
  { table: "agent_review_statuses", column: "owner_email" },
  { table: "agent_review_comment_reactions", column: "actor_email" },
  { table: "agent_review_thread_preferences", column: "user_email" },
  { table: "agent_review_suggestions", column: "author_email" },
  { table: "agent_review_suggestions", column: "owner_email" },
  { table: "agent_review_suggestion_amendments", column: "author_email" },
  { table: "agent_review_suggestion_amendments", column: "owner_email" },
  { table: "agent_review_suggestion_creations", column: "author_email" },
  { table: "agent_team_run_queue", column: "owner_email" },
  { table: "sessions", column: "email" },
  { table: "scim_user", column: "primary_email" },
  { table: "agent_native_embed_tickets", column: "owner_email" },
  { table: "recap_images", column: "owner_email" },
  { table: "sync_events", column: "owner", mode: "owner" },
  { table: "automation_webhook_tokens", column: "owner", mode: "owner" },
  { table: "token_usage", column: "owner_email" },
  { table: "chat_threads", column: "scope_id", mode: "typed-scope" },
  { table: "tool_data", column: "scope_key", mode: "scope-key" },
  { table: "automation_runs", column: "owner", mode: "owner" },
  { table: "sandbox_executions", column: "owner", mode: "owner" },
];

const OPTIONAL_TABLES = new Set(
  IDENTITY_REKEY_COLUMNS.map(({ table }) => table),
);

/** Columns that are deliberately stable IDs or immutable provenance, not email identities. */
export const IDENTITY_REKEY_IGNORED_COLUMNS = new Set([
  "agent_audit_log.actor_email",
  "agent_audit_log.owner_email",
  "tool_history.actor_email",
  "tool_history.owner_email",
  "agent_resource_versions.created_by",
  "agent_review_comments.created_by",
  "agent_human_review_summaries.created_by",
  "organizations.created_by",
  "member.user_id",
  "account.user_id",
  "session.user_id",
  "sso_provider.user_id",
  "scim_managed_connection.created_by",
  "scim_managed_credential.created_by",
  "scim_identity_tombstone.user_id",
  "scim_subject.user_id",
  "scim_user.user_id",
  "scim_projection_grant.user_id",
  "org_scim_memberships.user_id",
  "identity_rekeys.old_email",
  "identity_rekeys.new_email",
  "identity_rekeys.actor_email",
  // Actor kind enum ('user' | 'agent' | 'system'), not an address.
  "context_directives.created_by",
  "resources.created_by",
  // Integration conversation-scope record id.
  "token_usage.integration_scope_id",
  "twoFactor.user_id",
  // Browser-extension session ids; the row identity is owner_email.
  "agent_native_browser_sessions.session_id",
  "agent_native_browser_session_requests.session_id",
]);

const IDENTITY_COLUMN_PATTERN =
  /^(?:email|[a-z0-9]+_email|[a-z0-9_]*scope_id|updated_by|invited_by|created_by|owner|principal_id|session_id|user_id)$/i;

const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

// Stash app declarations on globalThis so they survive SSR bundle duplication,
// as the sharing registry does: the app registers from its Nitro plugin graph
// while the org routes may load a different copy of this module.
const APP_IDENTITY_COLUMNS_KEY = "__agentNativeAppIdentityColumns__";
const appIdentityGlobal = globalThis as typeof globalThis & {
  [APP_IDENTITY_COLUMNS_KEY]?: Map<string, AppIdentityColumn>;
};

function appIdentityRegistry(): Map<string, AppIdentityColumn> {
  return (appIdentityGlobal[APP_IDENTITY_COLUMNS_KEY] ??= new Map());
}

const samePolicy = (a: AppIdentityColumn, b: AppIdentityColumn) =>
  JSON.stringify({ ...a, reason: "" }) === JSON.stringify({ ...b, reason: "" });

/**
 * Declare how an app's own identity-shaped columns behave on email change and
 * member offboarding. Call it at module load from the app's server graph
 * (beside `registerShareableResource`). Share tables made by
 * `createSharesTable()` are recognized from their shape and need no entry.
 */
export function registerIdentityColumns(
  columns: readonly AppIdentityColumn[],
): void {
  const core = new Set([
    ...IDENTITY_REKEY_COLUMNS.map(({ table, column }) => `${table}.${column}`),
    ...IDENTITY_REKEY_IGNORED_COLUMNS,
  ]);
  const registry = appIdentityRegistry();
  for (const entry of columns) {
    const key = `${entry.table}.${entry.column}`;
    const identifiers = [entry.table, entry.column];
    if (entry.orgScope) {
      identifiers.push(entry.orgScope.column);
      if ("references" in entry.orgScope)
        identifiers.push(
          entry.orgScope.references.table,
          entry.orgScope.references.column,
          entry.orgScope.references.orgColumn,
        );
    }
    for (const identifier of identifiers)
      if (!SQL_IDENTIFIER.test(identifier))
        throw new Error(
          `Invalid identity column identifier ${identifier} in ${key}.`,
        );
    if (!entry.reason?.trim())
      throw new Error(`Identity column ${key} needs a reason.`);
    if (
      entry.mode === "secret-scope" &&
      (entry.emailChange === "delete" || entry.offboard === "transfer")
    )
      throw new Error(
        `Identity column ${key} is secret-scoped; it can only be rekeyed or retained on email change and deleted or retained on offboard.`,
      );
    if (core.has(key))
      throw new Error(
        `Identity column ${key} is owned by the framework registry and cannot be redeclared by an app.`,
      );
    const existing = registry.get(key);
    if (existing && !samePolicy(existing, entry))
      throw new Error(
        `Identity column ${key} was declared twice with different policies.`,
      );
    registry.set(key, entry);
  }
}

/** Test-only reset for the app declaration registry. */
export function __resetAppIdentityColumnsForTests(): void {
  appIdentityRegistry().clear();
}

function columnsByTable(
  rows: readonly Record<string, unknown>[],
): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  for (const row of rows) {
    const table = String(row.table_name ?? "");
    const column = String(row.column_name ?? "");
    if (!table || !column) continue;
    const columns = tables.get(table) ?? new Set<string>();
    columns.add(column);
    tables.set(table, columns);
  }
  return tables;
}

/**
 * The complete identity policy for one database schema: the framework
 * registry, app declarations, and share tables recognized by the
 * `createSharesTable()` shape. Throws on the first identity-shaped column
 * with no policy, so callers never run an incomplete migration.
 */
export function resolveIdentityColumns(
  rows: readonly Record<string, unknown>[],
): IdentityColumn[] {
  const entries: IdentityColumn[] = [
    ...IDENTITY_REKEY_COLUMNS,
    ...[...appIdentityRegistry().values()].map(
      ({ reason: _reason, mode, ...entry }): IdentityColumn =>
        mode === "secret-scope" ? { ...entry, mode } : entry,
    ),
  ];
  const registered = new Set(
    entries.map(({ table, column }) => `${table}.${column}`),
  );
  const tables = columnsByTable(rows);
  for (const [table, columns] of tables) {
    if (
      !columns.has("resource_id") ||
      !columns.has("principal_type") ||
      !columns.has("principal_id")
    )
      continue;
    // Same policy as the framework's own share tables: user grants follow an
    // email change and are revoked on offboard; the granter is attribution.
    if (!registered.has(`${table}.principal_id`))
      entries.push({ table, column: "principal_id", mode: "user-share" });
    if (columns.has("created_by") && !registered.has(`${table}.created_by`))
      entries.push({ table, column: "created_by" });
  }
  const resolved = new Set(
    entries.map(({ table, column }) => `${table}.${column}`),
  );
  for (const [table, columns] of tables) {
    for (const column of columns) {
      if (!IDENTITY_COLUMN_PATTERN.test(column)) continue;
      const key = `${table}.${column}`;
      // owner_email is intentionally swept at runtime because extensions and
      // app-owned stores may add it without a core migration release.
      if (resolved.has(key) || column === "owner_email") continue;
      if (IDENTITY_REKEY_IGNORED_COLUMNS.has(key)) continue;
      throw new Error(
        `${key} looks identity-bearing but has no identity policy; declare it with registerIdentityColumns() from @agent-native/core/org. Refusing to run an incomplete identity migration.`,
      );
    }
  }
  return entries;
}

/**
 * The Better Auth session column holding the user id. Migrated databases use
 * `user_id`; older fixtures and hand-built schemas use `"userId"`. Null means
 * there is no session table; a session table without either column throws,
 * because skipping revocation would leave the old identity signed in.
 */
export function sessionUserColumn(
  sessionColumns: ReadonlySet<string>,
): "user_id" | "userId" | null {
  if (!sessionColumns.size) return null;
  if (sessionColumns.has("user_id")) return "user_id";
  if (sessionColumns.has("userId")) return "userId";
  throw new Error(
    "Better Auth session table has no user id column; refusing to leave sessions unrevoked.",
  );
}

export function assertIdentityColumnRows(
  rows: readonly Record<string, unknown>[],
): IdentityColumn[] {
  return resolveIdentityColumns(rows);
}

export async function assertIdentityColumnsRegistered(
  db: IdentityRekeyDb,
): Promise<IdentityColumn[]> {
  const rows = await db.unsafe(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, column_name`,
  );
  return resolveIdentityColumns(rows);
}

const quote = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value))
    throw new Error(`Invalid SQL identifier: ${value}`);
  return `"${value}"`;
};

async function columns(
  db: IdentityRekeyDb,
  table: string,
): Promise<Set<string>> {
  const rows = await db.unsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(rows.map((row) => String(row.column_name)));
}

function predicate(
  entry: IdentityColumn,
  oldEmail: string,
): { sql: string; args: unknown[] } {
  const column = quote(entry.column);
  if (entry.mode === "user-scope") {
    return {
      sql: `("scope" = 'user' AND LOWER(${column}) = LOWER($1)) OR ("scope" = 'workspace' AND LOWER(${column}) = LOWER($2))`,
      args: [oldEmail, `solo:${oldEmail}`],
    };
  }
  if (entry.mode === "secret-scope")
    return {
      sql: `(LOWER("secret_scope") = 'user' AND (LOWER(${column}) = LOWER($1) OR LOWER(${column}) = LOWER($2))) OR (LOWER("secret_scope") = 'workspace' AND (LOWER(${column}) = LOWER($3) OR LOWER(${column}) = LOWER($4)))`,
      args: [
        oldEmail,
        `user:${oldEmail}`,
        `solo:${oldEmail}`,
        `workspace:${oldEmail}`,
      ],
    };
  if (entry.mode === "user-share") {
    return {
      sql: `"principal_type" = 'user' AND LOWER(${column}) = LOWER($1)`,
      args: [oldEmail],
    };
  }
  if (entry.mode === "state-session")
    return { sql: `LOWER(${column}) = LOWER($1)`, args: [oldEmail] };
  if (entry.mode === "owner")
    return {
      sql: `LOWER(${column}) = LOWER($1) OR LOWER(${column}) = LOWER($2)`,
      args: [oldEmail, `user:${oldEmail}`],
    };
  if (entry.mode === "typed-scope")
    return {
      sql: `LOWER("scope_type") = 'user' AND LOWER(${column}) = LOWER($1)`,
      args: [oldEmail],
    };
  if (entry.mode === "custom-scope")
    return {
      sql: `LOWER("scope") = 'user' AND LOWER(${column}) = LOWER($1)`,
      args: [oldEmail],
    };
  if (entry.mode === "scope-key")
    return {
      sql: `LOWER(${column}) = LOWER($1) OR LOWER(${column}) = LOWER($2)`,
      args: [oldEmail, `user:${oldEmail}`],
    };
  return { sql: `LOWER(${column}) = LOWER($1)`, args: [oldEmail] };
}

export interface IdentityRekeyResult {
  counts: Record<string, number>;
  sessionCount: number;
  /** OAuth rows that were revoked because their payload could not be safely rewritten. */
  oauthRevokedCount: number;
}

export type IdentityRekeyLedgerStatus = "pending" | "done";

export interface IdentityRekeyLedgerRow {
  id: string;
  oldEmail: string;
  newEmail: string;
  status: IdentityRekeyLedgerStatus;
  error: string | null;
}

export async function listPendingIdentityRekeys(
  db: IdentityRekeyDb,
): Promise<IdentityRekeyLedgerRow[]> {
  await ensureIdentityRekeyLedger(db);
  const rows = await db.unsafe(
    `SELECT id, old_email, new_email, status, error
     FROM identity_rekeys
     WHERE status = 'pending'
     ORDER BY created_at ASC`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    oldEmail: String(row.old_email),
    newEmail: String(row.new_email),
    status: "pending",
    error: row.error == null ? null : String(row.error),
  }));
}

/** The ledger is intentionally separate from the Better Auth update transaction. */
export async function ensureIdentityRekeyLedger(
  db: IdentityRekeyDb,
): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS identity_rekeys (
      id TEXT PRIMARY KEY,
      -- guard:allow-identity-column — immutable rekey source recorded for recovery
      old_email TEXT NOT NULL,
      -- guard:allow-identity-column — immutable rekey destination recorded for recovery
      new_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      -- guard:allow-identity-column — operator attribution, never used for access
      actor_email TEXT,
      counts_json TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      completed_at BIGINT
    )
  `);
  await db.unsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS identity_rekeys_old_new_idx
     ON identity_rekeys (LOWER(old_email), LOWER(new_email))`,
  );
}

export async function beginIdentityRekey(
  db: IdentityRekeyDb,
  oldEmail: string,
  newEmail: string,
  actorEmail?: string | null,
): Promise<IdentityRekeyLedgerRow> {
  await ensureIdentityRekeyLedger(db);
  const normalizedOld = oldEmail.trim().toLowerCase();
  const normalizedNew = newEmail.trim().toLowerCase();
  const existing = await db.unsafe(
    `SELECT id, old_email, new_email, status, error
     FROM identity_rekeys
     WHERE LOWER(old_email) = LOWER($1) AND LOWER(new_email) = LOWER($2)
     LIMIT 1`,
    [normalizedOld, normalizedNew],
  );
  const current = existing[0];
  if (current) {
    const id = String(current.id);
    await db.unsafe(
      `UPDATE identity_rekeys
       SET status = 'pending', error = NULL, actor_email = $1,
           updated_at = $2, completed_at = NULL
       WHERE id = $3`,
      [actorEmail?.trim().toLowerCase() ?? null, Date.now(), id],
    );
    return {
      id,
      oldEmail: normalizedOld,
      newEmail: normalizedNew,
      status: "pending",
      error: null,
    };
  }
  const id = randomUUID();
  await db.unsafe(
    `INSERT INTO identity_rekeys
       (id, old_email, new_email, status, actor_email, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', $4, $5, $5)`,
    [
      id,
      normalizedOld,
      normalizedNew,
      actorEmail?.trim().toLowerCase() ?? null,
      Date.now(),
    ],
  );
  return {
    id,
    oldEmail: normalizedOld,
    newEmail: normalizedNew,
    status: "pending",
    error: null,
  };
}

export async function finishIdentityRekey(
  db: IdentityRekeyDb,
  ledgerId: string,
  result: IdentityRekeyResult,
): Promise<void> {
  await db.unsafe(
    `UPDATE identity_rekeys
     SET status = 'done', error = NULL, counts_json = $1,
         updated_at = $2, completed_at = $2
     WHERE id = $3`,
    [JSON.stringify(result.counts), Date.now(), ledgerId],
  );
}

export async function failIdentityRekey(
  db: IdentityRekeyDb,
  ledgerId: string,
  error: unknown,
): Promise<void> {
  await db.unsafe(
    `UPDATE identity_rekeys
     SET status = 'pending', error = $1, updated_at = $2
     WHERE id = $3`,
    [
      error instanceof Error ? error.message : String(error),
      Date.now(),
      ledgerId,
    ],
  );
}

/** Durable wrapper used by Better Auth hooks and the CLI. */
export async function executeIdentityRekey(
  db: IdentityRekeyDb,
  oldEmail: string,
  newEmail: string,
  options: Parameters<typeof rekeyIdentity>[3] = {},
): Promise<IdentityRekeyResult> {
  const ledger = options.dryRun
    ? null
    : await beginIdentityRekey(db, oldEmail, newEmail, options.actorEmail);
  try {
    const result = db.transaction
      ? await db.transaction((tx) =>
          rekeyIdentity(tx, oldEmail, newEmail, options),
        )
      : await rekeyIdentity(db, oldEmail, newEmail, options);
    if (ledger) await finishIdentityRekey(db, ledger.id, result);
    return result;
  } catch (error) {
    if (ledger) await failIdentityRekey(db, ledger.id, error);
    throw error;
  }
}

/** Retry rows left pending after Better Auth committed the account email. */
export async function resumePendingIdentityRekeys(
  db: IdentityRekeyDb,
  email: string,
  options: { ensureLedger?: boolean } = {},
): Promise<void> {
  if (options.ensureLedger !== false) await ensureIdentityRekeyLedger(db);
  let rows: Array<Record<string, unknown>> & { count?: number };
  try {
    rows = await db.unsafe(
      `SELECT id, old_email, new_email
       FROM identity_rekeys
       WHERE status = 'pending'
         AND (LOWER(old_email) = LOWER($1) OR LOWER(new_email) = LOWER($1))
       ORDER BY created_at ASC`,
      [email.trim().toLowerCase()],
    );
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (
      options.ensureLedger === false &&
      (code === "42P01" ||
        /relation ["'`]?identity_rekeys["'`]? does not exist|no such table: ["'`]?identity_rekeys/i.test(
          String((error as { message?: unknown }).message ?? error),
        ))
    )
      return;
    throw error;
  }
  for (const row of rows) {
    const id = String(row.id);
    const oldEmail = String(row.old_email);
    const newEmail = String(row.new_email);
    try {
      const options = {
        accountAlreadyUpdated:
          newEmail.toLowerCase() === email.trim().toLowerCase(),
        actorEmail: email,
        caller: "email-verification" as const,
      };
      const result = db.transaction
        ? await db.transaction((tx) =>
            rekeyIdentity(tx, oldEmail, newEmail, options),
          )
        : await rekeyIdentity(db, oldEmail, newEmail, options);
      await finishIdentityRekey(db, id, result);
    } catch (error) {
      await failIdentityRekey(db, id, error);
      console.error("[identity] pending email rekey retry failed", error);
      throw error;
    }
  }
}

export interface VerifiedEmailChange {
  oldEmail: string;
  newEmail: string;
}

export async function verifiedEmailChangeFromToken(
  token: string,
  secret: string,
  verifiedEmail: string,
): Promise<VerifiedEmailChange | null> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
  });
  if (payload.requestType !== "change-email-verification") return null;
  if (
    typeof payload.email !== "string" ||
    typeof payload.updateTo !== "string" ||
    payload.updateTo.toLowerCase() !== verifiedEmail.toLowerCase()
  ) {
    throw new Error(
      "Verified email-change token does not match the updated account.",
    );
  }
  return { oldEmail: payload.email, newEmail: payload.updateTo };
}

export async function rekeyIdentityAfterEmailVerification(
  db: IdentityRekeyDb,
  args: {
    token: string;
    secret: string;
    verifiedEmail: string;
    actorEmail?: string | null;
  },
): Promise<IdentityRekeyResult | null> {
  const emailChange = await verifiedEmailChangeFromToken(
    args.token,
    args.secret,
    args.verifiedEmail,
  );
  if (!emailChange) return null;
  return rekeyIdentity(db, emailChange.oldEmail, emailChange.newEmail, {
    accountAlreadyUpdated: true,
    actorEmail: args.actorEmail ?? args.verifiedEmail,
    caller: "email-verification",
  });
}

/** Run inside the caller's PostgreSQL transaction. It deliberately refuses credential and derived-key stores it cannot safely rewrite. */
export async function rekeyIdentity(
  db: IdentityRekeyDb,
  oldEmailInput: string,
  newEmailInput: string,
  options: {
    dryRun?: boolean;
    actorEmail?: string | null;
    caller?: "cli" | "email-verification";
    accountAlreadyUpdated?: boolean;
    revokeSessions?: boolean;
  } = {},
): Promise<IdentityRekeyResult> {
  const oldEmail = oldEmailInput.trim().toLowerCase();
  const newEmail = newEmailInput.trim().toLowerCase();
  if (
    !oldEmail.includes("@") ||
    !newEmail.includes("@") ||
    oldEmail.toLowerCase() === newEmail.toLowerCase()
  ) {
    throw new Error("Provide two different valid email addresses.");
  }

  const identityColumns = await assertIdentityColumnsRegistered(db);

  const userColumns = await columns(db, "user");
  if (!userColumns.has("id") || !userColumns.has("email"))
    throw new Error(
      "Better Auth user table is unavailable; no identity data was changed.",
    );
  const users = await db.unsafe(
    `SELECT "id" FROM "user" WHERE LOWER("email") = LOWER($1) FOR UPDATE`,
    [oldEmail],
  );
  let userId: string;
  if (options.accountAlreadyUpdated) {
    const updatedUsers = await db.unsafe(
      `SELECT "id" FROM "user" WHERE LOWER("email") = LOWER($1) FOR UPDATE`,
      [newEmail],
    );
    if (users.length || updatedUsers.length !== 1)
      throw new Error(
        `Expected the Better Auth account to be updated to ${newEmail}; found ${updatedUsers.length}.`,
      );
    userId = String(updatedUsers[0].id);
  } else {
    if (users.length !== 1)
      throw new Error(
        `Expected one Better Auth account for ${oldEmail}; found ${users.length}.`,
      );
    userId = String(users[0].id);
  }
  const collision = await db.unsafe(
    `SELECT "id" FROM "user" WHERE LOWER("email") = LOWER($1) AND "id" <> $2`,
    [newEmail, userId],
  );
  if (collision.length)
    throw new Error(
      `The new email ${newEmail} already belongs to another account.`,
    );

  const counts: Record<string, number> = {};
  let oauthRevokedCount = 0;
  counts["user.email"] = 1;
  for (const entry of identityColumns) {
    if (entry.table === "user" || entry.emailChange === "retain") continue;
    if (entry.mode === "unsupported-oauth") {
      const oauthColumns = await columns(db, "oauth_tokens");
      if (!oauthColumns.size) continue;
      for (const required of [
        "provider",
        "account_id",
        "owner",
        "tokens",
        "revision",
        "updated_at",
      ])
        if (!oauthColumns.has(required))
          throw new Error(
            `oauth_tokens is missing ${required}; refusing to rekey OAuth ownership.`,
          );
      const oauthRows = await db.unsafe(
        `SELECT provider, account_id, owner, tokens, revision, updated_at FROM public.oauth_tokens WHERE LOWER(owner) = LOWER($1) OR LOWER(owner) = LOWER($2) FOR UPDATE`,
        [oldEmail, `user:${oldEmail}`],
      );
      counts["oauth_tokens.owner"] = oauthRows.length;
      const revokeOAuthRow = async (
        row: Record<string, unknown>,
        reason: unknown,
      ): Promise<void> => {
        oauthRevokedCount++;
        console.error(
          `[identity] revoking unreadable OAuth credential ${String(row.provider)}:${String(row.account_id)} during email rekey`,
          reason,
        );
        if (options.dryRun) return;
        const revoked = await db.unsafe(
          `DELETE FROM public.oauth_tokens WHERE provider = $1 AND account_id = $2 AND owner = $3`,
          [row.provider, row.account_id, row.owner],
        );
        if (revoked.count !== 1)
          throw new Error(
            `OAuth token changed during rekey while revoking ${String(row.provider)}:${String(row.account_id)}.`,
          );
      };
      for (const row of oauthRows) {
        const owner = String(row.owner ?? "");
        const tokenValue = row.tokens;
        if (typeof tokenValue !== "string" || !tokenValue) {
          await revokeOAuthRow(row, new Error("OAuth token payload is empty."));
          continue;
        }
        let credential: Record<string, unknown>;
        try {
          const serialized = isEncryptedSecretValue(tokenValue)
            ? decryptSecretValue(tokenValue)
            : tokenValue;
          const parsed: unknown = JSON.parse(serialized);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("OAuth token payload must be an object.");
          credential = parsed as Record<string, unknown>;
        } catch (error) {
          await revokeOAuthRow(row, error);
          continue;
        }
        const lifecycle = credential.oauthLifecycle;
        if (lifecycle !== undefined) {
          if (
            !lifecycle ||
            typeof lifecycle !== "object" ||
            Array.isArray(lifecycle)
          ) {
            await revokeOAuthRow(
              row,
              new Error("Invalid OAuth lifecycle metadata."),
            );
            continue;
          }
          const metadata = lifecycle as Record<string, unknown>;
          const expectedOwner = `user:${oldEmail}`;
          if (
            typeof metadata.owner !== "string" ||
            metadata.owner.toLowerCase() !== expectedOwner.toLowerCase()
          ) {
            await revokeOAuthRow(
              row,
              new Error("OAuth lifecycle owner does not match token owner."),
            );
            continue;
          }
          credential.oauthLifecycle = {
            ...metadata,
            owner: `user:${newEmail.toLowerCase()}`,
          };
        }
        const nextOwner = owner.toLowerCase().startsWith("user:")
          ? `user:${newEmail.toLowerCase()}`
          : newEmail;
        if (!options.dryRun) {
          let nextTokens: string;
          try {
            nextTokens = isEncryptedSecretValue(tokenValue)
              ? encryptSecretValue(JSON.stringify(credential))
              : JSON.stringify(credential);
          } catch (error) {
            await revokeOAuthRow(row, error);
            continue;
          }
          const updated = await db.unsafe(
            `UPDATE public.oauth_tokens SET owner = $1, tokens = $2, revision = GREATEST(COALESCE(revision, 0) + 1, $3), updated_at = $4 WHERE provider = $5 AND account_id = $6 AND owner = $7`,
            [
              nextOwner,
              nextTokens,
              Date.now(),
              Math.floor(Date.now() / 1_000),
              row.provider,
              row.account_id,
              owner,
            ],
          );
          if (updated.count !== 1)
            throw new Error(
              `OAuth token ownership changed during rekey for ${String(row.provider)}:${String(row.account_id)}.`,
            );
        }
      }
      continue;
    }
    const available = await columns(db, entry.table);
    if (!available.size) continue;
    if (!available.has(entry.column))
      throw new Error(
        `Registered identity column ${entry.table}.${entry.column} is missing; refusing an incomplete rekey.`,
      );
    if (entry.mode === "user-share" && !available.has("principal_type"))
      throw new Error(
        "workspace_app_shares has no principal_type; refusing to rewrite ambiguous grants.",
      );
    if (
      entry.mode === "user-scope" &&
      (!available.has("scope") || !available.has("key"))
    )
      throw new Error(
        "app_secrets schema is not recognized; refusing to rewrite credential scopes.",
      );
    if (entry.mode === "typed-scope" && !available.has("scope_type"))
      throw new Error(
        `${entry.table} is missing scope_type; refusing to rewrite an ambiguous scope id.`,
      );
    if (entry.mode === "custom-scope" && !available.has("scope"))
      throw new Error(
        `${entry.table} is missing scope; refusing to rewrite an ambiguous provider id.`,
      );

    if (entry.mode === "group-json") {
      if (!available.has("id"))
        throw new Error("workspace_user_groups is missing its id column.");
      const groupRows = await db.unsafe(
        `SELECT id, member_emails_json FROM workspace_user_groups`,
      );
      const updates: Array<{ id: unknown; members: string[] }> = [];
      for (const row of groupRows) {
        let members: unknown;
        try {
          members = JSON.parse(String(row.member_emails_json));
        } catch {
          throw new Error(
            `Invalid workspace_user_groups.member_emails_json for row ${String(row.id)}; refusing to alter group access.`,
          );
        }
        if (
          !Array.isArray(members) ||
          members.some((member) => typeof member !== "string")
        )
          throw new Error(
            `Unexpected workspace_user_groups.member_emails_json for row ${String(row.id)}; refusing to alter group access.`,
          );
        if (
          members.some(
            (member) => member.toLowerCase() === oldEmail.toLowerCase(),
          )
        )
          updates.push({ id: row.id, members });
      }
      counts[`${entry.table}.${entry.column}`] = updates.length;
      if (!options.dryRun) {
        for (const { id, members } of updates) {
          const next = [
            ...new Map(
              members.map((member) => {
                const value =
                  member.toLowerCase() === oldEmail.toLowerCase()
                    ? newEmail
                    : member;
                return [value.toLowerCase(), value] as const;
              }),
            ).values(),
          ];
          await db.unsafe(
            `UPDATE workspace_user_groups SET member_emails_json = $1 WHERE id = $2`,
            [JSON.stringify(next), id],
          );
        }
      }
      continue;
    }

    const { sql, args } = predicate(entry, oldEmail);
    const where = `(${sql})`;
    const rows = await db.unsafe(
      `SELECT COUNT(*)::int AS count FROM ${quote(entry.table)} WHERE ${where}`,
      args,
    );
    const count = Number(rows[0]?.count ?? 0);
    counts[`${entry.table}.${entry.column}`] = count;
    if (!count) continue;

    if (entry.emailChange === "delete") {
      if (!options.dryRun)
        await db.unsafe(
          `DELETE FROM ${quote(entry.table)} WHERE ${where}`,
          args,
        );
    } else if (entry.mode === "user-scope") {
      const destination = await db.unsafe(
        `SELECT 1 FROM app_secrets source JOIN app_secrets target ON target.key = source.key AND target.scope = source.scope WHERE ((source.scope = 'user' AND LOWER(source.scope_id) = LOWER($1)) OR (source.scope = 'workspace' AND LOWER(source.scope_id) = LOWER($2))) AND ((target.scope = 'user' AND LOWER(target.scope_id) = LOWER($3)) OR (target.scope = 'workspace' AND LOWER(target.scope_id) = LOWER($4))) LIMIT 1`,
        [oldEmail, `solo:${oldEmail}`, newEmail, `solo:${newEmail}`],
      );
      if (destination.length)
        throw new Error(
          "Credential scope collision detected; no identity data was changed.",
        );
      if (!options.dryRun)
        await db.unsafe(
          `UPDATE app_secrets SET scope_id = CASE WHEN scope = 'user' THEN $3 ELSE $4 END WHERE ${where}`,
          [...args, newEmail, `solo:${newEmail}`],
        );
    } else if (entry.mode === "secret-scope") {
      if (!options.dryRun)
        await db.unsafe(
          `UPDATE ${quote(entry.table)} SET ${quote(entry.column)} = CASE WHEN LOWER("secret_scope") = 'user' AND LOWER(${quote(entry.column)}) = LOWER($5) THEN $6 WHEN LOWER("secret_scope") = 'user' THEN $7 WHEN LOWER("secret_scope") = 'workspace' AND LOWER(${quote(entry.column)}) = LOWER($8) THEN $9 ELSE $10 END WHERE ${where}`,
          [
            ...args,
            oldEmail,
            newEmail,
            `user:${newEmail}`,
            `solo:${oldEmail}`,
            `solo:${newEmail}`,
            `workspace:${newEmail}`,
          ],
        );
    } else if (entry.mode === "email-user-id") {
      if (entry.table === "agent_experiment_assignments") {
        const collisionRows = await db.unsafe(
          `SELECT 1 FROM agent_experiment_assignments source JOIN agent_experiment_assignments target ON target.experiment_id = source.experiment_id AND LOWER(target.user_id) = LOWER($2) WHERE LOWER(source.user_id) = LOWER($1) LIMIT 1`,
          [oldEmail, newEmail],
        );
        if (collisionRows.length)
          throw new Error(
            "Experiment assignment collision detected; no identity data was changed.",
          );
      }
      if (!options.dryRun)
        await db.unsafe(
          `UPDATE ${quote(entry.table)} SET ${quote(entry.column)} = $2 WHERE ${where}`,
          [...args, newEmail],
        );
    } else if (entry.mode === "viewer-consent") {
      const collisions = await db.unsafe(
        `SELECT 1 FROM tool_consents source JOIN tool_consents target ON target.tool_id = source.tool_id AND target.content_hash = source.content_hash AND LOWER(target.viewer_email) = LOWER($2) WHERE LOWER(source.viewer_email) = LOWER($1) LIMIT 1`,
        [oldEmail, newEmail],
      );
      if (collisions.length)
        throw new Error(
          "Extension consent collision detected; no identity data was changed.",
        );
      if (!options.dryRun)
        await db.unsafe(
          `UPDATE tool_consents SET viewer_email = $2 WHERE ${where}`,
          [...args, newEmail],
        );
    } else if (entry.mode === "user-share") {
      const collisionRows = await db.unsafe(
        `SELECT 1 FROM ${quote(entry.table)} source JOIN ${quote(entry.table)} target ON target.resource_id = source.resource_id AND target.principal_type = source.principal_type AND LOWER(target.principal_id) = LOWER($2) WHERE source.principal_type = 'user' AND LOWER(source.${quote(entry.column)}) = LOWER($1) LIMIT 1`,
        [...args, newEmail],
      );
      if (collisionRows.length)
        throw new Error(
          "Share grant collision detected; no identity data was changed.",
        );
      if (!options.dryRun)
        await db.unsafe(
          `UPDATE ${quote(entry.table)} SET ${quote(entry.column)} = $2 WHERE ${where}`,
          [...args, newEmail],
        );
    } else if (entry.mode === "state-session") {
      const collisionRows = await db.unsafe(
        `SELECT 1 FROM application_state source JOIN application_state target ON target.key = source.key AND LOWER(target.session_id) = LOWER($2) WHERE LOWER(source.session_id) = LOWER($1) LIMIT 1`,
        [...args, newEmail],
      );
      if (collisionRows.length)
        throw new Error(
          "Application-state key collision detected; no identity data was changed.",
        );
      if (!options.dryRun)
        await db.unsafe(
          `UPDATE application_state SET session_id = $2 WHERE ${where}`,
          [...args, newEmail],
        );
    } else if (entry.mode === "owner") {
      if (!options.dryRun)
        await db.unsafe(
          `UPDATE ${quote(entry.table)} SET ${quote(entry.column)} = CASE WHEN LOWER(${quote(entry.column)}) = LOWER($1) THEN $3 ELSE 'user:' || $3 END WHERE ${where}`,
          [...args, newEmail],
        );
    } else if (entry.mode === "scope-key") {
      if (!options.dryRun)
        await db.unsafe(
          `UPDATE ${quote(entry.table)} SET ${quote(entry.column)} = CASE WHEN LOWER(${quote(entry.column)}) = LOWER($1) THEN $3 ELSE 'user:' || $3 END WHERE ${where}`,
          [...args, newEmail],
        );
    } else {
      if (!options.dryRun) {
        const update = await db.unsafe(
          `UPDATE ${quote(entry.table)} SET ${quote(entry.column)} = $${args.length + 1} WHERE ${where}`,
          [...args, newEmail],
        );
        counts[`${entry.table}.${entry.column}`] = update.count ?? count;
      }
    }
  }

  const settingsColumns = await columns(db, "settings");
  if (settingsColumns.size) {
    if (!settingsColumns.has("key"))
      throw new Error(
        "settings table schema is not recognized; refusing to rewrite user setting keys.",
      );
    const fromPrefix = `u:${oldEmail}:`;
    const toPrefix = `u:${newEmail.toLowerCase()}:`;
    const found = await db.unsafe(
      `SELECT COUNT(*)::int AS count FROM settings WHERE LOWER(LEFT("key", LENGTH($1))) = LOWER($1)`,
      [fromPrefix],
    );
    const count = Number(found[0]?.count ?? 0);
    counts["settings.key"] = count;
    const conflict = await db.unsafe(
      `SELECT 1 FROM settings WHERE LOWER(LEFT("key", LENGTH($1))) = LOWER($1) LIMIT 1`,
      [toPrefix],
    );
    if (count && conflict.length)
      throw new Error(
        "Settings key collision detected; no identity data was changed.",
      );
    if (count && !options.dryRun)
      await db.unsafe(
        `UPDATE settings SET "key" = $1 || SUBSTRING("key" FROM LENGTH($2) + 1) WHERE LOWER(LEFT("key", LENGTH($2))) = LOWER($2)`,
        [toPrefix, fromPrefix],
      );

    const featureFlagRows = await db.unsafe(
      `SELECT key, value FROM settings WHERE key LIKE 'feature-flag:%' OR key LIKE 'o:%:feature-flag:%' FOR UPDATE`,
    );
    const flagUpdates: Array<{ key: string; value: string }> = [];
    for (const row of featureFlagRows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(row.value));
      } catch (error) {
        throw new Error(
          `Invalid feature-flag settings JSON at ${String(row.key)}; refusing to alter targeting identities.`,
          { cause: error },
        );
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error(
          `Unexpected feature-flag settings value at ${String(row.key)}; refusing to alter targeting identities.`,
        );
      const rules = parsed as Record<string, unknown>;
      if (
        (rules.emails !== undefined &&
          (!Array.isArray(rules.emails) ||
            rules.emails.some((email) => typeof email !== "string"))) ||
        (rules.updatedBy !== undefined &&
          rules.updatedBy !== null &&
          typeof rules.updatedBy !== "string")
      )
        throw new Error(
          `Unexpected feature-flag targeting fields at ${String(row.key)}; refusing to alter targeting identities.`,
        );
      const emails = Array.isArray(rules.emails)
        ? (rules.emails as string[])
        : undefined;
      const hasOldTarget =
        emails?.some(
          (email) => email.toLowerCase() === oldEmail.toLowerCase(),
        ) ?? false;
      const hasOldUpdater =
        typeof rules.updatedBy === "string" &&
        rules.updatedBy.toLowerCase() === oldEmail.toLowerCase();
      if (!hasOldTarget && !hasOldUpdater) continue;
      const next = {
        ...rules,
        ...(emails
          ? {
              emails: [
                ...new Map(
                  emails.map((email) => {
                    const value =
                      email.toLowerCase() === oldEmail.toLowerCase()
                        ? newEmail.toLowerCase()
                        : email.toLowerCase();
                    return [value, value] as const;
                  }),
                ).values(),
              ],
            }
          : {}),
        ...(hasOldUpdater ? { updatedBy: newEmail.toLowerCase() } : {}),
      };
      flagUpdates.push({ key: String(row.key), value: JSON.stringify(next) });
    }
    counts["feature_flag_targeting"] = flagUpdates.length;
    if (!options.dryRun)
      for (const row of flagUpdates)
        await db.unsafe(`UPDATE settings SET value = $1 WHERE key = $2`, [
          row.value,
          row.key,
        ]);
  }

  const registeredOwnerEmailTables = new Set(
    identityColumns
      .filter(({ column }) => column === "owner_email")
      .map(({ table }) => table),
  );
  const dynamicOwnerColumns = await db.unsafe(
    `SELECT table_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'owner_email' ORDER BY table_name`,
  );
  for (const column of dynamicOwnerColumns) {
    const table = String(column.table_name);
    if (
      registeredOwnerEmailTables.has(table) ||
      table === "agent_audit_log" ||
      table === "tool_history"
    )
      continue;
    if (
      !["text", "character varying", "character"].includes(
        String(column.data_type),
      ) &&
      String(column.udt_name) !== "citext"
    )
      throw new Error(
        `Unsupported ${table}.owner_email type ${String(column.data_type)}; refusing an incomplete identity rekey.`,
      );
    const ownerColumn = quote("owner_email");
    const rows = await db.unsafe(
      `SELECT COUNT(*)::int AS count FROM ${quote(table)} WHERE LOWER(${ownerColumn}) = LOWER($1)`,
      [oldEmail],
    );
    const count = Number(rows[0]?.count ?? 0);
    counts[`${table}.owner_email`] = count;
    if (count && !options.dryRun)
      await db.unsafe(
        `UPDATE ${quote(table)} SET ${ownerColumn} = $1 WHERE LOWER(${ownerColumn}) = LOWER($2)`,
        [newEmail, oldEmail],
      );
  }

  if (!options.dryRun && !options.accountAlreadyUpdated) {
    const updateUser = await db.unsafe(
      `UPDATE "user" SET "email" = $1 WHERE "id" = $2 AND LOWER("email") = LOWER($3)`,
      [newEmail, userId, oldEmail],
    );
    if (updateUser.count !== 1)
      throw new Error(
        "Better Auth account changed during rekey; transaction aborted.",
      );
  }
  const sessionUser = sessionUserColumn(await columns(db, "session"));
  let sessionCount = 0;
  if (sessionUser) {
    if (options.dryRun && options.revokeSessions !== false) {
      const found = await db.unsafe(
        `SELECT COUNT(*)::int AS count FROM "session" WHERE ${quote(sessionUser)} = $1`,
        [userId],
      );
      sessionCount = Number(found[0]?.count ?? 0);
    } else if (!options.dryRun && options.revokeSessions !== false) {
      const revoked = await db.unsafe(
        `DELETE FROM "session" WHERE ${quote(sessionUser)} = $1`,
        [userId],
      );
      sessionCount = revoked.count ?? 0;
    }
  }

  if (!options.dryRun) await db.unsafe(AGENT_AUDIT_LOG_CREATE_SQL);
  if (!options.dryRun)
    await db.unsafe(
      `INSERT INTO agent_audit_log (id, created_at, action, caller, actor_kind, actor_email, target_type, target_id, status, summary, input, owner_email, visibility) VALUES ($1, $2, 'identity.rekeyed', $3, $4, $5, 'identity', $6, 'success', $7, $8, $6, 'private')`,
      [
        randomUUID(),
        Date.now(),
        options.caller ?? "cli",
        options.actorEmail ? "user" : "system",
        options.actorEmail ?? null,
        newEmail,
        `Identity rekeyed from ${oldEmail} to ${newEmail}.`,
        JSON.stringify({ oldEmail, newEmail }),
      ],
    );
  return { counts, sessionCount, oauthRevokedCount };
}

export const identityRekeySupportedTables = OPTIONAL_TABLES;
