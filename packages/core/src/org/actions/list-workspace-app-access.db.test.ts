import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";
import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../../app-config/index.js";
import { withDbExec, type DbExec } from "../../db/client.js";
import listWorkspaceAppAccess from "./list-workspace-app-access.js";

const orgId = "workspace-access-list-org";
const email = "owner@example.com";

let database: Awaited<ReturnType<typeof createTestPglite>>;
let dbExec: DbExec;

beforeAll(async () => {
  database = await createTestPglite();
  dbExec = {
    execute: async (statement) => {
      const result = await database.query(
        typeof statement === "string" ? statement : statement.sql,
        typeof statement === "string" ? [] : Array.from(statement.args ?? []),
      );
      return {
        rows: result.rows as Record<string, unknown>[],
        rowsAffected: result.affectedRows ?? 0,
      };
    },
  };
  await database.exec(`
    CREATE TABLE org_members (
      org_id TEXT, email TEXT, role TEXT,
      federation_removal_pending_at BIGINT
    );
    CREATE TABLE workspace_apps (
      id TEXT PRIMARY KEY, org_id TEXT, name TEXT, description TEXT,
      path TEXT, visibility TEXT, org_enabled BOOLEAN
    );
  `);
});

beforeEach(async () => {
  resetAppConfigForTests();
  await database.exec("DELETE FROM workspace_apps; DELETE FROM org_members;");
  await database.query(
    "INSERT INTO org_members (org_id, email, role) VALUES (?, ?, 'owner')",
    [orgId, email],
  );
  await database.query(
    `INSERT INTO workspace_apps
     (id, org_id, name, path, visibility, org_enabled)
     VALUES ('chat', ?, 'Chat', '/chat', 'private', true),
            ('programs', ?, 'Programs', '/programs', 'org', true)`,
    [orgId, orgId],
  );
});

afterEach(() => resetAppConfigForTests());
afterAll(async () => database.close());

async function listApps(appsJson?: string) {
  defineAppConfig({
    app: { id: "dispatch", packageName: "dispatch" },
    ...(appsJson === undefined ? {} : { workspace: { appsJson } }),
  });
  return withDbExec(dbExec, () =>
    listWorkspaceAppAccess.run(
      {},
      { caller: "http", userEmail: email, orgId, appId: "dispatch" },
    ),
  );
}

describe("list-workspace-app-access", () => {
  it("hides retired apps from the active manifest without deleting rows", async () => {
    const result = await listApps(
      JSON.stringify([{ id: "programs", path: "/programs" }]),
    );
    expect(result.apps).toEqual([
      {
        id: "programs",
        name: "Programs",
        description: null,
        path: "/programs",
        mode: "all",
      },
    ]);
    const persisted = await database.query(
      "SELECT id FROM workspace_apps ORDER BY id",
    );
    expect(persisted.rows).toEqual([{ id: "chat" }, { id: "programs" }]);
  });

  it("preserves the full list without a workspace manifest", async () => {
    const result = await listApps();
    expect(result.apps.map((app) => app.id)).toEqual(["chat", "programs"]);
  });
});
