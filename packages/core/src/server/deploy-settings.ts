/**
 * The settings a deployed server refuses to run without, answered by the same
 * checks the refusals use: the database refusal in db/client.ts and the auth
 * secret refusal in `resolveAuthSecret()`. The setup page that replaces sign-in
 * and the `/_agent-native/ping?configuration=1` probe both read this, so they
 * show exactly when the server refuses. Do not give either one, or a refusal,
 * its own copy of these rules.
 */
import {
  hasConfiguredA2ASecret,
  isA2AProductionRuntime,
} from "../a2a/auth-policy.js";
import { getRefusedLocalDatabaseSource } from "../db/client.js";
import { isDeployedServerRuntime } from "../db/server-runtime.js";
import {
  DEPLOY_SETTINGS_REQUIRED_CODE,
  type MissingDeploySettings,
} from "../shared/runtime-config.js";
import { readDeployCredentialEnv } from "./credential-provider.js";
import {
  isExplicitLocalDeployEnvironment,
  resolveDeployEnvironment,
} from "./deploy-environment.js";
import {
  getWorkspaceA2ADerivedSecret,
  isWorkspaceRuntime,
} from "./derived-secret.js";

/**
 * True where secrets must come from the deployment's configuration and are
 * never generated: every environment except local development.
 */
export function requiresConfiguredSecrets(): boolean {
  return (
    isDeployedServerRuntime() ||
    resolveDeployEnvironment() !== "local" ||
    (process.env.NODE_ENV === "production" &&
      !isExplicitLocalDeployEnvironment())
  );
}

/**
 * The key that would let Better Auth start, or null when its signing secret
 * resolves. `resolveAuthSecret()` throws exactly when this is non-null.
 */
export function getMissingAuthSecretKey(): MissingDeploySettings["authSecretKey"] {
  if (readDeployCredentialEnv("BETTER_AUTH_SECRET")) return null;
  if (getWorkspaceA2ADerivedSecret("better-auth")) return null;
  if (!requiresConfiguredSecrets()) return null;
  return isWorkspaceRuntime() ? "A2A_SECRET" : "BETTER_AUTH_SECRET";
}

/** The required settings this deployment is missing. */
export function getMissingDeploySettings(): MissingDeploySettings {
  return {
    databaseSource: getRefusedLocalDatabaseSource(),
    authSecretKey: getMissingAuthSecretKey(),
    // The A2A processor's own refusal, so the probe names A2A_SECRET exactly
    // when A2A answers 503.
    a2aSecretMissing:
      isWorkspaceRuntime() &&
      isA2AProductionRuntime() &&
      !hasConfiguredA2ASecret(),
  };
}

/**
 * The env keys whose absence stops accounts from being created or signed in,
 * in the order the setup page names them. A workspace missing only
 * `A2A_SECRET` still signs in, so it never blocks here; a workspace with
 * neither secret is asked for `A2A_SECRET` alone, since it derives the auth
 * secret too.
 */
export function getSignInBlockingSettingKeys(): string[] {
  const { databaseSource, authSecretKey } = getMissingDeploySettings();
  const keys: string[] = [];
  // Name the key that resolved to local PGlite: an app-prefixed or Netlify
  // key wins over DATABASE_URL, so setting DATABASE_URL would not fix it.
  if (databaseSource !== null) {
    keys.push(databaseSource === "default" ? "DATABASE_URL" : databaseSource);
  }
  if (authSecretKey !== null) keys.push(authSecretKey);
  return keys;
}

/** Thrown when Better Auth cannot start without a configured signing secret. */
export class MissingAuthSecretError extends Error {
  readonly code = DEPLOY_SETTINGS_REQUIRED_CODE;

  constructor(message: string) {
    super(message);
    this.name = "MissingAuthSecretError";
  }
}
