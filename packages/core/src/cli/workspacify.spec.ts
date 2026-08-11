import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { workspacifyApp } from "./workspacify.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeWorkspace(rootCoreVersion: string | undefined): {
  root: string;
  appDir: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-workspacify-"));
  tmpRoots.push(root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "ws",
        dependencies: rootCoreVersion
          ? { "@agent-native/core": rootCoreVersion }
          : {},
      },
      null,
      2,
    ),
  );
  const appDir = path.join(root, "apps", "mail");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify(
      { name: "mail", dependencies: { "@agent-native/core": "workspace:*" } },
      null,
      2,
    ),
  );
  return { root, appDir };
}

function appCoreVersion(appDir: string): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(appDir, "package.json"), "utf-8"),
  );
  return pkg.dependencies["@agent-native/core"];
}

describe("workspacifyApp core pinning", () => {
  it("inherits the version the workspace root already pins", () => {
    const { root, appDir } = makeWorkspace("0.120.3");
    workspacifyApp({
      appDir,
      appName: "mail",
      workspaceRoot: root,
      workspaceCoreName: "@ws/shared",
      coreDependencyVersion: "0.131.4",
    });
    expect(appCoreVersion(appDir)).toBe("0.120.3");
  });

  it("uses the CLI version when the root pins nothing concrete", () => {
    for (const rootVersion of [
      undefined,
      "latest",
      "catalog:",
      "file:../core",
    ]) {
      const { root, appDir } = makeWorkspace(rootVersion);
      workspacifyApp({
        appDir,
        appName: "mail",
        workspaceRoot: root,
        workspaceCoreName: "@ws/shared",
        coreDependencyVersion: "0.131.4",
      });
      expect(appCoreVersion(appDir)).toBe("0.131.4");
    }
  });
});
