import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../db/client.js", () => ({
  getDbExec: () => sharedClient,
  isPostgres: () => false,
  intType: () => "INTEGER",
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

interface FrameworkClient {
  execute(arg: string | { sql: string; args: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
}

let sqlite: Database.Database;
let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

beforeAll(() => {
  sqlite = new Database(":memory:");
  sharedClient = {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      const stmt = sqlite.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = stmt.all(...args) as any[];
        return { rows, rowsAffected: 0 };
      }
      const result = stmt.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
  };
});

afterAll(() => {
  sqlite.close();
});

describe("resourceEffectiveContext", () => {
  it("exposes selected Dispatch workspace skills only to granted apps", async () => {
    const {
      WORKSPACE_OWNER,
      resourceEffectiveContext,
      resourceGet,
      resourceGetByPath,
      resourceList,
      resourceListAccessible,
    } = await import("./store.js");

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS workspace_resources (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        path TEXT NOT NULL,
        content TEXT NOT NULL,
        scope TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_resource_grants (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        resource_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        status TEXT NOT NULL,
        synced_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    sqlite
      .prepare("DELETE FROM workspace_resource_grants WHERE id = ?")
      .run("grant_skill_analytics");
    sqlite
      .prepare("DELETE FROM workspace_resources WHERE id = ?")
      .run("selected_skill_analytics");

    const skillPath = "skills/analytics-review/SKILL.md";
    sqlite
      .prepare(
        `INSERT INTO workspace_resources
          (id, owner_email, org_id, kind, name, description, path, content, scope, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "selected_skill_analytics",
        "owner@example.test",
        "org_123",
        "skill",
        "Analytics Review",
        "Review analytics work",
        skillPath,
        "---\nname: analytics-review\ndescription: Review analytics work\n---\n\n# Analytics Review",
        "selected",
        "owner@example.test",
        1,
        2,
      );
    sqlite
      .prepare(
        `INSERT INTO workspace_resource_grants
          (id, owner_email, org_id, resource_id, app_id, status, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "grant_skill_analytics",
        "owner@example.test",
        "org_123",
        "selected_skill_analytics",
        "analytics",
        "active",
        null,
        1,
        2,
      );

    const grantedSkills = await resourceListAccessible(
      "member@example.test",
      "skills/",
      { workspaceAppId: "analytics", orgId: "org_123" },
    );
    const selectedSkill = grantedSkills.find(
      (resource) => resource.path === skillPath,
    );

    expect(selectedSkill).toMatchObject({
      id: "dispatch-workspace-resource:selected_skill_analytics",
      owner: WORKSPACE_OWNER,
      path: skillPath,
      mimeType: "text/markdown",
    });

    await expect(
      resourceGet(selectedSkill!.id, {
        workspaceAppId: "analytics",
        userEmail: "member@example.test",
        orgId: "org_123",
      }),
    ).resolves.toMatchObject({
      owner: WORKSPACE_OWNER,
      path: skillPath,
      content: expect.stringContaining("# Analytics Review"),
    });

    await expect(
      resourceGetByPath(WORKSPACE_OWNER, skillPath, {
        workspaceAppId: "analytics",
        userEmail: "member@example.test",
        orgId: "org_123",
      }),
    ).resolves.toMatchObject({
      owner: WORKSPACE_OWNER,
      path: skillPath,
    });

    await expect(
      resourceList(WORKSPACE_OWNER, "skills/", {
        workspaceAppId: "analytics",
        userEmail: "member@example.test",
        orgId: "org_123",
      }),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: skillPath })]),
    );

    const effective = await resourceEffectiveContext(
      "member@example.test",
      skillPath,
      { workspaceAppId: "analytics", orgId: "org_123" },
    );
    expect(effective.effectiveScope).toBe("workspace");
    expect(effective.effectiveResource).toMatchObject({
      owner: WORKSPACE_OWNER,
      path: skillPath,
    });

    const mailSkills = await resourceListAccessible(
      "member@example.test",
      "skills/",
      { workspaceAppId: "mail", orgId: "org_123" },
    );
    expect(mailSkills.some((resource) => resource.path === skillPath)).toBe(
      false,
    );
  });

  it("reuses one workspace record across callers and overlays shared/personal overrides", async () => {
    const {
      SHARED_OWNER,
      WORKSPACE_OWNER,
      resourceDeleteByPath,
      resourceEffectiveContext,
      resourceListAllOwners,
      resourcePut,
    } = await import("./store.js");

    const path = "context/runtime-inheritance-contract.md";
    const analyticsUser = "analytics-agent@example.test";
    const mailUser = "mail-agent@example.test";

    for (const owner of [
      WORKSPACE_OWNER,
      SHARED_OWNER,
      analyticsUser,
      mailUser,
    ]) {
      await resourceDeleteByPath(owner, path);
    }

    await resourcePut(WORKSPACE_OWNER, path, "# Workspace Baseline");

    const analyticsWorkspace = await resourceEffectiveContext(
      analyticsUser,
      path,
    );
    const mailWorkspace = await resourceEffectiveContext(mailUser, path);
    const workspaceId = analyticsWorkspace.effectiveResource?.id;

    expect(analyticsWorkspace.effectiveScope).toBe("workspace");
    expect(mailWorkspace.effectiveScope).toBe("workspace");
    expect(mailWorkspace.effectiveResource?.id).toBe(workspaceId);
    expect(mailWorkspace.effectiveResource?.owner).toBe(WORKSPACE_OWNER);
    expect(
      (await resourceListAllOwners(path)).map((resource) => resource.owner),
    ).toEqual([WORKSPACE_OWNER]);

    await resourcePut(SHARED_OWNER, path, "# Shared Override");

    const analyticsShared = await resourceEffectiveContext(analyticsUser, path);
    const mailShared = await resourceEffectiveContext(mailUser, path);

    expect(analyticsShared.effectiveScope).toBe("shared");
    expect(mailShared.effectiveScope).toBe("shared");
    expect(analyticsShared.effectiveResource?.id).toBe(
      mailShared.effectiveResource?.id,
    );
    expect(analyticsShared.layers[0].resource?.id).toBe(workspaceId);

    await resourcePut(analyticsUser, path, "# Personal Override");

    const analyticsPersonal = await resourceEffectiveContext(
      analyticsUser,
      path,
    );
    const mailStillShared = await resourceEffectiveContext(mailUser, path);
    const owners = (await resourceListAllOwners(path))
      .map((resource) => resource.owner)
      .sort();

    expect(analyticsPersonal.effectiveScope).toBe("personal");
    expect(mailStillShared.effectiveScope).toBe("shared");
    expect(owners).toEqual(
      [WORKSPACE_OWNER, SHARED_OWNER, analyticsUser].sort(),
    );
  });

  it("treats resource path prefixes with LIKE wildcards as literal text", async () => {
    const {
      resourceDeleteByPath,
      resourceList,
      resourceListAccessible,
      resourceListAllOwners,
      resourcePut,
    } = await import("./store.js");

    const owner = "prefix-wildcards@example.test";
    const namespace = `prefix-wildcards-${Date.now()}-`;
    const literalUnderscore = `${namespace}literal_prefix/file.md`;
    const underscoreDecoy = `${namespace}literalXprefix/file.md`;
    const literalPercent = `${namespace}literal%prefix/file.md`;
    const percentDecoy = `${namespace}literal-any-prefix/file.md`;
    const paths = [
      literalUnderscore,
      underscoreDecoy,
      literalPercent,
      percentDecoy,
    ];

    try {
      for (const path of paths) {
        await resourcePut(owner, path, path);
      }

      await expect(
        resourceList(owner, `${namespace}literal_prefix`),
      ).resolves.toEqual([
        expect.objectContaining({ path: literalUnderscore }),
      ]);

      await expect(
        resourceListAccessible(owner, `${namespace}literal%prefix`),
      ).resolves.toEqual([expect.objectContaining({ path: literalPercent })]);

      await expect(
        resourceListAllOwners(`${namespace}literal_prefix`),
      ).resolves.toEqual([
        expect.objectContaining({ path: literalUnderscore }),
      ]);
    } finally {
      for (const path of paths) {
        await resourceDeleteByPath(owner, path);
      }
    }
  });

  it("resolves personal > organization/app > workspace for instruction, skill, AGENTS, and context paths", async () => {
    const {
      SHARED_OWNER,
      WORKSPACE_OWNER,
      resourceDeleteByPath,
      resourceEffectiveContext,
      resourcePut,
    } = await import("./store.js");

    const user = "person+effective@example.test";
    const paths = [
      "AGENTS.md",
      "instructions/guardrails.md",
      "skills/company-voice/SKILL.md",
      "context/brand.md",
    ];

    for (const path of paths) {
      await resourcePut(WORKSPACE_OWNER, path, `workspace ${path}`);
      await resourcePut(SHARED_OWNER, path, `shared ${path}`);
      await resourcePut(user, path, `personal ${path}`);

      const personal = await resourceEffectiveContext(user, path);
      expect(personal.effectiveScope).toBe("personal");
      expect(personal.layers.map((layer) => layer.scope)).toEqual([
        "workspace",
        "shared",
        "personal",
      ]);
      expect(
        personal.layers.find((layer) => layer.scope === "personal"),
      ).toMatchObject({ exists: true, effective: true, overridden: false });
      expect(
        personal.layers.find((layer) => layer.scope === "shared"),
      ).toMatchObject({ exists: true, effective: false, overridden: true });
      expect(
        personal.layers.find((layer) => layer.scope === "workspace"),
      ).toMatchObject({ exists: true, effective: false, overridden: true });

      await resourceDeleteByPath(user, path);
      const shared = await resourceEffectiveContext(user, path);
      expect(shared.effectiveScope).toBe("shared");
      expect(
        shared.layers.find((layer) => layer.scope === "shared"),
      ).toMatchObject({ exists: true, effective: true, overridden: false });

      await resourceDeleteByPath(SHARED_OWNER, path);
      const workspace = await resourceEffectiveContext(user, path);
      expect(workspace.effectiveScope).toBe("workspace");
      expect(
        workspace.layers.find((layer) => layer.scope === "workspace"),
      ).toMatchObject({ exists: true, effective: true, overridden: false });
    }
  });

  it("surfaces local file mode control files as writable workspace resources", async () => {
    const {
      WORKSPACE_OWNER,
      resourceEffectiveContext,
      resourceGetByPath,
      resourceListAccessible,
      resourcePut,
    } = await import("./store.js");

    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-local-resource-store-"),
    );
    const previousManifest = process.env.AGENT_NATIVE_MANIFEST;
    const previousManifestPath = process.env.AGENT_NATIVE_MANIFEST_PATH;
    const manifestPath = path.join(root, "agent-native.json");
    try {
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            mode: "local-files",
            apps: {
              content: {
                roots: [{ path: "content", extensions: [".mdx"] }],
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      fs.writeFileSync(path.join(root, "AGENTS.md"), "# Local Agents", "utf8");
      fs.mkdirSync(path.join(root, ".agents", "skills", "local-review"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(root, ".agents", "skills", "local-review", "SKILL.md"),
        "---\nname: local-review\n---\n# Local Review",
        "utf8",
      );
      process.env.AGENT_NATIVE_MANIFEST = manifestPath;
      delete process.env.AGENT_NATIVE_MANIFEST_PATH;

      await expect(
        resourceGetByPath(WORKSPACE_OWNER, "AGENTS.md"),
      ).resolves.toMatchObject({
        owner: WORKSPACE_OWNER,
        path: "AGENTS.md",
        content: "# Local Agents",
      });

      const resources = await resourceListAccessible(
        "member@example.test",
        "skills/",
      );
      expect(resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            owner: WORKSPACE_OWNER,
            path: "skills/local-review/SKILL.md",
          }),
        ]),
      );

      const effective = await resourceEffectiveContext(
        "member@example.test",
        "AGENTS.md",
      );
      expect(effective.effectiveScope).toBe("workspace");
      expect(effective.layers[0]).toMatchObject({
        scope: "workspace",
        exists: true,
        canWrite: true,
      });

      await resourcePut(
        WORKSPACE_OWNER,
        "skills/generated/SKILL.md",
        "---\nname: generated\n---\n# Generated",
      );
      expect(
        fs.readFileSync(
          path.join(root, ".agents", "skills", "generated", "SKILL.md"),
          "utf8",
        ),
      ).toContain("# Generated");

      await expect(
        resourcePut(WORKSPACE_OWNER, "context/brand.md", "# Brand"),
      ).rejects.toThrow("Workspace resources in local file mode");
    } finally {
      if (previousManifest === undefined) {
        delete process.env.AGENT_NATIVE_MANIFEST;
      } else {
        process.env.AGENT_NATIVE_MANIFEST = previousManifest;
      }
      if (previousManifestPath === undefined) {
        delete process.env.AGENT_NATIVE_MANIFEST_PATH;
      } else {
        process.env.AGENT_NATIVE_MANIFEST_PATH = previousManifestPath;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
