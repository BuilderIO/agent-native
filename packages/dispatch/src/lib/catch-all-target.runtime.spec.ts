import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { build, type RollupOutput } from "vite";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(import.meta.dirname, "../..");
const sourcePath = path.join(packageRoot, "src", "lib", "catch-all-target.ts");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("resolveServerCatchAllTarget runtime boundaries", () => {
  it("runs the compiled module in native Node without Vite import.meta.env", () => {
    const typescriptCli = path.resolve(
      path.dirname(require.resolve("typescript-7")),
      "../bin/tsc",
    );
    execFileSync(process.execPath, [typescriptCli, "-p", packageRoot], {
      cwd: packageRoot,
      stdio: "pipe",
    });

    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "dispatch-native-node-"),
    );
    temporaryDirectories.push(fixtureRoot);
    const coreRoot = path.join(
      fixtureRoot,
      "node_modules",
      "@agent-native",
      "core",
    );
    fs.mkdirSync(coreRoot, { recursive: true });
    fs.writeFileSync(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    fs.writeFileSync(
      path.join(coreRoot, "package.json"),
      JSON.stringify({
        type: "module",
        exports: { "./server/agent-discovery": "./agent-discovery.js" },
      }),
    );
    fs.writeFileSync(
      path.join(coreRoot, "agent-discovery.js"),
      [
        "export const getBuiltinAgents = () => [];",
        "export const normalizeAgentId = (id) => id;",
        'export const loadWorkspaceAppsManifest = async () => [{ id: "forms", path: "/forms" }];',
      ].join("\n"),
    );
    fs.copyFileSync(
      path.join(packageRoot, "dist", "lib", "catch-all-target.js"),
      path.join(fixtureRoot, "catch-all-target.js"),
    );

    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'const { resolveServerCatchAllTarget } = await import("./catch-all-target.js"); console.log(await resolveServerCatchAllTarget("forms"));',
      ],
      { cwd: fixtureRoot, encoding: "utf8" },
    );

    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
    expect(child.stdout.trim()).toBe("/forms");
  }, 60_000);

  it("tree-shakes server discovery out of browser bundles", async () => {
    const result = await build({
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        lib: { entry: sourcePath, formats: ["es"] },
        rollupOptions: {
          external: (id) => id.startsWith("@agent-native/core/"),
        },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(
      (entry) => (entry as RollupOutput).output ?? [],
    );
    const browserCode = outputs
      .filter((entry) => entry.type === "chunk")
      .map((entry) => entry.code)
      .join("\n");

    expect(browserCode).not.toContain("server/agent-discovery");
  });
});
