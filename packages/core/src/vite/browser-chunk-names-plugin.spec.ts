import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { build, resolveConfig } from "vite";
import { describe, expect, it, vi } from "vitest";

import { isImmutableAssetPath } from "../deploy/immutable-assets.js";
import { agentNative } from "./client.js";

describe("production browser script URLs", () => {
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
