import { getSetting, putSetting } from "../settings/store.js";

const SETTING_PREFIX = "credential:";

/**
 * Resolve a credential by key. Checks process.env first (backward compat
 * for .env files and deploy-level config), then falls back to the SQL
 * settings store.
 *
 * Use this for per-user/account credentials (API keys, tokens, secrets)
 * that should persist in the database rather than environment variables.
 */
export async function resolveCredential(
  key: string,
): Promise<string | undefined> {
  const envValue = process.env[key];
  if (envValue) return envValue;

  const setting = await getSetting(`${SETTING_PREFIX}${key}`);
  if (setting && typeof setting.value === "string") return setting.value;

  return undefined;
}

/**
 * Check if a credential is available (env or settings).
 */
export async function hasCredential(key: string): Promise<boolean> {
  return (await resolveCredential(key)) !== undefined;
}

/**
 * Save a credential to the SQL settings store.
 */
export async function saveCredential(
  key: string,
  value: string,
): Promise<void> {
  await putSetting(`${SETTING_PREFIX}${key}`, { value });
}
