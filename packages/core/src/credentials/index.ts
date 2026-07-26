import { getDbExec } from "../db/client.js";
import {
  encryptSecretValue,
  decryptSecretValue,
  isEncryptedSecretValue,
} from "../secrets/crypto.js";
import { readAppSecret, type SecretRef } from "../secrets/storage.js";
import { getSetting, putSetting, deleteSetting } from "../settings/store.js";

const SETTING_PREFIX = "credential:";

export interface CredentialContext {
  userEmail: string;
  orgId?: string | null;
}

export type CredentialStorageScope = "user" | "org";

function userCredentialSettingKey(email: string, key: string): string {
  return `u:${email.toLowerCase()}:${SETTING_PREFIX}${key}`;
}

function orgCredentialSettingKey(orgId: string, key: string): string {
  return `o:${orgId}:${SETTING_PREFIX}${key}`;
}

async function readCredentialSetting(
  settingKey: string,
): Promise<string | undefined> {
  const setting = await getSetting(settingKey);
  if (!setting || typeof setting.value !== "string") return undefined;
  const stored = setting.value;
  // Values written by saveCredential are AES-256-GCM encrypted at rest.
  // Rows that predate encryption are plaintext — read them transparently
  // (the migrate-encrypt-credentials script re-encrypts them in place).
  if (!isEncryptedSecretValue(stored)) return stored;
  try {
    return decryptSecretValue(stored);
  } catch {
    // Key rotated, corrupt, or tampered row — treat as not set rather than
    // surfacing ciphertext or throwing into every credential lookup.
    return undefined;
  }
}

async function readScopedAppSecret(
  key: string,
  scope: SecretRef["scope"],
  scopeId: string,
): Promise<string | undefined> {
  try {
    return (await readAppSecret({ key, scope, scopeId }))?.value;
  } catch {
    // Older databases may not have app_secrets yet. Keep the legacy
    // credential store available while the table bootstraps.
    return undefined;
  }
}

/**
 * Resolve a credential from one explicit legacy SQL credential scope.
 *
 * Prefer `resolveCredential()` for normal app-local credential lookup. This
 * helper exists for workspace connection refs, where a ref can explicitly say
 * "use the org-scoped key" and must not accidentally read a user override.
 */
export async function resolveCredentialForScope(
  key: string,
  ctx: CredentialContext & { scope: CredentialStorageScope },
): Promise<string | undefined> {
  if (!ctx?.userEmail) return undefined;
  if (ctx.scope === "org") {
    if (!ctx.orgId) return undefined;
    return readCredentialSetting(orgCredentialSettingKey(ctx.orgId, key));
  }
  return readCredentialSetting(userCredentialSettingKey(ctx.userEmail, key));
}

/**
 * Resolve a credential across the encrypted app_secrets store and the legacy
 * settings-backed credential store. User overrides win, followed by the
 * active org/workspace shared value.
 *
 * SECURITY: NEVER reads from process.env. Env vars are global to the
 * deployment and would leak across users in a multi-tenant app.
 *
 * Read order:
 *   1. user-scoped app_secrets
 *   2. user-scoped legacy settings credential
 *   3. org-scoped app_secrets
 *   4. legacy workspace-scoped app_secrets for the org
 *   5. org-scoped legacy settings credential
 *   6. solo workspace scope
 *
 * Step 6 runs whether or not an org is active, so a credential written before
 * the user joined an org stays reachable afterwards.
 */
export async function resolveCredential(
  key: string,
  ctx: CredentialContext,
): Promise<string | undefined> {
  if (!ctx?.userEmail) return undefined;

  const userSecret = await readScopedAppSecret(key, "user", ctx.userEmail);
  if (userSecret) return userSecret;

  const userSetting = await resolveCredentialForScope(key, {
    ...ctx,
    scope: "user",
  });
  if (userSetting) return userSetting;

  if (ctx.orgId) {
    const orgSecret = await readScopedAppSecret(key, "org", ctx.orgId);
    if (orgSecret) return orgSecret;

    const workspaceSecret = await readScopedAppSecret(
      key,
      "workspace",
      ctx.orgId,
    );
    if (workspaceSecret) return workspaceSecret;

    const orgSetting = await resolveCredentialForScope(key, {
      ...ctx,
      scope: "org",
    });
    if (orgSetting) return orgSetting;
  }

  return readScopedAppSecret(key, "workspace", `solo:${ctx.userEmail}`);
}

/**
 * Explain an empty credential lookup when a key of that name is saved in a
 * scope the caller cannot read.
 *
 * Non-interactive runs — integration/webhook deliveries, scheduled jobs,
 * automations, and inbound A2A calls — resolve credentials as an owner
 * identity rather than as the person who triggered them, so a teammate's
 * Personal key is invisible to them even though the vault visibly holds it.
 * That produces a "the key is right there and it still says it's missing"
 * report, which this turns into a self-explanatory one.
 *
 * SECURITY: the probe is bounded to the caller's own organization, reports
 * only the scope kind, and never returns the owning account, how many rows
 * matched, or any part of the value. Without an active org there is no
 * boundary to bound the probe to, so it declines to answer rather than
 * revealing that some other tenant holds a key of the same name.
 *
 * Returns null when nothing safe and useful can be said.
 */
export async function describeCredentialScopeGap(
  keys: readonly string[],
  ctx: CredentialContext,
): Promise<string | null> {
  if (!ctx?.userEmail || !ctx.orgId) return null;

  for (const key of keys) {
    if (!(await hasForeignPersonalCredentialInOrg(key, ctx))) continue;
    return (
      `A "${key}" key is saved in this workspace with Personal scope. ` +
      `Personal keys are readable only by their own owner's signed-in sessions, ` +
      `and this run resolves credentials as the owner identity behind the ` +
      `integration, job, or automation — so it needs "${key}" saved with ` +
      `Workspace or Organization scope instead.`
    );
  }
  return null;
}

async function hasForeignPersonalCredentialInOrg(
  key: string,
  ctx: CredentialContext,
): Promise<boolean> {
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT 1 FROM app_secrets s
              JOIN org_members m ON LOWER(m.email) = LOWER(s.scope_id)
             WHERE s.key = ? AND s.scope = 'user'
               AND m.org_id = ? AND LOWER(s.scope_id) <> ?
             LIMIT 1`,
      args: [key, ctx.orgId!, ctx.userEmail.toLowerCase()],
    });
    return rows.length > 0;
  } catch {
    // Missing app_secrets/org_members table, or any other read failure — a
    // diagnostic must never replace the real "not configured" error.
    return false;
  }
}

/**
 * Check if a credential is available for the given context.
 */
export async function hasCredential(
  key: string,
  ctx: CredentialContext,
): Promise<boolean> {
  return (await resolveCredential(key, ctx)) !== undefined;
}

/**
 * Save a credential. By default writes to the per-user store; pass
 * `scope: "org"` to write to the active org's shared credentials.
 */
export async function saveCredential(
  key: string,
  value: string,
  ctx: CredentialContext & { scope?: "user" | "org" },
): Promise<void> {
  if (!ctx?.userEmail) {
    throw new Error("saveCredential requires CredentialContext with userEmail");
  }
  // Encrypt at rest (AES-256-GCM) so a leaked DB backup / pg_dump / read
  // replica doesn't expose plaintext keys. resolveCredential decrypts
  // transparently on read.
  const encrypted = encryptSecretValue(value);
  if (ctx.scope === "org") {
    if (!ctx.orgId) {
      throw new Error("saveCredential scope='org' requires orgId");
    }
    await putSetting(orgCredentialSettingKey(ctx.orgId, key), {
      value: encrypted,
    });
    return;
  }
  await putSetting(userCredentialSettingKey(ctx.userEmail, key), {
    value: encrypted,
  });
}

/**
 * Delete a credential from the per-user (default) or per-org store.
 */
export async function deleteCredential(
  key: string,
  ctx: CredentialContext & { scope?: "user" | "org" },
): Promise<void> {
  if (!ctx?.userEmail) {
    throw new Error(
      "deleteCredential requires CredentialContext with userEmail",
    );
  }
  if (ctx.scope === "org") {
    if (!ctx.orgId) {
      throw new Error("deleteCredential scope='org' requires orgId");
    }
    await deleteSetting(orgCredentialSettingKey(ctx.orgId, key));
    return;
  }
  await deleteSetting(userCredentialSettingKey(ctx.userEmail, key));
}
