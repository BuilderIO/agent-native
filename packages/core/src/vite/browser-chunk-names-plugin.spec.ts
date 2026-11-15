import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { reactRouter } from "@react-router/dev/vite";
import { build, createBuilder, resolveConfig } from "vite";
import { describe, expect, it, vi } from "vitest";

import { isImmutableAssetPath } from "../deploy/immutable-assets.js";
import { browserChunkNamesPlugin } from "./browser-chunk-names-plugin.js";
import { agentNative } from "./client.js";

describe("production browser script URLs", () => {
  it("keeps React Router entry and route modules free of source-derived names", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "core-router-script-urls-"),
    );
    try {
      fs.mkdirSync(path.join(root, "app/routes"), { recursive: true });
      fs.mkdirSync(path.join(root, "node_modules"));
      const require = createRequire(import.meta.url);
      for (const dependency of ["react", "react-dom", "react-router"]) {
        fs.symlinkSync(
          path.dirname(require.resolve(`${dependency}/package.json`)),
          path.join(root, "node_modules", dependency),
          "dir",
        );
      }
      fs.writeFileSync(
        path.join(root, "package.json"),
        '{"type":"module","dependencies":{"react-router":"*"}}',
      );
      fs.writeFileSync(
        path.join(root, "app/root.tsx"),
        'export { Outlet as default } from "react-router";',
      );
      fs.writeFileSync(
        path.join(root, "app/routes.ts"),
        'export default [{id:"routes/analytics-entry",path:"privacy",file:"routes/analytics-entry.tsx"}];',
      );
      fs.writeFileSync(
        path.join(root, "app/routes/analytics-entry.tsx"),
        'export default function Screen() { return "Connection ready"; }',
      );
      fs.writeFileSync(
        path.join(root, "app/entry.server.tsx"),
        'export default function render() { return new Response("Connection ready"); }',
      );
      fs.writeFileSync(path.join(root, "vite.config.ts"), "export default {};");
      const builder = await createBuilder({
        configFile: path.join(root, "vite.config.ts"),
        root,
        logLevel: "silent",
        plugins: [reactRouter(), browserChunkNamesPlugin()],
      });
      await builder.buildApp();
      const files = fs
        .readdirSync(path.join(root, "build/client/assets"))
        .filter((file) => file.endsWith(".js"));
      expect(files.length).toBeGreaterThan(2);
      for (const file of files) {
        expect(file).toMatch(/^(?:m-[\w-]{8}[0-9]*|manifest-[\w-]{8})\.js$/);
        expect(isImmutableAssetPath(`/assets/${file}`)).toBe(true);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      assetsDir: "assets",
      fileName: /^assets\/m-[\w-]{8}\.js$/,
      immutable: true,
    },
    {
      assetsDir: "scripts",
      fileName: /^scripts\/m-[\w-]{8}\.js$/,
      immutable: false,
    },
    { assetsDir: "", fileName: /^m-[\w-]{8}\.js$/, immutable: false },
    {
      assetsDir: "assets/",
      fileName: /^assets\/m-[\w-]{8}\.js$/,
      immutable: true,
    },
  ])(
    "builds entry and imported scripts in '$assetsDir' without source-derived names",
    async ({ assetsDir, fileName, immutable }) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-script-urls-"));
      const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
      try {
        fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
        fs.writeFileSync(
          path.join(root, "analytics-entry.js"),
          'globalThis.loadMessages = () => import("./consent-banner-messages.js");',
        );
        fs.writeFileSync(
          path.join(root, "consent-banner-messages.js"),
          'export const message = "Connection ready";',
        );
        const config = await resolveConfig(
          {
            configFile: false,
            root,
            logLevel: "silent",
            plugins: agentNative(),
            build: {
              assetsDir,
              rolldownOptions: { input: path.join(root, "analytics-entry.js") },
            },
          },
          "build",
        );
        const result = await build({
          configFile: false,
          root,
          logLevel: "silent",
          build: { ...config.environments.client.build, write: false },
        });
        if ("close" in result) throw new Error("Unexpected watch build");
        const chunks = (Array.isArray(result) ? result : [result])
          .flatMap((bundle) => bundle.output)
          .filter((output) => output.type === "chunk");
        expect(chunks).toHaveLength(2);
        for (const chunk of chunks) {
          expect(chunk.fileName).toMatch(fileName);
          expect(isImmutableAssetPath(`/${chunk.fileName}`)).toBe(immutable);
        }
        expect(chunks.find((chunk) => chunk.isEntry)?.dynamicImports).toEqual([
          chunks.find((chunk) => chunk.isDynamicEntry)?.fileName,
        ]);
      } finally {
        cwd.mockRestore();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("preserves explicit browser output naming, including multiple outputs", async () => {
    for (const output of [
      { entryFileNames: "app.js", chunkFileNames: "part-[name].js" },
      [{ entryFileNames: "app.js", chunkFileNames: "part-[name].js" }],
    ]) {
      const config = await resolveConfig(
        {
          configFile: false,
          plugins: agentNative(),
          build: { rolldownOptions: { output } },
        },
        "build",
      );
      expect(config.environments.client.build.rolldownOptions.output).toEqual(
        output,
      );
    }
  });

  it("leaves server and library entry naming to Vite", async () => {
    for (const buildOptions of [
      { ssr: "/app/server.ts" },
      { lib: { entry: "/app/library.ts", formats: ["es" as const] } },
    ]) {
      const config = await resolveConfig(
        { configFile: false, plugins: agentNative(), build: buildOptions },
        "build",
      );
      for (const environment of Object.values(config.environments).filter(
        (environment) => environment.consumer === "server" || buildOptions.lib,
      )) {
        expect(environment.build.rolldownOptions.output).toBeUndefined();
      }
    }
  });
});
