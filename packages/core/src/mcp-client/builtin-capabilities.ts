import type { McpStdioServerConfig } from "./config.js";

export type BuiltinMcpCapabilityId =
  | "browser-chrome-devtools"
  | "browser-playwright"
  | "computer-use"
  | "screen-memory";

export interface BuiltinMcpCapability {
  id: BuiltinMcpCapabilityId;
  serverId: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  exclusiveGroup?: "browser";
  platforms?: NodeJS.Platform[];
  notes?: string;
}

export const BUILTIN_MCP_CAPABILITIES: BuiltinMcpCapability[] = [
  {
    id: "browser-chrome-devtools",
    serverId: "chrome-devtools",
    name: "Chrome DevTools",
    description: "Attach to a live Chrome browser through Chrome DevTools MCP.",
    command: "npx",
    args: [
      "-y",
      "chrome-devtools-mcp@0.26.0",
      "--autoConnect",
      "--no-usage-statistics",
    ],
    exclusiveGroup: "browser",
    notes:
      "Uses --autoConnect and requires Chrome 144+ with remote debugging enabled.",
  },
  {
    id: "browser-playwright",
    serverId: "playwright",
    name: "Playwright Browser",
    description: "Launch and control a Playwright-managed browser.",
    command: "npx",
    args: ["-y", "@playwright/mcp@0.0.75"],
    exclusiveGroup: "browser",
  },
  {
    id: "computer-use",
    serverId: "computer-use",
    name: "Computer Use",
    description:
      "Control local macOS apps through the Computer Use MCP server.",
    command: "npx",
    args: ["-y", "computer-use-mcp@1.8.0"],
    platforms: ["darwin"],
  },
  {
    id: "screen-memory",
    serverId: "screen-memory",
    name: "Screen Memory",
    description: "Query local Clips Screen Memory context from this machine.",
    command: "agent-native",
    args: ["mcp", "screen-memory"],
    platforms: ["darwin"],
    notes:
      "Requires Clips desktop Screen Memory to be enabled. Local-only and disabled by default.",
  },
];

const CAPABILITY_BY_ID = new Map(
  BUILTIN_MCP_CAPABILITIES.map((capability) => [capability.id, capability]),
);

export function areBuiltinMcpCapabilitiesSupported(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.VERCEL || process.env.VERCEL_ENV) return false;
  if (process.env.NETLIFY && process.env.NETLIFY_LOCAL !== "true") {
    return false;
  }
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV) {
    return false;
  }
  if (process.env.CF_PAGES || process.env.CLOUDFLARE_WORKERS) return false;
  return true;
}

export function getBuiltinMcpCapability(
  id: string,
): BuiltinMcpCapability | null {
  return CAPABILITY_BY_ID.get(id as BuiltinMcpCapabilityId) ?? null;
}

export function isBuiltinMcpCapabilityId(
  id: string,
): id is BuiltinMcpCapabilityId {
  return CAPABILITY_BY_ID.has(id as BuiltinMcpCapabilityId);
}

export function isBuiltinMcpCapabilityAvailable(
  capability: BuiltinMcpCapability,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return !capability.platforms || capability.platforms.includes(platform);
}

export function listSupportedBuiltinMcpCapabilities(
  platform: NodeJS.Platform = process.platform,
): BuiltinMcpCapability[] {
  if (!areBuiltinMcpCapabilitiesSupported()) return [];
  return BUILTIN_MCP_CAPABILITIES.filter((capability) =>
    isBuiltinMcpCapabilityAvailable(capability, platform),
  );
}

export function normalizeBuiltinMcpCapabilityIds(
  ids: readonly string[],
): BuiltinMcpCapabilityId[] {
  const enabled: BuiltinMcpCapabilityId[] = [];
  for (const rawId of ids) {
    const capability = getBuiltinMcpCapability(rawId);
    if (!capability) continue;
    if (capability.exclusiveGroup) {
      for (let i = enabled.length - 1; i >= 0; i--) {
        const existing = getBuiltinMcpCapability(enabled[i]);
        if (existing?.exclusiveGroup === capability.exclusiveGroup) {
          enabled.splice(i, 1);
        }
      }
    } else if (enabled.includes(capability.id)) {
      continue;
    }
    enabled.push(capability.id);
  }
  return enabled;
}

export function toBuiltinMcpServerConfig(
  capability: BuiltinMcpCapability,
): McpStdioServerConfig {
  return {
    type: "stdio",
    command: capability.command,
    args: capability.args,
    description: capability.description,
  };
}
