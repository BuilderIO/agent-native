import crypto from "node:crypto";

import { and, desc, eq, isNull, or, sql } from "@agent-native/core/db/schema";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import {
  deleteAppSecret,
  isVaultManagedSecret,
  listAppSecretsForScope,
  listAppSecretSummaries,
  readAppSecretMetaById,
  updateAppSecretById,
  VAULT_SYNC_DESCRIPTION_PREFIX,
  writeAppSecret,
  type AppSecretSummary,
  type SecretMeta,
  type SecretScope,
} from "@agent-native/core/secrets";
import { readOrgMemberRole } from "@agent-native/core/server";
import { discoverAgents } from "@agent-native/core/server/agent-discovery";
import {
  getOrgSetting,
  getUserSetting,
  putOrgSetting,
  putUserSetting,
} from "@agent-native/core/settings";
import type { SQL } from "drizzle-orm";

import { getDb, schema } from "../../db/index.js";
import {
  currentOwnerEmail,
  currentOrgId,
  recordAudit,
} from "./dispatch-store.js";

const VAULT_ACCESS_SETTINGS_KEY = "dispatch-vault-access-settings";

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
 * are not authorization. A key is found only in the credential-store scope
 * the ctx maps to (see `credentialStoreScopeForVaultCtx`); a grant, request
 * or audit row matches the ctx if either the caller owns it or it lives in
 * the caller's active org.
 */
export interface VaultCtx {
  ownerEmail: string;
  orgId: string | null;
}

export function requireVaultCtx(): VaultCtx {
  const ownerEmail = currentOwnerEmail();
  if (!ownerEmail) {
    throw new Error("Vault operation requires an authenticated user");
  }
  return { ownerEmail, orgId: currentOrgId() };
}

function ctxScope<T extends { ownerEmail: any; orgId: any }>(
  table: T,
  ctx: VaultCtx,
) {
  if (!ctx.orgId) {
    return and(eq(table.ownerEmail, ctx.ownerEmail), isNull(table.orgId));
  }
  return or(eq(table.ownerEmail, ctx.ownerEmail), eq(table.orgId, ctx.orgId));
}

/** Scope an approval operation to the active tenant, never just the owner email. */
function tenantScope<T extends { ownerEmail: any; orgId: any }>(
  table: T,
  ctx: VaultCtx,
) {
  if (ctx.orgId) return eq(table.orgId, ctx.orgId);
  return and(eq(table.ownerEmail, ctx.ownerEmail), isNull(table.orgId));
}

function ctxForRow(row: {
  ownerEmail: string;
  orgId: string | null;
}): VaultCtx {
  return { ownerEmail: row.ownerEmail, orgId: row.orgId };
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

function scopedFilter<T extends { ownerEmail: any; orgId: any }>(table: T) {
  return ctxScope(table, requireVaultCtx());
}

export async function assertCanManageVault(): Promise<void> {
  const orgId = currentOrgId();
  if (!orgId) return;

  const email = currentOwnerEmail().trim().toLowerCase();
  let role: string | null = null;
  try {
    role = await readOrgMemberRole(orgId, email);
  } catch {
    // coercion-ok: unknown membership is treated as unauthorized below.
    // A failed membership check must not become an authorization bypass.
  }

  if (role !== "owner" && role !== "admin") {
    throw Object.assign(
      new Error(
        "Only organization owners and admins can manage the workspace vault.",
      ),
      { statusCode: 403 },
    );
  }
}

export async function canManageVault(): Promise<boolean> {
  try {
    await assertCanManageVault();
    return true;
  } catch {
    // coercion-ok: the UI must treat an authorization lookup failure as no access.
    return false;
  }
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
  await assertCanManageVault();
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

export async function recordVaultAudit(input: {
  action: string;
  secretId?: string | null;
  /** The key the event is about. Recorded in the metadata, which outlives the key's row. */
  credentialKey?: string | null;
  appId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
  actor?: string;
}) {
  const db = getDb();
  const metadata =
    input.credentialKey || input.metadata
      ? {
          ...(input.credentialKey
            ? { credentialKey: input.credentialKey }
            : {}),
          ...input.metadata,
        }
      : null;
  await db.insert(schema.vaultAuditLog).values({
    id: id(),
    ownerEmail: currentOwnerEmail(),
    orgId: currentOrgId(),
    secretId: input.secretId || null,
    appId: input.appId || null,
    action: input.action,
    actor: input.actor || currentOwnerEmail(),
    summary: input.summary,
    metadata: metadata ? safeJson(metadata) : null,
    createdAt: now(),
  });
}

export async function listVaultAudit(limit = 50) {
  await assertCanManageVault();
  const db = getDb();
  return db
    .select()
    .from(schema.vaultAuditLog)
    .where(scopedFilter(schema.vaultAuditLog))
    .orderBy(desc(schema.vaultAuditLog.createdAt))
    .limit(limit);
}

/**
 * A key in the vault's credential-store scope: its `app_secrets` row without
 * the value. `name` is the label, or the key itself for a row saved before
 * labels existed.
 */
export interface VaultSecretRow {
  id: string;
  name: string;
  credentialKey: string;
  provider: string | null;
  description: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  /**
   * Created or edited through the Vault. Without it the key is one an app
   * registered for itself in the same scope.
   */
  managed: boolean;
}

/**
 * What the credential store holds for a key: a readable value, or one this
 * deployment cannot decrypt (a rotated key, a copied database).
 */
export type VaultValueStatus = "stored" | "unreadable";

export interface VaultSecretMetadata {
  id: string;
  name: string;
  credentialKey: string;
  last4: string;
  valueStatus: VaultValueStatus;
  provider: string | null;
  description: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A key an earlier release saved carries that release's marker in its description; it is not the user's text. */
function visibleDescription(description: string | null): string | null {
  return description?.startsWith(VAULT_SYNC_DESCRIPTION_PREFIX)
    ? null
    : description;
}

function vaultSecretRow(row: AppSecretSummary): VaultSecretRow {
  return {
    id: row.id,
    name: row.label || row.key,
    credentialKey: row.key,
    provider: row.provider,
    description: visibleDescription(row.description),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    managed: isVaultManagedSecret(row),
  };
}

function vaultSecretMetadata(meta: SecretMeta): VaultSecretMetadata {
  return {
    id: meta.id,
    name: meta.label || meta.key,
    credentialKey: meta.key,
    last4: meta.last4,
    // The scope listing reports a value it cannot decrypt as an empty
    // preview, and a stored value is never empty.
    valueStatus: meta.last4 === "" ? "unreadable" : "stored",
    provider: meta.provider,
    description: visibleDescription(meta.description),
    createdBy: meta.createdBy,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

/**
 * Where a vault's keys live in the credential store: the organization's scope,
 * or the caller's own `solo:` scope when no organization is active. A key is
 * its `app_secrets` row there, and its id is that row's id.
 */
export function credentialStoreScopeForVaultCtx(ctx: VaultCtx): {
  scope: Extract<SecretScope, "org" | "workspace">;
  scopeId: string;
} {
  if (ctx.orgId) return { scope: "org", scopeId: ctx.orgId };
  return { scope: "workspace", scopeId: `solo:${ctx.ownerEmail}` };
}

async function listScopeSecrets(ctx: VaultCtx): Promise<VaultSecretRow[]> {
  const target = credentialStoreScopeForVaultCtx(ctx);
  const rows = await listAppSecretSummaries(target.scope, target.scopeId);
  return rows.map(vaultSecretRow);
}

async function findSecret(
  secretId: string,
  ctx: VaultCtx,
): Promise<VaultSecretRow | null> {
  const rows = await listScopeSecrets(ctx);
  return rows.find((row) => row.id === secretId) ?? null;
}

async function requireSecretMetadata(
  secretId: string,
  ctx: VaultCtx,
): Promise<VaultSecretMetadata> {
  const secret = await getSecret(secretId, ctx);
  if (!secret) throw new Error("Secret not found");
  return secret;
}

/** Every key in the vault's scope with a masked preview. Never returns a value. */
export async function listSecrets(): Promise<VaultSecretMetadata[]> {
  await assertCanManageVault();
  const target = credentialStoreScopeForVaultCtx(requireVaultCtx());
  const rows = await listAppSecretsForScope(target.scope, target.scopeId);
  return rows.map(vaultSecretMetadata);
}

/**
 * The keys the caller may pick from. Admins get everything in the vault's
 * scope, as on the Vault page. Members get only keys the Vault manages, so an
 * app's own organization keys stay out of reach of a picker any member can open.
 */
export async function listSecretOptions() {
  const rows = await listScopeSecrets(requireVaultCtx());
  const visible = (await canManageVault())
    ? rows
    : rows.filter((row) => row.managed);
  return visible.map(({ id, name, credentialKey, provider, description }) => ({
    id,
    name,
    credentialKey,
    provider,
    description,
  }));
}

export async function getSecret(
  secretId: string,
  ctx: VaultCtx = requireVaultCtx(),
): Promise<VaultSecretMetadata | null> {
  await assertCanManageVault();
  const target = credentialStoreScopeForVaultCtx(ctx);
  const meta = await readAppSecretMetaById({ id: secretId, ...target });
  return meta ? vaultSecretMetadata(meta) : null;
}

/**
 * Save a key. A key that already exists in the scope is updated, which is the
 * caller asking for exactly that; nothing else here ever overwrites a row.
 * The value goes straight into the encrypted column of its `app_secrets` row.
 */
export async function createSecret(
  input: {
    credentialKey: string;
    value: string;
    name: string;
    provider?: string | null | undefined;
    description?: string | null | undefined;
  },
  ctx: VaultCtx = requireVaultCtx(),
): Promise<VaultSecretMetadata> {
  await assertCanManageVault();
  const credentialKey = normalizeCredentialKey(input.credentialKey);
  if (!credentialKey) throw new Error("Credential key is required");
  if (!input.value) throw new Error("Secret value is required");
  const target = credentialStoreScopeForVaultCtx(ctx);
  const existing = (await listScopeSecrets(ctx)).find(
    (row) => row.credentialKey === credentialKey,
  );

  if (existing) {
    const updated = await updateAppSecretById(
      { id: existing.id, ...target },
      {
        value: input.value,
        label: input.name,
        provider: input.provider || null,
        description: input.description || null,
        adoptedBy: ctx.ownerEmail,
      },
    );
    if (updated) {
      await recordVaultAudit({
        action: "secret.updated",
        secretId: existing.id,
        credentialKey,
        summary: `Updated secret "${input.name}" (${credentialKey})`,
        metadata: { provider: input.provider },
      });

      await recordAudit({
        action: "vault.secret.updated",
        targetType: "vault-secret",
        targetId: existing.id,
        summary: `Updated vault secret "${input.name}" (${credentialKey})`,
      });

      return requireSecretMetadata(existing.id, ctx);
    }
  }

  const secretId = await writeAppSecret({
    key: credentialKey,
    value: input.value,
    ...target,
    label: input.name,
    provider: input.provider || null,
    ...(input.description ? { description: input.description } : {}),
    createdBy: ctx.ownerEmail,
  });

  await recordVaultAudit({
    action: "secret.created",
    secretId,
    credentialKey,
    summary: `Created secret "${input.name}" (${credentialKey})`,
    metadata: { provider: input.provider },
  });

  await recordAudit({
    action: "vault.secret.created",
    targetType: "vault-secret",
    targetId: secretId,
    summary: `Created vault secret "${input.name}" (${credentialKey})`,
  });

  return requireSecretMetadata(secretId, ctx);
}

export async function updateSecret(
  secretId: string,
  input:
    | string
    | {
        credentialKey?: string | undefined;
        value?: string | undefined;
        name?: string | undefined;
        provider?: string | null | undefined;
        description?: string | null | undefined;
      },
  ctx: VaultCtx = requireVaultCtx(),
): Promise<VaultSecretMetadata> {
  await assertCanManageVault();
  const existing = await findSecret(secretId, ctx);
  if (!existing) throw new Error("Secret not found");
  const patch = typeof input === "string" ? { value: input } : input;
  const credentialKey =
    patch.credentialKey !== undefined
      ? normalizeCredentialKey(patch.credentialKey)
      : existing.credentialKey;
  if (!credentialKey) throw new Error("Credential key is required");
  const name = patch.name !== undefined ? patch.name.trim() : existing.name;
  if (!name) throw new Error("Secret name is required");
  if (patch.value !== undefined && !patch.value) {
    throw new Error("Secret value is required");
  }
  const provider =
    patch.provider !== undefined ? patch.provider || null : existing.provider;
  const description =
    patch.description !== undefined
      ? patch.description || null
      : existing.description;
  const renamed = credentialKey !== existing.credentialKey;

  // One statement renames, rotates and relabels together, and refuses a key
  // another row in the scope already holds. A rename moves the stored
  // ciphertext with the row, so the value is never read or rewritten.
  const stored = await updateAppSecretById(
    { id: secretId, ...credentialStoreScopeForVaultCtx(ctx) },
    {
      ...(renamed ? { key: credentialKey } : {}),
      ...(patch.value !== undefined ? { value: patch.value } : {}),
      ...(patch.name !== undefined ? { label: name } : {}),
      ...(patch.provider !== undefined ? { provider } : {}),
      ...(patch.description !== undefined ? { description } : {}),
      adoptedBy: ctx.ownerEmail,
    },
  );
  if (!stored) throw new Error("Secret not found");

  if (renamed) {
    // Grants name their key, so they follow it. A failure here leaves them on
    // the old key, which grants nothing: access fails closed.
    await getDb()
      .update(schema.vaultGrants)
      .set({ credentialKey, secretId, updatedAt: now() })
      .where(
        or(
          eq(schema.vaultGrants.secretId, secretId),
          and(
            eq(schema.vaultGrants.credentialKey, existing.credentialKey),
            tenantScope(schema.vaultGrants, ctx),
          ),
        ),
      );
  }

  const auditMetadata = {
    name,
    previousName: name !== existing.name ? existing.name : undefined,
    credentialKey,
    previousCredentialKey: renamed ? existing.credentialKey : undefined,
    provider,
    previousProvider:
      provider !== existing.provider ? existing.provider : undefined,
    description,
    previousDescription:
      description !== existing.description ? existing.description : undefined,
    valueChanged: patch.value !== undefined ? true : undefined,
  };

  await recordVaultAudit({
    action: "secret.updated",
    secretId,
    credentialKey,
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

  return requireSecretMetadata(secretId, ctx);
}

export async function deleteSecret(
  secretId: string,
  ctx: VaultCtx = requireVaultCtx(),
) {
  await assertCanManageVault();
  const existing = await findSecret(secretId, ctx);
  if (!existing) throw new Error("Secret not found");

  const grants = await listGrants({ secretId });
  for (const grant of grants) {
    if (grant.status === "active") {
      await revokeGrant(grant.id, ctx);
    }
  }

  const removed = await deleteAppSecret({
    key: existing.credentialKey,
    ...credentialStoreScopeForVaultCtx(ctx),
  });
  // Another admin renamed or deleted the key after the lookup: say so rather
  // than record a delete that never happened.
  if (!removed) throw new Error("Secret not found");

  await recordVaultAudit({
    action: "secret.deleted",
    secretId,
    credentialKey: existing.credentialKey,
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

/**
 * A grant belongs to a key by its name. The id match covers a grant whose key
 * column a rename has not reached yet; the name match covers grants backfilled
 * from before the key column existed, whose `secretId` is stale.
 */
function grantsOfSecret(secret: VaultSecretRow, ctx: VaultCtx) {
  return or(
    eq(schema.vaultGrants.secretId, secret.id),
    and(
      eq(schema.vaultGrants.credentialKey, secret.credentialKey),
      tenantScope(schema.vaultGrants, ctx),
    ),
  );
}

/** Report the grant against the key's current id, so callers can match it to a listed key. */
function withCurrentSecretId<
  T extends { secretId: string; credentialKey: string | null },
>(grant: T, secrets: VaultSecretRow[]): T {
  const secret = grant.credentialKey
    ? secrets.find((row) => row.credentialKey === grant.credentialKey)
    : undefined;
  return secret ? { ...grant, secretId: secret.id } : grant;
}

export async function listGrants(filter?: {
  secretId?: string;
  appId?: string;
}) {
  await assertCanManageVault();
  const ctx = requireVaultCtx();
  const db = getDb();
  const secrets = await listScopeSecrets(ctx);
  const conditions: Array<SQL | undefined> = [scopedFilter(schema.vaultGrants)];
  if (filter?.secretId) {
    const secret = secrets.find((row) => row.id === filter.secretId);
    conditions.push(
      secret
        ? grantsOfSecret(secret, ctx)
        : eq(schema.vaultGrants.secretId, filter.secretId),
    );
  }
  if (filter?.appId) {
    conditions.push(eq(schema.vaultGrants.appId, filter.appId));
  }
  const rows = await db
    .select()
    .from(schema.vaultGrants)
    .where(and(...conditions))
    .orderBy(desc(schema.vaultGrants.updatedAt));
  return rows.map((grant) => withCurrentSecretId(grant, secrets));
}

export async function getGrant(
  grantId: string,
  ctx: VaultCtx = requireVaultCtx(),
) {
  await assertCanManageVault();
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.vaultGrants)
    .where(
      and(
        eq(schema.vaultGrants.id, grantId),
        ctxScope(schema.vaultGrants, ctx),
      ),
    )
    .limit(1);
  const row = rows.at(0);
  return row ? withCurrentSecretId(row, await listScopeSecrets(ctx)) : null;
}

export async function createGrant(
  secretId: string,
  appId: string,
  ctx: VaultCtx = requireVaultCtx(),
) {
  await assertCanManageVault();
  const db = getDb();
  const secret = await findSecret(secretId, ctx);
  if (!secret) throw new Error("Secret not found");

  const timestamp = now();
  const actor = ctx.ownerEmail;
  const matches = await db
    .select()
    .from(schema.vaultGrants)
    .where(
      and(
        eq(schema.vaultGrants.appId, appId),
        grantsOfSecret(secret, ctx),
        ctxScope(schema.vaultGrants, ctx),
      ),
    )
    .orderBy(desc(schema.vaultGrants.updatedAt));
  const existing =
    matches.find((grant) => grant.status === "active") ?? matches[0];

  if (existing?.status === "active") {
    return getGrant(existing.id, ctx);
  }

  if (existing) {
    await db
      .update(schema.vaultGrants)
      .set({
        grantedBy: actor,
        status: "active",
        syncedAt: null,
        secretId: secret.id,
        credentialKey: secret.credentialKey,
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
      credentialKey: secret.credentialKey,
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
    secretId: secret.id,
    credentialKey: secret.credentialKey,
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
    credentialKey: secret.credentialKey,
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

  return getGrant(grantId, ctx);
}

export async function grantSecretsToApp(
  secretIds: string[],
  appId: string,
  ctx: VaultCtx = requireVaultCtx(),
) {
  await assertCanManageVault();
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
  await assertCanManageVault();
  const db = getDb();
  const grant = await getGrant(grantId, ctx);
  if (!grant) throw new Error("Grant not found");

  const secret = await findSecret(grant.secretId, ctx);
  const credentialKey = secret?.credentialKey ?? grant.credentialKey;

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
    credentialKey,
    appId: grant.appId,
    summary: `Revoked ${credentialKey || grant.secretId} from ${grant.appId}`,
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

export async function listRequests(filter?: { status?: string }) {
  const db = getDb();
  const ctx = requireVaultCtx();
  const isAdmin = await canManageVault();
  const conditions = [
    isAdmin
      ? ctxScope(schema.vaultRequests, ctx)
      : eq(schema.vaultRequests.ownerEmail, ctx.ownerEmail),
  ];
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

async function getRequestForTenant(requestId: string, ctx: VaultCtx) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.vaultRequests)
    .where(
      and(
        eq(schema.vaultRequests.id, requestId),
        tenantScope(schema.vaultRequests, ctx),
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
    credentialKey: input.credentialKey,
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
  await assertCanManageVault();
  const db = getDb();
  const request = await getRequestForTenant(requestId, ctx);
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
        tenantScope(schema.vaultRequests, ctx),
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

  const claimedRequest = claimed.at(0);
  if (!claimedRequest) {
    const current = await getRequestForTenant(requestId, ctx);
    if (current?.status === "applying") {
      throw new Error("Vault request is already being applied");
    }
    return current;
  }

  // Secret + grant must land in the REQUEST's tenant, not the approver's
  // (the approver may be acting on behalf of another user in the same org).
  const requestCtx = ctxForRow(claimedRequest);

  try {
    // A key that already exists in the scope is only granted: the approver's
    // value never overwrites a row, whether the Vault or an app wrote it.
    let secretId = (await listScopeSecrets(requestCtx)).find(
      (row) => row.credentialKey === claimedRequest.credentialKey,
    )?.id;

    if (!secretId) {
      secretId = (
        await createSecret(
          {
            credentialKey: claimedRequest.credentialKey,
            value: secretValue,
            name: secretName || claimedRequest.credentialKey,
          },
          requestCtx,
        )
      ).id;
    }

    await createGrant(secretId, claimedRequest.appId, requestCtx);
  } catch (error) {
    await db
      .update(schema.vaultRequests)
      .set({ status: "pending", updatedAt: now() })
      .where(
        and(
          eq(schema.vaultRequests.id, requestId),
          tenantScope(schema.vaultRequests, ctx),
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
        tenantScope(schema.vaultRequests, ctx),
        eq(schema.vaultRequests.status, "applying"),
      ),
    );

  await recordVaultAudit({
    action: "request.approved",
    credentialKey: claimedRequest.credentialKey,
    appId: claimedRequest.appId,
    summary: `Approved ${claimedRequest.credentialKey} for ${claimedRequest.appId} (requested by ${claimedRequest.requestedBy})`,
    metadata: { requestId, reviewer },
  });

  return getRequestForTenant(requestId, ctx);
}

export async function denyRequest(
  requestId: string,
  reason?: string | null,
  ctx: VaultCtx = requireVaultCtx(),
) {
  await assertCanManageVault();
  const db = getDb();
  const request = await getRequestForTenant(requestId, ctx);
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
        tenantScope(schema.vaultRequests, ctx),
        eq(schema.vaultRequests.status, "pending"),
      ),
    )
    .returning();

  const claimedRequest = claimed.at(0);
  if (!claimedRequest) {
    return getRequestForTenant(requestId, ctx);
  }

  await recordVaultAudit({
    action: "request.denied",
    credentialKey: claimedRequest.credentialKey,
    appId: claimedRequest.appId,
    summary: `Denied ${claimedRequest.credentialKey} for ${claimedRequest.appId} (requested by ${claimedRequest.requestedBy})`,
    metadata: { requestId, reviewer, reason },
  });

  return getRequestForTenant(requestId, ctx);
}

export interface IntegrationEntry {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
  vaultGranted: boolean;
  vaultSecretId?: string;
  secret: boolean;
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
  const grants = (await canManageVault()) ? await listGrants() : [];
  const secrets = await listSecretOptions();

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
        secret?: boolean;
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
          secret: env.secret ?? true,
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

export async function listVaultOverview() {
  const isAdmin = await canManageVault();
  const [secrets, grants, requests, access] = await Promise.all([
    listSecretOptions(),
    isAdmin ? listGrants() : Promise.resolve([]),
    listRequests(),
    getVaultAccessSettings(),
  ]);
  // A grant with no key (written before grants named their key) grants nothing.
  const manualGrantCount = grants.filter(
    (g) => g.status === "active" && g.credentialKey,
  ).length;

  return {
    accessMode: access.mode,
    secretCount: secrets.length,
    activeGrantCount:
      access.mode === "all-apps"
        ? secrets.length
        : isAdmin
          ? manualGrantCount
          : 0,
    manualGrantCount: isAdmin ? manualGrantCount : 0,
    pendingRequestCount: requests.filter((r) => r.status === "pending").length,
  };
}

async function notifyAdminsOfRequest(
  requestId: string,
  input: { credentialKey: string; appId: string; reason?: string | null },
) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;
  const appUrl = process.env.APP_URL;
  if (!apiKey || !from || !appUrl) return;

  const { approverRecipients, getApprovalPolicy } =
    await import("./dispatch-store.js");
  const recipients = approverRecipients(
    (await getApprovalPolicy()).approverEmails,
  );
  if (recipients.length === 0) return;

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
          to: recipients.map((email) => ({ email })),
          subject: `Vault request: ${input.credentialKey} for ${input.appId}`,
        },
      ],
      from: { email: from },
      content: [{ type: "text/plain", value: body }],
      custom_args: { requestId },
    }),
  }).catch(() => {});
}
