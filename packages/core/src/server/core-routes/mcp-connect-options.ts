/**
 * Everything the core-routes plugin can configure about its MCP *connect*
 * surface, in one object.
 *
 * This is deliberately not the same object as `AgentChatMcpOptions`. That one
 * owns the protocol mount — which tools an external caller sees. This one owns
 * how a caller gets a token in the first place: the browser Connect page, the
 * CLI device-code flow, and the OAuth endpoints. They live in different plugins
 * because core-routes is the light one; an app can serve MCP from it without
 * paying for chat plugin initialization, which is what `mcp.enabled: false` on
 * the chat side exists for.
 *
 * Before this existed the settings were four flat `mcpConnect*` keys, two of
 * which only restated app identity the config schema already declares.
 */

import { getAppConfig } from "../../app-config/index.js";

export interface CoreRoutesMcpOptions {
  /**
   * Mount the `/mcp/connect` routes (browser Connect page + CLI device-code
   * flow that mints per-user, revocable MCP tokens) and the standard
   * remote-MCP OAuth endpoints under `/mcp/oauth`. The legacy
   * `/_agent-native/mcp` aliases follow this same switch. Defaults to `true` —
   * the routes are session-gated where they approve user access, and token
   * endpoints are protected by single-use codes / refresh tokens.
   */
  connect?: boolean;
  /**
   * Explicit MCP server id returned in copyable config and device-flow grants.
   *
   * Only needed when the id a client should key this server by differs from
   * this app's own identity. Otherwise it derives from `app.id` /
   * `app.template` / `app.slug`, which covers every first-party template with
   * no configuration at all.
   */
  serverName?: string;
}

/** The legacy top-level keys `mcp` replaces. */
export interface CoreRoutesMcpLegacyInput {
  /** @deprecated Use `mcp.connect: false`. */
  disableMcpConnect?: boolean;
  /** @deprecated Use `mcp.serverName`. */
  mcpConnectServerName?: string;
  /**
   * @deprecated Set `app.id` in `defineAppConfig()` (env alias
   * `AGENT_NATIVE_APP_ID`). App identity is one declared field, not a
   * per-surface option.
   */
  mcpConnectAppId?: string;
  /**
   * @deprecated Set `app.name` in `defineAppConfig()` (env alias `APP_NAME`).
   * Unset, it resolves from this app's package.json.
   */
  mcpConnectAppName?: string;
  mcp?: CoreRoutesMcpOptions;
}

export interface ResolvedCoreRoutesMcp {
  connect: boolean;
  serverName: string | undefined;
  /** Passed through to the connect/OAuth handlers as their app identity. */
  appId: string | undefined;
  appName: string | undefined;
}

const warnedLegacyKeys = new Set<string>();

/**
 * Nested value wins, but only when the two forms agree.
 *
 * Disagreement throws at plugin init rather than picking a side, the same
 * contract as `resolveAgentChatMcpOptions` and `resolveFrameworkTools`: an app
 * that boots with a connect surface nobody chose is how a "why does my client
 * see the wrong server" report ends up unexplainable.
 */
function pick<T>(
  key: string,
  legacyKey: string,
  legacyValue: T | undefined,
  nestedValue: T | undefined,
): T | undefined {
  if (legacyValue === undefined) return nestedValue;
  if (nestedValue !== undefined && legacyValue !== nestedValue) {
    throw new Error(
      `[agent-native] Conflicting core-routes options: \`${legacyKey}: ${JSON.stringify(legacyValue)}\` ` +
        `and \`mcp.${key}: ${JSON.stringify(nestedValue)}\` disagree. ` +
        `Remove the deprecated \`${legacyKey}\` and keep \`mcp.${key}\`.`,
    );
  }
  if (!warnedLegacyKeys.has(legacyKey)) {
    warnedLegacyKeys.add(legacyKey);
    console.warn(
      `[agent-native] \`${legacyKey}\` is deprecated — use \`mcp: { ${key}: … }\`.`,
    );
  }
  return nestedValue ?? legacyValue;
}

const warnedIdentityKeys = new Set<string>();

function warnIdentityOption(legacyKey: string, field: string): void {
  if (warnedIdentityKeys.has(legacyKey)) return;
  warnedIdentityKeys.add(legacyKey);
  console.warn(
    `[agent-native] \`${legacyKey}\` is deprecated — set \`${field}\` in ` +
      `defineAppConfig() so every surface reads one app identity.`,
  );
}

/**
 * Collapse the nested `mcp` option and the legacy top-level keys into the one
 * shape the plugin threads into the connect and OAuth handlers.
 *
 * `appId` and `appName` fall through to the declared config fields rather than
 * defaulting here, so the connect page, the OAuth consent screen, and the
 * runtime config report cannot disagree about what this app is called.
 */
export function resolveCoreRoutesMcpOptions(
  input: CoreRoutesMcpLegacyInput | undefined,
): ResolvedCoreRoutesMcp {
  const mcp = input?.mcp ?? {};

  // `disableMcpConnect` is the inverse of `connect`, so normalize before
  // comparing — otherwise `disableMcpConnect: true` + `connect: false` would
  // read as a conflict.
  const legacyConnect =
    input?.disableMcpConnect === undefined
      ? undefined
      : !input.disableMcpConnect;

  if (input?.mcpConnectAppId !== undefined) {
    warnIdentityOption("mcpConnectAppId", "app.id");
  }
  if (input?.mcpConnectAppName !== undefined) {
    warnIdentityOption("mcpConnectAppName", "app.name");
  }

  const app = getAppConfig().app;
  return {
    connect:
      pick("connect", "disableMcpConnect", legacyConnect, mcp.connect) ?? true,
    serverName: pick(
      "serverName",
      "mcpConnectServerName",
      input?.mcpConnectServerName,
      mcp.serverName,
    ),
    appId: input?.mcpConnectAppId ?? app.id,
    appName: input?.mcpConnectAppName ?? app.name,
  };
}
