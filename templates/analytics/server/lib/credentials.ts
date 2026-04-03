export {
  resolveCredential,
  hasCredential,
  saveCredential,
} from "@agent-native/core/credentials";
import { resolveCredential } from "@agent-native/core/credentials";
import { setResponseStatus, type H3Event } from "h3";
import type { MissingKeyResponse } from "@agent-native/core/server";

/**
 * Async replacement for requireEnvKey that checks both process.env and SQL.
 * Returns a structured "missing_api_key" response if the credential is not
 * found in either source. Returns null if the credential exists.
 */
export async function requireCredential(
  event: H3Event,
  key: string,
  label: string,
  options?: { message?: string; settingsPath?: string },
): Promise<MissingKeyResponse | null> {
  const value = await resolveCredential(key);
  if (value) return null;

  setResponseStatus(event, 200);
  return {
    error: "missing_api_key",
    key,
    label,
    message:
      options?.message ?? `Connect your ${label} account to see this data`,
    settingsPath: options?.settingsPath ?? "/data-sources",
  };
}
