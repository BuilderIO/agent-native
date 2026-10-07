import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import {
  filterAgentTools,
  filterMcpOnlyActions,
} from "../server/agent-chat/action-filters-a2a.js";
import { resolveAgentChatMcpOptions } from "../server/agent-chat/mcp-options.js";
import type { AgentChatPluginOptions } from "../server/agent-chat/plugin-options.js";
import { generateActionRegistryForProject } from "../vite/action-types-plugin.js";
import { createMCPServerForRequest } from "./build-server.js";

const pluginOptions = vi.hoisted(() => new Map<string, Record<string, any>>());

// The plugin factory is the only place an app's static MCP instructions and
// policy are visible, so capture what each template hands it instead of
// reading the source. Everything else in the module is the real one.
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAgentChatPlugin: (options: Record<string, any>) => {
    pluginOptions.set(String(options.appId), options);
    return () => undefined;
  },
}));

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);
const LOAD_TIMEOUT_MS = 180_000;

const FULL_CATALOG_ONLY =
  "advertised only on the full catalog; owners to reword or advertise";

// Names an app's instructions use that its default catalog does not advertise,
// each with the reason. "*" applies to every app. App-specific entries are
// debt, not endorsement: the test fails once the name is advertised or no
// longer named, so they cannot outlive their cause.
const UNADVERTISED_NAMES: Record<string, Record<string, string>> = {
  "*": {
    "view-screen":
      'the shared text says "the app\'s `view-screen` tool", which only exists in apps with a screen to read',
  },
  design: {
    "get-visual-edit-prompt":
      "a page-local WebMCP tool the text itself marks as a fallback for browser-capable hosts",
    "export-html": FULL_CATALOG_ONLY,
    "export-zip": FULL_CATALOG_ONLY,
    "export-coding-handoff": FULL_CATALOG_ONLY,
    "export-design-as-figma-svg": FULL_CATALOG_ONLY,
  },
  forms: Object.fromEntries(
    [
      "patch-form-fields",
      "update-form",
      "get-form",
      "list-forms",
      "response-insights",
      "list-responses",
      "export-responses",
    ].map((name) => [
      name,
      "Forms declares no connector tier, so its default catalog is builtins only; owners to advertise or reword",
    ]),
  ),
};

const TOOL_NAME = /(?<![\w-])[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+(?![\w-])/g;

const templateIds = fs
  .readdirSync(path.join(repoRoot, "templates"), { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      fs.existsSync(
        path.join(
          repoRoot,
          "templates",
          entry.name,
          "server/plugins/agent-chat.ts",
        ),
      ),
  )
  .map((entry) => entry.name)
  .sort();

async function connectDefaultCatalog(options: Record<string, any>) {
  const mcp = resolveAgentChatMcpOptions(options as AgentChatPluginOptions);
  const actions = {
    ...filterMcpOnlyActions(options.actions),
    ...filterAgentTools(options.actions),
  };
  const server = await createMCPServerForRequest(
    {
      name: String(options.appId),
      appId: String(options.appId),
      description: `Agent-Native ${String(options.appId)} agent`,
      instructions: mcp.instructions,
      keyToolNames: mcp.keyToolNames,
      actions,
      ...(mcp.catalog ? { catalogMode: mcp.catalog } : {}),
      ...(mcp.builtinCrossAppTools !== undefined
        ? { builtinCrossAppTools: mcp.builtinCrossAppTools }
        : {}),
      ...(mcp.connectorCatalog
        ? { connectorCatalog: mcp.connectorCatalog }
        : {}),
      ...(mcp.directoryProfile
        ? { directoryProfile: mcp.directoryProfile }
        : {}),
      ...(mcp.externalAgents ? { externalAgents: mcp.externalAgents } : {}),
    },
    {
      userEmail: "instructions-test@example.com",
      orgDomain: undefined,
      orgId: null,
      oauthScopes: ["mcp:read", "mcp:write"],
    },
    { transport: "http", inlineMcpApps: false },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "instructions-contract",
    version: "1.0.0",
  });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  const advertised = new Set(
    (await client.listTools()).tools.map((tool) => tool.name),
  );
  const instructions = client.getInstructions() ?? "";
  await client.close();
  return { advertised, instructions, actions };
}

describe("static MCP instructions name only advertised tools", () => {
  it(
    "holds for every template that sets mcp.instructions",
    async () => {
      for (const appId of templateIds) {
        const projectRoot = path.join(repoRoot, "templates", appId);
        generateActionRegistryForProject(projectRoot);
        await import(
          pathToFileURL(path.join(projectRoot, "server/plugins/agent-chat.ts"))
            .href
        );
      }
      const withInstructions = [...pluginOptions.values()].filter(
        (options) => resolveAgentChatMcpOptions(options as any).instructions,
      );
      // A silent import failure would make the loop below vacuous.
      expect(withInstructions.map((options) => options.appId).sort()).toEqual(
        expect.arrayContaining(["content", "design", "forms", "slides"]),
      );

      const problems: string[] = [];
      for (const options of withInstructions) {
        const { advertised, instructions, actions } =
          await connectDefaultCatalog(options);
        // A name is a tool reference when it is an action's own name, or has an
        // action verb as its first word (so a typo is caught, and prose such as
        // "revision-guarded" is not).
        const verbs = new Set(
          [...Object.keys(actions), ...advertised].map(
            (name) => name.split(/[-_]/)[0],
          ),
        );
        const named = new Set(
          (instructions.match(TOOL_NAME) ?? []).filter(
            (token) =>
              token in actions ||
              advertised.has(token) ||
              verbs.has(token.split(/[-_]/)[0]!),
          ),
        );
        const appNames = UNADVERTISED_NAMES[String(options.appId)] ?? {};
        for (const name of named) {
          if (
            advertised.has(name) ||
            name in appNames ||
            name in UNADVERTISED_NAMES["*"]!
          ) {
            continue;
          }
          problems.push(
            `${options.appId}: instructions name "${name}", which its default MCP catalog does not advertise`,
          );
        }
        for (const name of Object.keys(appNames)) {
          if (advertised.has(name) || !named.has(name)) {
            problems.push(
              `${options.appId}: "${name}" is listed in UNADVERTISED_NAMES but is ${advertised.has(name) ? "now advertised" : "no longer named"}; remove the entry`,
            );
          }
        }
      }
      expect(
        problems,
        "Static MCP instructions are read by external agents as the guide to this catalog. Remove or reword " +
          "the name, advertise the tool (mcpTool: true on the action, or the app's connectorCatalog), or, if the " +
          "name is legitimately conditional, list it with a reason in UNADVERTISED_NAMES. This checks static " +
          "instructions only: not directory-profile or connection-specific text.",
      ).toEqual([]);
    },
    LOAD_TIMEOUT_MS,
  );
});
