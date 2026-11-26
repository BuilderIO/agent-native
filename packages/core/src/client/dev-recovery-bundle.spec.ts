import path from "node:path";
import { fileURLToPath } from "node:url";

import { build as esbuild } from "esbuild";
import { build, createServer, type Rollup } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

const coreRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const themeModule = path.join(coreRoot, "src/client/theme.ts");
const RECOVERY_MARKER = "__an_optimize_reload";
const THEME_MARKER = "__an_storage_probe__";
const BUILD_TIMEOUT = 60_000;

describe("theme init script in app bundles", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it(
    "leaves the dev recovery script out of a production client bundle",
    async () => {
      // Vite derives `import.meta.env.DEV` from NODE_ENV, which Vitest sets to
      // "test"; `vite build` runs with "production".
      vi.stubEnv("NODE_ENV", "production");
      const result = (await build({
        configFile: false,
        logLevel: "silent",
        mode: "production",
        root: coreRoot,
        build: {
          write: false,
          minify: true,
          lib: { entry: themeModule, formats: ["es"], fileName: "theme" },
        },
      })) as Rollup.RollupOutput | Rollup.RollupOutput[];
      const code = (Array.isArray(result) ? result : [result])
        .flatMap((output) => output.output)
        .map((chunk) => (chunk.type === "chunk" ? chunk.code : ""))
        .join("\n");

      expect(code).toContain(THEME_MARKER);
      expect(code).not.toContain(RECOVERY_MARKER);
    },
    BUILD_TIMEOUT,
  );

  it(
    "renders without the dev recovery script where Node loads core unbundled",
    async () => {
      // The production SSR build keeps core external, so `import.meta.env` is
      // undefined at runtime. esbuild leaves it untouched, like plain Node.
      const result = await esbuild({
        entryPoints: [themeModule],
        bundle: true,
        format: "esm",
        platform: "node",
        write: false,
        logLevel: "silent",
      });
      const source = result.outputFiles[0]?.text ?? "";
      expect(source).toContain("import.meta.env");
      const theme = (await import(
        `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
      )) as { getThemeInitScript: () => string };

      const script = theme.getThemeInitScript();
      expect(script).toContain(THEME_MARKER);
      expect(script).not.toContain(RECOVERY_MARKER);
    },
    BUILD_TIMEOUT,
  );

  it(
    "keeps the dev recovery script in pages a dev server renders",
    async () => {
      const server = await createServer({
        configFile: false,
        logLevel: "silent",
        root: coreRoot,
        appType: "custom",
        server: { middlewareMode: true, hmr: false, ws: false },
      });
      try {
        const theme = (await server.ssrLoadModule(themeModule)) as {
          getThemeInitScript: () => string;
        };
        const script = theme.getThemeInitScript();
        expect(script).toContain(THEME_MARKER);
        expect(script).toContain(RECOVERY_MARKER);
      } finally {
        await server.close();
      }
    },
    BUILD_TIMEOUT,
  );
});
