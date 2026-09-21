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

  it("restores an overwritten primary materialization when legacy cleanup conflicts", async () => {
    const conflictPath = "context/materialization-forward-rollback.md";
    const previousContent = "# Original all-app materialization";
    const nextContent = "# Rejected all-app materialization";
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
        name: "Original all-app materialization",
        path: conflictPath,
        content: previousContent,
        scope: "all",
      });
      const resourceId = (created as { id: string }).id;
      const primary = await coreResources.resourceGetByPath(
        coreResources.WORKSPACE_OWNER,
        conflictPath,
        { orgId },
      );
      expect(primary).toMatchObject({
        owner: coreResources.workspaceResourceOwner(orgId),
        content: previousContent,
      });
      await coreResources.resourcePut(
        coreResources.WORKSPACE_OWNER,
        conflictPath,
        previousContent,
        "text/markdown",
        { createdBy: "system", metadata: JSON.parse(primary!.metadata!) },
      );
      const deleteSpy = vi
        .spyOn(coreResources, "resourceDeleteIfCurrent")
        .mockImplementation(async (candidate) => {
          if (candidate.owner === coreResources.WORKSPACE_OWNER) return false;
          return false;
        });

      try {
        await expect(
          applyWorkspaceResourceUpdate(resourceId, { content: nextContent }),
        ).rejects.toThrow(
          `Workspace resource materialization changed concurrently: ${conflictPath}`,
        );
      } finally {
        deleteSpy.mockRestore();
      }

      await expect(
        coreResources.resourceGetByPath(
          coreResources.WORKSPACE_OWNER,
          conflictPath,
          { orgId },
        ),
      ).resolves.toMatchObject({
        id: primary!.id,
        owner: primary!.owner,
        path: conflictPath,
        content: previousContent,
        mimeType: primary!.mimeType,
        metadata: primary!.metadata,
      });
      await expect(
        getDbExec().execute({
          sql: "SELECT content, scope FROM workspace_resources WHERE id = ?",
          args: [resourceId],
        }),
      ).resolves.toMatchObject({
        rows: [{ content: previousContent, scope: "all" }],
      });
    });
  }, 60_000);

  it("restores an earlier deleted materialization when a later legacy cleanup conflicts", async () => {
    const conflictPath = "context/materialization-partial-rollback.md";
    const previousContent = "# Original selected rollback materialization";
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
        name: "Original selected rollback materialization",
        path: conflictPath,
        content: previousContent,
        scope: "all",
      });
      const resourceId = (created as { id: string }).id;
      const primary = await coreResources.resourceGetByPath(
        coreResources.WORKSPACE_OWNER,
        conflictPath,
        { orgId },
      );
      expect(primary).toMatchObject({
        owner: coreResources.workspaceResourceOwner(orgId),
        content: previousContent,
      });
      await coreResources.resourcePut(
        coreResources.WORKSPACE_OWNER,
        conflictPath,
        previousContent,
        "text/markdown",
        { createdBy: "system", metadata: JSON.parse(primary!.metadata!) },
      );

      const deleteIfCurrent = coreResources.resourceDeleteIfCurrent;
      const deleteSpy = vi
        .spyOn(coreResources, "resourceDeleteIfCurrent")
        .mockImplementation(async (candidate) => {
          if (candidate.owner === coreResources.WORKSPACE_OWNER) return false;
          return deleteIfCurrent(candidate);
        });

      try {
        await expect(
          applyWorkspaceResourceUpdate(resourceId, { scope: "selected" }),
        ).rejects.toThrow(
          `Workspace resource materialization changed concurrently: ${conflictPath}`,
        );
      } finally {
        deleteSpy.mockRestore();
      }

      await expect(
        coreResources.resourceGetByPath(
          coreResources.WORKSPACE_OWNER,
          conflictPath,
          { orgId },
        ),
      ).resolves.toMatchObject({
        id: primary!.id,
        owner: primary!.owner,
        path: conflictPath,
        content: previousContent,
        metadata: primary!.metadata,
      });
      await expect(
        getDbExec().execute({
          sql: "SELECT content, scope FROM workspace_resources WHERE id = ?",
          args: [resourceId],
        }),
      ).resolves.toMatchObject({
        rows: [{ content: previousContent, scope: "all" }],
      });
    });
  }, 60_000);

  it("updates and restores the bare SQL materialization for no-org All-app resources", async () => {
    const conflictPath = "context/no-org-sql-materialization.md";
    const initialContent = "# Initial no-org materialization";
    const updatedContent = "# Updated no-org materialization";
    const rejectedContent = "# Rejected no-org materialization";
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

    await runWithRequestContext(
      { userEmail: ownerEmail, orgId: null },
      async () => {
        const created = await createWorkspaceResource({
          kind: "instruction",
          name: "No-org SQL materialization",
          path: conflictPath,
          content: initialContent,
          scope: "all",
        });
        const resourceId = (created as { id: string }).id;
        const initial = await coreResources.resourceGetByPath(
          coreResources.WORKSPACE_OWNER,
          conflictPath,
          { orgId: null },
        );
        expect(initial).toMatchObject({
          owner: coreResources.WORKSPACE_OWNER,
          content: initialContent,
        });

        await expect(
          applyWorkspaceResourceUpdate(resourceId, { content: updatedContent }),
        ).resolves.toMatchObject({ content: updatedContent, scope: "all" });
        const updated = await coreResources.resourceGetByPath(
          coreResources.WORKSPACE_OWNER,
          conflictPath,
          { orgId: null },
        );
        expect(updated).toMatchObject({
          id: initial!.id,
          owner: coreResources.WORKSPACE_OWNER,
          content: updatedContent,
        });

        await coreResources.resourcePut(
          coreResources.SHARED_OWNER,
          conflictPath,
          updatedContent,
          "text/markdown",
          { createdBy: "system", metadata: JSON.parse(updated!.metadata!) },
        );
        const deleteIfCurrent = coreResources.resourceDeleteIfCurrent;
        const deleteSpy = vi
          .spyOn(coreResources, "resourceDeleteIfCurrent")
          .mockImplementation(async (candidate) => {
            if (candidate.owner === coreResources.SHARED_OWNER) return false;
            return deleteIfCurrent(candidate);
          });

        try {
          await expect(
            applyWorkspaceResourceUpdate(resourceId, {
              content: rejectedContent,
            }),
          ).rejects.toThrow(
            `Workspace resource materialization changed concurrently: ${conflictPath}`,
          );
        } finally {
          deleteSpy.mockRestore();
        }

        await expect(
          coreResources.resourceGetByPath(
            coreResources.WORKSPACE_OWNER,
            conflictPath,
            { orgId: null },
          ),
        ).resolves.toMatchObject({
          id: updated!.id,
          owner: updated!.owner,
          content: updatedContent,
          metadata: updated!.metadata,
        });
        await expect(
          getDbExec().execute({
            sql: "SELECT content, scope FROM workspace_resources WHERE id = ?",
            args: [resourceId],
          }),
        ).resolves.toMatchObject({
          rows: [{ content: updatedContent, scope: "all" }],
        });
      },
    );
  }, 60_000);

  it("preserves a newer primary materialization when rollback loses its derived snapshot", async () => {
    const conflictPath = "context/materialization-derived-race.md";
    const previousContent = "# Original derived materialization";
    const attemptedContent = "# Attempted derived materialization";
    const concurrentContent = "# Newer derived materialization";
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
        name: "Original derived materialization",
        path: conflictPath,
        content: previousContent,
        scope: "all",
      });
      const resourceId = (created as { id: string }).id;
      const primary = await coreResources.resourceGetByPath(
        coreResources.WORKSPACE_OWNER,
        conflictPath,
        { orgId },
      );
      expect(primary).toMatchObject({
        owner: coreResources.workspaceResourceOwner(orgId),
        content: previousContent,
      });
      await coreResources.resourcePut(
        coreResources.WORKSPACE_OWNER,
        conflictPath,
        previousContent,
        "text/markdown",
        { createdBy: "system", metadata: JSON.parse(primary!.metadata!) },
      );

      const concurrentMetadata = {
        source: "dispatch-workspace-resource",
        resourceId: "newer-dispatch-resource",
        updatedAt: Date.now() + 10_000,
      };
      const deleteIfCurrent = coreResources.resourceDeleteIfCurrent;
      const deleteSpy = vi
        .spyOn(coreResources, "resourceDeleteIfCurrent")
        .mockImplementation(async (candidate) => {
          if (candidate.owner !== coreResources.WORKSPACE_OWNER) {
            return deleteIfCurrent(candidate);
          }
          await coreResources.resourcePut(
            primary!.owner,
            conflictPath,
            concurrentContent,
            "text/markdown",
            { createdBy: "system", metadata: concurrentMetadata },
          );
          return false;
        });

      try {
        await expect(
          applyWorkspaceResourceUpdate(resourceId, {
            content: attemptedContent,
          }),
        ).rejects.toThrow(
          `Workspace resource materialization failed and could not be rolled back`,
        );
      } finally {
        deleteSpy.mockRestore();
      }

      await expect(
        coreResources.resourceGetByPath(
          coreResources.WORKSPACE_OWNER,
          conflictPath,
          { orgId },
        ),
      ).resolves.toMatchObject({
        owner: primary!.owner,
        content: concurrentContent,
        metadata: JSON.stringify(concurrentMetadata),
      });
      await expect(
        getDbExec().execute({
          sql: "SELECT content, scope FROM workspace_resources WHERE id = ?",
          args: [resourceId],
        }),
      ).resolves.toMatchObject({
        rows: [{ content: previousContent, scope: "all" }],
      });
    });
  }, 60_000);

  it("continues compensating earlier materializations after one undo restore fails", async () => {
    const conflictPath = "context/materialization-undo-continues.md";
    const previousContent = "# Original multi-owner materialization";
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
        name: "Original multi-owner materialization",
        path: conflictPath,
        content: previousContent,
        scope: "all",
      });
      const resourceId = (created as { id: string }).id;
      const primary = await coreResources.resourceGetByPath(
        coreResources.WORKSPACE_OWNER,
        conflictPath,
        { orgId },
      );
      expect(primary).toMatchObject({
        owner: coreResources.workspaceResourceOwner(orgId),
        content: previousContent,
      });
      const metadata = JSON.parse(primary!.metadata!);
      await Promise.all([
        coreResources.resourcePut(
          coreResources.WORKSPACE_OWNER,
          conflictPath,
          previousContent,
          "text/markdown",
          { createdBy: "system", metadata },
        ),
        coreResources.resourcePut(
          coreResources.SHARED_OWNER,
          conflictPath,
          previousContent,
          "text/markdown",
          { createdBy: "system", metadata },
        ),
      ]);

      const deleteIfCurrent = coreResources.resourceDeleteIfCurrent;
      const restoreSnapshot = coreResources.resourceRestoreSnapshotIfCurrent;
      const deleteSpy = vi
        .spyOn(coreResources, "resourceDeleteIfCurrent")
        .mockImplementation(async (candidate) => {
          if (candidate.owner === coreResources.SHARED_OWNER) return false;
          return deleteIfCurrent(candidate);
        });
      const restoreSpy = vi
        .spyOn(coreResources, "resourceRestoreSnapshotIfCurrent")
        .mockImplementation(async (snapshot, current) => {
          if (snapshot.owner === coreResources.WORKSPACE_OWNER) {
            throw new Error("Injected bare undo failure");
          }
          return restoreSnapshot(snapshot, current);
        });

      try {
        await expect(
          applyWorkspaceResourceUpdate(resourceId, { scope: "selected" }),
        ).rejects.toThrow(
          "Workspace resource materialization failed and could not be rolled back",
        );
      } finally {
        restoreSpy.mockRestore();
        deleteSpy.mockRestore();
      }

      await expect(
        coreResources.resourceGetByPath(
          coreResources.WORKSPACE_OWNER,
          conflictPath,
          { orgId },
        ),
      ).resolves.toMatchObject({
        id: primary!.id,
        owner: primary!.owner,
        content: previousContent,
        metadata: primary!.metadata,
      });
      await expect(
        coreResources.resourceListAllOwners(conflictPath, {
          includeShadowedWorkspaceRows: true,
        }),
      ).resolves.toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({
            owner: coreResources.WORKSPACE_OWNER,
            path: conflictPath,
          }),
        ]),
      );
      await expect(
        getDbExec().execute({
          sql: "SELECT content, scope FROM workspace_resources WHERE id = ?",
          args: [resourceId],
        }),
      ).resolves.toMatchObject({
        rows: [{ content: previousContent, scope: "all" }],
      });
    });
  }, 60_000);

  it("restores local and hidden bare-SQL materializations after a later shared cleanup conflict", async () => {
    const manifestPath = path.join(tempDir!, "agent-native.json");
    const localPath = "AGENTS.md";
    const previousContent = "# Local All-app instructions";
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
        coreResources,
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
            name: "Local rollback instructions",
            path: localPath,
            content: previousContent,
            scope: "all",
          });
          const resourceId = (created as { id: string }).id;
          const local = await coreResources.resourceGetByPath(
            coreResources.WORKSPACE_OWNER,
            localPath,
            { orgId: null },
          );
          expect(local).toMatchObject({
            owner: coreResources.WORKSPACE_OWNER,
            content: previousContent,
          });

          const { rows } = await getDbExec().execute({
            sql: "SELECT updated_at FROM workspace_resources WHERE id = ?",
            args: [resourceId],
          });
          const metadata = {
            source: "dispatch-workspace-resource",
            resourceId,
            kind: "instruction",
            name: "Local rollback instructions",
            description: null,
            updatedAt: Number(rows[0]?.updated_at),
          };
          const hiddenBareId = `hidden-bare-${resourceId}`;
          const timestamp = Date.now();
          await getDbExec().execute({
            sql: "INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at, created_by, visibility, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            args: [
              hiddenBareId,
              localPath,
              coreResources.WORKSPACE_OWNER,
              previousContent,
              "text/markdown",
              Buffer.byteLength(previousContent, "utf8"),
              timestamp,
              timestamp,
              "system",
              "workspace",
              JSON.stringify(metadata),
            ],
          });
          await coreResources.resourcePut(
            coreResources.SHARED_OWNER,
            localPath,
            previousContent,
            "text/markdown",
            { createdBy: "system", metadata },
          );

          const deleteIfCurrent = coreResources.resourceDeleteIfCurrent;
          let localDeleted = false;
          let bareDeleted = false;
          const deleteSpy = vi
            .spyOn(coreResources, "resourceDeleteIfCurrent")
            .mockImplementation(async (candidate) => {
              if (candidate.owner === coreResources.SHARED_OWNER) return false;
              const deleted = await deleteIfCurrent(candidate);
              if (candidate.id === local!.id) localDeleted = deleted;
              if (candidate.id === hiddenBareId) bareDeleted = deleted;
              return deleted;
            });

          try {
            await expect(
              applyWorkspaceResourceUpdate(resourceId, { scope: "selected" }),
            ).rejects.toThrow(
              `Workspace resource materialization changed concurrently: ${localPath}`,
            );
          } finally {
            deleteSpy.mockRestore();
          }

          expect(localDeleted).toBe(true);
          expect(bareDeleted).toBe(true);
          expect(fs.readFileSync(path.join(tempDir!, localPath), "utf8")).toBe(
            previousContent,
          );
          await expect(
            getDbExec().execute({
              sql: "SELECT id, content, metadata FROM resources WHERE id = ?",
              args: [hiddenBareId],
            }),
          ).resolves.toMatchObject({
            rows: [
              {
                id: hiddenBareId,
                content: previousContent,
                metadata: JSON.stringify(metadata),
              },
            ],
          });
          await expect(
            getDbExec().execute({
              sql: "SELECT content, scope FROM workspace_resources WHERE id = ?",
              args: [resourceId],
            }),
          ).resolves.toMatchObject({
            rows: [{ content: previousContent, scope: "all" }],
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
});
