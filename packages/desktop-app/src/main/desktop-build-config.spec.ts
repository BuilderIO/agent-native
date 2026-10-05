import { fileURLToPath } from "node:url";

import { resolveConfig as resolveElectronConfig } from "electron-vite";
import { resolveConfig as resolveViteConfig } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

import desktopPackage from "../../package.json";

const desktopRoot = fileURLToPath(new URL("../../", import.meta.url));
const configurations = [
  {
    target: "main" as const,
    exclude: [
      "@agent-native/code-agents-ui",
      "@agent-native/code-agents-ui/code-agents",
      "@agent-native/shared-app-config",
      "@modelcontextprotocol/sdk",
      "@sentry/electron",
      "electron-updater",
      "zod",
    ],
    entries: ["browser-control-host", "index"],
    packagingPlugin: "agent-native:assert-electron-is-external",
  },
  {
    target: "preload" as const,
    exclude: [
      "@agent-native/code-agents-ui",
      "@agent-native/code-agents-ui/code-agents",
      "@agent-native/shared-app-config",
    ],
    entries: ["index", "webview", "webview-chat"],
    packagingPlugin: "agent-native:inline-preload-chunks",
  },
];

describe("desktop build dependency boundary", () => {
  let loaded: Awaited<ReturnType<typeof resolveElectronConfig>>;

  beforeAll(async () => {
    const nodeEnv = process.env.NODE_ENV;
    try {
      loaded = await resolveElectronConfig(
        {
          root: desktopRoot,
          configFile: fileURLToPath(
            new URL("../../electron.vite.config.ts", import.meta.url),
          ),
          logLevel: "silent",
        },
        "build",
        "production",
      );
    } finally {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
    }
  });

  it.each(configurations)(
    "preserves $target canonical externals and packaged entries",
    async ({ target, exclude, entries, packagingPlugin }) => {
      const config = loaded.config?.[target];
      expect(config).toBeDefined();
      expect(config?.build?.externalizeDeps).toBe(false);
      const resolved = await resolveViteConfig(config!, "build", "production");
      const external = resolved.build.rolldownOptions.external;
      expect(typeof external).toBe("function");
      if (typeof external !== "function")
        throw new Error("Missing dependency external predicate");

      for (const name of Object.keys(desktopPackage.dependencies)) {
        const expected = !exclude.includes(name);
        expect(external(name, undefined, false), name).toBe(expected);
        expect(
          external(`${name}/subpath`, undefined, false),
          `${name}/subpath`,
        ).toBe(expected);
        expect(
          external(`${name}-lookalike`, undefined, false),
          `${name}-lookalike`,
        ).toBe(false);
        expect(
          external(`${name}ish/subpath`, undefined, false),
          `${name}ish/subpath`,
        ).toBe(false);
      }
      for (const name of exclude) {
        expect(external(name, undefined, false), name).toBe(false);
        expect(
          external(`${name}/subpath`, undefined, false),
          `${name}/subpath`,
        ).toBe(false);
      }
      expect(external("electron", undefined, false)).toBe(true);
      expect(external("electron/main", undefined, false)).toBe(true);
      expect(external("electron-lookalike", undefined, false)).toBe(false);
      expect(external("node-pty", undefined, false)).toBe(true);
      expect(
        Object.keys(
          resolved.build.rolldownOptions.input as Record<string, string>,
        ).sort(),
      ).toEqual(entries);
      expect(resolved.build.rolldownOptions.output).toMatchObject({
        format: "cjs",
        entryFileNames: "[name].js",
      });
      expect(resolved.plugins.map((plugin) => plugin.name)).toContain(
        packagingPlugin,
      );
      expect(resolved.plugins.map((plugin) => plugin.name)).not.toContain(
        "vite:externalize-deps",
      );
    },
  );
});
