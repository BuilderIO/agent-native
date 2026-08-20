import type { ExternalAgentPolicy } from "../../mcp/external-agent-policy.js";

/** App icon descriptor surfaced during the MCP `initialize` handshake. */
export interface AgentChatMcpIcon {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: "light" | "dark";
}

/**
 * Everything the agent-chat plugin can configure about its MCP mount, in one
 * object.
 *
 * Before this existed, the MCP settings were five unrelated top-level keys
 * (`disableMcp`, `mcpServerInfo`, `connectorCatalog`, `externalAgents`) and
 * several `MCPConfig` fields with no route through the plugin at all —
 * `builtinCrossAppTools` was reachable only by calling `mountMCP` directly,
 * which is why `frameworkTools` could never remove the cross-app builtins from
 * an app that used the normal plugin entry point.
 */
export interface AgentChatMcpOptions {
  /**
   * Mount the remote MCP protocol route. Defaults to `true`.
   *
   * Set `false` for hosted apps with a dedicated early MCP plugin, so their
   * external connector does not depend on the heavier chat plugin
   * initialization path.
   */
  enabled?: boolean;
  /**
   * `"app"` serves external callers exactly this app's own tool registry,
   * flat — the same actions the in-app agent holds, with no cross-app
   * builtins, no `ask-agent`, no `tool-search`, and no compact/connector
   * trimming. `connectorCatalog` and the `--full-catalog` opt-ins are inert
   * once this is set; `externalAgents.denyActions` and OAuth scopes still
   * apply.
   *
   * Weigh the token cost before setting it: an app registering ~100 actions
   * puts every one of their schemas in the caller's context on `tools/list`,
   * which is the exact footgun the compact default exists to avoid.
   */
  catalog?: "app";
  /**
   * Curated allow-list of action names served to external connector clients.
   * Trims both the advertised and the callable surface — a name outside the
   * list is rejected, not merely hidden.
   */
  connectorCatalog?: string[];
  /**
   * Default authenticated external-agent policy. In `auto` read mode, every
   * action explicitly marked as GET + readOnly + publicAgent.requiresAuth is
   * added to the connector surface automatically. Writes remain ask_app-only
   * unless `writes: "allowlisted"` is explicitly selected.
   */
  externalAgents?: ExternalAgentPolicy;
  /**
   * Merge the generic cross-app builtins (`list_apps`, `open_app`, `ask_app`,
   * `ask_app_status`, `create_embed_session`, `create_workspace_app`,
   * `list_templates`). Defaults to `true`.
   *
   * These are added by the MCP layer itself, downstream of `frameworkTools`,
   * so they are NOT removed by `frameworkTools: "minimal"` or
   * `workspaceApps: false` — this is the switch that turns them off.
   */
  builtinCrossAppTools?: boolean;
  /** Human-facing title. Defaults to the capitalized app id/name. */
  title?: string;
  /** Host-facing description. Defaults to "Agent-native <app> agent". */
  description?: string;
  /** Canonical app URL. Relative URLs are resolved against the request origin. */
  websiteUrl?: string;
  /** App icons. Relative `src` values are resolved against the request origin. */
  icons?: AgentChatMcpIcon[];
}

/** The legacy top-level keys `mcp` replaces. */
export interface AgentChatMcpLegacyInput {
  /** @deprecated Use `mcp.enabled: false`. */
  disableMcp?: boolean;
  /** @deprecated Use `mcp.title` / `mcp.description` / `mcp.websiteUrl` / `mcp.icons`. */
  mcpServerInfo?: {
    title?: string;
    description?: string;
    websiteUrl?: string;
    icons?: AgentChatMcpIcon[];
  };
  /** @deprecated Use `mcp.connectorCatalog`. */
  connectorCatalog?: string[];
  /** @deprecated Use `mcp.externalAgents`. */
  externalAgents?: ExternalAgentPolicy;
  mcp?: AgentChatMcpOptions;
}

export interface ResolvedAgentChatMcp {
  enabled: boolean;
  catalog: "app" | undefined;
  connectorCatalog: string[] | undefined;
  externalAgents: ExternalAgentPolicy | undefined;
  builtinCrossAppTools: boolean | undefined;
  title: string | undefined;
  description: string | undefined;
  websiteUrl: string | undefined;
  icons: AgentChatMcpIcon[] | undefined;
}

function conflict(
  key: string,
  legacyKey: string,
  legacyValue: unknown,
  nestedValue: unknown,
): never {
  throw new Error(
    `[agent-native] Conflicting agent-chat options: \`${legacyKey}: ${JSON.stringify(legacyValue)}\` ` +
      `and \`mcp.${key}: ${JSON.stringify(nestedValue)}\` disagree. ` +
      `Remove the deprecated \`${legacyKey}\` and keep \`mcp.${key}\`.`,
  );
}

const warnedLegacyKeys = new Set<string>();

/**
 * Nested value wins, but only when the two forms agree.
 *
 * Disagreement throws at plugin init rather than picking a side: an app that
 * boots with an MCP surface nobody chose is how a "why can't the connector see
 * this tool" report ends up unexplainable. Same contract as
 * `resolveFrameworkTools`.
 */
function pick<T>(
  key: string,
  legacyKey: string,
  legacyValue: T | undefined,
  nestedValue: T | undefined,
): T | undefined {
  if (legacyValue === undefined) return nestedValue;
  if (
    nestedValue !== undefined &&
    JSON.stringify(legacyValue) !== JSON.stringify(nestedValue)
  ) {
    conflict(key, legacyKey, legacyValue, nestedValue);
  }
  if (!warnedLegacyKeys.has(legacyKey)) {
    warnedLegacyKeys.add(legacyKey);
    console.warn(
      `[agent-native] \`${legacyKey}\` is deprecated — use \`mcp: { ${key}: … }\`.`,
    );
  }
  return nestedValue ?? legacyValue;
}

/**
 * Collapse the nested `mcp` option and the legacy top-level keys into the one
 * shape the plugin threads into `mountMCP`.
 */
export function resolveAgentChatMcpOptions(
  input: AgentChatMcpLegacyInput | undefined,
): ResolvedAgentChatMcp {
  const mcp = input?.mcp ?? {};
  const legacyInfo = input?.mcpServerInfo;

  // `disableMcp` is the inverse of `enabled`, so normalize before comparing —
  // otherwise `disableMcp: true` + `enabled: false` would read as a conflict.
  const legacyEnabled =
    input?.disableMcp === undefined ? undefined : !input.disableMcp;
  const enabled = pick("enabled", "disableMcp", legacyEnabled, mcp.enabled);

  const connectorCatalog = pick(
    "connectorCatalog",
    "connectorCatalog",
    input?.connectorCatalog,
    mcp.connectorCatalog,
  );
  // `catalogMode: "app"` short-circuits `connectorCatalogActive` in
  // `build-server.ts`, so declaring both served the app's FULL registry while
  // the allow-list sat in the config looking authoritative. That is the same
  // unexplainable-report shape `pick` throws on, minus the legacy/nested pair:
  // an allow-list is written to keep something off the external surface, and
  // silently ignoring it hands every action schema to every connector client.
  if (
    mcp.catalog === "app" &&
    connectorCatalog &&
    connectorCatalog.length > 0
  ) {
    throw new Error(
      `[agent-native] Conflicting agent-chat options: \`mcp.catalog: "app"\` serves this ` +
        `app's entire action registry flat, which makes \`mcp.connectorCatalog\` ` +
        `(${connectorCatalog.length} name(s)) inert. Keep \`connectorCatalog\` for a curated ` +
        `external surface, or drop it and keep \`catalog: "app"\` — not both.`,
    );
  }

  return {
    enabled: enabled ?? true,
    catalog: mcp.catalog,
    connectorCatalog,
    externalAgents: pick(
      "externalAgents",
      "externalAgents",
      input?.externalAgents,
      mcp.externalAgents,
    ),
    builtinCrossAppTools: mcp.builtinCrossAppTools,
    title: pick("title", "mcpServerInfo.title", legacyInfo?.title, mcp.title),
    description: pick(
      "description",
      "mcpServerInfo.description",
      legacyInfo?.description,
      mcp.description,
    ),
    websiteUrl: pick(
      "websiteUrl",
      "mcpServerInfo.websiteUrl",
      legacyInfo?.websiteUrl,
      mcp.websiteUrl,
    ),
    icons: pick("icons", "mcpServerInfo.icons", legacyInfo?.icons, mcp.icons),
  };
}
