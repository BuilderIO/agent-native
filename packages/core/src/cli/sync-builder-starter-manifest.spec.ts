import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyStarterToolchainSync,
  applyWorkspaceFileSync,
  collectStarterToolchainFiles,
  createStandaloneChatSnapshot,
  diffStarterToolchainFiles,
  generateStandaloneChatManifest,
  mergeStarterManifest,
  STARTER_TOOLCHAIN_SYNC_PATHS,
  syncStarterManifestFiles,
  workspaceFileSyncChanged,
} from "./sync-builder-starter-manifest.js";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const STARTER_MANIFEST_TIMEOUT_MS = 20_000;

describe("sync-builder-starter-manifest", () => {
  it(
    "generates a standalone chat manifest without workspace or catalog refs",
    () => {
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
    },
    STARTER_MANIFEST_TIMEOUT_MS,
  );

  it(
    "collects toolchain files from the post-processed standalone snapshot",
    () => {
      const snapshot = createStandaloneChatSnapshot(repoRoot);
      try {
        const files = collectStarterToolchainFiles(snapshot.dir);
        for (const relativePath of STARTER_TOOLCHAIN_SYNC_PATHS) {
          if (relativePath === ".oxfmtrc.json") continue;
          expect(files.has(relativePath), relativePath).toBe(true);
        }
        expect(files.get("react-router.config.ts")).not.toContain(
          "v8_viteEnvironmentApi",
        );
        const tsconfig = JSON.parse(files.get("tsconfig.json") ?? "{}") as {
          compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
        };
        expect(tsconfig.compilerOptions?.baseUrl).toBeUndefined();
        expect(tsconfig.compilerOptions?.paths?.["*"]).toEqual(["./*"]);
        expect(
          fs.readFileSync(
            path.join(snapshot.dir, "server/plugins/agent-chat.ts"),
            "utf-8",
          ),
        ).toContain('appId: "builder-agent-native-starter"');
        expect(files.get("netlify.toml")).toContain('publish = "dist"');
        expect(files.get("netlify.toml")).not.toContain("templates/chat");
      } finally {
        snapshot.cleanup();
      }
    },
    STARTER_MANIFEST_TIMEOUT_MS,
  );

  it("does not sync starter-owned plugin prompt and marketing files", () => {
    expect(STARTER_TOOLCHAIN_SYNC_PATHS).not.toContain(
      "server/plugins/agent-chat.ts",
    );
    expect(STARTER_TOOLCHAIN_SYNC_PATHS).not.toContain(
      "server/plugins/auth.ts",
    );
  });

  it(
    "preserves starter identity fields and pinned core when merging",
    () => {
      const { packageJson: canonical } =
        generateStandaloneChatManifest(repoRoot);
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
    },
    STARTER_MANIFEST_TIMEOUT_MS,
  );

  it(
    "preserves starter-only manifest fields not present in templates/chat",
    () => {
      const { packageJson: canonical } =
        generateStandaloneChatManifest(repoRoot);
      const merged = mergeStarterManifest(
        {
          packageManager: "pnpm@10.14.0",
          scripts: {
            dev: "node scripts/maybe-migrate.mjs && agent-native dev --open",
            "db:generate": "drizzle-kit generate",
            "db:migrate": "drizzle-kit migrate",
          },
          dependencies: {
            "@agent-native/core": "0.72.1",
            "@neondatabase/serverless": "^1.0.2",
            "drizzle-orm": "0.45.2",
          },
          devDependencies: {
            "drizzle-kit": "0.31.10",
            dotenv: "^17.2.1",
          },
        },
        canonical,
      );

      const deps = merged.dependencies as Record<string, string>;
      const devDeps = merged.devDependencies as Record<string, string>;
      const scripts = merged.scripts as Record<string, string>;

      expect(deps["@agent-native/core"]).toBe("0.72.1");
      expect(deps["@neondatabase/serverless"]).toBe("^1.0.2");
      expect(deps["drizzle-orm"]).toBe("0.45.2");
      expect(deps.postgres).toBe("^3.4.9");
      expect(devDeps["drizzle-kit"]).toBe("0.31.10");
      expect(devDeps.dotenv).toBe("^17.2.1");
      expect(scripts["db:generate"]).toBe("drizzle-kit generate");
      expect(scripts["db:migrate"]).toBe("drizzle-kit migrate");
      expect(merged.packageManager).toBe("pnpm@10.14.0");
    },
    STARTER_MANIFEST_TIMEOUT_MS,
  );

  describe("syncStarterManifestFiles", () => {
    let tempDir: string;

    afterEach(() => {
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it(
      "reports no changes when starter already matches the canonical manifest",
      () => {
        tempDir = fs.mkdtempSync(
          path.join(os.tmpdir(), "an-starter-sync-spec-"),
        );
        const snapshot = createStandaloneChatSnapshot(repoRoot);
        try {
          const starterPackageJsonPath = path.join(tempDir, "package.json");
          const starterPnpmWorkspacePath = path.join(
            tempDir,
            "pnpm-workspace.yaml",
          );

          fs.writeFileSync(
            starterPackageJsonPath,
            `${JSON.stringify(snapshot.packageJson, null, 2)}\n`,
          );
          if (snapshot.pnpmWorkspaceYaml) {
            fs.writeFileSync(
              starterPnpmWorkspacePath,
              snapshot.pnpmWorkspaceYaml,
            );
          }
          for (const [relativePath, content] of snapshot.toolchainFiles) {
            const targetPath = path.join(tempDir, relativePath);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, content);
          }

          const result = syncStarterManifestFiles({
            starterDir: tempDir,
            repoRoot,
          });

          expect(result.changed).toBe(false);
        } finally {
          snapshot.cleanup();
        }
      },
      STARTER_MANIFEST_TIMEOUT_MS,
    );

    it(
      "syncs toolchain files when starter config drifts from templates/chat",
      () => {
        tempDir = fs.mkdtempSync(
          path.join(os.tmpdir(), "an-starter-sync-spec-"),
        );
        const { packageJson, pnpmWorkspaceYaml } =
          generateStandaloneChatManifest(repoRoot);

        fs.writeFileSync(
          path.join(tempDir, "package.json"),
          `${JSON.stringify(packageJson, null, 2)}\n`,
        );
        if (pnpmWorkspaceYaml) {
          fs.writeFileSync(
            path.join(tempDir, "pnpm-workspace.yaml"),
            pnpmWorkspaceYaml,
          );
        }
        fs.writeFileSync(
          path.join(tempDir, "react-router.config.ts"),
          [
            'import type { Config } from "@react-router/dev/config";',
            "",
            "export default {",
            '  appDirectory: "app",',
            "  ssr: true,",
            '  routeDiscovery: { mode: "initial" },',
            "  future: {",
            "    v8_viteEnvironmentApi: true,",
            "  },",
            "} satisfies Config;",
            "",
          ].join("\n"),
        );

        const result = syncStarterManifestFiles({
          starterDir: tempDir,
          repoRoot,
          write: true,
        });

        expect(result.changed).toBe(true);
        expect(result.changedToolchainPaths).toContain(
          "react-router.config.ts",
        );
        expect(
          fs.readFileSync(
            path.join(tempDir, "react-router.config.ts"),
            "utf-8",
          ),
        ).not.toContain("v8_viteEnvironmentApi");
      },
      STARTER_MANIFEST_TIMEOUT_MS,
    );

    it(
      "deletes stale starter toolchain files removed from templates/chat",
      () => {
        tempDir = fs.mkdtempSync(
          path.join(os.tmpdir(), "an-starter-sync-spec-"),
        );
        fs.writeFileSync(
          path.join(tempDir, "components.json"),
          '{"stale":true}\n',
        );

        const changes = diffStarterToolchainFiles(tempDir, new Map());
        expect(
          changes.find((change) => change.relativePath === "components.json")
            ?.changed,
        ).toBe(true);

        applyStarterToolchainSync(tempDir, new Map());

        expect(fs.existsSync(path.join(tempDir, "components.json"))).toBe(
          false,
        );
      },
      STARTER_MANIFEST_TIMEOUT_MS,
    );
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
