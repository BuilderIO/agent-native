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
 *
 * Without an active org, step 3 is replaced by the solo workspace scope.
 */
export async function resolveCredential(
  key: string,
  ctx: CredentialContext,
): Promise<string | undefined> {
  if (!ctx?.userEmail) return undefined;

  const userSecret = await readScopedAppSecret(
    key,
    "user",
    ctx.userEmail,
  );
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

    return resolveCredentialForScope(key, { ...ctx, scope: "org" });
  }

  return readScopedAppSecret(
    key,
    "workspace",
    `solo:${ctx.userEmail}`,
  );
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
