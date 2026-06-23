import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyWorkspaceFileSync,
  generateStandaloneChatManifest,
  mergeStarterManifest,
  syncStarterManifestFiles,
  workspaceFileSyncChanged,
} from "./sync-builder-starter-manifest.js";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");

describe("sync-builder-starter-manifest", () => {
  it("generates a standalone chat manifest without workspace or catalog refs", () => {
    const { packageJson } = generateStandaloneChatManifest(repoRoot);
    const deps = {
      ...(packageJson.dependencies as Record<string, string>),
      ...(packageJson.devDependencies as Record<string, string>),
    };

    expect(packageJson.name).toBe("builder-agent-native-starter");
    expect(deps["@agent-native/core"]).toBe("latest");
    expect(deps.postgres).toBe("^3.4.9");
    expect(
      Object.values(deps).some((value) => value.startsWith("workspace:")),
    ).toBe(false);
    expect(Object.values(deps).some((value) => value === "catalog:")).toBe(
      false,
    );
  });

  it("preserves starter identity fields and pinned core when merging", () => {
    const { packageJson: canonical } = generateStandaloneChatManifest(repoRoot);
    const merged = mergeStarterManifest(
      {
        name: "builder-agent-native-starter",
        displayName: "Builder Agent Native Starter",
        description: "Workspace app for Builder Agent Native Starter.",
        private: true,
        dependencies: {
          "@agent-native/core": "0.69.0",
        },
      },
      canonical,
    );

    expect(merged.name).toBe("builder-agent-native-starter");
    expect(merged.displayName).toBe("Builder Agent Native Starter");
    expect(merged.description).toBe(
      "Workspace app for Builder Agent Native Starter.",
    );
    expect(
      (merged.dependencies as Record<string, string>)["@agent-native/core"],
    ).toBe("0.69.0");
    expect((merged.dependencies as Record<string, string>).postgres).toBe(
      "^3.4.9",
    );
  });

  describe("syncStarterManifestFiles", () => {
    let tempDir: string;

    afterEach(() => {
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("reports no changes when starter already matches the canonical manifest", () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-starter-sync-spec-"));
      const { packageJson, pnpmWorkspaceYaml } =
        generateStandaloneChatManifest(repoRoot);
      const starterPackageJsonPath = path.join(tempDir, "package.json");
      const starterPnpmWorkspacePath = path.join(
        tempDir,
        "pnpm-workspace.yaml",
      );

      fs.writeFileSync(
        starterPackageJsonPath,
        `${JSON.stringify(packageJson, null, 2)}\n`,
      );
      if (pnpmWorkspaceYaml) {
        fs.writeFileSync(starterPnpmWorkspacePath, pnpmWorkspaceYaml);
      }

      const result = syncStarterManifestFiles({
        starterPackageJsonPath,
        starterPnpmWorkspacePath,
        repoRoot,
      });

      expect(result.changed).toBe(false);
    });
  });

  describe("workspaceFileSyncChanged", () => {
    it("detects when a stale starter workspace file should be removed", () => {
      expect(workspaceFileSyncChanged("allowBuilds:\n", null)).toBe(true);
    });

    it("detects when a starter workspace file should be added", () => {
      expect(workspaceFileSyncChanged(null, "allowBuilds:\n")).toBe(true);
    });

    it("detects when workspace file content changed", () => {
      expect(workspaceFileSyncChanged("old:\n", "new:\n")).toBe(true);
    });

    it("reports no change when both sides omit the workspace file", () => {
      expect(workspaceFileSyncChanged(null, null)).toBe(false);
    });
  });

  describe("applyWorkspaceFileSync", () => {
    let tempDir: string;
    let workspacePath: string;

    afterEach(() => {
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("deletes the starter workspace file when canonical omits it", () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-starter-sync-spec-"));
      workspacePath = path.join(tempDir, "pnpm-workspace.yaml");
      fs.writeFileSync(workspacePath, "allowBuilds:\n");

      applyWorkspaceFileSync(workspacePath, null);

      expect(fs.existsSync(workspacePath)).toBe(false);
    });
  });
});
