import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ownerEmail = "owner+resource-lifecycle@example.test";
const approverEmail = "approver+resource-lifecycle@example.test";
const userEmail = "person+resource-lifecycle@example.test";
const orgId = "org_resource_lifecycle";
const resourcePath = "context/lifecycle-smoke.md";

const originalEnv = {
  AGENT_NATIVE_MANIFEST: process.env.AGENT_NATIVE_MANIFEST,
  AGENT_NATIVE_MANIFEST_PATH: process.env.AGENT_NATIVE_MANIFEST_PATH,
  APP_NAME: process.env.APP_NAME,
  DATABASE_URL: process.env.DATABASE_URL,
  DISPATCH_DATABASE_URL: process.env.DISPATCH_DATABASE_URL,
};

let tempDir: string | null = null;

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dispatch-resource-lifecycle-"),
  );
  process.env.DATABASE_URL = `pglite:${tempDir}`;
  delete process.env.APP_NAME;
  delete process.env.DISPATCH_DATABASE_URL;
  vi.resetModules();

  const [{ runMigrations }, { dispatchMigrations }] = await Promise.all([
    import("@agent-native/core/db"),
    import("../../db/migrations.js"),
  ]);
  await runMigrations(dispatchMigrations, {
    table: "dispatch_migrations",
  })({});
  await (await import("@agent-native/core/db")).closeDbExec();
});

afterEach(async () => {
  try {
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
  } catch {}
  restoreEnv();
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("workspace resource approval lifecycle", () => {
  it("queues, approves, materializes, and explains inherited All-app context", async () => {
    const [
      { getDbExec },
      { runWithRequestContext },
      {
        resourceGetByPath,
        resourcePut,
        SHARED_OWNER,
        WORKSPACE_OWNER,
        workspaceResourceOwner,
      },
      { putOrgSetting },
      {
        approveRequest,
        createWorkspaceResource,
        getWorkspaceResourceEffectiveContext,
        listWorkspaceResourcesForApp,
      },
    ] = await Promise.all([
      import("@agent-native/core/db"),
      import("@agent-native/core/server"),
      import("@agent-native/core/resources/store"),
      import("@agent-native/core/settings"),
      import("./workspace-resources-store.js").then(async (resourcesStore) => {
        const dispatchStore = await import("./dispatch-store.js");
        return {
          approveRequest: dispatchStore.approveRequest,
          createWorkspaceResource: resourcesStore.createWorkspaceResource,
          getWorkspaceResourceEffectiveContext:
            resourcesStore.getWorkspaceResourceEffectiveContext,
          listWorkspaceResourcesForApp:
            resourcesStore.listWorkspaceResourcesForApp,
        };
      }),
    ]);

    const exec = getDbExec();

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await putOrgSetting(orgId, "dispatch-approval-policy", {
        enabled: true,
        approverEmails: [approverEmail],
      });

      const queued = await createWorkspaceResource({
        kind: "knowledge",
        name: "Lifecycle Smoke Context",
        description: "A smoke-test resource for global inheritance.",
        path: resourcePath,
        content: "# Workspace lifecycle context",
        scope: "all",
      });

      expect(queued).toEqual(
        expect.objectContaining({
          status: "pending",
          changeType: "workspace-resource.create",
          targetType: "workspace-knowledge",
        }),
      );

      const beforeRows = await exec.execute({
        sql: "SELECT * FROM workspace_resources WHERE path = ?",
        args: [resourcePath],
      });
      expect(beforeRows.rows).toHaveLength(0);
      await expect(
        resourceGetByPath(WORKSPACE_OWNER, resourcePath),
      ).resolves.toBeNull();

      await approveRequest((queued as any).id);

      const approvalRows = await exec.execute({
        sql: "SELECT status, reviewed_by FROM dispatch_approval_requests WHERE id = ?",
        args: [(queued as any).id],
      });
      expect(approvalRows.rows[0]).toMatchObject({
        status: "approved",
        reviewed_by: ownerEmail,
      });

      const afterRows = await exec.execute({
        sql: "SELECT path, scope, content FROM workspace_resources WHERE path = ?",
        args: [resourcePath],
      });
      expect(afterRows.rows).toEqual([
        expect.objectContaining({
          path: resourcePath,
          scope: "all",
          content: "# Workspace lifecycle context",
        }),
      ]);

      const materialized = await resourceGetByPath(
        WORKSPACE_OWNER,
        resourcePath,
      );
      expect(materialized).toEqual(
        expect.objectContaining({
          owner: workspaceResourceOwner(orgId),
          path: resourcePath,
          content: "# Workspace lifecycle context",
        }),
      );

      const appResources = await listWorkspaceResourcesForApp("analytics");
      expect(appResources.resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: resourcePath,
            source: "workspace",
            scope: "all",
            grantId: null,
          }),
        ]),
      );

      const inherited = await getWorkspaceResourceEffectiveContext({
        path: resourcePath,
        appId: "analytics",
        userEmail,
      });
      expect(inherited).toMatchObject({
        availability: "all-apps",
        availableToApp: true,
        effectiveScope: "workspace",
      });
      expect(inherited.layers.map((layer) => layer.scope)).toEqual([
        "workspace",
        "shared",
        "personal",
      ]);

      await resourcePut(SHARED_OWNER, resourcePath, "# Organization override");

      const sharedOverride = await getWorkspaceResourceEffectiveContext({
        path: resourcePath,
        appId: "analytics",
        userEmail,
      });
      expect(sharedOverride.effectiveScope).toBe("shared");
      expect(
        sharedOverride.layers.find((layer) => layer.scope === "workspace"),
      ).toMatchObject({ exists: true, overridden: true });
      expect(
        sharedOverride.layers.find((layer) => layer.scope === "shared"),
      ).toMatchObject({ exists: true, effective: true });

      await resourcePut(userEmail, resourcePath, "# Personal override");

      const personalOverride = await getWorkspaceResourceEffectiveContext({
        path: resourcePath,
        appId: "analytics",
        userEmail,
      });
      expect(personalOverride.effectiveScope).toBe("personal");
      expect(personalOverride.effectiveResource).toEqual(
        expect.objectContaining({
          owner: userEmail,
          path: resourcePath,
        }),
      );
      expect(
        personalOverride.layers.find((layer) => layer.scope === "shared"),
      ).toMatchObject({ exists: true, overridden: true });
      expect(
        personalOverride.layers.find((layer) => layer.scope === "personal"),
      ).toMatchObject({ exists: true, effective: true });
    });
  }, 60_000);

  it("removes an organization-tagged legacy bare copy when approval revokes All apps", async () => {
    const [
      { getDbExec },
      { runWithRequestContext },
      {
        resourceDeleteByPath,
        resourceGetByPath,
        resourcePut,
        SHARED_OWNER,
        WORKSPACE_OWNER,
        workspaceResourceOwner,
      },
      { putOrgSetting },
      {
        approveRequest,
        createWorkspaceResource,
        getWorkspaceResourceEffectiveContext,
        updateWorkspaceResource,
      },
    ] = await Promise.all([
      import("@agent-native/core/db"),
      import("@agent-native/core/server"),
      import("@agent-native/core/resources/store"),
      import("@agent-native/core/settings"),
      import("./workspace-resources-store.js").then(async (resourcesStore) => {
        const dispatchStore = await import("./dispatch-store.js");
        return {
          approveRequest: dispatchStore.approveRequest,
          createWorkspaceResource: resourcesStore.createWorkspaceResource,
          getWorkspaceResourceEffectiveContext:
            resourcesStore.getWorkspaceResourceEffectiveContext,
          updateWorkspaceResource: resourcesStore.updateWorkspaceResource,
        };
      }),
    ]);

    const exec = getDbExec();

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      await putOrgSetting(orgId, "dispatch-approval-policy", {
        enabled: true,
        approverEmails: [approverEmail],
      });

      const created = await createWorkspaceResource({
        kind: "knowledge",
        name: "Legacy cleanup context",
        path: resourcePath,
        content: "# Legacy cleanup context",
        scope: "all",
      });
      await approveRequest((created as any).id);

      const { rows } = await exec.execute({
        sql: "SELECT id, updated_at FROM workspace_resources WHERE path = ?",
        args: [resourcePath],
      });
      const resourceId = String(rows[0]?.id);
      const metadata = {
        source: "dispatch-workspace-resource",
        resourceId,
        updatedAt: Number(rows[0]?.updated_at),
      };

      await resourceDeleteByPath(workspaceResourceOwner(orgId), resourcePath);
      await resourcePut(
        WORKSPACE_OWNER,
        resourcePath,
        "# Legacy cleanup context",
        "text/markdown",
        { createdBy: "system", metadata },
      );
      await resourcePut(
        WORKSPACE_OWNER,
        `${resourcePath}.backup`,
        "# Same prefix must survive",
        "text/markdown",
        { createdBy: "system", metadata },
      );
      await resourcePut(
        SHARED_OWNER,
        resourcePath,
        "# Another Dispatch resource must survive",
        "text/markdown",
        {
          createdBy: "system",
          metadata: { ...metadata, resourceId: "other_dispatch_resource" },
        },
      );

      await expect(
        resourceGetByPath(WORKSPACE_OWNER, resourcePath, { orgId }),
      ).resolves.toMatchObject({ owner: WORKSPACE_OWNER });

      const revoke = await updateWorkspaceResource(resourceId, {
        scope: "selected",
      });
      await approveRequest((revoke as any).id);

      const materializedRows = await exec.execute({
        sql: "SELECT owner, path FROM resources WHERE path LIKE ? ORDER BY owner, path",
        args: [`${resourcePath}%`],
      });
      expect(materializedRows.rows).toEqual([
        { owner: SHARED_OWNER, path: resourcePath },
        { owner: WORKSPACE_OWNER, path: `${resourcePath}.backup` },
      ]);
      await expect(
        resourceGetByPath(WORKSPACE_OWNER, resourcePath, { orgId }),
      ).resolves.toBeNull();

      await expect(
        getWorkspaceResourceEffectiveContext({
          path: resourcePath,
          appId: "analytics",
          userEmail,
        }),
      ).resolves.toMatchObject({
        availability: "selected-not-granted",
        availableToApp: false,
        effectiveScope: "shared",
      });
    });
  }, 60_000);

  it("removes a local-file materialization when applying an All-app resource update to selected apps", async () => {
    const manifestPath = path.join(tempDir!, "agent-native.json");
    const localPath = "AGENTS.md";
    const previousContent = "# All-app local instructions";
    const nextContent = "# Selected-app instructions";
    const previousManifest = process.env.AGENT_NATIVE_MANIFEST;
    const previousManifestPath = process.env.AGENT_NATIVE_MANIFEST_PATH;

    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ mode: "local-files" }),
      "utf8",
    );
    process.env.AGENT_NATIVE_MANIFEST = manifestPath;
    delete process.env.AGENT_NATIVE_MANIFEST_PATH;

    try {
      const [
        { getDbExec },
        { runWithRequestContext },
        { resourceGetByPath, WORKSPACE_OWNER },
        { applyWorkspaceResourceUpdate, createWorkspaceResource },
      ] = await Promise.all([
        import("@agent-native/core/db"),
        import("@agent-native/core/server"),
        import("@agent-native/core/resources/store"),
        import("./workspace-resources-store.js"),
      ]);

      await runWithRequestContext(
        { userEmail: ownerEmail, orgId: null },
        async () => {
          const created = await createWorkspaceResource({
            kind: "instruction",
            name: "Local lifecycle instructions",
            path: localPath,
            content: previousContent,
            scope: "all",
          });
          const resourceId = (created as { id: string }).id;

          expect(fs.readFileSync(path.join(tempDir!, localPath), "utf8")).toBe(
            previousContent,
          );
          await expect(
            resourceGetByPath(WORKSPACE_OWNER, localPath, { orgId: null }),
          ).resolves.toMatchObject({
            owner: WORKSPACE_OWNER,
            content: previousContent,
          });

          await expect(
            applyWorkspaceResourceUpdate(resourceId, {
              scope: "selected",
              content: nextContent,
            }),
          ).resolves.toMatchObject({
            id: resourceId,
            scope: "selected",
            content: nextContent,
          });

          expect(fs.existsSync(path.join(tempDir!, localPath))).toBe(false);
          await expect(
            resourceGetByPath(WORKSPACE_OWNER, localPath, { orgId: null }),
          ).resolves.toBeNull();
          await expect(
            getDbExec().execute({
              sql: "SELECT id, scope, content FROM workspace_resources WHERE id = ?",
              args: [resourceId],
            }),
          ).resolves.toMatchObject({
            rows: [
              {
                id: resourceId,
                scope: "selected",
                content: nextContent,
              },
            ],
          });
        },
      );
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
    }
  }, 60_000);

  it("restores the All-app row when a matching materialization cannot be removed", async () => {
    const conflictPath = "context/materialization-rollback.md";
    const previousName = "All-app rollback instructions";
    const previousContent = "# All-app rollback instructions";
    const nextName = "Selected-app rollback instructions";
    const nextContent = "# Selected-app rollback instructions";
    const [
      { getDbExec },
      { runWithRequestContext },
      coreResources,
      { applyWorkspaceResourceUpdate, createWorkspaceResource },
    ] = await Promise.all([
      import("@agent-native/core/db"),
      import("@agent-native/core/server"),
      import("@agent-native/core/resources/store"),
      import("./workspace-resources-store.js"),
    ]);

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      const created = await createWorkspaceResource({
        kind: "instruction",
        name: previousName,
        path: conflictPath,
        content: previousContent,
        scope: "all",
      });
      const resourceId = (created as { id: string }).id;
      const deleteSpy = vi
        .spyOn(coreResources, "resourceDeleteIfCurrent")
        .mockResolvedValue(false);

      try {
        await expect(
          applyWorkspaceResourceUpdate(resourceId, {
            name: nextName,
            content: nextContent,
            scope: "selected",
          }),
        ).rejects.toThrow(
          `Workspace resource materialization changed concurrently: ${conflictPath}`,
        );
      } finally {
        deleteSpy.mockRestore();
      }

      await expect(
        getDbExec().execute({
          sql: "SELECT name, content, scope FROM workspace_resources WHERE id = ?",
          args: [resourceId],
        }),
      ).resolves.toMatchObject({
        rows: [
          {
            name: previousName,
            content: previousContent,
            scope: "all",
          },
        ],
      });
      await expect(
        coreResources.resourceGetByPath(
          coreResources.WORKSPACE_OWNER,
          conflictPath,
          { orgId },
        ),
      ).resolves.toMatchObject({
        owner: coreResources.workspaceResourceOwner(orgId),
        content: previousContent,
      });
      await expect(
        getDbExec().execute({
          sql: "SELECT action FROM dispatch_audit_events WHERE target_id = ? AND action = ?",
          args: [resourceId, "workspace.instruction.updated"],
        }),
      ).resolves.toMatchObject({ rows: [] });
    });
  }, 60_000);

  it("does not overwrite a newer row when materialization rollback loses its snapshot", async () => {
    const conflictPath = "context/materialization-rollback-concurrent.md";
    const previousContent = "# All-app concurrent rollback instructions";
    const concurrentName = "Concurrent selected instructions";
    const concurrentContent = "# Concurrent selected instructions";
    const [
      { getDbExec },
      { runWithRequestContext },
      coreResources,
      { applyWorkspaceResourceUpdate, createWorkspaceResource },
    ] = await Promise.all([
      import("@agent-native/core/db"),
      import("@agent-native/core/server"),
      import("@agent-native/core/resources/store"),
      import("./workspace-resources-store.js"),
    ]);

    await runWithRequestContext({ userEmail: ownerEmail, orgId }, async () => {
      const created = await createWorkspaceResource({
        kind: "instruction",
        name: "All-app concurrent rollback instructions",
        path: conflictPath,
        content: previousContent,
        scope: "all",
      });
      const resourceId = (created as { id: string }).id;
      let injected = false;
      const deleteSpy = vi
        .spyOn(coreResources, "resourceDeleteIfCurrent")
        .mockImplementation(async () => {
          if (!injected) {
            injected = true;
            await getDbExec().execute({
              sql: "UPDATE workspace_resources SET name = ?, content = ?, scope = ?, updated_at = ? WHERE id = ?",
              args: [
                concurrentName,
                concurrentContent,
                "selected",
                Date.now() + 10_000,
                resourceId,
              ],
            });
          }
          return false;
        });

      try {
        await expect(
          applyWorkspaceResourceUpdate(resourceId, {
            content: "# Attempted selected instructions",
            scope: "selected",
          }),
        ).rejects.toThrow(
          `Workspace resource materialization failed and could not be rolled back: ${conflictPath}`,
        );
      } finally {
        deleteSpy.mockRestore();
      }

      await expect(
        getDbExec().execute({
          sql: "SELECT name, content, scope FROM workspace_resources WHERE id = ?",
          args: [resourceId],
        }),
      ).resolves.toMatchObject({
        rows: [
          {
            name: concurrentName,
            content: concurrentContent,
            scope: "selected",
          },
        ],
      });
      await expect(
        getDbExec().execute({
          sql: "SELECT action FROM dispatch_audit_events WHERE target_id = ? AND action = ?",
          args: [resourceId, "workspace.instruction.updated"],
        }),
      ).resolves.toMatchObject({ rows: [] });
    });
  }, 60_000);
});
