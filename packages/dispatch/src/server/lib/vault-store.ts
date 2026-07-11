import crypto from "node:crypto";

import { and, desc, eq, isNull, or, sql } from "@agent-native/core/db/schema";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import {
  deleteAppSecret,
  listAppSecretsForScope,
  writeAppSecret,
  type SecretScope,
} from "@agent-native/core/secrets";
import { discoverAgents } from "@agent-native/core/server/agent-discovery";
import {
  getOrgSetting,
  getUserSetting,
  putOrgSetting,
  putUserSetting,
} from "@agent-native/core/settings";

import { getDb, schema } from "../../db/index.js";
import {
  currentOwnerEmail,
  currentOrgId,
  recordAudit,
} from "./dispatch-store.js";

const VAULT_ACCESS_SETTINGS_KEY = "dispatch-vault-access-settings";
const VAULT_SYNC_DESCRIPTION_PREFIX = "Synced from Dispatch vault:";

export type VaultAccessMode = "all-apps" | "manual";

export interface VaultAccessSettings {
  mode: VaultAccessMode;
  scope: "org" | "user";
  scopeId: string;
}

/**
 * Caller-supplied access context for vault operations.
 *
 * Every getSecret / updateSecret / deleteSecret / createGrant call must
 * pass the ctx of the *current request* so the row is scoped to that
 * caller's tenant. Looking up a vault secret by id alone is unsafe — UUIDs
 * are not authorization. A row matches the ctx if either the caller owns
 * it or it lives in the caller's active org.
 */
export interface VaultCtx {
  ownerEmail: string;
  orgId: string | null;
}

/**
 * Build a VaultCtx from the current request. Throws if the request is
 * unauthenticated — the previous behavior of falling back to "local@localhost"
 * leaked rows across tenants when a misconfigured environment skipped auth.
 */
export function requireVaultCtx(): VaultCtx {
  const ownerEmail = currentOwnerEmail();
  if (!ownerEmail) {
    throw new Error("Vault operation requires an authenticated user");
  }
  return { ownerEmail, orgId: currentOrgId() };
}

/** WHERE clause that limits a vault row to the caller's ownership scope. */
function ctxScope<T extends { ownerEmail: any; orgId: any }>(
  table: T,
  ctx: VaultCtx,
) {
  if (!ctx.orgId) {
    return and(eq(table.ownerEmail, ctx.ownerEmail), isNull(table.orgId));
  }
  return or(eq(table.ownerEmail, ctx.ownerEmail), eq(table.orgId, ctx.orgId));
}

/** Build a ctx that scopes to a specific row's owner/org (used when a
 * request approver acts on behalf of the original requester so the
 * created secret lands in the request's org). */
function ctxForRow(row: {
  ownerEmail: string;
  orgId: string | null;
}): VaultCtx {
  return { ownerEmail: row.ownerEmail, orgId: row.orgId };
}

function ctxForSecretRow(row: VaultSecretRow, fallback: VaultCtx): VaultCtx {
  return row.ownerEmail ? ctxForRow(row) : fallback;
}

function id() {
  return crypto.randomUUID();
}

function now() {
  return Date.now();
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function workspaceBaseOrigins(): Set<string> {
  const out = new Set<string>();
  for (const value of [
    process.env.WORKSPACE_GATEWAY_URL,
    process.env.APP_URL,
    process.env.URL,
    process.env.DEPLOY_URL,
    process.env.BETTER_AUTH_URL,
  ]) {
    if (!value) continue;
    try {
      out.add(new URL(value).origin);
    } catch {
      // Ignore malformed deploy metadata.
    }
  }
  return out;
}

export function isTrustedEnvVarSyncAgentUrl(agentUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(agentUrl);
  } catch {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  ) {
    return true;
  }
  return workspaceBaseOrigins().has(parsed.origin);
}

function scopedFilter<T extends { ownerEmail: any; orgId: any }>(table: T) {
  return ctxScope(table, requireVaultCtx());
}

function normalizeCredentialKey(value: string) {
  return value.trim();
}

function vaultAccessScope() {
  const orgId = currentOrgId();
  if (orgId) return { scope: "org" as const, scopeId: orgId };
  return { scope: "user" as const, scopeId: currentOwnerEmail() };
}

function parseVaultAccessMode(value: unknown): VaultAccessMode {
  return value === "manual" ? "manual" : "all-apps";
}

export async function getVaultAccessSettings(): Promise<VaultAccessSettings> {
  const scope = vaultAccessScope();
  const raw =
    scope.scope === "org"
      ? await getOrgSetting(scope.scopeId, VAULT_ACCESS_SETTINGS_KEY)
      : await getUserSetting(scope.scopeId, VAULT_ACCESS_SETTINGS_KEY);
  return {
    ...scope,
    mode: parseVaultAccessMode(raw?.mode),
  };
}

export async function setVaultAccessSettings(input: {
  mode: VaultAccessMode;
}): Promise<VaultAccessSettings> {
  const scope = vaultAccessScope();
  const next = { mode: parseVaultAccessMode(input.mode) };
  if (scope.scope === "org") {
    await putOrgSetting(scope.scopeId, VAULT_ACCESS_SETTINGS_KEY, next);
  } else {
    await putUserSetting(scope.scopeId, VAULT_ACCESS_SETTINGS_KEY, next);
  }
  await recordAudit({
    action: "vault.access-settings.updated",
    targetType: "vault-settings",
    targetId: VAULT_ACCESS_SETTINGS_KEY,
    summary:
      next.mode === "all-apps"
        ? "Set vault access to all workspace apps"
        : "Set vault access to manual per-app grants",
    metadata: next,
  });
  return getVaultAccessSettings();
}

// ─── Vault Audit ──────────────────────────────────────────────────

export async function recordVaultAudit(input: {
  action: string;
  secretId?: string | null;
  appId?: string | null;
  summary: string;
  metadata?: unknown;
  actor?: string;
}) {
  const db = getDb();
  await db.insert(schema.vaultAuditLog).values({
    id: id(),
    ownerEmail: currentOwnerEmail(),
    orgId: currentOrgId(),
    secretId: input.secretId || null,
    appId: input.appId || null,
    action: input.action,
    actor: input.actor || currentOwnerEmail(),
    summary: input.summary,
    metadata: input.metadata ? safeJson(input.metadata) : null,
    createdAt: now(),
  });
}

export async function listVaultAudit(limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(schema.vaultAuditLog)
    .where(scopedFilter(schema.vaultAuditLog))
    .orderBy(desc(schema.vaultAuditLog.createdAt))
    .limit(limit);
}

// ─── Secrets ──────────────────────────────────────────────────────

export async function listSecrets() {
  const db = getDb();
  return db
    .select()
    .from(schema.vaultSecrets)
    .where(scopedFilter(schema.vaultSecrets))
    .orderBy(desc(schema.vaultSecrets.updatedAt));
}

export async function getSecret(secretId: string, ctx: VaultCtx) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.vaultSecrets)
    .where(
      and(
        eq(schema.vaultSecrets.id, secretId),
        ctxScope(schema.vaultSecrets, ctx),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createSecret(
  input: {
    credentialKey: string;
    value: string;
    name: string;
    provider?: string | null;
    description?: string | null;
  },
  ctx: VaultCtx = requireVaultCtx(),
) {
  const db = getDb();
  const timestamp = now();
  const credentialKey = normalizeCredentialKey(input.credentialKey);
  if (!credentialKey) throw new Error("Credential key is required");
  const existing = await db
    .select()
    .from(schema.vaultSecrets)
    .where(
      and(
        eq(schema.vaultSecrets.credentialKey, credentialKey),
        ctxScope(schema.vaultSecrets, ctx),
      ),
    )
    .orderBy(desc(schema.vaultSecrets.updatedAt))
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.vaultSecrets)
      .set({
        name: input.name,
        credentialKey,
        value: input.value,
        provider: input.provider || null,
        description: input.description || null,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(schema.vaultSecrets.id, existing[0].id),
          ctxScope(schema.vaultSecrets, ctx),
        ),
      );

    await recordVaultAudit({
      action: "secret.updated",
      secretId: existing[0].id,
      summary: `Updated secret "${input.name}" (${credentialKey})`,
      metadata: { credentialKey, provider: input.provider },
    });

    await recordAudit({
      action: "vault.secret.updated",
      targetType: "vault-secret",
      targetId: existing[0].id,
      summary: `Updated vault secret "${input.name}" (${credentialKey})`,
    });

    const updated = await getSecret(existing[0].id, ctx);
    if (updated) {
      await syncSecretsToCredentialStore(
        [updated],
        ctxForSecretRow(updated, ctx),
      );
    }
    return updated;
  }

  const secretId = id();
  const actor = ctx.ownerEmail;

  await db.insert(schema.vaultSecrets).values({
    id: secretId,
    ownerEmail: actor,
    orgId: ctx.orgId,
    name: input.name,
    credentialKey,
    value: input.value,
    provider: input.provider || null,
    description: input.description || null,
    createdBy: actor,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await recordVaultAudit({
    action: "secret.created",
    secretId,
    summary: `Created secret "${input.name}" (${credentialKey})`,
    metadata: { credentialKey, provider: input.provider },
  });

  await recordAudit({
    action: "vault.secret.created",
    targetType: "vault-secret",
    targetId: secretId,
    summary: `Created vault secret "${input.name}" (${credentialKey})`,
  });

  const created = await getSecret(secretId, ctx);
  if (created) {
    await syncSecretsToCredentialStore(
      [created],
      ctxForSecretRow(created, ctx),
    );
  }
  return created;
}

export async function updateSecret(
  secretId: string,
  input:
    | string
    | {
        credentialKey?: string;
        value?: string;
        name?: string;
        provider?: string | null;
        description?: string | null;
      },
  ctx: VaultCtx = requireVaultCtx(),
) {
  const db = getDb();
  const existing = await getSecret(secretId, ctx);
  if (!existing) throw new Error("Secret not found");
  const patch = typeof input === "string" ? { value: input } : input;
  const credentialKey =
    patch.credentialKey !== undefined
      ? normalizeCredentialKey(patch.credentialKey)
      : existing.credentialKey;
  if (!credentialKey) throw new Error("Credential key is required");
  const name = patch.name !== undefined ? patch.name.trim() : existing.name;
  if (!name) throw new Error("Secret name is required");
  const value = patch.value !== undefined ? patch.value : existing.value;
  if (!value) throw new Error("Secret value is required");
  const provider =
    patch.provider !== undefined ? patch.provider || null : existing.provider;
  const description =
    patch.description !== undefined
      ? patch.description || null
      : existing.description;

  if (credentialKey !== existing.credentialKey) {
    const conflict = await db
      .select({ id: schema.vaultSecrets.id })
      .from(schema.vaultSecrets)
      .where(
        and(
          eq(schema.vaultSecrets.credentialKey, credentialKey),
          ctxScope(schema.vaultSecrets, ctx),
        ),
      )
      .limit(1);
    if (conflict[0] && conflict[0].id !== secretId) {
      throw new Error(`Credential key "${credentialKey}" is already in use`);
    }
  }

  await db
    .update(schema.vaultSecrets)
    .set({
      name,
      credentialKey,
      value,
      provider,
      description,
      updatedAt: now(),
    })
    .where(
      and(
        eq(schema.vaultSecrets.id, secretId),
        ctxScope(schema.vaultSecrets, ctx),
      ),
    );

  const auditMetadata = {
    name,
    previousName: name !== existing.name ? existing.name : undefined,
    credentialKey,
    previousCredentialKey:
      credentialKey !== existing.credentialKey
        ? existing.credentialKey
        : undefined,
    provider,
    previousProvider:
      provider !== existing.provider ? existing.provider : undefined,
    description,
    previousDescription:
      description !== existing.description ? existing.description : undefined,
    valueChanged: value !== existing.value ? true : undefined,
  };

  await recordVaultAudit({
    action: "secret.updated",
    secretId,
    summary: `Updated secret "${name}" (${credentialKey})`,
    metadata: auditMetadata,
  });

  await recordAudit({
    action: "vault.secret.updated",
    targetType: "vault-secret",
    targetId: secretId,
    summary: `Updated vault secret "${name}" (${credentialKey})`,
    metadata: auditMetadata,
  });

  const updated = await getSecret(secretId, ctx);
  if (updated) {
    await syncSecretsToCredentialStore(
      [updated],
      ctxForSecretRow(updated, ctx),
    );
  }
  if (updated && credentialKey !== existing.credentialKey) {
    await cleanupSyncedCredentialKeysIfUnused(ctxForRow(existing), [
      existing.credentialKey,
    ]);
  } else if (updated && patch.credentialKey !== undefined) {
    await cleanupSyncedCredentialKeysIfUnused(ctxForSecretRow(updated, ctx));
  }
  return updated;
}

export async function deleteSecret(
  secretId: string,
  ctx: VaultCtx = requireVaultCtx(),
) {
  const db = getDb();
  const existing = await getSecret(secretId, ctx);
  if (!existing) throw new Error("Secret not found");

  // Revoke all active grants first
  const grants = await listGrants({ secretId });
  for (const grant of grants) {
    if (grant.status === "active") {
      await revokeGrant(grant.id, ctx);
    }
  }

  await db
    .delete(schema.vaultSecrets)
    .where(
      and(
        eq(schema.vaultSecrets.id, secretId),
        ctxScope(schema.vaultSecrets, ctx),
      ),
    );
  await cleanupSyncedCredentialKeysIfUnused(ctxForRow(existing), [
    existing.credentialKey,
  ]);

  await recordVaultAudit({
    action: "secret.deleted",
    secretId,
    summary: `Deleted secret "${existing.name}" (${existing.credentialKey})`,
  });

  await recordAudit({
    action: "vault.secret.deleted",
    targetType: "vault-secret",
    targetId: secretId,
    summary: `Deleted vault secret "${existing.name}" (${existing.credentialKey})`,
  });

  return existing;
}

// ─── Grants ──────────────────────────────────────────────────────

export async function listGrants(filter?: {
  secretId?: string;
  appId?: string;
}) {
  const db = getDb();
  const conditions = [scopedFilter(schema.vaultGrants)];
  if (filter?.secretId) {
    conditions.push(eq(schema.vaultGrants.secretId, filter.secretId) as any);
  }
  if (filter?.appId) {
    conditions.push(eq(schema.vaultGrants.appId, filter.appId) as any);
  }
  return db
    .select()
    .from(schema.vaultGrants)
    .where(and(...conditions))
    .orderBy(desc(schema.vaultGrants.updatedAt));
}

export async function getGrant(
  grantId: string,
  ctx: VaultCtx = requireVaultCtx(),
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.vaultGrants)
    .where(
      and(
        eq(schema.vaultGrants.id, grantId),
        ctxScope(schema.vaultGrants, ctx),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createGrant(
  secretId: string,
  appId: string,
  ctx: VaultCtx = requireVaultCtx(),
) {
  const db = getDb();
  const secret = await getSecret(secretId, ctx);
  if (!secret) throw new Error("Secret not found");

  const timestamp = now();
  const actor = ctx.ownerEmail;
  const [existing] = await db
    .select()
    .from(schema.vaultGrants)
    .where(
      and(
        eq(schema.vaultGrants.secretId, secretId),
        eq(schema.vaultGrants.appId, appId),
        ctxScope(schema.vaultGrants, ctx),
      ),
    )
    .orderBy(desc(schema.vaultGrants.updatedAt))
    .limit(1);

  if (existing?.status === "active") {
    return existing;
  }

  if (existing) {
    await db
      .update(schema.vaultGrants)
      .set({
        grantedBy: actor,
        status: "active",
        syncedAt: null,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(schema.vaultGrants.id, existing.id),
          ctxScope(schema.vaultGrants, ctx),
        ),
      );

    await recordVaultAudit({
      action: "grant.reinstated",
      secretId,
      appId,
      summary: `Reinstated "${secret.name}" (${secret.credentialKey}) for ${appId}`,
      metadata: { grantId: existing.id },
    });

    await recordAudit({
      action: "vault.grant.reinstated",
      targetType: "vault-grant",
      targetId: existing.id,
      summary: `Reinstated vault secret "${secret.name}" for ${appId}`,
    });

    return getGrant(existing.id, ctx);
  }

  const grantId = id();

  await db.insert(schema.vaultGrants).values({
    id: grantId,
    ownerEmail: actor,
    orgId: ctx.orgId,
    secretId,
    appId,
    grantedBy: actor,
    status: "active",
    syncedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await recordVaultAudit({
    action: "grant.created",
    secretId,
    appId,
    summary: `Granted "${secret.name}" (${secret.credentialKey}) to ${appId}`,
    metadata: { grantId },
  });

  await recordAudit({
    action: "vault.grant.created",
    targetType: "vault-grant",
    targetId: grantId,
    summary: `Granted vault secret "${secret.name}" to ${appId}`,
  });

  return getGrant(grantId);
}

export async function grantSecretsToApp(
  secretIds: string[],
  appId: string,
  ctx: VaultCtx = requireVaultCtx(),
) {
  const access = await getVaultAccessSettings();
  const uniqueSecretIds = Array.from(new Set(secretIds));
  if (access.mode === "all-apps") {
    return {
      appId,
      accessMode: access.mode,
      created: [],
      skipped: uniqueSecretIds,
    };
  }
  const existingActive = (await listGrants({ appId })).filter(
    (grant) => grant.status === "active",
  );
  const existingSecretIds = new Set(
    existingActive.map((grant) => grant.secretId),
  );
  const created = [];
  const skipped: string[] = [];

  for (const secretId of uniqueSecretIds) {
    if (existingSecretIds.has(secretId)) {
      skipped.push(secretId);
      continue;
    }
    const grant = await createGrant(secretId, appId, ctx);
    if (grant) {
      created.push(grant);
      existingSecretIds.add(secretId);
    }
  }

  return { appId, accessMode: access.mode, created, skipped };
}

export async function revokeGrant(
  grantId: string,
  ctx: VaultCtx = requireVaultCtx(),
) {
  const db = getDb();
  const grant = await getGrant(grantId, ctx);
  if (!grant) throw new Error("Grant not found");

  const secret = await getSecret(grant.secretId, ctx);

  await db
    .update(schema.vaultGrants)
    .set({ status: "revoked", updatedAt: now() })
    .where(
      and(
        eq(schema.vaultGrants.id, grantId),
        ctxScope(schema.vaultGrants, ctx),
      ),
    );

  await recordVaultAudit({
    action: "grant.revoked",
    secretId: grant.secretId,
    appId: grant.appId,
    summary: `Revoked ${secret?.credentialKey || grant.secretId} from ${grant.appId}`,
    metadata: { grantId },
  });

  await recordAudit({
    action: "vault.grant.revoked",
    targetType: "vault-grant",
    targetId: grantId,
    summary: `Revoked vault secret "${secret?.name || grant.secretId}" from ${grant.appId}`,
  });

  return getGrant(grantId, ctx);
}

// ─── Shared Credential Store Sync ─────────────────────────────────

type VaultSecretRow = typeof schema.vaultSecrets.$inferSelect;

export function credentialStoreScopeForVaultCtx(ctx: VaultCtx): {
  scope: Extract<SecretScope, "org" | "workspace">;
  scopeId: string;
} {
  if (ctx.orgId) return { scope: "org", scopeId: ctx.orgId };
  return { scope: "workspace", scopeId: `solo:${ctx.ownerEmail}` };
}

export async function syncSecretsToCredentialStore(
  secrets: VaultSecretRow[],
  ctx: VaultCtx,
) {
  const target = credentialStoreScopeForVaultCtx(ctx);
  const syncedKeys: string[] = [];

  for (const secret of secrets) {
    if (!secret.credentialKey || !secret.value) continue;
    await writeAppSecret({
      key: secret.credentialKey,
      value: secret.value,
      scope: target.scope,
      scopeId: target.scopeId,
      description: `${VAULT_SYNC_DESCRIPTION_PREFIX} ${secret.name}`,
    });
    syncedKeys.push(secret.credentialKey);
  }

  return { ...target, keys: syncedKeys };
}

export async function cleanupSyncedCredentialKeysIfUnused(
  ctx: VaultCtx,
  candidateKeys?: string[],
) {
  const db = getDb();
  const target = credentialStoreScopeForVaultCtx(ctx);
  const keys = candidateKeys
    ? candidateKeys
    : (await listAppSecretsForScope(target.scope, target.scopeId))
        .filter((secret) =>
          secret.description?.startsWith(VAULT_SYNC_DESCRIPTION_PREFIX),
        )
        .map((secret) => secret.key);

  for (const key of new Set(keys.filter(Boolean))) {
    const stillUsesKey = await db
      .select({ id: schema.vaultSecrets.id })
      .from(schema.vaultSecrets)
      .where(
        and(
          eq(schema.vaultSecrets.credentialKey, key),
          ctxScope(schema.vaultSecrets, ctx),
        ),
      )
      .limit(1);
    if (!stillUsesKey[0]) {
      await deleteAppSecret({
        key,
        scope: target.scope,
        scopeId: target.scopeId,
      });
    }
  }
}

// ─── Sync ──────────────────────────────────────────────────────

export async function syncGrantsToApp(
  appId: string,
  ctx: VaultCtx = requireVaultCtx(),
) {
  const db = getDb();
  const access = await getVaultAccessSettings();
  const agents = await discoverAgents("dispatch");
  const agent = agents.find((a) => a.id === appId);
  if (!agent) throw new Error(`App "${appId}" not found in agent registry`);

  const secretsToSync: VaultSecretRow[] = [];
  const activeGrants =
    access.mode === "manual"
      ? (await listGrants({ appId })).filter((g) => g.status === "active")
      : [];

  if (access.mode === "all-apps") {
    const secrets = await listSecrets();
    for (const secret of secrets) {
      secretsToSync.push(secret);
    }
  } else {
    for (const grant of activeGrants) {
      const secret = await getSecret(grant.secretId, ctx);
      if (secret) {
        secretsToSync.push(secret);
      }
    }
  }

  if (secretsToSync.length === 0) {
    return { appId, accessMode: access.mode, synced: 0, keys: [] };
  }

  const credentialStoreSync = await syncSecretsToCredentialStore(
    secretsToSync,
    ctx,
  );
  const vars = secretsToSync.map((secret) => ({
    key: secret.credentialKey,
    value: secret.value,
  }));
  let envVarSync:
    | { status: "synced"; keys: string[] }
    | { status: "skipped"; reason: string }
    | { status: "failed"; reason: string };

  // Best-effort push to the app's env-vars endpoint for local/dev apps that
  // still read process.env directly. Production/shared-DB apps intentionally
  // reject env writes; the encrypted app_secrets sync above is the canonical
  // path for request-scoped credentials.
  if (!isTrustedEnvVarSyncAgentUrl(agent.url)) {
    envVarSync = {
      status: "skipped",
      reason: "env-var sync is limited to localhost or workspace-owned apps",
    };
  } else {
    try {
      const res = await ssrfSafeFetch(
        `${agent.url}/_agent-native/env-vars`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vars }),
          signal: AbortSignal.timeout(10_000),
        },
        { maxRedirects: 3 },
      );

      if (res.ok) {
        const result = await res.json();
        envVarSync = { status: "synced", keys: result.saved || [] };
      } else {
        const err = await res.text().catch(() => "Unknown error");
        envVarSync = { status: "skipped", reason: err };
      }
    } catch (err) {
      envVarSync = {
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const syncedKeys = credentialStoreSync.keys;
  const timestamp = now();

  // Update syncedAt on grants that were successfully pushed to the shared
  // credential store. All-apps mode has no explicit grant rows to update.
  for (const grant of activeGrants) {
    const secret = await getSecret(grant.secretId, ctx);
    if (secret && syncedKeys.includes(secret.credentialKey)) {
      await db
        .update(schema.vaultGrants)
        .set({ syncedAt: timestamp, updatedAt: timestamp })
        .where(eq(schema.vaultGrants.id, grant.id));
    }
  }

  await recordVaultAudit({
    action: "secret.synced",
    appId,
    summary: `Synced ${syncedKeys.length} secret(s) to ${appId}: ${syncedKeys.join(", ")}`,
    metadata: {
      syncedKeys,
      accessMode: access.mode,
      credentialStore: {
        scope: credentialStoreSync.scope,
        scopeId: credentialStoreSync.scopeId,
      },
      envVars: envVarSync,
    },
  });

  return {
    appId,
    accessMode: access.mode,
    synced: syncedKeys.length,
    keys: syncedKeys,
    credentialStore: {
      scope: credentialStoreSync.scope,
      scopeId: credentialStoreSync.scopeId,
      synced: credentialStoreSync.keys.length,
    },
    envVars: envVarSync,
  };
}

// ─── Requests ──────────────────────────────────────────────────────

export async function listRequests(filter?: { status?: string }) {
  const db = getDb();
  const conditions = [scopedFilter(schema.vaultRequests)];
  if (filter?.status) {
    conditions.push(eq(schema.vaultRequests.status, filter.status) as any);
  }
  return db
    .select()
    .from(schema.vaultRequests)
    .where(and(...conditions))
    .orderBy(desc(schema.vaultRequests.updatedAt));
}

export async function getRequest(
  requestId: string,
  ctx: VaultCtx = requireVaultCtx(),
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.vaultRequests)
    .where(
      and(
        eq(schema.vaultRequests.id, requestId),
        ctxScope(schema.vaultRequests, ctx),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createRequest(input: {
  credentialKey: string;
  appId: string;
  reason?: string | null;
}) {
  const db = getDb();
  const timestamp = now();
  const requestId = id();
  const actor = currentOwnerEmail();

  await db.insert(schema.vaultRequests).values({
    id: requestId,
    ownerEmail: actor,
    orgId: currentOrgId(),
    credentialKey: input.credentialKey,
    appId: input.appId,
    reason: input.reason || null,
    requestedBy: actor,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await recordVaultAudit({
    action: "request.created",
    appId: input.appId,
    summary: `${actor} requested ${input.credentialKey} for ${input.appId}`,
    metadata: { requestId, reason: input.reason },
  });

  await notifyAdminsOfRequest(requestId, input);

  return getRequest(requestId);
}

export async function approveRequest(
  requestId: string,
  secretValue: string,
  secretName?: string,
  ctx: VaultCtx = requireVaultCtx(),
) {
  const db = getDb();
  const request = await getRequest(requestId, ctx);
  if (!request) throw new Error("Request not found");

  const timestamp = now();
  const reviewer = ctx.ownerEmail;
  const staleApplyingBefore = timestamp - 5 * 60 * 1000;

  // Fence the transition on the current status — scoped to caller's tenant —
  // so a concurrent approve can't both win: only the caller that flips
  // pending -> applying proceeds to create the secret/grant. A crashed worker
  // leaves an applying row behind, so a later reviewer may reclaim a lease
  // that has been idle for five minutes. See
  // claimAgentTeamRun in packages/core/src/server/agent-teams-run-queue.ts
  // for the same pattern.
  const claimed = await db
    .update(schema.vaultRequests)
    .set({
      status: "applying",
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(schema.vaultRequests.id, requestId),
        ctxScope(schema.vaultRequests, ctx),
        or(
          eq(schema.vaultRequests.status, "pending"),
          and(
            eq(schema.vaultRequests.status, "applying"),
            sql`${schema.vaultRequests.updatedAt} < ${staleApplyingBefore}`,
          ),
        ),
      ),
    )
    .returning();

  if (claimed.length === 0) {
    const current = await getRequest(requestId, ctx);
    if (current?.status === "applying") {
      throw new Error("Vault request is already being applied");
    }
    return current;
  }

  const claimedRequest = claimed[0];

  // Secret + grant must land in the REQUEST's tenant, not the approver's
  // (the approver may be acting on behalf of another user in the same org).
  const requestCtx = ctxForRow(claimedRequest);

  try {
    // Check if secret already exists in the request's tenant for this key.
    const existingSecrets = await db
      .select()
      .from(schema.vaultSecrets)
      .where(
        and(
          eq(schema.vaultSecrets.credentialKey, claimedRequest.credentialKey),
          ctxScope(schema.vaultSecrets, requestCtx),
        ),
      );
    let secret = existingSecrets[0] ?? null;

    if (!secret) {
      secret = await createSecret(
        {
          credentialKey: claimedRequest.credentialKey,
          value: secretValue,
          name: secretName || claimedRequest.credentialKey,
        },
        requestCtx,
      );
    }

    if (secret) {
      // Create the grant in the request's tenant as well.
      await createGrant(secret.id, claimedRequest.appId, requestCtx);
    }
  } catch (error) {
    await db
      .update(schema.vaultRequests)
      .set({ status: "pending", updatedAt: now() })
      .where(
        and(
          eq(schema.vaultRequests.id, requestId),
          ctxScope(schema.vaultRequests, ctx),
          eq(schema.vaultRequests.status, "applying"),
        ),
      );
    throw error;
  }

  await db
    .update(schema.vaultRequests)
    .set({
      status: "approved",
      reviewedBy: reviewer,
      reviewedAt: timestamp,
      updatedAt: now(),
    })
    .where(
      and(
        eq(schema.vaultRequests.id, requestId),
        ctxScope(schema.vaultRequests, ctx),
        eq(schema.vaultRequests.status, "applying"),
      ),
    );

  await recordVaultAudit({
    action: "request.approved",
    appId: claimedRequest.appId,
    summary: `Approved ${claimedRequest.credentialKey} for ${claimedRequest.appId} (requested by ${claimedRequest.requestedBy})`,
    metadata: { requestId, reviewer },
  });

  return getRequest(requestId, ctx);
}

export async function denyRequest(
  requestId: string,
  reason?: string | null,
  ctx: VaultCtx = requireVaultCtx(),
) {
  const db = getDb();
  const request = await getRequest(requestId, ctx);
  if (!request) throw new Error("Request not found");

  const timestamp = now();
  const reviewer = ctx.ownerEmail;

  const claimed = await db
    .update(schema.vaultRequests)
    .set({
      status: "denied",
      reviewedBy: reviewer,
      reviewedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(schema.vaultRequests.id, requestId),
        ctxScope(schema.vaultRequests, ctx),
        eq(schema.vaultRequests.status, "pending"),
      ),
    )
    .returning();

  if (claimed.length === 0) {
    return getRequest(requestId, ctx);
  }

  const claimedRequest = claimed[0];

  await recordVaultAudit({
    action: "request.denied",
    appId: claimedRequest.appId,
    summary: `Denied ${claimedRequest.credentialKey} for ${claimedRequest.appId} (requested by ${claimedRequest.requestedBy})`,
    metadata: { requestId, reviewer, reason },
  });

  return getRequest(requestId, ctx);
}

// ─── Integrations Catalog ────────────────────────────────────────

export interface IntegrationEntry {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
  vaultGranted: boolean;
  vaultSecretId?: string;
}

export interface AppIntegrations {
  appId: string;
  appName: string;
  url: string;
  color: string;
  integrations: IntegrationEntry[];
  vaultAccessMode: VaultAccessMode;
  reachable: boolean;
}

export async function listIntegrationsCatalog(): Promise<AppIntegrations[]> {
  const access = await getVaultAccessSettings();
  const agents = await discoverAgents("dispatch");
  const grants = await listGrants();
  const secrets = await listSecrets();

  const secretByKey = new Map(secrets.map((s) => [s.credentialKey, s]));

  const results: AppIntegrations[] = [];

  for (const agent of agents) {
    try {
      const res = await ssrfSafeFetch(
        `${agent.url}/_agent-native/env-status`,
        {
          signal: AbortSignal.timeout(3000),
        },
        { maxRedirects: 3 },
      );
      if (!res.ok) {
        results.push({
          appId: agent.id,
          appName: agent.name,
          url: agent.url,
          color: agent.color,
          integrations: [],
          vaultAccessMode: access.mode,
          reachable: false,
        });
        continue;
      }

      const envStatus: Array<{
        key: string;
        label: string;
        required: boolean;
        configured: boolean;
      }> = await res.json();

      const appGrants = grants.filter(
        (g) => g.appId === agent.id && g.status === "active",
      );
      const grantedSecretIds = new Set(appGrants.map((g) => g.secretId));

      const integrations: IntegrationEntry[] = envStatus.map((env) => {
        const matchingSecret = secretByKey.get(env.key);
        return {
          key: env.key,
          label: env.label,
          required: env.required,
          configured: env.configured,
          vaultGranted:
            !!matchingSecret &&
            (access.mode === "all-apps" ||
              grantedSecretIds.has(matchingSecret.id)),
          vaultSecretId: matchingSecret?.id,
        };
      });

      results.push({
        appId: agent.id,
        appName: agent.name,
        url: agent.url,
        color: agent.color,
        integrations,
        vaultAccessMode: access.mode,
        reachable: true,
      });
    } catch {
      results.push({
        appId: agent.id,
        appName: agent.name,
        url: agent.url,
        color: agent.color,
        integrations: [],
        vaultAccessMode: access.mode,
        reachable: false,
      });
    }
  }

  return results;
}

// ─── Vault Overview (for dashboard) ──────────────────────────────

export async function listVaultOverview() {
  const [secrets, grants, requests, access] = await Promise.all([
    listSecrets(),
    listGrants(),
    listRequests(),
    getVaultAccessSettings(),
  ]);
  const manualGrantCount = grants.filter((g) => g.status === "active").length;

  return {
    accessMode: access.mode,
    secretCount: secrets.length,
    activeGrantCount:
      access.mode === "all-apps" ? secrets.length : manualGrantCount,
    manualGrantCount,
    pendingRequestCount: requests.filter((r) => r.status === "pending").length,
  };
}

// ─── SendGrid Notifications ──────────────────────────────────────

async function notifyAdminsOfRequest(
  requestId: string,
  input: { credentialKey: string; appId: string; reason?: string | null },
) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;
  const appUrl = process.env.APP_URL;
  if (!apiKey || !from || !appUrl) return;

  // Use approval policy approver emails as admin notification targets
  const { getApprovalPolicy } = await import("./dispatch-store.js");
  const policy = await getApprovalPolicy();
  if (policy.approverEmails.length === 0) return;

  const body = [
    `Secret request: ${input.credentialKey} for ${input.appId}`,
    input.reason ? `Reason: ${input.reason}` : "",
    `Requested by: ${currentOwnerEmail()}`,
    "",
    `Review it here: ${appUrl}/vault`,
  ]
    .filter(Boolean)
    .join("\n");

  await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: policy.approverEmails.map((email) => ({ email })),
          subject: `Vault request: ${input.credentialKey} for ${input.appId}`,
        },
      ],
      from: { email: from },
      content: [{ type: "text/plain", value: body }],
      custom_args: { requestId },
    }),
  }).catch(() => {});
}
