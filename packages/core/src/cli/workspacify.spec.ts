import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

import { ensureNodePtyBuildDependency, workspacifyApp } from "./workspacify.js";

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
  fs.mkdirSync(path.join(root, ".agents", "skills"), { recursive: true });
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

  it("adds node-gyp to workspaces that install node-pty on Linux", () => {
    const { root, appDir } = makeWorkspace(undefined);
    fs.writeFileSync(
      path.join(root, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n  - apps/*\n",
    );
    fs.writeFileSync(
      path.join(appDir, "package.json"),
      JSON.stringify(
        { name: "mail", dependencies: { "node-pty": "^1.1.0" } },
        null,
        2,
      ),
    );

    workspacifyApp({
      appDir,
      appName: "mail",
      workspaceRoot: root,
      workspaceCoreName: "@ws/shared",
    });

    const workspaceYaml = fs.readFileSync(
      path.join(root, "pnpm-workspace.yaml"),
      "utf8",
    );
    expect(workspaceYaml).toContain("node-pty@*:");
    expect(workspaceYaml).toContain("node-gyp: ^12.4.0");
  });

  it("merges existing packageExtensions YAML without duplicate keys", () => {
    const sources = [
      "packageExtensions:\n  'node-pty@*':\n    dependencies:\n      node-gyp: '^12.4.0'\n",
      "packageExtensions: {}\n",
      'packageExtensions: {"other@1": {dependencies: {dep: "^1"}}}\n',
    ];

    for (const source of sources) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-workspacify-"));
      tmpRoots.push(root);
      const workspacePath = path.join(root, "pnpm-workspace.yaml");
      fs.writeFileSync(workspacePath, source);

      ensureNodePtyBuildDependency(root);
      ensureNodePtyBuildDependency(root);

      const updated = fs.readFileSync(workspacePath, "utf8");
      expect(updated.match(/node-pty@\*/g)).toHaveLength(1);
      const document = parseDocument(updated);
      expect(document.errors).toHaveLength(0);
      expect(
        document.getIn([
          "packageExtensions",
          "node-pty@*",
          "dependencies",
          "node-gyp",
        ]),
      ).toBe("^12.4.0");
    }
  });

  it("surfaces malformed or missing workspace YAML", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-workspacify-"));
    tmpRoots.push(root);

    expect(() => ensureNodePtyBuildDependency(root)).toThrow(
      "pnpm-workspace.yaml",
    );
    fs.writeFileSync(
      path.join(root, "pnpm-workspace.yaml"),
      "packageExtensions: [\n",
    );
    expect(() => ensureNodePtyBuildDependency(root)).toThrow("Cannot update");
  });

  it("links inherited skills and removes template copies while preserving app skills", () => {
    const { root, appDir } = makeWorkspace(undefined);
    const workspaceSkillsDir = path.join(root, ".agents", "skills");
    fs.mkdirSync(path.join(workspaceSkillsDir, "actions"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspaceSkillsDir, "actions", "SKILL.md"),
      "workspace actions\n",
    );

    const appSkillsDir = path.join(appDir, ".agents", "skills");
    fs.mkdirSync(path.join(appSkillsDir, "actions"), { recursive: true });
    fs.writeFileSync(
      path.join(appSkillsDir, "actions", "SKILL.md"),
      "copied template actions\n",
    );
    fs.mkdirSync(path.join(appSkillsDir, "feature-flags"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(appSkillsDir, "feature-flags", "SKILL.md"),
      "copied optional skill\n",
    );
    fs.mkdirSync(path.join(appSkillsDir, "call-coach"), { recursive: true });
    fs.writeFileSync(
      path.join(appSkillsDir, "call-coach", "SKILL.md"),
      "app skill\n",
    );

    workspacifyApp({
      appDir,
      appName: "mail",
      workspaceRoot: root,
      workspaceCoreName: "@ws/shared",
    });

    expect(
      fs.lstatSync(path.join(appSkillsDir, "actions")).isSymbolicLink(),
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(appSkillsDir, "actions", "SKILL.md"), "utf8"),
    ).toBe("workspace actions\n");
    expect(fs.existsSync(path.join(appSkillsDir, "feature-flags"))).toBe(false);
    expect(
      fs.existsSync(path.join(appSkillsDir, "call-coach", "SKILL.md")),
    ).toBe(true);
  });
});
