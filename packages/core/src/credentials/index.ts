import { getDbExec } from "../db/client.js";
import {
  encryptSecretValue,
  decryptSecretValue,
  isEncryptedSecretValue,
} from "../secrets/crypto.js";
import { readAppSecret, type SecretRef } from "../secrets/storage.js";
import { assertCredentialStoreReadable } from "../server/credential-provider.js";
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
 * `ctx.orgId` when the caller supplied one, otherwise the org resolved from
 * `ctx.userEmail`'s membership. Interactive requests always supply `orgId`
 * (session/`getOrgContext` backfill it); CLI runs, cron jobs, and any other
 * caller built straight from `getCredentialContext()` outside a request event
 * do not, and previously fell through as "no active org" — invisibly skipping
 * every org-scoped credential a signed-in session could see. Mirrors the
 * fallback already proven in `resolveSecretDetailed`
 * (server/credential-provider.ts).
 */
async function resolveEffectiveOrgId(
  ctx: CredentialContext,
): Promise<{ orgId: string | null; lookupFailed: boolean; cause?: unknown }> {
  if (ctx.orgId) return { orgId: ctx.orgId, lookupFailed: false };
  try {
    const { resolveOrgIdForEmail } = await import("../org/context.js");
    return {
      orgId: await resolveOrgIdForEmail(ctx.userEmail),
      lookupFailed: false,
    };
  } catch (cause) {
    // Membership was unreadable, not merely absent — must not collapse to
    // "caller has no org", which would silently hide every org-scoped row.
    return { orgId: null, lookupFailed: true, cause };
  }
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
 *   6. solo workspace-scoped app_secrets (`solo:<email>`)
 *
 * Steps 3-5 use `ctx.orgId` when given, else the org resolved from
 * `ctx.userEmail` (see `resolveEffectiveOrgId`), and are skipped only when the
 * caller truly has no org. A membership lookup that could not be read throws
 * `CredentialStoreUnavailableError` instead of silently reporting the
 * credential as unset — "the store didn't answer" and "nothing is saved" are
 * different outcomes callers must not conflate.
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

  const orgLookup = await resolveEffectiveOrgId(ctx);
  assertCredentialStoreReadable(orgLookup);
  const { orgId } = orgLookup;

  if (orgId) {
    const orgSecret = await readScopedAppSecret(key, "org", orgId);
    if (orgSecret) return orgSecret;

    const workspaceSecret = await readScopedAppSecret(key, "workspace", orgId);
    if (workspaceSecret) return workspaceSecret;

    const orgSetting = await resolveCredentialForScope(key, {
      ...ctx,
      orgId,
      scope: "org",
    });
    if (orgSetting) return orgSetting;
  }

  // Solo-workspace fallback: always checked, even when an org id was found
  // above. A credential written before the user joined/created an org lives
  // here, and must not become unreachable once that org exists. Last on
  // purpose — a current org-scoped value always wins over a pre-org one.
  return readScopedAppSecret(key, "workspace", `solo:${ctx.userEmail}`);
}

/**
 * Explain an empty credential lookup when a key of that name is saved in a
 * scope the caller cannot read.
 *
 * Two distinct causes produce the same "the key is right there and it still
 * says it's missing" report:
 *
 *  - Non-interactive runs — integration/webhook deliveries, scheduled jobs,
 *    automations, and inbound A2A calls — resolve credentials as an owner
 *    identity rather than as the person who triggered them, so a teammate's
 *    Personal key is invisible to them even though the vault visibly holds it.
 *  - The key is saved in a DIFFERENT organization the caller also belongs to.
 *    Credentials are per-organization, so gaining a second organization (or
 *    having `active-org-id` repointed at one) orphans every key synced under
 *    the first. Without this, the only symptom is a missing-env-var error that
 *    names the key rather than the org mismatch that actually caused it.
 *
 * SECURITY: both probes are bounded to organizations the caller is a member
 * of, report only the scope kind (and, for the cross-org case, the name of an
 * org the caller already belongs to), and never return the owning account, how
 * many rows matched, or any part of the value. Without an active org there is
 * no boundary to bound the probe to, so it declines to answer rather than
 * revealing that some other tenant holds a key of the same name — this
 * includes callers whose `ctx.orgId` is unset AND whose org could not be
 * resolved from `ctx.userEmail` (see `resolveEffectiveOrgId`).
 *
 * Returns null when nothing safe and useful can be said.
 */
export async function describeCredentialScopeGap(
  keys: readonly string[],
  ctx: CredentialContext,
): Promise<string | null> {
  if (!ctx?.userEmail) return null;
  const orgLookup = await resolveEffectiveOrgId(ctx);
  if (orgLookup.lookupFailed || !orgLookup.orgId) return null;
  const scopedCtx: CredentialContext = { ...ctx, orgId: orgLookup.orgId };

  for (const key of keys) {
    if (await hasForeignPersonalCredentialInOrg(key, scopedCtx)) {
      return (
        `A "${key}" key is saved in this workspace with Personal scope. ` +
        `Personal keys are readable only by their own owner's signed-in sessions, ` +
        `and this run resolves credentials as the owner identity behind the ` +
        `integration, job, or automation — so it needs "${key}" saved with ` +
        `Workspace or Organization scope instead.`
      );
    }

    const holder = await findMemberOrgHoldingCredential(key, scopedCtx);
    if (holder) {
      return (
        `A "${key}" key is saved in the ${holder} organization, but this ` +
        `request resolved to a different organization you also belong to. ` +
        `Credentials are scoped per organization and are not shared between ` +
        `them, so this is an organization mismatch rather than a missing key. ` +
        `Either switch your active organization back to ${holder}, or save ` +
        `"${key}" in the organization this request runs in.`
      );
    }
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
 * Name an organization the caller is a member of that holds this key, other
 * than the one the request resolved to. Returns a quoted display name, or the
 * bare word `another` when the org row is unreadable — never an org id, which
 * would be useless to the person reading the error.
 */
async function findMemberOrgHoldingCredential(
  key: string,
  ctx: CredentialContext,
): Promise<string | null> {
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT o.name AS org_name
              FROM app_secrets s
              JOIN org_members m ON m.org_id = s.scope_id
                                AND LOWER(m.email) = ?
              LEFT JOIN organizations o ON o.id = s.scope_id
             WHERE s.key = ?
               AND s.scope IN ('org', 'workspace')
               AND s.scope_id <> ?
             LIMIT 1`,
      args: [ctx.userEmail.toLowerCase(), key, ctx.orgId!],
    });
    if (rows.length === 0) return null;
    const name = (rows[0] as { org_name?: unknown }).org_name;
    return typeof name === "string" && name.trim()
      ? `"${name.trim()}"`
      : "another";
  } catch {
    return null;
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
