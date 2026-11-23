import type { MCPCallerIdentity } from "./build-server.js";

const RETIRED_INLINE_ENV_VARS = [
  "AGENT_NATIVE_MCP_APPS_INLINE",
  "AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS",
] as const;

let warnedRetiredInlineEnv = false;

/** Logs once per process when a retired inline env var is still set. */
export function warnIfRetiredInlineEnvSet(): void {
  if (warnedRetiredInlineEnv) return;
  const set = RETIRED_INLINE_ENV_VARS.filter((name) =>
    process.env[name]?.trim(),
  );
  if (set.length === 0) return;
  warnedRetiredInlineEnv = true;
  console.warn(
    `[mcp] ${set.join(" and ")} ${set.length === 1 ? "is" : "are"} ignored. ` +
      "MCP Apps cards are on by default for people connected with write access.",
  );
}

/**
 * Whether this caller gets MCP Apps cards by default. A card can open its app
 * in a full-app embed session, so cards go only to a person signed in with a
 * credential this app issued (the OAuth sign-in chat apps use, or a connect
 * token), carrying the issue time an embed session needs, whose grant allows
 * writes. A read-only grant, a shared static token, a standalone stdio server,
 * another app's signed token and a service principal get plain results with
 * links. The checks match `hasVerifiedMcpUserIdentity` and `hasMcpOAuthScope`,
 * repeated here so this module stays free of runtime imports.
 */
export function isMcpAppsInlineEnabled(
  identity: MCPCallerIdentity | undefined,
): boolean {
  return (
    identity?.identityAssurance === "user" &&
    !!identity.userEmail?.trim() &&
    Number.isSafeInteger(identity.mcpCredentialIssuedAtMs) &&
    (!identity.oauthScopes || identity.oauthScopes.includes("mcp:write"))
  );
}

export function _resetRetiredInlineEnvWarningForTests(): void {
  warnedRetiredInlineEnv = false;
}
