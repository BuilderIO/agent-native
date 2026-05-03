import { isLocalDatabase } from "../db/client.js";
import { isDevEnvironment } from "./auth.js";

/**
 * Whether deployment-wide `process.env` writes (and .env file writes) are safe.
 *
 * Production never allows request-time env writes, even with the escape hatch.
 * Env vars are deployment-wide globals and one tenant could otherwise
 * overwrite shared keys for every other tenant. Per-user/org credentials
 * should use `app_secrets` instead.
 */
export function isEnvVarWriteAllowed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.AGENT_NATIVE_ALLOW_ENV_VAR_WRITES === "1") return true;
  return isDevEnvironment() && isLocalDatabase();
}
