import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { z } from "zod";

import { createTestPglite } from "../../a2a/test-pglite.js";
import { defineAction } from "../../action.js";
import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../../app-config/index.js";
import { withDbExec, type DbExec } from "../../db/client.js";
import { ownableColumns, table, text } from "../../db/schema.js";
import { runWithRequestContext } from "../../server/request-context.js";
import { assertAccess, ForbiddenError } from "../../sharing/access.js";
import { registerShareableResource } from "../../sharing/registry.js";
import { createSharesTable } from "../../sharing/schema.js";
import { defineAppRoles } from "../app-roles.js";
import { invalidateMemberOrgCaches } from "../request-org-cache.js";
import explainAccess from "./explain-access.js";

const owner = "owner+qa@example.com";
const member = "member+qa@example.com";
const orgId = "explain-access-org";
const forms = table("explain_forms", {
  id: text("id").primaryKey(),
  ...ownableColumns(),
});
const shares = createSharesTable("explain_form_shares");
const appAccess = defineAppRoles({
  appId: "forms",
  roles: ["editor", "reviewer"],
  permissions: { "forms.edit": ["editor"] },
});
const editForm = defineAction({
  description: "Exercise the resource policy used by form updates.",
  schema: z.object({ id: z.string() }),
  access: {
    scope: "resource",
    resource: { type: "explain-form", idFrom: "id", level: "editor" },
  },
  run: async ({ id }) => {
    await assertAccess("explain-form", id, "editor");
    return { editable: true };
  },
});

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let exec: DbExec;

function asMember<T>(email: string, fn: () => T | Promise<T>) {
  return runWithRequestContext({ userEmail: email, orgId }, async () =>
    withDbExec(exec, fn),
  );
}

function explain(
  email: string,
  resourceId?: string,
  permission?: string,
  appId = "forms",
  callerEmail = owner,
) {
  return asMember(callerEmail, () =>
    explainAccess.run(
      {
        appId,
        email,
        permission,
        ...(resourceId
          ? {
              resourceType: "explain-form",
              resourceId,
              resourceLevel: "editor" as const,
            }
          : {}),
      },
      { caller: "http", userEmail: callerEmail, orgId, appId: "forms" },
    ),
  );
}

beforeAll(async () => {
  pglite = await createTestPglite();
  exec = {
    execute: async (statement) => {
      const result = await pglite.query(
        typeof statement === "string" ? statement : statement.sql,
        typeof statement === "string" ? [] : statement.args,
      );
      return {
        rows: result.rows as Record<string, unknown>[],
        rowsAffected: result.affectedRows ?? 0,
      };
    },
  };
  await pglite.exec(`
    CREATE TABLE explain_forms (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, org_id TEXT, visibility TEXT NOT NULL);
    CREATE TABLE explain_form_shares (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL, role TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, notified_at TEXT);
    CREATE TABLE organizations (id TEXT PRIMARY KEY, identity_authority TEXT, identity_id TEXT);
    CREATE TABLE org_members (org_id TEXT, email TEXT, role TEXT, federation_removal_pending_at BIGINT);
    CREATE TABLE app_member_roles (org_id TEXT, app_id TEXT, email TEXT, role TEXT);
    CREATE TABLE app_permission_overrides (org_id TEXT, app_id TEXT, permission TEXT, roles_json TEXT);
    CREATE TABLE workspace_apps (id TEXT PRIMARY KEY, owner_email TEXT, org_id TEXT, visibility TEXT, org_enabled BOOLEAN);
    CREATE TABLE workspace_app_shares (resource_id TEXT, principal_type TEXT, principal_id TEXT);
  `);
  const db = drizzle(pglite.db);
  registerShareableResource({
    type: "explain-form",
    resourceTable: forms,
    sharesTable: shares,
    displayName: "QA Form",
    getDb: () => db,
  });
});

beforeEach(async () => {
  resetAppConfigForTests();
  defineAppConfig({ app: { id: "forms", packageName: "forms" } });
  await pglite.exec(`
    DELETE FROM workspace_app_shares;
    DELETE FROM workspace_apps;
    DELETE FROM app_permission_overrides;
    DELETE FROM app_member_roles;
    DELETE FROM org_members;
    DELETE FROM organizations;
    DELETE FROM explain_form_shares;
    DELETE FROM explain_forms;
  `);
  await pglite.query("INSERT INTO organizations (id) VALUES (?)", [orgId]);
  for (const [email, role] of [
    [owner, "owner"],
    [member, "member"],
  ]) {
    await pglite.query("INSERT INTO org_members VALUES (?, ?, ?, NULL)", [
      orgId,
      email,
      role,
    ]);
    await pglite.query(
      "INSERT INTO app_member_roles VALUES (?, 'forms', ?, 'editor')",
      [orgId, email],
    );
  }
  for (const id of ["private-form", "shared-form"]) {
    await pglite.query(
      "INSERT INTO explain_forms VALUES (?, ?, ?, 'private')",
      [id, owner, orgId],
    );
  }
  await pglite.query(
    "INSERT INTO explain_form_shares VALUES ('editor-share', 'shared-form', 'user', ?, 'editor', ?, 'qa', NULL)",
    [member, owner],
  );
});

afterEach(() => resetAppConfigForTests());
afterAll(async () => {
  await pglite.close();
});

describe("standalone explain-access agrees with enforcement without workspace registration", () => {
  it.each([
    [owner, "private-form", "owner"],
    [member, "shared-form", "editor"],
  ])("explains %s's access to %s as %s", async (email, id, role) => {
    await expect(
      asMember(email, () =>
        editForm.run(
          { id },
          { caller: "http", userEmail: email, orgId, appId: "forms" },
        ),
      ),
    ).resolves.toEqual({ editable: true });
    await expect(explain(email, id)).resolves.toMatchObject({
      allowed: true,
      resourceRole: role,
    });
    await expect(explain(email, id, "forms.edit")).resolves.toMatchObject({
      allowed: true,
      resourceRole: role,
      roles: ["editor"],
    });
    const registry = await pglite.query("SELECT id FROM workspace_apps");
    expect(registry.rows).toEqual([]);
  });

  it("reports missing resource access rather than missing app access", async () => {
    await expect(
      asMember(member, () =>
        editForm.run(
          { id: "private-form" },
          { caller: "http", userEmail: member, orgId, appId: "forms" },
        ),
      ),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      explain(member, "private-form", "forms.edit"),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "Requires editor access to explain-form private-form.",
      resourceRole: null,
    });
  });

  it("lets a non-admin explain their own editor share", async () => {
    await expect(
      explain(member, "shared-form", "forms.edit", "forms", member),
    ).resolves.toMatchObject({ allowed: true, resourceRole: "editor" });
  });

  it("does not infer an app permission from a resource share or org ownership", async () => {
    await pglite.query("DELETE FROM app_member_roles WHERE app_id = 'forms'");
    for (const email of [owner, member]) {
      await expect(
        asMember(email, () => appAccess.assertPermission(["forms.edit"])),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        explain(email, "shared-form", "forms.edit"),
      ).resolves.toMatchObject({
        allowed: false,
        roles: [],
        reason: "Requires the forms.edit permission in forms.",
      });
    }
  });

  it("checks the same assigned roles and permission overrides as the app guard", async () => {
    await expect(
      asMember(member, () => appAccess.assertPermission(["forms.edit"])),
    ).resolves.toBeUndefined();
    await expect(
      explain(member, undefined, "forms.edit"),
    ).resolves.toMatchObject({ allowed: true, roles: ["editor"] });
    await pglite.query(
      "INSERT INTO app_permission_overrides VALUES (?, 'forms', 'forms.edit', '[]')",
      [orgId],
    );
    await expect(
      asMember(member, () => appAccess.assertPermission(["forms.edit"])),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      explain(member, "shared-form", "forms.edit"),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "Requires the forms.edit permission in forms.",
    });
  });

  it("does not exempt a different app from workspace access", async () => {
    await expect(
      explain(member, undefined, undefined, "unregistered-app"),
    ).resolves.toMatchObject({
      allowed: false,
      reason:
        "The unregistered-app app is not available to this organization member.",
    });
  });
});

describe("workspace explain-access uses the deployed workspace identity", () => {
  beforeEach(async () => {
    defineAppConfig({
      app: {
        id: "forms",
        packageName: "forms",
        workspaceId: "workspace-forms",
      },
    });
    await pglite.query(
      "INSERT INTO workspace_apps VALUES ('workspace-forms', ?, ?, 'org', true)",
      [owner, orgId],
    );
  });

  it("allows a member with app availability, app permission, and an editor share", async () => {
    await expect(
      explain(member, "shared-form", "forms.edit"),
    ).resolves.toMatchObject({
      allowed: true,
      roles: ["editor"],
      resourceRole: "editor",
    });
  });

  it("still denies private resource access in an available workspace app", async () => {
    await expect(
      explain(member, "private-form", "forms.edit"),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "Requires editor access to explain-form private-form.",
    });
  });

  it("denies a disabled workspace app even for its owner or a shared editor", async () => {
    await pglite.query(
      "UPDATE workspace_apps SET org_enabled = false WHERE id = 'workspace-forms'",
    );
    // The set-workspace-app-access action invalidates after its own write;
    // this test writes the row directly, so it performs that invalidation.
    invalidateMemberOrgCaches();
    for (const email of [owner, member]) {
      await expect(
        explain(email, "shared-form", "forms.edit"),
      ).resolves.toMatchObject({
        allowed: false,
        reason: "The forms app is not available to this organization member.",
      });
    }
  });

  it("does not let a resource share bypass a private workspace app", async () => {
    await pglite.query(
      "UPDATE workspace_apps SET visibility = 'private' WHERE id = 'workspace-forms'",
    );
    invalidateMemberOrgCaches();
    await expect(
      explain(member, "shared-form", "forms.edit"),
    ).resolves.toMatchObject({ allowed: false, resourceRole: null });
    await pglite.query(
      "INSERT INTO workspace_app_shares VALUES ('workspace-forms', 'user', ?)",
      [member],
    );
    await expect(
      explain(member, "shared-form", "forms.edit"),
    ).resolves.toMatchObject({ allowed: true, resourceRole: "editor" });
  });
});
