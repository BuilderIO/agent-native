import fs from "fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveDeployPostBuildInvocation } from "./deploy-build.js";

const tmpRoots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-deploy-build-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("resolveDeployPostBuildInvocation", () => {
  it("uses the built deploy script when core dist is available", () => {
    const root = tempRoot();
    const cliDir = path.join(root, "dist", "cli");
    const deployBuild = path.join(root, "dist", "deploy", "build.js");
    fs.mkdirSync(path.dirname(deployBuild), { recursive: true });
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(deployBuild, "");

    expect(
      resolveDeployPostBuildInvocation({
        cliDir,
        findTsxBin: () => "tsx",
      }),
    ).toEqual({
      command: "node",
      args: [deployBuild],
      scriptPath: deployBuild,
    });
  });

  it("runs the source deploy script through tsx when the CLI uses source fallback", () => {
    const root = tempRoot();
    const cliDir = path.join(root, "src", "cli");
    const deployBuild = path.join(root, "src", "deploy", "build.ts");
    fs.mkdirSync(path.dirname(deployBuild), { recursive: true });
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(deployBuild, "");

    expect(
      resolveDeployPostBuildInvocation({
        cliDir,
        findTsxBin: () => "/repo/node_modules/.bin/tsx",
      }),
    ).toEqual({
      command: "/repo/node_modules/.bin/tsx",
      args: [deployBuild],
      scriptPath: deployBuild,
    });
  });

  it("runs deploy-build with an ancestor tsx outside PATH", () => {
    if (process.platform === "win32") return;
    const root = tempRoot();
    const workspace = path.join(root, "workspace");
    const cwd = path.join(workspace, "nested app");
    const bin = path.join(workspace, "node_modules", ".bin");
    const pathDir = path.join(root, "empty-path");
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(pathDir);
    fs.writeFileSync(path.join(cwd, "package.json"), "{}");
    fs.writeFileSync(path.join(cwd, "react-router.config.ts"), "");
    for (const name of ["react-router", "@react-router/dev", "vite"]) {
      const dir = path.join(workspace, "node_modules", name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ main: "index.js" }),
      );
      fs.writeFileSync(path.join(dir, "index.js"), "");
      if (name === "@react-router/dev")
        fs.writeFileSync(path.join(dir, "vite.js"), "");
    }
    fs.writeFileSync(path.join(bin, "react-router"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    fs.writeFileSync(
      path.join(bin, "tsx"),
      "#!/bin/sh\necho ancestor-tsx:$1\n",
      { mode: 0o755 },
    );
    const require = createRequire(import.meta.url);
    const cli = fileURLToPath(new URL("./index.ts", import.meta.url));
    const result = spawnSync(
      process.execPath,
      [require.resolve("tsx/cli"), cli, "build"],
      {
        cwd,
        env: { ...process.env, PATH: pathDir, CI: "1", DO_NOT_TRACK: "1" },
        encoding: "utf8",
        timeout: 30000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ancestor-tsx:");
    expect(result.stdout).toContain("src/deploy/build.ts");
  });

  it("fails deploy-preset builds when no post-build script can run", () => {
    const root = tempRoot();
    const cliDir = path.join(root, "src", "cli");
    fs.mkdirSync(cliDir, { recursive: true });

    expect(() =>
      resolveDeployPostBuildInvocation({
        cliDir,
        env: { NITRO_PRESET: "netlify" },
        findTsxBin: () => "tsx",
      }),
    ).toThrow(/refusing to publish an incomplete NITRO_PRESET=netlify build/);
  });

  it("preserves the non-deploy local build warning path", () => {
    const root = tempRoot();
    const cliDir = path.join(root, "src", "cli");
    fs.mkdirSync(cliDir, { recursive: true });

    expect(
      resolveDeployPostBuildInvocation({
        cliDir,
        env: {},
        findTsxBin: () => "tsx",
      }),
    ).toBeUndefined();
  });
});
