import {
  formatCapabilityDetail,
  formatCapabilitySummary,
  loadAllCapabilities,
  loadCapabilities,
  MAX_APPS,
} from "../server/agent-capabilities.js";
import { discoverAgents, findAgent } from "../server/agent-discovery.js";

export interface ParsedAgentsArgs {
  command: "list" | "help";
  selfAppId?: string;
  app?: string;
  capabilities: boolean;
  json: boolean;
  errors: string[];
}

export interface AgentsCliIo {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export function parseAgentsArgs(args: string[]): ParsedAgentsArgs {
  const parsed: ParsedAgentsArgs = {
    command: "list",
    capabilities: false,
    json: false,
    errors: [],
  };
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eqIndex = arg.indexOf("=");
    const name =
      eqIndex === -1 ? arg.slice("--".length) : arg.slice("--".length, eqIndex);
    const inlineValue = eqIndex === -1 ? undefined : arg.slice(eqIndex + 1);

    if (name === "help" || name === "h") {
      parsed.command = "help";
      continue;
    }
    if (name === "json") {
      parsed.json = true;
      continue;
    }
    if (name === "capabilities" || name === "what-can-they-do") {
      parsed.capabilities = true;
      continue;
    }
    if (name === "app") {
      const value =
        inlineValue ??
        (args[i + 1] !== undefined && !args[i + 1].startsWith("--")
          ? args[++i]
          : undefined);
      if (!value) {
        parsed.errors.push(`Missing value for --${name}`);
      } else {
        parsed.app = value;
        parsed.capabilities = true;
      }
      continue;
    }
    if (name === "self" || name === "self-app-id") {
      const value =
        inlineValue ??
        (args[i + 1] !== undefined && !args[i + 1].startsWith("--")
          ? args[++i]
          : undefined);
      if (!value) {
        parsed.errors.push(`Missing value for --${name}`);
      } else {
        parsed.selfAppId = value;
      }
      continue;
    }
    parsed.errors.push(`Unknown option: --${name}`);
  }

  if (positional[0] === "help") parsed.command = "help";
  if (positional[0] && positional[0] !== "list" && positional[0] !== "help") {
    parsed.errors.push(`Unknown agents command: ${positional[0]}`);
  }

  return parsed;
}

export async function runAgents(
  args: string[],
  io: AgentsCliIo = {},
): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  const parsed = parseAgentsArgs(args);

  if (parsed.command === "help") {
    stdout(formatAgentsUsage());
    return 0;
  }
  if (parsed.errors.length > 0) {
    stderr(parsed.errors.join("\n"));
    stderr("");
    stderr(formatAgentsUsage());
    return 1;
  }

  if (parsed.app) {
    const agent = await findAgent(parsed.app, parsed.selfAppId);
    if (!agent) {
      const available = (await discoverAgents(parsed.selfAppId))
        .map((peer) => peer.id)
        .join(", ");
      stderr(
        `No connected agent "${parsed.app}". Available: ${available || "(none)"}`,
      );
      return 1;
    }
    const peer = await loadCapabilities(agent);
    stdout(
      parsed.json
        ? JSON.stringify(toCapabilityJson(peer), null, 2)
        : formatCapabilityDetail(peer, callHint),
    );
    return 0;
  }

  const agents = await discoverAgents(parsed.selfAppId);

  if (parsed.capabilities) {
    if (agents.length === 0) {
      stdout("No connected agents found.");
      return 0;
    }
    const shown = agents.slice(0, MAX_APPS);
    const peers = await loadAllCapabilities(shown);
    stdout(
      parsed.json
        ? JSON.stringify({ agents: peers.map(toCapabilityJson) }, null, 2)
        : formatCapabilitySummary(
            peers,
            agents.length - shown.length,
            (appId) => `run agent-native agents list --app ${appId}`,
          ),
    );
    return 0;
  }

  if (parsed.json) {
    stdout(JSON.stringify({ agents }, null, 2));
    return 0;
  }

  if (agents.length === 0) {
    stdout("No connected agents found.");
    return 0;
  }

  const rows = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    url: agent.url,
  }));
  const idWidth = Math.max(2, ...rows.map((row) => row.id.length));
  const nameWidth = Math.max(4, ...rows.map((row) => row.name.length));
  stdout(`${"ID".padEnd(idWidth)}  ${"Name".padEnd(nameWidth)}  URL`);
  for (const row of rows) {
    stdout(
      `${row.id.padEnd(idWidth)}  ${row.name.padEnd(nameWidth)}  ${row.url}`,
    );
  }
  return 0;
}

export function formatAgentsUsage(): string {
  return [
    "Usage: agent-native agents list [options]",
    "",
    "Lists discoverable agent-native apps from the same registry used by chat and A2A.",
    "",
    "Options:",
    "  --self-app-id <id>          Exclude the current app from results",
    "  --json                      Print machine-readable output",
  ].join("\n");
}
