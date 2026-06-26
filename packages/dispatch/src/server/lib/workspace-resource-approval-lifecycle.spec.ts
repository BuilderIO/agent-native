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
  APP_NAME: process.env.APP_NAME,
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
  DISPATCH_DATABASE_URL: process.env.DISPATCH_DATABASE_URL,
  DISPATCH_DATABASE_AUTH_TOKEN: process.env.DISPATCH_DATABASE_AUTH_TOKEN,
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
  process.env.DATABASE_URL = `file:${path.join(tempDir, "app.db")}`;
  delete process.env.APP_NAME;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.DISPATCH_DATABASE_URL;
  delete process.env.DISPATCH_DATABASE_AUTH_TOKEN;
  vi.resetModules();

  const [{ runMigrations }, { dispatchMigrations }] = await Promise.all([
    import("@agent-native/core/db"),
    import("../../db/migrations.js"),
  ]);
  await runMigrations(dispatchMigrations, {
    table: "dispatch_migrations",
  })({});
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
      { resourceGetByPath, resourcePut, SHARED_OWNER, WORKSPACE_OWNER },
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
          owner: WORKSPACE_OWNER,
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
  }, 30_000);
});
