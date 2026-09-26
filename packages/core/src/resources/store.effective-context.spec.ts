import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { runWithRequestContext } from "../server/request-context.js";

vi.mock("../db/client.js", () => ({
  getDbExec: () => sharedClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

interface FrameworkClient {
  execute(arg: string | { sql: string; args: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
  transaction?<T>(fn: (tx: FrameworkClient) => Promise<T>): Promise<T>;
}

function frameworkClientFor(client: any): FrameworkClient {
  return {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      let parameter = 0;
      const postgresSql = sql.replace(/\?/g, () => `$${++parameter}`);
      const result = await client.query(postgresSql, args);
      return {
        rows: Array.from(result.rows ?? []),
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
    transaction: (fn) =>
      client.transaction((tx: any) => fn(frameworkClientFor(tx))),
  };
}

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

beforeAll(async () => {
  pglite = await createTestPglite();
  sharedClient = frameworkClientFor(pglite.db);
});

afterAll(async () => {
  await pglite.close();
});

describe("resourceEffectiveContext", () => {
  it("isolates organization resources and preserves legacy app defaults", async () => {
    const {
      SHARED_OWNER,
      organizationResourceOwner,
      resourceDeleteByPath,
      resourceEffectiveContext,
      resourceGetByPath,
      resourceListAccessible,
      resourcePut,
    } = await import("./store.js");

    const path = `context/org-learning-${Date.now()}.md`;
    const orgAOwner = organizationResourceOwner("org-a");
    const orgBOwner = organizationResourceOwner("org-b");
    try {
      await resourcePut(SHARED_OWNER, path, "legacy app default");
      await resourcePut(orgAOwner, path, "org A learning");
      await resourcePut(orgBOwner, path, "org B learning");

      const orgA = await resourceEffectiveContext("member@example.test", path, {
        orgId: "org-a",
      });
      const orgB = await resourceEffectiveContext("member@example.test", path, {
        orgId: "org-b",
      });
      const solo = await resourceEffectiveContext("member@example.test", path, {
        orgId: null,
      });

      expect(orgA.effectiveResource).toMatchObject({
        owner: orgAOwner,
      });
      expect(orgB.effectiveResource).toMatchObject({
        owner: orgBOwner,
      });
      expect(solo.effectiveResource).toMatchObject({
        owner: SHARED_OWNER,
      });
      await expect(resourceGetByPath(orgAOwner, path)).resolves.toMatchObject({
        content: "org A learning",
      });
      await expect(resourceGetByPath(orgBOwner, path)).resolves.toMatchObject({
        content: "org B learning",
      });
      await expect(
        resourceGetByPath(SHARED_OWNER, path),
      ).resolves.toMatchObject({ content: "legacy app default" });

      const orgAResources = await resourceListAccessible(
        "member@example.test",
        "context/org-learning-",
        { orgId: "org-a" },
      );
      expect(orgAResources).toEqual([
        expect.objectContaining({ owner: orgAOwner, path }),
      ]);
      expect(
        orgAResources.some((resource) => resource.owner === orgBOwner),
      ).toBe(false);
    } finally {
      await Promise.all([
        resourceDeleteByPath(SHARED_OWNER, path),
        resourceDeleteByPath(orgAOwner, path),
        resourceDeleteByPath(orgBOwner, path),
      ]);
    }
  });

  it("isolates organization workspace defaults and keeps legacy bare-owner rows readable", async () => {
    const {
      WORKSPACE_OWNER,
      resourceDeleteByPath,
      resourceEffectiveContext,
      resourceGetByPath,
      resourceList,
      resourcePut,
      workspaceResourceOwner,
    } = await import("./store.js");

    const prefix = `context/org-workspace-${Date.now()}/`;
    const path = `${prefix}company.md`;
    const legacyPath = `${prefix}legacy.md`;
    const orgAOwner = workspaceResourceOwner("org-a");
    const orgBOwner = workspaceResourceOwner("org-b");
    expect(orgAOwner).not.toBe(orgBOwner);
    expect(workspaceResourceOwner(null)).toBe(WORKSPACE_OWNER);
    try {
      await resourcePut(orgAOwner, path, "Acme");
      await resourcePut(orgBOwner, path, "Globex");
      await resourcePut(WORKSPACE_OWNER, legacyPath, "legacy default");

      await expect(
        resourceGetByPath(WORKSPACE_OWNER, path, { orgId: "org-a" }),
      ).resolves.toMatchObject({ owner: orgAOwner, content: "Acme" });
      await expect(
        resourceGetByPath(WORKSPACE_OWNER, path, { orgId: "org-b" }),
      ).resolves.toMatchObject({ owner: orgBOwner, content: "Globex" });
      await expect(
        resourceGetByPath(WORKSPACE_OWNER, path, { orgId: null }),
      ).resolves.toBeNull();
      await expect(
        resourceGetByPath(WORKSPACE_OWNER, legacyPath, { orgId: "org-a" }),
      ).resolves.toMatchObject({
        owner: WORKSPACE_OWNER,
        content: "legacy default",
      });

      const orgAList = await resourceList(WORKSPACE_OWNER, prefix, {
        orgId: "org-a",
      });
      expect(
        orgAList.map((resource) => [resource.path, resource.owner]),
      ).toEqual(
        expect.arrayContaining([
          [path, orgAOwner],
          [legacyPath, WORKSPACE_OWNER],
        ]),
      );
      expect(orgAList.some((resource) => resource.owner === orgBOwner)).toBe(
        false,
      );

      const orgA = await resourceEffectiveContext("member@example.test", path, {
        orgId: "org-a",
      });
      expect(orgA.effectiveScope).toBe("workspace");
      expect(orgA.effectiveResource).toMatchObject({ owner: orgAOwner });
      expect(orgA.layers[0]).toMatchObject({
        scope: "workspace",
        owner: orgAOwner,
        effective: true,
      });
      const orgB = await resourceEffectiveContext("member@example.test", path, {
        orgId: "org-b",
      });
      expect(orgB.effectiveResource).toMatchObject({ owner: orgBOwner });
    } finally {
      await Promise.all([
        resourceDeleteByPath(orgAOwner, path),
        resourceDeleteByPath(orgBOwner, path),
        resourceDeleteByPath(WORKSPACE_OWNER, legacyPath),
      ]);
    }
  });

  it("scopes direct organization workspace reads to the resolved organization", async () => {
    const {
      WORKSPACE_OWNER,
      resourceDeleteByPath,
      resourceGet,
      resourceGetByPath,
      resourceList,
      resourceListContentByOwnersAndPrefixes,
      resourcePut,
      workspaceResourceOwner,
    } = await import("./store.js");
    const prefix = `context/org-workspace-id-${Date.now()}/`;
    const orgAOwner = workspaceResourceOwner("org-a");
    const malformedOwner = "__workspace__:__organization__:bad%zz";
    const orgAPath = `${prefix}org-a.md`;
    const malformedPath = `${prefix}malformed.md`;
    const barePath = `${prefix}default.md`;
    const personalPath = `${prefix}personal.md`;

    try {
      const orgA = await resourcePut(orgAOwner, orgAPath, "org A only");
      const malformed = await resourcePut(
        malformedOwner,
        malformedPath,
        "malformed owner",
      );
      const bare = await resourcePut(
        WORKSPACE_OWNER,
        barePath,
        "deployment default",
      );
      const personal = await resourcePut(
        "member@example.test",
        personalPath,
        "personal resource",
      );

      await expect(
        resourceGet(orgA.id, { orgId: "org-a" }),
      ).resolves.toMatchObject({
        content: "org A only",
      });
      await expect(
        resourceGetByPath(orgAOwner, orgAPath, { orgId: "org-a" }),
      ).resolves.toMatchObject({ content: "org A only" });
      await expect(
        resourceList(orgAOwner, prefix, { orgId: "org-a" }),
      ).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ path: orgAPath })]),
      );
      await expect(
        resourceListContentByOwnersAndPrefixes([orgAOwner], [prefix], {
          orgId: "org-a",
        }),
      ).resolves.toEqual([expect.objectContaining({ path: orgAPath })]);
      await expect(
        resourceGet(orgA.id, { orgId: "org-b" }),
      ).resolves.toBeNull();
      await expect(
        resourceGetByPath(orgAOwner, orgAPath, { orgId: "org-b" }),
      ).resolves.toBeNull();
      await expect(
        resourceList(orgAOwner, prefix, { orgId: "org-b" }),
      ).resolves.toEqual([]);
      await expect(
        resourceListContentByOwnersAndPrefixes(
          [orgAOwner, WORKSPACE_OWNER],
          [prefix],
          { orgId: "org-b" },
        ),
      ).resolves.toEqual([expect.objectContaining({ path: barePath })]);
      await expect(resourceGet(orgA.id, { orgId: null })).resolves.toBeNull();
      await expect(
        runWithRequestContext({ orgId: undefined }, () => resourceGet(orgA.id)),
      ).resolves.toBeNull();
      await expect(
        runWithRequestContext({ orgId: undefined }, () =>
          resourceGetByPath(orgAOwner, orgAPath),
        ),
      ).resolves.toBeNull();
      await expect(
        runWithRequestContext({ orgId: undefined }, () =>
          resourceList(orgAOwner, prefix),
        ),
      ).resolves.toEqual([]);
      await expect(
        runWithRequestContext({ orgId: undefined }, () =>
          resourceListContentByOwnersAndPrefixes([orgAOwner], [prefix]),
        ),
      ).resolves.toEqual([]);
      await expect(
        runWithRequestContext({ orgId: "org-a" }, () => resourceGet(orgA.id)),
      ).resolves.toMatchObject({ content: "org A only" });
      await expect(
        runWithRequestContext({ orgId: "org-a" }, () =>
          resourceGetByPath(orgAOwner, orgAPath),
        ),
      ).resolves.toMatchObject({ content: "org A only" });
      await expect(
        runWithRequestContext({ orgId: "org-a" }, () =>
          resourceList(orgAOwner, prefix),
        ),
      ).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ path: orgAPath })]),
      );
      await expect(
        runWithRequestContext({ orgId: "org-a" }, () =>
          resourceGet(orgA.id, { orgId: null }),
        ),
      ).resolves.toBeNull();
      await expect(
        runWithRequestContext({ orgId: "org-a" }, () =>
          resourceGetByPath(orgAOwner, orgAPath, { orgId: null }),
        ),
      ).resolves.toBeNull();
      await expect(
        resourceGet(malformed.id, { orgId: "org-a" }),
      ).resolves.toBeNull();
      await expect(
        resourceGetByPath(malformedOwner, malformedPath, { orgId: "org-a" }),
      ).resolves.toBeNull();
      await expect(
        resourceList(malformedOwner, prefix, { orgId: "org-a" }),
      ).resolves.toEqual([]);
      await expect(
        resourceListContentByOwnersAndPrefixes([malformedOwner], [prefix], {
          orgId: "org-a",
        }),
      ).resolves.toEqual([]);
      await expect(
        resourceGet(bare.id, { orgId: "org-b" }),
      ).resolves.toMatchObject({
        content: "deployment default",
      });
      await expect(
        resourceGet(bare.id, { orgId: null }),
      ).resolves.toMatchObject({
        content: "deployment default",
      });
      await expect(
        resourceGet(personal.id, { orgId: "org-b" }),
      ).resolves.toMatchObject({ content: "personal resource" });
      await expect(
        resourceGetByPath(WORKSPACE_OWNER, barePath, { orgId: "org-b" }),
      ).resolves.toMatchObject({ content: "deployment default" });
      await expect(
        resourceList(WORKSPACE_OWNER, prefix, { orgId: "org-b" }),
      ).resolves.toEqual([expect.objectContaining({ path: barePath })]);
    } finally {
      await Promise.all([
        resourceDeleteByPath(orgAOwner, orgAPath),
        resourceDeleteByPath(malformedOwner, malformedPath),
        resourceDeleteByPath(WORKSPACE_OWNER, barePath),
        resourceDeleteByPath("member@example.test", personalPath),
      ]);
    }
  });

  it("fails closed for tagged Dispatch workspace rows without tenancy schema", async () => {
    const {
      WORKSPACE_OWNER,
      resourceDeleteByPath,
      resourceGet,
      resourceGetByPath,
      resourceList,
      resourceListContentByOwnersAndPrefixes,
      resourcePut,
    } = await import("./store.js");
    const prefix = `instructions/legacy-dispatch-missing-schema-${Date.now()}/`;
    const taggedPath = `${prefix}private.md`;
    const defaultPath = `${prefix}default.md`;

    try {
      const tagged = await resourcePut(
        WORKSPACE_OWNER,
        taggedPath,
        "unscoped private copy",
        undefined,
        {
          metadata: {
            source: "dispatch-workspace-resource",
            resourceId: "missing-tenancy-row",
          },
        },
      );
      await resourcePut(WORKSPACE_OWNER, defaultPath, "deployment default");

      await expect(
        resourceGet(tagged.id, { orgId: "org-a" }),
      ).resolves.toBeNull();
      await expect(
        resourceGetByPath(WORKSPACE_OWNER, taggedPath, { orgId: "org-a" }),
      ).resolves.toBeNull();
      await expect(
        resourceGetByPath(WORKSPACE_OWNER, defaultPath, { orgId: "org-a" }),
      ).resolves.toMatchObject({ content: "deployment default" });
      await expect(
        resourceList(WORKSPACE_OWNER, prefix, { orgId: "org-a" }),
      ).resolves.toEqual([expect.objectContaining({ path: defaultPath })]);
      await expect(
        resourceListContentByOwnersAndPrefixes([WORKSPACE_OWNER], [prefix], {
          orgId: "org-a",
        }),
      ).resolves.toEqual([expect.objectContaining({ path: defaultPath })]);
    } finally {
      await Promise.all([
        resourceDeleteByPath(WORKSPACE_OWNER, taggedPath),
        resourceDeleteByPath(WORKSPACE_OWNER, defaultPath),
      ]);
    }
  });

  it("propagates non-schema tenancy lookup failures", async () => {
    const {
      WORKSPACE_OWNER,
      resourceDeleteByPath,
      resourceGetByPath,
      resourcePut,
    } = await import("./store.js");
    const path = `instructions/legacy-dispatch-db-error-${Date.now()}.md`;
    const databaseClient = sharedClient;

    try {
      await resourcePut(WORKSPACE_OWNER, path, "private copy", undefined, {
        metadata: {
          source: "dispatch-workspace-resource",
          resourceId: "unreadable-tenancy-row",
        },
      });
      sharedClient = {
        async execute(arg) {
          const sql = typeof arg === "string" ? arg : arg.sql;
          if (sql.includes("SELECT id, org_id FROM workspace_resources")) {
            throw new Error("Dispatch tenancy connection reset");
          }
          return databaseClient.execute(arg);
        },
      };

      await expect(
        resourceGetByPath(WORKSPACE_OWNER, path, { orgId: "org-a" }),
      ).rejects.toThrow("Dispatch tenancy connection reset");
    } finally {
      sharedClient = databaseClient;
      await resourceDeleteByPath(WORKSPACE_OWNER, path);
    }
  });

  it("keeps a pre-upgrade Dispatch copy visible only to the organization that authored it", async () => {
    const {
      WORKSPACE_OWNER,
      resourceDeleteByPath,
      resourceGet,
      resourceGetByPath,
      resourceList,
      resourcePut,
    } = await import("./store.js");

    await pglite.exec(`
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
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);
    const prefix = `instructions/legacy-dispatch-${Date.now()}/`;
    const orgBPath = `${prefix}private.md`;
    const untaggedPath = `${prefix}default.md`;
    const orphanPath = `${prefix}orphan.md`;
    await pglite
      .prepare(
        `INSERT INTO workspace_resources
          (id, owner_email, org_id, kind, name, description, path, content, scope, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "legacy_dispatch_org_b",
        "owner@org-b.test",
        "org-b",
        "instruction",
        "Private",
        null,
        orgBPath,
        "org B private",
        "all",
        "owner@org-b.test",
        1,
        2,
      );
    try {
      const orgBRow = await resourcePut(
        WORKSPACE_OWNER,
        orgBPath,
        "org B private",
        undefined,
        {
          metadata: {
            source: "dispatch-workspace-resource",
            resourceId: "legacy_dispatch_org_b",
          },
        },
      );
      await resourcePut(WORKSPACE_OWNER, untaggedPath, "deployment default");
      await resourcePut(
        WORKSPACE_OWNER,
        orphanPath,
        "orphaned copy",
        undefined,
        {
          metadata: {
            source: "dispatch-workspace-resource",
            resourceId: "legacy_dispatch_missing",
          },
        },
      );

      await expect(
        resourceGetByPath(WORKSPACE_OWNER, orgBPath, { orgId: "org-a" }),
      ).resolves.toBeNull();
      await expect(
        resourceGet(orgBRow.id, { orgId: "org-a" }),
      ).resolves.toBeNull();
      await expect(
        resourceGetByPath(WORKSPACE_OWNER, orgBPath, { orgId: "org-b" }),
      ).resolves.toMatchObject({ content: "org B private" });
      await expect(
        resourceGetByPath(WORKSPACE_OWNER, untaggedPath, { orgId: "org-a" }),
      ).resolves.toMatchObject({ content: "deployment default" });
      await expect(
        resourceGetByPath(WORKSPACE_OWNER, orphanPath, { orgId: "org-a" }),
      ).resolves.toBeNull();

      const orgAList = await resourceList(WORKSPACE_OWNER, prefix, {
        orgId: "org-a",
      });
      expect(orgAList.map((resource) => resource.path)).toEqual([untaggedPath]);
      const orgBList = await resourceList(WORKSPACE_OWNER, prefix, {
        orgId: "org-b",
      });
      expect(orgBList.map((resource) => resource.path).sort()).toEqual(
        [orgBPath, untaggedPath].sort(),
      );
    } finally {
      await Promise.all([
        resourceDeleteByPath(WORKSPACE_OWNER, orgBPath),
        resourceDeleteByPath(WORKSPACE_OWNER, untaggedPath),
        resourceDeleteByPath(WORKSPACE_OWNER, orphanPath),
        pglite
          .prepare("DELETE FROM workspace_resources WHERE id = ?")
          .run("legacy_dispatch_org_b"),
      ]);
    }
  });

  it("exposes selected Dispatch workspace skills only to granted apps", async () => {
    const {
      WORKSPACE_OWNER,
      resourceEffectiveContext,
      resourceGet,
      resourceGetByPath,
      resourceList,
      resourceListAccessible,
    } = await import("./store.js");

    await pglite.exec(`
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
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_resource_grants (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        resource_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        status TEXT NOT NULL,
        synced_at BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);
    const skillContent =
      "---\nname: analytics-review\ndescription: Review analytics work\n---\n\n# Analytics Review \u{1F4CA}";
    await pglite
      .prepare("DELETE FROM workspace_resource_grants WHERE id = ?")
      .run("grant_skill_analytics");
    await pglite
      .prepare("DELETE FROM workspace_resources WHERE id = ?")
      .run("selected_skill_analytics");

    const skillPath = "skills/analytics-review/SKILL.md";
    await pglite
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
        skillContent,
        "selected",
        "owner@example.test",
        1,
        2,
      );
    await pglite
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
      size: Buffer.byteLength(skillContent, "utf8"),
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
      runWithRequestContext({ orgId: "org_123" }, () =>
        resourceGet(selectedSkill!.id, {
          workspaceAppId: "analytics",
          userEmail: "member@example.test",
          orgId: null,
        }),
      ),
    ).resolves.toBeNull();

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
      resourceDeleteByPath,
      resourceDeleteIfCurrent,
      resourceEffectiveContext,
      resourceGetByPath,
      resourceList,
      resourceListAllOwners,
      resourceListAccessible,
      resourcePut,
      resourcePutIfAbsent,
      resourcePutIfCurrent,
      workspaceResourceOwner,
    } = await import("./store.js");

    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-local-resource-store-"),
    );
    const previousManifest = process.env.AGENT_NATIVE_MANIFEST;
    const previousManifestPath = process.env.AGENT_NATIVE_MANIFEST_PATH;
    const manifestPath = path.join(root, "agent-native.json");
    const localPath = "skills/local-review/SKILL.md";
    let bareSqlFallback:
      | {
          id: string;
          content: string;
          size: number;
          updatedAt: number;
          createdForTest: boolean;
        }
      | undefined;
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
        localPath,
      );
      expect(effective.effectiveScope).toBe("workspace");
      expect(effective.layers[0]).toMatchObject({
        scope: "workspace",
        exists: true,
        canWrite: true,
      });

      const orgAOwner = workspaceResourceOwner("org-a");
      const orgBOwner = workspaceResourceOwner("org-b");
      const orgA = await resourcePut(orgAOwner, localPath, "# Org A");
      await resourcePut(orgBOwner, localPath, "# Org B");
      await expect(
        resourcePut(orgAOwner, "context/org-only.md", "# Org-only"),
      ).resolves.toMatchObject({ owner: orgAOwner });
      await expect(
        resourcePutIfAbsent(
          orgAOwner,
          "context/org-if-absent.md",
          "# Org-only once",
        ),
      ).resolves.toMatchObject({ owner: orgAOwner });
      expect(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe(
        "# Local Agents",
      );

      await expect(
        resourceGetByPath(WORKSPACE_OWNER, localPath, { orgId: "org-a" }),
      ).resolves.toMatchObject({ owner: orgAOwner, content: "# Org A" });
      await expect(
        resourceGetByPath(orgBOwner, localPath, { orgId: "org-b" }),
      ).resolves.toMatchObject({ owner: orgBOwner, content: "# Org B" });
      await expect(
        resourceList(WORKSPACE_OWNER, localPath, { orgId: "org-a" }),
      ).resolves.toEqual([expect.objectContaining({ owner: orgAOwner })]);
      await expect(resourceListAllOwners(localPath)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            owner: WORKSPACE_OWNER,
            content: expect.stringContaining("# Local Review"),
          }),
          expect.objectContaining({ owner: orgAOwner, content: "# Org A" }),
          expect.objectContaining({ owner: orgBOwner, content: "# Org B" }),
        ]),
      );

      const orgAContext = await resourceEffectiveContext(
        "member@example.test",
        localPath,
        { orgId: "org-a" },
      );
      expect(orgAContext.effectiveResource).toMatchObject({
        owner: orgAOwner,
      });
      await expect(
        resourcePutIfCurrent({
          owner: orgAOwner,
          path: localPath,
          content: "# Org A updated",
          expectedId: orgA.id,
          expectedUpdatedAt: orgA.updatedAt,
          expectedContent: orgA.content,
        }),
      ).resolves.toMatchObject({ content: "# Org A updated" });
      await expect(resourceDeleteByPath(orgAOwner, localPath)).resolves.toBe(
        true,
      );
      const bareRows = (await pglite
        .prepare(
          "SELECT id, content, size, updated_at FROM resources WHERE owner = ? AND path = ?",
        )
        .all(WORKSPACE_OWNER, localPath)) as Array<{
        id: string;
        content: string;
        size: number;
        updated_at: number;
      }>;
      const bareRow = bareRows[0];
      const now = Date.now();
      if (bareRow) {
        bareSqlFallback = {
          id: bareRow.id,
          content: bareRow.content,
          size: Number(bareRow.size),
          updatedAt: Number(bareRow.updated_at),
          createdForTest: false,
        };
        await pglite
          .prepare(
            "UPDATE resources SET content = ?, size = ?, updated_at = ? WHERE id = ?",
          )
          .run(
            "# Bare SQL fallback",
            Buffer.byteLength("# Bare SQL fallback", "utf8"),
            now,
            bareSqlFallback.id,
          );
      } else {
        const id = `bare-local-fallback-${Date.now()}`;
        await pglite
          .prepare(
            `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            localPath,
            WORKSPACE_OWNER,
            "# Bare SQL fallback",
            "text/markdown",
            Buffer.byteLength("# Bare SQL fallback", "utf8"),
            now,
            now,
          );
        bareSqlFallback = {
          id,
          content: "",
          size: 0,
          updatedAt: 0,
          createdForTest: true,
        };
      }
      expect(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe(
        "# Local Agents",
      );
      await expect(
        resourceGetByPath(WORKSPACE_OWNER, localPath, { orgId: "org-a" }),
      ).resolves.toMatchObject({
        owner: WORKSPACE_OWNER,
        content: expect.stringContaining("# Local Review"),
      });
      await expect(
        resourceList(WORKSPACE_OWNER, localPath, { orgId: "org-a" }),
      ).resolves.toEqual([
        expect.objectContaining({
          owner: WORKSPACE_OWNER,
          metadata: expect.stringContaining("local-workspace-resource"),
        }),
      ]);
      await expect(
        resourceListAllOwners(localPath, {
          includeShadowedWorkspaceRows: true,
        }),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: bareSqlFallback.id,
            owner: WORKSPACE_OWNER,
            content: "# Bare SQL fallback",
          }),
          expect.objectContaining({
            owner: WORKSPACE_OWNER,
            metadata: expect.stringContaining("local-workspace-resource"),
          }),
        ]),
      );
      await expect(
        resourceGetByPath(orgBOwner, localPath, { orgId: "org-b" }),
      ).resolves.toMatchObject({ owner: orgBOwner, content: "# Org B" });

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

      const conditionalLocal = await resourcePut(
        WORKSPACE_OWNER,
        "skills/conditional/SKILL.md",
        "---\nname: conditional\n---\n# Materialized",
      );
      await expect(resourceDeleteIfCurrent(conditionalLocal)).resolves.toBe(
        true,
      );
      expect(
        fs.existsSync(
          path.join(root, ".agents", "skills", "conditional", "SKILL.md"),
        ),
      ).toBe(false);

      await expect(
        resourcePut(WORKSPACE_OWNER, "context/brand.md", "# Brand"),
      ).rejects.toThrow("Workspace resources in local file mode");
    } finally {
      await Promise.all([
        resourceDeleteByPath(workspaceResourceOwner("org-a"), localPath),
        resourceDeleteByPath(
          workspaceResourceOwner("org-a"),
          "context/org-only.md",
        ),
        resourceDeleteByPath(
          workspaceResourceOwner("org-a"),
          "context/org-if-absent.md",
        ),
        resourceDeleteByPath(workspaceResourceOwner("org-b"), localPath),
      ]);
      if (bareSqlFallback) {
        if (bareSqlFallback.createdForTest) {
          await pglite
            .prepare("DELETE FROM resources WHERE id = ?")
            .run(bareSqlFallback.id);
        } else {
          await pglite
            .prepare(
              "UPDATE resources SET content = ?, size = ?, updated_at = ? WHERE id = ?",
            )
            .run(
              bareSqlFallback.content,
              bareSqlFallback.size,
              bareSqlFallback.updatedAt,
              bareSqlFallback.id,
            );
        }
      }
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

  it("drops a conditional write when the resource version is stale", async () => {
    const {
      SHARED_OWNER,
      resourceGetByPath,
      resourcePut,
      resourcePutIfCurrent,
    } = await import("./store.js");
    const path = `context/conditional-${Date.now()}-${Math.random()}.md`;

    const initial = await resourcePut(SHARED_OWNER, path, "before");
    const updated = await resourcePutIfCurrent({
      owner: SHARED_OWNER,
      path,
      content: "after",
      expectedId: initial.id,
      expectedUpdatedAt: initial.updatedAt,
      expectedContent: initial.content,
    });
    expect(updated?.content).toBe("after");

    await expect(
      resourcePutIfCurrent({
        owner: SHARED_OWNER,
        path,
        content: "stale",
        expectedId: initial.id,
        expectedUpdatedAt: initial.updatedAt,
        expectedContent: initial.content,
      }),
    ).resolves.toBeNull();
    await expect(resourceGetByPath(SHARED_OWNER, path)).resolves.toMatchObject({
      content: "after",
    });
  });

  it("does not overwrite an existing resource during conditional insert", async () => {
    const {
      SHARED_OWNER,
      resourceDeleteByPath,
      resourceGetByPath,
      resourcePutIfAbsent,
    } = await import("./store.js");
    const path = `context/conditional-insert-${Date.now()}-${Math.random()}.md`;

    try {
      const first = await resourcePutIfAbsent(SHARED_OWNER, path, "first");
      expect(first?.content).toBe("first");

      await expect(
        resourcePutIfAbsent(SHARED_OWNER, path, "second"),
      ).resolves.toBeNull();
      await expect(
        resourceGetByPath(SHARED_OWNER, path),
      ).resolves.toMatchObject({
        content: "first",
      });
    } finally {
      await resourceDeleteByPath(SHARED_OWNER, path);
    }
  });

  it("guards snapshot writes and restores with the full SQL resource state", async () => {
    const {
      SHARED_OWNER,
      resourceDeleteByPath,
      resourceDeleteIfCurrent,
      resourceGetByPath,
      resourcePut,
      resourcePutIfSnapshot,
      resourceRestoreSnapshotIfCurrent,
    } = await import("./store.js");
    const path = `context/snapshot-${Date.now()}-${Math.random()}.md`;
    try {
      const before = await resourcePut(
        SHARED_OWNER,
        path,
        "before",
        undefined,
        {
          metadata: { source: "before" },
        },
      );
      const written = await resourcePutIfSnapshot({
        previous: before,
        owner: SHARED_OWNER,
        path,
        content: "written",
        options: {
          createdBy: "agent",
          metadata: { source: "dispatch" },
        },
      });
      expect(written?.resource).toMatchObject({
        id: before.id,
        content: "written",
        createdBy: "agent",
        metadata: expect.stringContaining("dispatch"),
      });
      await resourcePut(SHARED_OWNER, path, "written", undefined, {
        metadata: { source: "replacement" },
      });

      await expect(
        resourcePutIfSnapshot({
          previous: written!.resource,
          owner: SHARED_OWNER,
          path,
          content: "stale",
        }),
      ).resolves.toBeNull();
      await expect(
        resourceRestoreSnapshotIfCurrent(before, written!.resource),
      ).resolves.toBe(false);

      const replacement = await resourceGetByPath(SHARED_OWNER, path);
      await expect(resourceDeleteIfCurrent(replacement!)).resolves.toBe(true);
      await resourcePut(SHARED_OWNER, path, "new owner");
      await expect(
        resourceRestoreSnapshotIfCurrent(before, null),
      ).resolves.toBe(false);
    } finally {
      await resourceDeleteByPath(SHARED_OWNER, path);
    }
  });

  it("rolls back the first write when a snapshot pair conflicts", async () => {
    const {
      SHARED_OWNER,
      resourceDeleteByPath,
      resourceGetByPath,
      resourcePut,
      resourcePutSnapshotPairIfCurrent,
    } = await import("./store.js");
    const suffix = `${Date.now()}-${Math.random()}`;
    const bodyPath = `context/snapshot-pair-body-${suffix}.md`;
    const indexPath = `context/snapshot-pair-index-${suffix}.md`;

    try {
      const previousBody = await resourcePut(
        SHARED_OWNER,
        bodyPath,
        "body before",
      );
      const previousIndex = await resourcePut(
        SHARED_OWNER,
        indexPath,
        "index before",
      );
      await resourcePut(SHARED_OWNER, indexPath, "concurrent index");

      await expect(
        resourcePutSnapshotPairIfCurrent([
          {
            owner: SHARED_OWNER,
            path: bodyPath,
            content: "body after",
            previous: previousBody,
          },
          {
            owner: SHARED_OWNER,
            path: indexPath,
            content: "index after",
            previous: previousIndex,
          },
        ]),
      ).resolves.toBeNull();

      await expect(
        resourceGetByPath(SHARED_OWNER, bodyPath),
      ).resolves.toMatchObject({
        content: "body before",
      });
      await expect(
        resourceGetByPath(SHARED_OWNER, indexPath),
      ).resolves.toMatchObject({
        content: "concurrent index",
      });
    } finally {
      await resourceDeleteByPath(SHARED_OWNER, bodyPath);
      await resourceDeleteByPath(SHARED_OWNER, indexPath);
    }
  });

  it("rolls back every snapshot in a batch when a later write conflicts", async () => {
    const {
      SHARED_OWNER,
      resourceDeleteByPath,
      resourceGetByPath,
      resourcePut,
      resourcePutSnapshotBatchIfCurrent,
    } = await import("./store.js");
    const suffix = `${Date.now()}-${Math.random()}`;
    const firstPath = `context/snapshot-batch-first-${suffix}.md`;
    const secondPath = `context/snapshot-batch-second-${suffix}.md`;
    const indexPath = `context/snapshot-batch-index-${suffix}.md`;

    try {
      const previousFirst = await resourcePut(
        SHARED_OWNER,
        firstPath,
        "first before",
      );
      const previousSecond = await resourcePut(
        SHARED_OWNER,
        secondPath,
        "second before",
      );
      const previousIndex = await resourcePut(
        SHARED_OWNER,
        indexPath,
        "index before",
      );
      await resourcePut(SHARED_OWNER, indexPath, "concurrent index");

      await expect(
        resourcePutSnapshotBatchIfCurrent([
          {
            owner: SHARED_OWNER,
            path: firstPath,
            content: "first after",
            previous: previousFirst,
          },
          {
            owner: SHARED_OWNER,
            path: secondPath,
            content: "second after",
            previous: previousSecond,
          },
          {
            owner: SHARED_OWNER,
            path: indexPath,
            content: "index after",
            previous: previousIndex,
          },
        ]),
      ).resolves.toBeNull();

      await expect(
        resourceGetByPath(SHARED_OWNER, firstPath),
      ).resolves.toMatchObject({ content: "first before" });
      await expect(
        resourceGetByPath(SHARED_OWNER, secondPath),
      ).resolves.toMatchObject({ content: "second before" });
      await expect(
        resourceGetByPath(SHARED_OWNER, indexPath),
      ).resolves.toMatchObject({ content: "concurrent index" });
    } finally {
      await resourceDeleteByPath(SHARED_OWNER, firstPath);
      await resourceDeleteByPath(SHARED_OWNER, secondPath);
      await resourceDeleteByPath(SHARED_OWNER, indexPath);
    }
  });

  it("rolls back guard writes when a snapshot pair pre-write guard fails", async () => {
    const {
      SHARED_OWNER,
      resourceDeleteByPath,
      resourceGetByPath,
      resourcePut,
      resourcePutSnapshotPairIfCurrent,
    } = await import("./store.js");
    const suffix = `${Date.now()}-${Math.random()}`;
    const bodyPath = `context/snapshot-pair-guard-body-${suffix}.md`;
    const indexPath = `context/snapshot-pair-guard-index-${suffix}.md`;
    const guardError = new Error("capture lease expired");

    try {
      const previousBody = await resourcePut(
        SHARED_OWNER,
        bodyPath,
        "body before",
      );
      const previousIndex = await resourcePut(
        SHARED_OWNER,
        indexPath,
        "index before",
      );

      await expect(
        resourcePutSnapshotPairIfCurrent(
          [
            {
              owner: SHARED_OWNER,
              path: bodyPath,
              content: "body after",
              previous: previousBody,
            },
            {
              owner: SHARED_OWNER,
              path: indexPath,
              content: "index after",
              previous: previousIndex,
            },
          ],
          {
            beforeWrite: async (tx) => {
              await tx.execute({
                sql: "UPDATE resources SET content = ? WHERE id = ?",
                args: ["guard side effect", previousBody.id],
              });
              throw guardError;
            },
          },
        ),
      ).rejects.toBe(guardError);

      await expect(
        resourceGetByPath(SHARED_OWNER, bodyPath),
      ).resolves.toMatchObject({ content: "body before" });
      await expect(
        resourceGetByPath(SHARED_OWNER, indexPath),
      ).resolves.toMatchObject({ content: "index before" });
    } finally {
      await resourceDeleteByPath(SHARED_OWNER, bodyPath);
      await resourceDeleteByPath(SHARED_OWNER, indexPath);
    }
  });

  it("commits both inserts in a snapshot pair together", async () => {
    const {
      SHARED_OWNER,
      resourceDeleteByPath,
      resourceGetByPath,
      resourcePutSnapshotPairIfCurrent,
    } = await import("./store.js");
    const suffix = `${Date.now()}-${Math.random()}`;
    const bodyPath = `context/snapshot-pair-body-${suffix}.md`;
    const indexPath = `context/snapshot-pair-index-${suffix}.md`;

    try {
      const written = await resourcePutSnapshotPairIfCurrent([
        {
          owner: SHARED_OWNER,
          path: bodyPath,
          content: "body saved",
          previous: null,
        },
        {
          owner: SHARED_OWNER,
          path: indexPath,
          content: "index saved",
          previous: null,
        },
      ]);

      expect(written?.map(({ resource }) => resource.content)).toEqual([
        "body saved",
        "index saved",
      ]);
      await expect(
        resourceGetByPath(SHARED_OWNER, bodyPath),
      ).resolves.toMatchObject({
        content: "body saved",
      });
      await expect(
        resourceGetByPath(SHARED_OWNER, indexPath),
      ).resolves.toMatchObject({
        content: "index saved",
      });
    } finally {
      await resourceDeleteByPath(SHARED_OWNER, bodyPath);
      await resourceDeleteByPath(SHARED_OWNER, indexPath);
    }
  });

  it("does not delete a replacement during conditional legacy cleanup", async () => {
    const {
      SHARED_OWNER,
      resourceDeleteByPath,
      resourceDeleteIfCurrent,
      resourceGetByPath,
      resourcePut,
    } = await import("./store.js");
    const path = `context/conditional-delete-${Date.now()}-${Math.random()}.md`;
    const legacyMetadata = {
      source: "workspace-files",
      scope: "org",
      scopeId: "org-a",
    };

    try {
      const legacy = await resourcePut(
        SHARED_OWNER,
        path,
        "legacy",
        undefined,
        {
          metadata: legacyMetadata,
        },
      );
      await resourcePut(SHARED_OWNER, path, "global default", undefined, {
        metadata: { source: "global" },
      });

      await expect(resourceDeleteIfCurrent(legacy)).resolves.toBe(false);
      await expect(
        resourceGetByPath(SHARED_OWNER, path),
      ).resolves.toMatchObject({
        content: "global default",
      });
    } finally {
      await resourceDeleteByPath(SHARED_OWNER, path);
    }
  });

  it("conditionally deletes a resource without metadata", async () => {
    const {
      SHARED_OWNER,
      resourceDeleteByPath,
      resourceDeleteIfCurrent,
      resourceGetByPath,
      resourcePut,
    } = await import("./store.js");
    const path = `context/conditional-null-metadata-${Date.now()}-${Math.random()}.md`;

    try {
      const resource = await resourcePut(SHARED_OWNER, path, "content");

      await expect(resourceDeleteIfCurrent(resource)).resolves.toBe(true);
      await expect(resourceGetByPath(SHARED_OWNER, path)).resolves.toBeNull();
    } finally {
      await resourceDeleteByPath(SHARED_OWNER, path);
    }
  });

  it("does not delete a same-timestamp MIME or visibility mutation", async () => {
    const {
      SHARED_OWNER,
      resourceDeleteByPath,
      resourceDeleteIfCurrent,
      resourceGetByPath,
      resourcePut,
    } = await import("./store.js");
    const path = `context/conditional-fields-${Date.now()}-${Math.random()}.md`;

    try {
      const resource = await resourcePut(
        SHARED_OWNER,
        path,
        "content",
        "text/plain",
      );
      await pglite
        .prepare(
          "UPDATE resources SET mime_type = ?, visibility = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          "application/json",
          "agent_scratch",
          resource.updatedAt,
          resource.id,
        );

      await expect(resourceDeleteIfCurrent(resource)).resolves.toBe(false);
      await expect(
        resourceGetByPath(SHARED_OWNER, path),
      ).resolves.toMatchObject({
        mimeType: "application/json",
        visibility: "agent_scratch",
      });
    } finally {
      await resourceDeleteByPath(SHARED_OWNER, path);
    }
  });
});
