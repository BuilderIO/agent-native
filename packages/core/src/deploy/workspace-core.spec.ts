import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  getWorkspaceCoreExports,
  _resetWorkspaceCoreCache,
} from "./workspace-core.js";

function makeWorkspaceFixture(opts: {
  corePackageName: string;
  withWorkspaceCoreField: boolean;
  withServerIndex: boolean;
  withActionsDir: boolean;
  withSkillsDir: boolean;
  withAgentsMd: boolean;
}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ws-core-fixture-"));
  const corePackageDir = path.join(tmpRoot, "packages", "shared");
  const appDir = path.join(tmpRoot, "apps", "example");
  fs.mkdirSync(corePackageDir, { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });

  fs.writeFileSync(
    path.join(tmpRoot, "package.json"),
    JSON.stringify(
      {
        name: "test-workspace",
        private: true,
        ...(opts.withWorkspaceCoreField
          ? { "agent-native": { workspaceCore: opts.corePackageName } }
          : {}),
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(tmpRoot, "pnpm-workspace.yaml"), "packages:\n");

  fs.writeFileSync(
    path.join(corePackageDir, "package.json"),
    JSON.stringify({ name: opts.corePackageName, version: "0.0.0" }, null, 2),
  );

  if (opts.withServerIndex) {
    fs.mkdirSync(path.join(corePackageDir, "src", "server"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(corePackageDir, "src", "server", "index.ts"),
      `export const authPlugin = async () => {};
export const orgPlugin = async () => {};
// not exported: agentChatPlugin
`,
    );
  }

  if (opts.withActionsDir) {
    fs.mkdirSync(path.join(corePackageDir, "actions"), { recursive: true });
    fs.writeFileSync(
      path.join(corePackageDir, "actions", "shared.ts"),
      "export default { tool: {}, run: async () => '' };",
    );
  }

  if (opts.withSkillsDir) {
    fs.mkdirSync(path.join(corePackageDir, ".agents", "skills", "policy"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(corePackageDir, ".agents", "skills", "policy", "SKILL.md"),
      "---\nname: policy\ndescription: Shared enterprise policy\n---\n",
    );
  }

  if (opts.withAgentsMd) {
    fs.writeFileSync(
      path.join(corePackageDir, "AGENTS.md"),
      "# Enterprise Instructions\nAll apps must obey.",
    );
  }

  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify({ name: "example-app" }, null, 2),
  );

  return {
    tmpRoot,
    appDir,
    corePackageDir,
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

describe("getWorkspaceCoreExports", () => {
  beforeEach(() => _resetWorkspaceCoreCache());
  afterEach(() => _resetWorkspaceCoreCache());

  it("returns null when cwd is not inside a workspace", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "not-a-workspace-"));
    try {
      const result = await getWorkspaceCoreExports(tmp);
      expect(result).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns null when the declared package cannot be resolved", async () => {
    const fix = makeWorkspaceFixture({
      corePackageName: "@missing/package",
      withWorkspaceCoreField: true,
      withServerIndex: false,
      withActionsDir: false,
      withSkillsDir: false,
      withAgentsMd: false,
    });
    try {
      fs.writeFileSync(
        path.join(fix.tmpRoot, "package.json"),
        JSON.stringify(
          {
            name: "test-workspace",
            private: true,
            "agent-native": { workspaceCore: "@ghost/never-written" },
          },
          null,
          2,
        ),
      );
      const result = await getWorkspaceCoreExports(fix.appDir);
      expect(result).toBeNull();
    } finally {
      fix.cleanup();
    }
  });

  it("discovers a workspace core via packages/*/package.json name", async () => {
    const fix = makeWorkspaceFixture({
      corePackageName: "@my-company/shared",
      withWorkspaceCoreField: true,
      withServerIndex: true,
      withActionsDir: true,
      withSkillsDir: true,
      withAgentsMd: true,
    });
    try {
      const result = await getWorkspaceCoreExports(fix.appDir);
      expect(result).not.toBeNull();
      expect(result!.packageName).toBe("@my-company/shared");
      expect(result!.workspaceRoot).toBe(fix.tmpRoot);
      expect(result!.packageDir).toBe(fix.corePackageDir);
      expect(result!.skillsDir).toBe(
        path.join(fix.corePackageDir, ".agents", "skills"),
      );
      expect(result!.actionsDir).toBe(path.join(fix.corePackageDir, "actions"));
      expect(result!.agentsMdPath).toBe(
        path.join(fix.corePackageDir, "AGENTS.md"),
      );
    } finally {
      fix.cleanup();
    }
  });

  it("detects plugin exports in src/server/index.ts", async () => {
    const fix = makeWorkspaceFixture({
      corePackageName: "@my-company/shared",
      withWorkspaceCoreField: true,
      withServerIndex: true,
      withActionsDir: false,
      withSkillsDir: false,
      withAgentsMd: false,
    });
    try {
      const result = await getWorkspaceCoreExports(fix.appDir);
      expect(result).not.toBeNull();
      expect(result!.plugins).toEqual({
        auth: "authPlugin",
        org: "orgPlugin",
      });
      expect(result!.plugins["agent-chat"]).toBeUndefined();
    } finally {
      fix.cleanup();
    }
  });

  it("reports null for missing optional directories", async () => {
    const fix = makeWorkspaceFixture({
      corePackageName: "@co/core",
      withWorkspaceCoreField: true,
      withServerIndex: false,
      withActionsDir: false,
      withSkillsDir: false,
      withAgentsMd: false,
    });
    try {
      const result = await getWorkspaceCoreExports(fix.appDir);
      expect(result).not.toBeNull();
      expect(result!.actionsDir).toBeNull();
      expect(result!.skillsDir).toBeNull();
      expect(result!.agentsMdPath).toBeNull();
      expect(result!.plugins).toEqual({});
    } finally {
      fix.cleanup();
    }
  });

  it("returns null when root package.json has no workspaceCore field", async () => {
    const fix = makeWorkspaceFixture({
      corePackageName: "@co/core",
      withWorkspaceCoreField: false,
      withServerIndex: true,
      withActionsDir: false,
      withSkillsDir: false,
      withAgentsMd: false,
    });
    try {
      const result = await getWorkspaceCoreExports(fix.appDir);
      expect(result).toBeNull();
    } finally {
      fix.cleanup();
    }
  });

  it("caches results per-cwd", async () => {
    const fix = makeWorkspaceFixture({
      corePackageName: "@co/core",
      withWorkspaceCoreField: true,
      withServerIndex: true,
      withActionsDir: false,
      withSkillsDir: false,
      withAgentsMd: false,
    });
    try {
      const first = await getWorkspaceCoreExports(fix.appDir);
      const tempBackup = path.join(os.tmpdir(), "ws-cache-backup");
      fs.renameSync(fix.tmpRoot, tempBackup);
      try {
        const second = await getWorkspaceCoreExports(fix.appDir);
        expect(second).toEqual(first);
      } finally {
        fs.renameSync(tempBackup, fix.tmpRoot);
      }
    } finally {
      fix.cleanup();
    }
  });
});
