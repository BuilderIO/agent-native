import { createHash } from "node:crypto";

import { getDbExec, intType, isPostgres } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";

let initPromise: Promise<void> | undefined;

export type IntegrationConversationType =
  | "channel"
  | "direct_message"
  | "group_direct_message";

export type IntegrationConversationTrust =
  | "trusted"
  | "guest"
  | "external_shared"
  | "unknown";

export interface IntegrationScopeAccess {
  ownerEmail: string;
  orgId?: string | null;
}

export interface IntegrationScopeKey {
  platform: string;
  tenantId: string;
  conversationId: string;
}

export interface IntegrationScopePolicy {
  requireMention: boolean;
  allowDirectMessages: boolean;
  allowGuests: boolean;
  allowExternalShared: boolean;
  allowUnknownTrust: boolean;
}

export const DEFAULT_INTEGRATION_SCOPE_POLICY: Readonly<IntegrationScopePolicy> =
  Object.freeze({
    requireMention: true,
    allowDirectMessages: false,
    allowGuests: false,
    allowExternalShared: false,
    allowUnknownTrust: false,
  });

export interface IntegrationScope extends IntegrationScopeKey {
  id: string;
  conversationType: IntegrationConversationType;
  trust: IntegrationConversationTrust;
  ownerEmail: string;
  orgId: string | null;
  installationId: string | null;
  serviceOwnerEmail: string;
  defaultModel: string | null;
  policy: IntegrationScopePolicy;
  createdAt: number;
  updatedAt: number;
}

export interface SaveIntegrationScopeInput extends IntegrationScopeKey {
  conversationType: IntegrationConversationType;
  trust?: IntegrationConversationTrust;
  /**
   * Omit to use the caller's active org, or pass null for a personal scope.
   * Passing an org other than the caller's active org is always rejected.
   */
  orgId?: string | null;
  installationId?: string | null;
  defaultModel?: string | null;
  policy?: Partial<IntegrationScopePolicy>;
}

const CONVERSATION_TYPES = new Set<IntegrationConversationType>([
  "channel",
  "direct_message",
  "group_direct_message",
]);
const TRUST_VALUES = new Set<IntegrationConversationTrust>([
  "trusted",
  "guest",
  "external_shared",
  "unknown",
]);

async function ensureTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const db = getDbExec();
      const createSql = `CREATE TABLE IF NOT EXISTS integration_conversation_scopes (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        conversation_type TEXT NOT NULL,
        trust_level TEXT NOT NULL DEFAULT 'unknown',
        owner_email TEXT NOT NULL,
        org_id TEXT,
        installation_id TEXT,
        service_owner_email TEXT NOT NULL,
        default_model TEXT,
        require_mention ${intType()} NOT NULL DEFAULT 1,
        allow_direct_messages ${intType()} NOT NULL DEFAULT 0,
        allow_guests ${intType()} NOT NULL DEFAULT 0,
        allow_external_shared ${intType()} NOT NULL DEFAULT 0,
        allow_unknown_trust ${intType()} NOT NULL DEFAULT 0,
        created_at ${intType()} NOT NULL,
        updated_at ${intType()} NOT NULL
      )`;
      const uniqueIndexSql =
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_scope_external_key ON integration_conversation_scopes(platform, tenant_id, conversation_id)";
      const ownerIndexSql =
        "CREATE INDEX IF NOT EXISTS idx_integration_scope_owner ON integration_conversation_scopes(owner_email, platform, tenant_id)";
      const orgIndexSql =
        "CREATE INDEX IF NOT EXISTS idx_integration_scope_org ON integration_conversation_scopes(org_id, platform, tenant_id)";

      if (isPostgres()) {
        await ensureTableExists("integration_conversation_scopes", createSql);
        await ensureColumnExists(
          "integration_conversation_scopes",
          "default_model",
          "ALTER TABLE integration_conversation_scopes ADD COLUMN IF NOT EXISTS default_model TEXT",
        );
        await ensureIndexExists(
          "idx_integration_scope_external_key",
          uniqueIndexSql,
        );
        await ensureIndexExists("idx_integration_scope_owner", ownerIndexSql);
        await ensureIndexExists("idx_integration_scope_org", orgIndexSql);
        return;
      }

      await db.execute(createSql);
      try {
        await db.execute(
          "ALTER TABLE integration_conversation_scopes ADD COLUMN default_model TEXT",
        );
      } catch (error) {
        if (!/duplicate/i.test(String((error as Error)?.message ?? error))) {
          throw error;
        }
      }
      await db.execute(uniqueIndexSql);
      await db.execute(ownerIndexSql);
      await db.execute(orgIndexSql);
    })().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }
  return initPromise;
}

function requiredString(value: unknown, name: string, maxLength = 255): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (normalized.length > maxLength) {
    throw new Error(`${name} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function normalizeEmail(value: unknown, name: string): string {
  const email = requiredString(value, name, 320).toLowerCase();
  if (!email.includes("@")) throw new Error(`${name} must be an email address`);
  return email;
}

function normalizeAccess(
  access: IntegrationScopeAccess,
): Required<IntegrationScopeAccess> {
  return {
    ownerEmail: normalizeEmail(access.ownerEmail, "ownerEmail"),
    orgId: access.orgId ? requiredString(access.orgId, "orgId") : null,
  };
}

function normalizeKey(key: IntegrationScopeKey): IntegrationScopeKey {
  return {
    platform: requiredString(key.platform, "platform", 80).toLowerCase(),
    tenantId: requiredString(key.tenantId, "tenantId"),
    conversationId: requiredString(key.conversationId, "conversationId"),
  };
}

/** A stable, non-secret subject key suitable for a scope budget. */
export function integrationScopeSubjectKey(key: IntegrationScopeKey): string {
  const normalized = normalizeKey(key);
  return JSON.stringify([
    normalized.platform,
    normalized.tenantId,
    normalized.conversationId,
  ]);
}

function scopeId(key: IntegrationScopeKey): string {
  return `scope:${integrationScopeSubjectKey(key)}`;
}

function serviceOwnerForScope(
  key: IntegrationScopeKey,
  access: Required<IntegrationScopeAccess>,
  orgId: string | null,
): string {
  if (!orgId) return access.ownerEmail;
  const subject = createHash("sha256")
    .update(`${orgId}:${integrationScopeSubjectKey(key)}`)
    .digest("hex")
    .slice(0, 24);
  return `integration+${subject}@service.agent-native.local`;
}

function authorizationSql(alias = ""): string {
  const prefix = alias ? `${alias}.` : "";
  return `((${prefix}org_id = ? AND CAST(? AS TEXT) IS NOT NULL) OR (${prefix}org_id IS NULL AND ${prefix}owner_email = ?))`;
}

function authorizationArgs(
  access: Required<IntegrationScopeAccess>,
): unknown[] {
  return [access.orgId, access.orgId, access.ownerEmail];
}

function policyFromRow(row: Record<string, unknown>): IntegrationScopePolicy {
  return {
    requireMention: Number(row.require_mention) === 1,
    allowDirectMessages: Number(row.allow_direct_messages) === 1,
    allowGuests: Number(row.allow_guests) === 1,
    allowExternalShared: Number(row.allow_external_shared) === 1,
    allowUnknownTrust: Number(row.allow_unknown_trust) === 1,
  };
}

function rowToScope(row: Record<string, unknown>): IntegrationScope {
  return {
    id: String(row.id),
    platform: String(row.platform),
    tenantId: String(row.tenant_id),
    conversationId: String(row.conversation_id),
    conversationType: row.conversation_type as IntegrationConversationType,
    trust: row.trust_level as IntegrationConversationTrust,
    ownerEmail: String(row.owner_email),
    orgId: row.org_id == null ? null : String(row.org_id),
    installationId:
      row.installation_id == null ? null : String(row.installation_id),
    serviceOwnerEmail: String(row.service_owner_email),
    defaultModel: row.default_model == null ? null : String(row.default_model),
    policy: policyFromRow(row),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

const SELECT_COLUMNS = `id, platform, tenant_id, conversation_id,
  conversation_type, trust_level, owner_email, org_id, installation_id,
  service_owner_email, require_mention, allow_direct_messages, allow_guests,
  allow_external_shared, allow_unknown_trust, default_model, created_at, updated_at`;

function isUniqueViolation(error: unknown): boolean {
  const value = error as { code?: string; message?: string } | null;
  if (value?.code === "23505") return true;
  return /unique|duplicate/i.test(String(value?.message ?? error ?? ""));
}

function normalizePolicy(
  policy: Partial<IntegrationScopePolicy> | undefined,
): IntegrationScopePolicy {
  return {
    ...DEFAULT_INTEGRATION_SCOPE_POLICY,
    ...policy,
  };
}

function resolveOrgId(
  requested: string | null | undefined,
  access: Required<IntegrationScopeAccess>,
): string | null {
  if (requested === null) return null;
  if (requested === undefined) return access.orgId;
  const normalized = requiredString(requested, "orgId");
  if (!access.orgId || normalized !== access.orgId) {
    throw new Error(
      "Not authorized to manage an integration scope for that org",
    );
  }
  return normalized;
}

export async function getIntegrationScope(
  keyInput: IntegrationScopeKey,
  accessInput: IntegrationScopeAccess,
): Promise<IntegrationScope | null> {
  await ensureTable();
  const key = normalizeKey(keyInput);
  const access = normalizeAccess(accessInput);
  const { rows } = await getDbExec().execute({
    sql: `SELECT ${SELECT_COLUMNS}
      FROM integration_conversation_scopes
      WHERE platform = ? AND tenant_id = ? AND conversation_id = ?
        AND ${authorizationSql()}
      LIMIT 1`,
    args: [
      key.platform,
      key.tenantId,
      key.conversationId,
      ...authorizationArgs(access),
    ],
  });
  return rows.length > 0
    ? rowToScope(rows[0] as Record<string, unknown>)
    : null;
}

export async function listIntegrationScopes(
  accessInput: IntegrationScopeAccess,
  filter: { platform?: string; tenantId?: string } = {},
): Promise<IntegrationScope[]> {
  await ensureTable();
  const access = normalizeAccess(accessInput);
  const clauses = [authorizationSql()];
  const args: unknown[] = [...authorizationArgs(access)];
  if (filter.platform) {
    clauses.push("platform = ?");
    args.push(requiredString(filter.platform, "platform", 80).toLowerCase());
  }
  if (filter.tenantId) {
    clauses.push("tenant_id = ?");
    args.push(requiredString(filter.tenantId, "tenantId"));
  }
  const { rows } = await getDbExec().execute({
    sql: `SELECT ${SELECT_COLUMNS}
      FROM integration_conversation_scopes
      WHERE ${clauses.join(" AND ")}
      ORDER BY platform, tenant_id, conversation_id`,
    args,
  });
  return rows.map((row) => rowToScope(row as Record<string, unknown>));
}

export async function saveIntegrationScope(
  input: SaveIntegrationScopeInput,
  accessInput: IntegrationScopeAccess,
): Promise<IntegrationScope> {
  await ensureTable();
  const key = normalizeKey(input);
  const access = normalizeAccess(accessInput);
  const orgId = resolveOrgId(input.orgId, access);
  if (!CONVERSATION_TYPES.has(input.conversationType)) {
    throw new Error("Unsupported integration conversation type");
  }
  const trust = input.trust ?? "unknown";
  if (!TRUST_VALUES.has(trust)) {
    throw new Error("Unsupported integration conversation trust level");
  }
  const serviceOwnerEmail = serviceOwnerForScope(key, access, orgId);
  const installationId = input.installationId
    ? requiredString(input.installationId, "installationId")
    : null;
  const defaultModel = input.defaultModel?.trim().slice(0, 200) || null;
  const policy = normalizePolicy(input.policy);
  const now = Date.now();
  const db = getDbExec();

  const updated = await db.execute({
    sql: `UPDATE integration_conversation_scopes SET
      conversation_type = ?, trust_level = ?, installation_id = ?,
      service_owner_email = ?, require_mention = ?, allow_direct_messages = ?,
      allow_guests = ?, allow_external_shared = ?, allow_unknown_trust = ?,
      default_model = ?, updated_at = ?
      WHERE platform = ? AND tenant_id = ? AND conversation_id = ?
        AND ${authorizationSql()}`,
    args: [
      input.conversationType,
      trust,
      installationId,
      serviceOwnerEmail,
      policy.requireMention ? 1 : 0,
      policy.allowDirectMessages ? 1 : 0,
      policy.allowGuests ? 1 : 0,
      policy.allowExternalShared ? 1 : 0,
      policy.allowUnknownTrust ? 1 : 0,
      defaultModel,
      now,
      key.platform,
      key.tenantId,
      key.conversationId,
      ...authorizationArgs(access),
    ],
  });

  if (updated.rowsAffected === 0) {
    try {
      await db.execute({
        sql: `INSERT INTO integration_conversation_scopes (
          id, platform, tenant_id, conversation_id, conversation_type,
          trust_level, owner_email, org_id, installation_id,
          service_owner_email, require_mention, allow_direct_messages,
          allow_guests, allow_external_shared, allow_unknown_trust,
          default_model, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          scopeId(key),
          key.platform,
          key.tenantId,
          key.conversationId,
          input.conversationType,
          trust,
          access.ownerEmail,
          orgId,
          installationId,
          serviceOwnerEmail,
          policy.requireMention ? 1 : 0,
          policy.allowDirectMessages ? 1 : 0,
          policy.allowGuests ? 1 : 0,
          policy.allowExternalShared ? 1 : 0,
          policy.allowUnknownTrust ? 1 : 0,
          defaultModel,
          now,
          now,
        ],
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new Error("Integration scope is not available to this caller");
      }
      throw error;
    }
  }

  const saved = await getIntegrationScope(key, access);
  if (!saved) throw new Error("Integration scope write could not be verified");
  return saved;
}

export async function deleteIntegrationScope(
  keyInput: IntegrationScopeKey,
  accessInput: IntegrationScopeAccess,
): Promise<boolean> {
  await ensureTable();
  const key = normalizeKey(keyInput);
  const access = normalizeAccess(accessInput);
  const result = await getDbExec().execute({
    sql: `DELETE FROM integration_conversation_scopes
      WHERE platform = ? AND tenant_id = ? AND conversation_id = ?
        AND ${authorizationSql()}`,
    args: [
      key.platform,
      key.tenantId,
      key.conversationId,
      ...authorizationArgs(access),
    ],
  });
  return result.rowsAffected > 0;
}

export type IntegrationScopePolicyDenial =
  | "mention_required"
  | "direct_messages_disabled"
  | "guests_disabled"
  | "external_shared_disabled"
  | "unverified_conversation_disabled";

export function evaluateIntegrationScopePolicy(
  scope: Pick<IntegrationScope, "conversationType" | "trust" | "policy">,
  context: { mentioned: boolean },
):
  | { allowed: true }
  | { allowed: false; reason: IntegrationScopePolicyDenial } {
  if (scope.policy.requireMention && !context.mentioned) {
    return { allowed: false, reason: "mention_required" };
  }
  if (
    (scope.conversationType === "direct_message" ||
      scope.conversationType === "group_direct_message") &&
    !scope.policy.allowDirectMessages
  ) {
    return { allowed: false, reason: "direct_messages_disabled" };
  }
  if (scope.trust === "guest" && !scope.policy.allowGuests) {
    return { allowed: false, reason: "guests_disabled" };
  }
  if (scope.trust === "external_shared" && !scope.policy.allowExternalShared) {
    return { allowed: false, reason: "external_shared_disabled" };
  }
  if (scope.trust === "unknown" && !scope.policy.allowUnknownTrust) {
    return { allowed: false, reason: "unverified_conversation_disabled" };
  }
  return { allowed: true };
}

/** Test-only reset for suites that swap the injected database. */
export function _resetIntegrationScopeStoreForTests(): void {
  initPromise = undefined;
}
