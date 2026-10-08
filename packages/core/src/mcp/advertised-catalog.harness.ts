import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createApp } from "h3";
import { vi } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import { loadActionsFromStaticRegistry } from "../server/action-discovery.js";
import { generateActionRegistryForProject } from "../vite/action-types-plugin.js";
import { createMCPServerForRequest, type MCPConfig } from "./build-server.js";
import { getBuiltinCrossAppTools } from "./builtin-tools.js";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);

export const LOAD_TIMEOUT_MS = 600_000;

export interface AdvertisedTool {
  name: string;
  annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface AppCatalog {
  appId: string;
  /** What the plugin hands `mountMCP`: the app's real external surface. */
  config: MCPConfig;
  /** Action names the template itself defines; the rest come from the framework. */
  templateActionNames: ReadonlySet<string>;
  /** `tools/list` as a client reads it, per catalog mode. */
  catalogs: { default: AdvertisedTool[]; full: AdvertisedTool[] };
  /** What `ActionEntry` declares for each advertised tool name. */
  entries: Record<string, ActionEntry>;
  instructions: string;
}

export function templateIdsWithAgentChat(): string[] {
  return fs
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
}

/**
 * `loadActionsFromStaticRegistry` skips a module that is missing or not a valid
 * action, which would read as "fewer tools to review". The contract tests need
 * every registered module to be an action, so a bad one fails the run.
 */
export function loadActionsStrictly(
  appId: string,
  modules: Record<string, unknown>,
): Record<string, ActionEntry> {
  const loaded = loadActionsFromStaticRegistry(modules);
  const invalid = Object.keys(modules).filter((name) => !(name in loaded));
  if (invalid.length > 0) {
    throw new Error(
      `templates/${appId}: these registry modules are not valid actions: ${invalid.join(", ")}`,
    );
  }
  return loaded;
}

const captured = {
  plugins: new Map<string, (nitroApp: unknown) => void>(),
  initPromises: [] as Promise<void>[],
  mounts: [] as Array<Record<string, unknown>>,
};

// The plugin composes an app's external surface inside its async init (framework
// tools, automations, extensions, chat, database, resources), so the only
// faithful catalog is the one it passes to `mountMCP`. Run the real plugin with
// its process-level side effects (timers, schedulers, migrations) stubbed, the
// way agent-chat-plugin.lifecycle.spec.ts does, and capture that config.
function stubPluginSideEffects() {
  vi.doMock(
    "../server/framework-request-handler.js",
    async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      awaitBootstrap: () => Promise.resolve(),
      getH3App: (nitroApp: { h3App: unknown }) => nitroApp.h3App,
      markDefaultPluginProvided: vi.fn(),
      trackPluginInit: (_nitroApp: unknown, promise: Promise<void>) => {
        captured.initPromises.push(promise);
      },
    }),
  );
  vi.doMock("../mcp-client/index.js", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    buildMergedConfig: vi.fn(async () => null),
    startMcpConfigRefresh: () => () => {},
  }));
  vi.doMock("../jobs/scheduler.js", () => ({
    processRecurringJobs: vi.fn(async () => {}),
  }));
  vi.doMock("../triggers/dispatcher.js", () => ({
    initTriggerDispatcher: vi.fn(async () => {}),
  }));
  vi.doMock("../chat-threads/migrations.js", () => ({
    runChatThreadDataMigrations: vi.fn(async () => {}),
  }));
  vi.doMock("../server/social-og-image.js", () => ({
    createAgentNativeOgImageHandler: () => () => new Response(),
  }));
  // Lab-gated actions are advertised once a user enables the lab, and the lab
  // registry is populated by other server plugins this harness does not run.
  // Treat every lab as enabled so the contract covers them.
  vi.doMock("@agent-native/core/labs/server", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getUserLabEnabled: vi.fn(async () => true),
  }));
  vi.doMock("@agent-native/core/mcp", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    mountMCP: (_nitroApp: unknown, config: Record<string, unknown>) => {
      captured.mounts.push(config);
    },
  }));
  vi.doMock("../mcp/server.js", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    mountMCP: (_nitroApp: unknown, config: Record<string, unknown>) => {
      captured.mounts.push(config);
    },
  }));
  vi.doMock("@agent-native/core/server", async (importOriginal) => {
    const { createAgentChatPlugin } =
      await import("../server/agent-chat-plugin.js");
    return {
      ...(await importOriginal<Record<string, unknown>>()),
      createAgentChatPlugin: (options: Record<string, unknown>) => {
        const plugin = createAgentChatPlugin(options as never);
        captured.plugins.set(String(options.appId), plugin as never);
        return plugin;
      },
    };
  });
}

function createCloseHooks() {
  const closers: Array<() => void | Promise<void>> = [];
  return {
    hooks: {
      hook(name: string, callback: () => void | Promise<void>) {
        if (name === "close") closers.push(callback);
      },
      callHook: async () => {},
    },
    close: async () => {
      await Promise.all(closers.map((closer) => closer()));
    },
  };
}

async function listAdvertised(
  config: MCPConfig,
  fullCatalog: boolean,
): Promise<{ tools: AdvertisedTool[]; instructions: string }> {
  const server = await createMCPServerForRequest(
    config,
    {
      userEmail: "catalog-contract@example.com",
      orgDomain: undefined,
      orgId: null,
      oauthScopes: ["mcp:read", "mcp:write"],
    },
    {
      transport: "http",
      inlineMcpApps: false,
      ...(fullCatalog ? { fullCatalog } : {}),
    },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "catalog-contract", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  const tools = (await client.listTools()).tools.map((tool) => ({
    name: tool.name,
    annotations: { ...(tool.annotations ?? {}) },
  }));
  const instructions = client.getInstructions() ?? "";
  await client.close();
  return { tools, instructions };
}

/**
 * Builds every template's MCP catalog the way a deployed app does: through its
 * real agent-chat plugin, then `createMCPServerForRequest`, in the default and
 * full-catalog modes. Apps whose plugin does not mount MCP are omitted.
 */
export async function loadAppCatalogs(): Promise<AppCatalog[]> {
  vi.stubEnv("AGENT_MODE", "production");
  stubPluginSideEffects();
  const results: AppCatalog[] = [];
  try {
    for (const appId of templateIdsWithAgentChat()) {
      const projectRoot = path.join(repoRoot, "templates", appId);
      generateActionRegistryForProject(projectRoot);
      const registry = await import(
        pathToFileURL(path.join(projectRoot, ".generated/actions-registry.ts"))
          .href
      );
      const templateActions = loadActionsStrictly(appId, registry.default);

      await import(
        pathToFileURL(path.join(projectRoot, "server/plugins/agent-chat.ts"))
          .href
      );
      const plugin = captured.plugins.get(appId);
      if (!plugin) {
        throw new Error(
          `templates/${appId}/server/plugins/agent-chat.ts did not create an agent chat plugin for "${appId}".`,
        );
      }
      const mountsBefore = captured.mounts.length;
      const initsBefore = captured.initPromises.length;
      const { hooks, close } = createCloseHooks();
      plugin({ h3App: createApp(), hooks });
      const init = captured.initPromises[initsBefore];
      if (!init) throw new Error(`${appId}: the plugin did not start init.`);
      try {
        // A rejected init is a loud failure here, not an app without MCP.
        await init;
      } finally {
        await close();
      }
      if (captured.mounts.length === mountsBefore) {
        // Plan turns the plugin's own mount off and mounts MCP from a plugin of
        // its own, so that plugin is the app's real catalog boundary.
        const ownMount = path.join(projectRoot, "server/plugins/00-mcp.ts");
        if (!fs.existsSync(ownMount)) {
          throw new Error(
            `templates/${appId} has an agent chat plugin but mounted no MCP server, and has no 00-mcp.ts plugin that does.`,
          );
        }
        const { default: mountOwnMcp } = await import(
          pathToFileURL(ownMount).href
        );
        mountOwnMcp({ h3App: createApp(), hooks });
        if (captured.mounts.length === mountsBefore) {
          throw new Error(
            `templates/${appId}/server/plugins/00-mcp.ts mounted nothing.`,
          );
        }
      }
      const config = captured.mounts.at(-1) as unknown as MCPConfig;

      const defaultCatalog = await listAdvertised(config, false);
      const fullCatalog = await listAdvertised(config, true);
      const entries = {
        ...getBuiltinCrossAppTools(config),
        ...config.actions,
        ...(config.productionActions ?? {}),
      };
      results.push({
        appId,
        config,
        templateActionNames: new Set(Object.keys(templateActions)),
        catalogs: { default: defaultCatalog.tools, full: fullCatalog.tools },
        entries,
        instructions: defaultCatalog.instructions,
      });
    }
  } finally {
    vi.unstubAllEnvs();
  }
  return results;
}
