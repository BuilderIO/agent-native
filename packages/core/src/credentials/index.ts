import { getSetting, putSetting, deleteSetting } from "../settings/store.js";

const SETTING_PREFIX = "credential:";

export interface CredentialContext {
  userEmail: string;
  orgId?: string | null;
}

/**
 * Resolve a credential, scoped to the caller's user (and falling back to
 * the active org's shared credential, if any).
 *
 * SECURITY: NEVER reads from process.env. Env vars are global to the
 * deployment and would leak across users in a multi-tenant app. The only
 * sources are per-user / per-org rows in the SQL `settings` table.
 *
 * Storage keys (priority order):
 *   1. u:<email>:credential:<KEY>   — per-user override
 *   2. o:<orgId>:credential:<KEY>   — per-org shared credential (if orgId given)
 */
export async function resolveCredential(
  key: string,
  ctx: CredentialContext,
): Promise<string | undefined> {
  if (!ctx?.userEmail) return undefined;
  const email = ctx.userEmail.toLowerCase();

  const userKey = `u:${email}:${SETTING_PREFIX}${key}`;
  const userSetting = await getSetting(userKey);
  if (userSetting && typeof userSetting.value === "string") {
    return userSetting.value;
  }

  if (ctx.orgId) {
    const orgKey = `o:${ctx.orgId}:${SETTING_PREFIX}${key}`;
    const orgSetting = await getSetting(orgKey);
    if (orgSetting && typeof orgSetting.value === "string") {
      return orgSetting.value;
    }
  }

  return undefined;
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
  if (ctx.scope === "org") {
    if (!ctx.orgId) {
      throw new Error("saveCredential scope='org' requires orgId");
    }
    await putSetting(`o:${ctx.orgId}:${SETTING_PREFIX}${key}`, { value });
    return;
  }
  await putSetting(`u:${ctx.userEmail.toLowerCase()}:${SETTING_PREFIX}${key}`, {
    value,
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
    await deleteSetting(`o:${ctx.orgId}:${SETTING_PREFIX}${key}`);
    return;
  }
  await deleteSetting(
    `u:${ctx.userEmail.toLowerCase()}:${SETTING_PREFIX}${key}`,
  );
}
