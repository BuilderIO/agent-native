import crypto from "node:crypto";

import { getAppConfig } from "../app-config/index.js";

const DERIVED_SECRET_PREFIX = "agent-native:derived-secret:v1";

/**
 * Whether this app runs inside a workspace, where auth and internal secrets
 * derive from the shared `A2A_SECRET`. Exported so the deploy settings check
 * decides "workspace" exactly the way the derivation does.
 */
export function isWorkspaceRuntime(): boolean {
  const workspace = getAppConfig().workspace;
  return (
    workspace.isWorkspace === true || typeof workspace.appsJson === "string"
  );
}

export function deriveServerSecret(
  rootSecret: string,
  purpose: string,
): string {
  return crypto
    .createHmac("sha256", rootSecret)
    .update(`${DERIVED_SECRET_PREFIX}:${purpose}`)
    .digest("hex");
}

export function getWorkspaceA2ADerivedSecret(
  purpose:
    | "better-auth"
    | "oauth-state"
    | "short-lived-token"
    | "secrets-encryption",
): string | undefined {
  if (!isWorkspaceRuntime()) return undefined;
  const rootSecret = process.env.A2A_SECRET?.trim();
  return rootSecret ? deriveServerSecret(rootSecret, purpose) : undefined;
}
