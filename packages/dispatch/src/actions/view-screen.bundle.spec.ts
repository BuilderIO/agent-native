import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Dispatch view-screen production bundle", () => {
  it("bundles local actions and preserves connected-agent and Dreams dispatch", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "dispatch-view-screen-bundle-"),
    );
    temporaryDirectories.push(temporaryDirectory);
    const entry = path.resolve("src/actions/view-screen.ts");
    const outputDirectory = path.join(temporaryDirectory, "dist");
    const calls: Array<[string, Record<string, unknown>]> = [];
    const stubbedImports = new Set([
      "./get-dream.js",
      "./get-dream-settings.js",
      "./list-connected-agents.js",
      "./list-dream-candidates.js",
      "./list-dreams.js",
      "./list-mcp-app-access.js",
      "@agent-native/core/action",
      "@agent-native/core/application-state",
      "zod",
      "../server/lib/app-creation-store.js",
      "../server/lib/dispatch-store.js",
      "../server/lib/thread-debug-store.js",
      "../server/lib/usage-metrics-store.js",
      "../server/lib/vault-store.js",
      "../server/lib/workspace-resources-store.js",
      "../shared/chat-first-pane.js",
    ]);

    const stubPlugin = {
      name: "view-screen-inert-dependencies",
      enforce: "pre" as const,
      resolveId(source: string, importer?: string) {
        if (source.startsWith("\0view-screen-stub:")) return source;
        if (importer !== entry || !stubbedImports.has(source)) return null;
        return `\0view-screen-stub:${source}`;
      },
      load(id: string) {
        if (!id.startsWith("\0view-screen-stub:")) return null;
        const source = id.slice("\0view-screen-stub:".length);
        const actionName = source.match(
          /\/(get-dream(?:-settings)?|list-connected-agents|list-dream-candidates|list-dreams|list-mcp-app-access)\.js$/,
        )?.[1];
        if (actionName) {
          return `export default { run: async (args) => { globalThis.__viewScreenCalls.push([${JSON.stringify(actionName)}, args]); return ${JSON.stringify(actionName)}; } };`;
        }
        if (source === "@agent-native/core/action") {
          return "export const defineAction = (action) => action;";
        }
        if (source === "@agent-native/core/application-state") {
          return "export const readAppState = async () => globalThis.__viewScreenNavigation;";
        }
        if (source === "zod") {
          return "export const z = { object: () => ({}) };";
        }
        if (source.endsWith("chat-first-pane.js")) {
          return 'export const CHAT_FIRST_PANE_STATE_KEY = "chat-first-pane";';
        }

        const exports = [
          "listWorkspaceApps",
          "listOverview",
          "getAgentThreadDebug",
          "listAgentRunFailures",
          "listThreadDebugSources",
          "searchAgentThreads",
          "listDispatchUsageMetrics",
          "listVaultOverview",
          "listSecretOptions",
          "listGrants",
          "listRequests",
          "getVaultAccessSettings",
          "canManageVault",
          "listWorkspaceResourceOptions",
          "listWorkspaceResourcesForApp",
        ];
        return exports
          .map(
            (name) =>
              `export const ${name} = async () => ${JSON.stringify(name)};`,
          )
          .join("\n");
      },
    };

    await build({
      configFile: false,
      root: process.cwd(),
      logLevel: "silent",
      plugins: [stubPlugin],
      build: {
        emptyOutDir: true,
        outDir: outputDirectory,
        lib: { entry, formats: ["es"], fileName: () => "view-screen.mjs" },
        rolldownOptions: {
          output: { format: "es", inlineDynamicImports: true },
        },
      },
    });

    const bundlePath = path.join(outputDirectory, "view-screen.mjs");
    const bundle = await readFile(bundlePath, "utf8");
    expect(bundle).not.toMatch(/@vite-ignore|modulePath|import\s*\(/);

    globalThis.__viewScreenCalls = calls;
    globalThis.__viewScreenNavigation = { view: "connected-agents" };
    try {
      const action = await import(
        `${pathToFileURL(bundlePath).href}?connected`
      );
      const connected = JSON.parse(await action.default.run());
      expect(connected.connectedAgents).toBe("list-connected-agents");
      expect(connected.mcpAppAccess).toBe("list-mcp-app-access");
      expect(calls).toEqual([
        ["list-connected-agents", {}],
        ["list-mcp-app-access", {}],
      ]);

      calls.length = 0;
      globalThis.__viewScreenNavigation = {
        view: "dreams",
        sourceId: "source-1",
        status: "open",
        id: "dream-1",
      };
      const dreams = JSON.parse(await action.default.run());
      expect(dreams.dreamCandidates).toBe("list-dream-candidates");
      expect(dreams.latestDreams).toBe("list-dreams");
      expect(dreams.dreamDetail).toBe("get-dream");
      expect(calls).toEqual([
        ["list-dream-candidates", { sourceId: "source-1", limit: 10 }],
        ["list-dreams", { status: "open", limit: 10 }],
        ["get-dream-settings", {}],
        ["get-dream", { id: "dream-1" }],
      ]);
    } finally {
      delete globalThis.__viewScreenCalls;
      delete globalThis.__viewScreenNavigation;
    }
  });
});

declare global {
  var __viewScreenCalls: Array<[string, Record<string, unknown>]> | undefined;
  var __viewScreenNavigation: Record<string, unknown> | undefined;
}
