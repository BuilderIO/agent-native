import fs from "fs";
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
