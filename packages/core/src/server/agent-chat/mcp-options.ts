import type { ExternalAgentPolicy } from "../../mcp/external-agent-policy.js";

export interface AgentChatMcpIcon {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: "light" | "dark";
}

export interface AgentChatMcpOptions {
  enabled?: boolean;
  catalog?: "app";
  connectorCatalog?: string[];
  externalAgents?: ExternalAgentPolicy;
  builtinCrossAppTools?: boolean;
  title?: string;
  description?: string;
  websiteUrl?: string;
  icons?: AgentChatMcpIcon[];
  instructions?: string;
  keyToolNames?: readonly string[];
}

export interface AgentChatMcpLegacyInput {
  /** @deprecated Use `mcp.enabled: false`. */
  disableMcp?: boolean;
  /** @deprecated Use `mcp.title` / `mcp.description` / `mcp.websiteUrl` / `mcp.icons`. */
  mcpServerInfo?: {
    title?: string;
    description?: string;
    websiteUrl?: string;
    icons?: AgentChatMcpIcon[];
    instructions?: string;
  };
  /** @deprecated Use `mcp.connectorCatalog`. */
  connectorCatalog?: string[];
  /** @deprecated Use `mcp.externalAgents`. */
  externalAgents?: ExternalAgentPolicy;
  initialToolNames?: readonly string[];
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
  instructions: string | undefined;
  keyToolNames: readonly string[] | undefined;
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

export function resolveAgentChatMcpOptions(
  input: AgentChatMcpLegacyInput | undefined,
): ResolvedAgentChatMcp {
  const mcp = input?.mcp ?? {};
  const legacyInfo = input?.mcpServerInfo;

  const legacyEnabled =
    input?.disableMcp === undefined ? undefined : !input.disableMcp;
  const enabled = pick("enabled", "disableMcp", legacyEnabled, mcp.enabled);

  const connectorCatalog = pick(
    "connectorCatalog",
    "connectorCatalog",
    input?.connectorCatalog,
    mcp.connectorCatalog,
  );
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
    instructions: pick(
      "instructions",
      "mcpServerInfo.instructions",
      legacyInfo?.instructions,
      mcp.instructions,
    ),
    keyToolNames: mcp.keyToolNames ?? input?.initialToolNames,
  };
}
