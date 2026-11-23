import { createRequire } from "node:module";

import { checkActionProperties } from "@agent-native/core/action-properties";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import readAction from "./get-workspace-name";
import writeAction from "./set-workspace-name";
const { PGlite } = createRequire(import.meta.url)("@electric-sql/pglite");
const m = vi.hoisted(() => ({
  org: "workspace-a",
  email: "owner@example.test",
  execute: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@agent-native/core/db", async (original) => ({
  ...(await original<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({ execute: m.execute }),
}));
vi.mock("@agent-native/core/org", () => ({
  invalidateMemberOrgCaches: m.invalidate,
}));
vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getRequestUserEmail: () => m.email,
  }),
);
vi.mock("./_semantic-helpers.js", () => ({
  requireSemanticOrg: async () => m.org,
}));
import { readWorkspaceName, changeWorkspaceName } from "./_workspace-name";
let client: InstanceType<typeof PGlite>;
beforeEach(async () => {
  client = await PGlite.create("memory://");
  await client.exec(
    "CREATE TABLE organizations (id text primary key, name text); CREATE TABLE org_members (org_id text, email text, role text, federation_removal_pending_at bigint);",
  );
  await client.query(
    "INSERT INTO organizations VALUES ('workspace-a', 'Workspace A'), ('workspace-b', 'Workspace B')",
  );
  await client.query(
    "INSERT INTO org_members VALUES ('workspace-a','owner@example.test','owner',NULL), ('workspace-a','member@example.test','member',NULL), ('workspace-a','removed@example.test','admin',1), ('workspace-b','other@example.test','owner',NULL)",
  );
  m.org = "workspace-a";
  m.email = "owner@example.test";
  m.invalidate.mockClear();
  m.execute.mockImplementation(
    async ({ sql, args = [] }: { sql: string; args?: unknown[] }) => {
      let n = 0;
      const result = await client.query(
        sql.replace(/\?/g, () => `$${++n}`),
        args,
      );
      return { rows: result.rows };
    },
  );
});
afterEach(async () => client.close());
it("saves the active workspace and reads the durable name back, preserving its neighbor", async () => {
  expect(await readWorkspaceName()).toEqual({
    orgId: "workspace-a",
    name: "Workspace A",
    canEdit: true,
  });
  expect(await changeWorkspaceName("QA test workspace", "workspace-a")).toEqual(
    {
      name: "QA test workspace",
    },
  );
  expect(await readWorkspaceName()).toEqual({
    orgId: "workspace-a",
    name: "QA test workspace",
    canEdit: true,
  });
  expect(
    (
      await client.query(
        "SELECT name FROM organizations WHERE id = 'workspace-b'",
      )
    ).rows,
  ).toEqual([{ name: "Workspace B" }]);
  expect(m.invalidate).toHaveBeenCalledOnce();
});
it.each(["member@example.test", "other@example.test", "removed@example.test"])(
  "refuses renaming as %s with zero write",
  async (email) => {
    m.email = email;
    await expect(
      changeWorkspaceName("Unauthorized", "workspace-a"),
    ).rejects.toThrow("Only workspace owners and admins");
    expect(
      (
        await client.query(
          "SELECT name FROM organizations WHERE id = 'workspace-a'",
        )
      ).rows,
    ).toEqual([{ name: "Workspace A" }]);
    expect(m.invalidate).not.toHaveBeenCalled();
  },
);
it("members can read, but revoked or foreign membership cannot read", async () => {
  m.email = "member@example.test";
  expect(await readWorkspaceName()).toEqual({
    orgId: "workspace-a",
    name: "Workspace A",
    canEdit: false,
  });
  for (const email of ["other@example.test", "removed@example.test"]) {
    m.email = email;
    await expect(readWorkspaceName()).rejects.toThrow(
      "Workspace is unavailable",
    );
  }
});

it("checks generated action input and output contracts", async () => {
  await checkActionProperties(readAction, {
    context: { caller: "tool" },
    runs: 15,
    seed: 126,
  });
  await checkActionProperties(writeAction, {
    context: { caller: "tool" },
    runs: 15,
    seed: 127,
  });
});

it("refuses a stale workspace modal after switching organizations", async () => {
  await expect(
    changeWorkspaceName("Wrong target", "workspace-b"),
  ).rejects.toThrow("active workspace changed");
  expect(
    (
      await client.query(
        "SELECT name FROM organizations WHERE id = 'workspace-a'",
      )
    ).rows,
  ).toEqual([{ name: "Workspace A" }]);
});
