import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createApp } from "h3";
import { vi } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import {
  coreActionLoaderEntries,
  loadActionsFromStaticRegistry,
} from "../server/action-discovery.js";
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

/**
 * A deployment shape whose catalog is checked. Code execution registers
 * different tools (`run-code`, and `bash`/`edit`/`write` when trusted), and a
 * dev server swaps in the full action surface for an authenticated caller.
 */
export interface Surface {
  name: string;
  /** `AGENT_MODE=production` unless this is a dev server. */
  dev: boolean;
  /** `AGENT_PROD_CODE_EXECUTION`; dev always has run-code and ignores it. */
  codeExecution: "off" | "sandboxed" | "trusted";
  /** The caller is authenticated, which selects `productionActions` in dev. */
  fullSurface: boolean;
}

export const SURFACES: readonly Surface[] = [
  {
    name: "production, code execution off",
    dev: false,
    codeExecution: "off",
    fullSurface: false,
  },
  {
    name: "production, sandboxed code execution",
    dev: false,
    codeExecution: "sandboxed",
    fullSurface: false,
  },
  {
    name: "production, trusted code execution",
    dev: false,
    codeExecution: "trusted",
    fullSurface: false,
  },
  {
    name: "dev, authenticated full surface",
    dev: true,
    codeExecution: "off",
    fullSurface: true,
  },
];

export interface SurfaceCatalog {
  surface: Surface;
  config: MCPConfig;
  /** `tools/list` as a client reads it, per catalog mode. */
  catalogs: { default: AdvertisedTool[]; full: AdvertisedTool[] };
  /** What `ActionEntry` declares for each tool this surface can advertise. */
  entries: Record<string, ActionEntry>;
}

export interface AppCatalog {
  appId: string;
  /** Action names the template itself defines; the rest come from the framework. */
  templateActionNames: ReadonlySet<string>;
  /**
   * The app mounts MCP from a plugin of its own instead of the agent chat
   * plugin, so it has no code-execution tools to vary by deployment.
   */
  ownMcpMount: boolean;
  /**
   * Tools only a dev server advertises, each backed by a file in the app's
   * own `actions/` or `scripts/` folder. A dev server wraps every such file
   * (helper modules and one-off CLI scripts included) as a tool for its
   * authenticated owner. A file that declares no hints of its own advertises
   * the framework's conservative `mcpAnnotationDefaults`, which are not a
   * declaration.
   */
  devDiscoveredTools: ReadonlySet<string>;
  surfaces: SurfaceCatalog[];
  /** Static instructions, as a plain production deployment's catalog sends them. */
  instructions: string;
}

/** The default catalog of a plain production deployment (code execution off). */
export function defaultProductionTools(app: AppCatalog): AdvertisedTool[] {
  return app.surfaces[0]!.catalogs.default;
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

/**
 * `mergeCoreSharingActions` skips a framework action whose import throws or
 * whose module is not an action. Import every loader entry here first so such
 * a failure fails the run instead of shrinking every app's catalog. The list
 * is the loader's own, not a copy.
 */
export async function assertCoreActionLoadersAreValid(): Promise<number> {
  const entries = coreActionLoaderEntries();
  const failures: string[] = [];
  for (const [name, loader] of entries) {
    try {
      const definition = (await loader()).default;
      if (!definition?.tool || typeof definition.run !== "function") {
        failures.push(`${name}: the module has no default action`);
      }
    } catch (error) {
      failures.push(
        `${name}: import failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
    }
  }
  if (entries.length === 0 || failures.length > 0) {
    throw new Error(
      `Core action loader entries are not all valid (${entries.length} entries):\n${failures.join("\n")}`,
    );
  }
  return entries.length;
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
  vi.doMock("../integrations/plugin.js", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    defaultIntegrationsPlugin: () => {},
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

export async function listAdvertised(
  config: MCPConfig,
  request: { fullCatalog: boolean; fullSurface: boolean },
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
      ...(request.fullCatalog ? { fullCatalog: true } : {}),
      ...(request.fullSurface ? { fullSurface: true } : {}),
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

// Runs the app's plugin once under the surface's environment and returns the
// config it mounted.
async function mountedConfig(
  label: string,
  appId: string,
  projectRoot: string,
  plugin: (nitroApp: unknown) => void,
): Promise<{ config: MCPConfig; ownMount: boolean }> {
  const mountsBefore = captured.mounts.length;
  const initsBefore = captured.initPromises.length;
  const { hooks, close } = createCloseHooks();
  const nitroApp = { h3App: createApp(), h3: { "~middleware": [] }, hooks };
  plugin(nitroApp);
  const init = captured.initPromises[initsBefore];
  if (!init) throw new Error(`${label}: the plugin did not start init.`);
  try {
    // A rejected init is a loud failure here, not an app without MCP.
    await init;
  } finally {
    await close();
  }
  let ownMount = false;
  if (captured.mounts.length === mountsBefore) {
    // Plan turns the plugin's own mount off and mounts MCP from a plugin of
    // its own, so that plugin is the app's real catalog boundary.
    ownMount = true;
    const ownMountPath = path.join(projectRoot, "server/plugins/00-mcp.ts");
    if (!fs.existsSync(ownMountPath)) {
      throw new Error(
        `${label}: the agent chat plugin mounted no MCP server (its init may have failed and fallen back), and templates/${appId} has no 00-mcp.ts plugin that does.`,
      );
    }
    const { default: mountOwnMcp } = await import(
      pathToFileURL(ownMountPath).href
    );
    mountOwnMcp(nitroApp);
    if (captured.mounts.length === mountsBefore) {
      throw new Error(
        `templates/${appId}/server/plugins/00-mcp.ts mounted nothing.`,
      );
    }
  }
  return {
    config: captured.mounts.at(-1) as unknown as MCPConfig,
    ownMount,
  };
}

function advertisedNames(surface: SurfaceCatalog): string[] {
  return [...surface.catalogs.default, ...surface.catalogs.full].map(
    (tool) => tool.name,
  );
}

// See AppCatalog.devDiscoveredTools.
function devDiscoveredTools(
  projectRoot: string,
  surfaces: SurfaceCatalog[],
): Set<string> {
  const deployed = new Set(
    surfaces
      .filter(({ surface }) => !surface.dev)
      .flatMap((surface) => advertisedNames(surface)),
  );
  const discovered = new Set<string>();
  for (const surface of surfaces.filter(({ surface }) => surface.dev)) {
    for (const name of advertisedNames(surface)) {
      if (
        !deployed.has(name) &&
        ["actions", "scripts"].some((dir) =>
          fs.existsSync(path.join(projectRoot, dir, `${name}.ts`)),
        )
      ) {
        discovered.add(name);
      }
    }
  }
  return discovered;
}

/**
 * Builds every template's MCP catalog the way a deployed app does: through its
 * real agent-chat plugin, then `createMCPServerForRequest`, in the default and
 * full-catalog modes, for each deployment shape in SURFACES.
 */
export async function loadAppCatalogs(
  only?: readonly string[],
): Promise<AppCatalog[]> {
  await assertCoreActionLoadersAreValid();
  stubPluginSideEffects();
  const results: AppCatalog[] = [];
  try {
    for (const appId of templateIdsWithAgentChat()) {
      if (only && !only.includes(appId)) continue;
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

      // The app runs from its own folder: a dev server discovers loose files
      // there, and trusted code execution roots its shell there.
      const cwd = vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
      const surfaces: SurfaceCatalog[] = [];
      let instructions = "";
      let ownMcpMount = false;
      try {
        for (const surface of SURFACES) {
          // Every input the plugin reads is set explicitly so a developer's
          // shell cannot change which catalog is under test.
          vi.stubEnv("AGENT_MODE", surface.dev ? "development" : "production");
          vi.stubEnv("AGENT_PROD_CODE_EXECUTION", surface.codeExecution);
          const mounted = await mountedConfig(
            `${appId} (${surface.name})`,
            appId,
            projectRoot,
            plugin,
          );
          const { config } = mounted;
          ownMcpMount = mounted.ownMount;
          const request = { fullSurface: surface.fullSurface };
          const defaultCatalog = await listAdvertised(config, {
            ...request,
            fullCatalog: false,
          });
          const fullCatalog = await listAdvertised(config, {
            ...request,
            fullCatalog: true,
          });
          if (surfaces.length === 0) instructions = defaultCatalog.instructions;
          surfaces.push({
            surface,
            config,
            catalogs: {
              default: defaultCatalog.tools,
              full: fullCatalog.tools,
            },
            entries: {
              ...getBuiltinCrossAppTools(config),
              ...(surface.fullSurface && config.productionActions
                ? config.productionActions
                : config.actions),
            },
          });
        }
      } finally {
        cwd.mockRestore();
      }
      results.push({
        appId,
        templateActionNames: new Set(Object.keys(templateActions)),
        ownMcpMount,
        devDiscoveredTools: devDiscoveredTools(projectRoot, surfaces),
        surfaces,
        instructions,
      });
    }
  } finally {
    vi.unstubAllEnvs();
  }
  return results;
}
