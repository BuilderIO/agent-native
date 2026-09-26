/**
 * The settings a deployed server refuses to run without, answered by the same
 * checks the refusals use: the database refusal in db/client.ts and the auth
 * secret refusal in `resolveAuthSecret()`. The `/_agent-native/ping?configuration=1`
 * probe reports this for the sign-in banner, so the banner shows exactly when
 * the server refuses. Do not give the probe or a refusal its own copy of these
 * rules.
 */
import { getRefusedLocalDatabaseSource } from "../db/client.js";
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
    a2aSecretMissing:
      isWorkspaceRuntime() &&
      requiresConfiguredSecrets() &&
      !readDeployCredentialEnv("A2A_SECRET")?.trim(),
  };
}

/** Thrown when Better Auth cannot start without a configured signing secret. */
export class MissingAuthSecretError extends Error {
  readonly code = DEPLOY_SETTINGS_REQUIRED_CODE;

  constructor(message: string) {
    super(message);
    this.name = "MissingAuthSecretError";
  }
}
