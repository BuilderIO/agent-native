import { PGlite } from "@electric-sql/pglite";
import type { PGlite as PGliteDatabase } from "@electric-sql/pglite";
import { pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { createApp } from "h3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

const {
  execute,
  getSession,
  getUserSetting,
  putUserSetting,
  validate,
  scopedDb,
} = vi.hoisted(() => ({
  execute: vi.fn(),
  getSession: vi.fn(),
  getUserSetting: vi.fn(),
  putUserSetting: vi.fn(),
  validate: vi.fn(),
  scopedDb: { current: null as PGliteDatabase | null },
}));

vi.mock(
  "@agent-native/core/server/request-context",
  async () => await import("./request-context.js"),
);

vi.mock("../db/client.js", async (original) => ({
  ...(await original<typeof import("../db/client.js")>()),
  getDbExec: () => ({ execute }),
}));
vi.mock("./auth.js", async (original) => ({
  ...(await original<typeof import("./auth.js")>()),
  getSession,
}));
vi.mock("../settings/user-settings.js", async (original) => ({
  ...(await original<typeof import("../settings/user-settings.js")>()),
  getUserSetting,
  putUserSetting,
}));
vi.mock("../org/federation.js", async (original) => ({
  ...(await original<typeof import("../org/federation.js")>()),
  validateFederatedOrganizationMembership: validate,
}));
vi.mock("../sharing/access-requests.js", () => ({
  resolveLinkStatus: vi.fn(async () => ({ status: "forbidden" })),
}));
vi.mock("../agent/loop-settings.js", async (original) => ({
  ...(await original<typeof import("../agent/loop-settings.js")>()),
  writeAgentLoopSettings: vi.fn(),
}));
vi.mock("./framework-request-handler.js", async (original) => ({
  ...(await original<typeof import("./framework-request-handler.js")>()),
  getH3App: (nitro: { app: ReturnType<typeof createApp> }) => nitro.app,
}));

import { defineAction } from "../action.js";
import { writeAgentLoopSettings } from "../agent/loop-settings.js";
import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import { getOrgContext } from "../org/context.js";
import {
  __resetProcessMemberOrgCacheForTests,
  invalidateActiveOrgSettingCache,
  invalidateMemberOrgCaches,
} from "../org/request-org-cache.js";
import getResourceAccessStatus from "../sharing/actions/get-resource-access-status.js";
import { mountActionRoutes } from "./action-routes.js";
import { autoMountAuth } from "./auth.js";
import { createCoreRoutesPlugin } from "./core-routes-plugin.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

beforeEach(() => {
  vi.clearAllMocks();
  __resetProcessMemberOrgCacheForTests();
  invalidateMemberOrgCaches();
  getSession.mockResolvedValue({ email: "fresh@example.test" });
  getUserSetting.mockResolvedValue(null);
  execute.mockResolvedValue({ rows: [] });
});
afterEach(() => {
  delete process.env.ORG_CREATION;
  delete process.env.AUTO_CREATE_DEFAULT_ORG;
  delete process.env.AUTH_BOOTSTRAP_ADMINS;
  resetAppConfigForTests();
});

const scopedRecords = pgTable("org_boundary_records", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
});

const saveRecord = defineAction({
  description: "Insert a record scoped to the request's owner and workspace.",
  schema: z.object({ label: z.string().min(1) }),
  run: async ({ label }) => {
    const database = scopedDb.current;
    if (!database) throw new Error("Scoped test database is not initialized");
    const db = drizzle(database);
    const [term] = await db
      .insert(scopedRecords)
      .values({
        id: crypto.randomUUID(),
        label,
        ownerEmail: getRequestUserEmail()!,
        orgId: getRequestOrgId() ?? null,
      })
      .returning();
    return { term };
  },
});

const readScope = defineAction({
  description: "Read the resolved workspace scope.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => ({ orgId: getRequestOrgId() ?? null }),
});

function actionApp(owner: string | null = "fresh@example.test") {
  const app = createApp();
  mountActionRoutes(
    { app },
    {
      "save-record": saveRecord,
      "read-scope": readScope,
      "get-resource-access-status": getResourceAccessStatus,
    },
    {
      getOwnerFromEvent: async () => owner,
      resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
    },
  );
  return app;
}

async function createScopedDatabase() {
  const database = new PGlite();
  scopedDb.current = database;
  await database.exec(
    `CREATE TABLE org_boundary_records (id text primary key, label text not null, owner_email text not null, org_id text)`,
  );
  return database;
}

async function save(app: ReturnType<typeof createApp>) {
  return app.fetch(
    new Request("http://example.test/_agent-native/actions/save-record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Quasar" }),
    }),
  );
}

it("rejects a revoked selected federation membership without falling back to another workspace", async () => {
  process.env.ORG_CREATION = "open";
  process.env.AUTO_CREATE_DEFAULT_ORG = "1";
  getUserSetting.mockResolvedValue({ orgId: "f" });
  let reads = 0;
  execute.mockImplementation(async ({ sql }: { sql: string }) => {
    if (sql.includes("FROM org_members m")) {
      reads++;
      return {
        rows:
          reads === 1
            ? []
            : [
                {
                  orgId: "f",
                  orgName: "Federated",
                  role: "owner",
                  identityAuthority: "https://identity.example.test",
                  identityId: "f",
                },
                { orgId: "a", orgName: "A", role: "member" },
              ],
      };
    }
    if (sql.includes("FROM org_members") && sql.includes("SELECT org_id"))
      return { rows: [{ org_id: "a" }] };
    return { rows: [] };
  });
  validate.mockResolvedValue({ active: false });
  const database = await createScopedDatabase();
  try {
    const response = await save(actionApp());
    expect(validate).toHaveBeenCalled();
    expect(
      (await database.query("SELECT * FROM org_boundary_records")).rows,
    ).toEqual([]);
    expect(response.status).toBe(403);
  } finally {
    await database.close();
  }
});

it("requires membership when creation is closed and auto-create is enabled", async () => {
  process.env.ORG_CREATION = "closed";
  process.env.AUTO_CREATE_DEFAULT_ORG = "1";
  const database = await createScopedDatabase();
  try {
    const response = await save(actionApp());
    expect(
      (await database.query("SELECT * FROM org_boundary_records")).rows,
    ).toEqual([]);
    expect(response.status).toBe(403);
  } finally {
    await database.close();
  }
});

it("does not save loop settings without a required workspace when bootstrap is disabled", async () => {
  process.env.ORG_CREATION = "closed";
  process.env.AUTO_CREATE_DEFAULT_ORG = "0";
  const app = createApp();
  await createCoreRoutesPlugin()({ app, h3: { "~middleware": [] } });
  const response = await app.fetch(
    new Request("http://example.test/_agent-native/agent-loop-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxIterations: 42 }),
    }),
  );
  expect(response.status).toBe(403);
  expect(writeAgentLoopSettings).not.toHaveBeenCalled();
});

it("saves loop settings in explicitly selected personal scope, not the session workspace", async () => {
  process.env.ORG_CREATION = "closed";
  process.env.AUTO_CREATE_DEFAULT_ORG = "0";
  getSession.mockResolvedValue({
    email: "fresh@example.test",
    orgId: "old-org",
  });
  getUserSetting.mockResolvedValue({ orgId: null });
  vi.mocked(writeAgentLoopSettings).mockResolvedValue({
    maxIterations: 42,
    defaultMaxIterations: 400,
    minMaxIterations: 1,
    maxMaxIterations: 1000,
    maxRunInputTokens: 20_000_000,
    defaultMaxRunInputTokens: 20_000_000,
    scope: "user",
    source: "user",
  });
  const app = createApp();
  await createCoreRoutesPlugin()({ app, h3: { "~middleware": [] } });
  const response = await app.fetch(
    new Request("http://example.test/_agent-native/agent-loop-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxIterations: 42 }),
    }),
  );
  expect(response.status).toBe(200);
  expect(writeAgentLoopSettings).toHaveBeenCalledWith(
    { userEmail: "fresh@example.test", orgId: null },
    42,
  );
});

async function bootstrapDatabase() {
  process.env.ORG_CREATION = "closed";
  process.env.AUTO_CREATE_DEFAULT_ORG = "0";
  process.env.AUTH_BOOTSTRAP_ADMINS = "fresh@example.test";
  getSession.mockResolvedValue({
    email: "fresh@example.test",
    emailVerified: true,
  });
  const database = await createScopedDatabase();
  await database.exec(`
    CREATE TABLE organizations (
      id text primary key, name text not null, created_by text, created_at bigint,
      a2a_secret text, allowed_domain text, identity_authority text, identity_id text
    );
    CREATE TABLE org_members (
      id text primary key, org_id text not null, email text not null, role text not null,
      joined_at bigint, federation_removal_pending_at bigint
    );
    CREATE UNIQUE INDEX org_members_identity ON org_members (org_id, lower(email));
    CREATE TABLE workspace_apps (id text primary key, owner_email text, org_id text, visibility text, org_enabled boolean);
    INSERT INTO workspace_apps VALUES ('analytics', '', NULL, 'org', true);
  `);
  let setting: Record<string, unknown> | null = null;
  getUserSetting.mockImplementation(async () => setting);
  putUserSetting.mockImplementation(async (_email, _key, value) => {
    setting = value;
    invalidateActiveOrgSettingCache();
  });
  execute.mockImplementation(
    async ({ sql, args }: { sql: string; args: unknown[] }) => {
      let parameter = 0;
      return database.query(
        sql.replace(/\?/g, () => `$${++parameter}`),
        args,
      );
    },
  );
  return database;
}

async function readScopeAction(app: ReturnType<typeof createApp>) {
  return app.fetch(
    new Request("http://example.test/_agent-native/actions/read-scope"),
  );
}

it("bootstraps a verified admin and permits scoped reads and writes", async () => {
  const database = await bootstrapDatabase();
  try {
    const app = actionApp();
    const read = await readScopeAction(app);
    expect(read.status).toBe(200);
    const orgs = (
      await database.query<{ id: string }>("SELECT id FROM organizations")
    ).rows;
    expect(orgs).toHaveLength(1);
    expect(await read.json()).toMatchObject({ orgId: orgs[0].id });
    const write = await save(app);
    expect(write.status).toBe(200);
    expect(
      (await database.query("SELECT label, org_id FROM org_boundary_records"))
        .rows,
    ).toEqual([{ label: "Quasar", org_id: orgs[0].id }]);
    expect(
      (await database.query("SELECT email, role, org_id FROM org_members"))
        .rows,
    ).toEqual([
      { email: "fresh@example.test", role: "owner", org_id: orgs[0].id },
    ]);
  } finally {
    await database.close();
  }
});

it.each(["private", "public"])(
  "does not restore a removed admin on a %s read",
  async (kind) => {
    const database = await bootstrapDatabase();
    try {
      await database.query(
        "INSERT INTO organizations (id, name) VALUES ('existing', 'Existing')",
      );
      await database.query(
        "INSERT INTO org_members (id, org_id, email, role) VALUES ('owner', 'existing', 'owner@example.test', 'owner')",
      );
      getUserSetting.mockResolvedValue({ orgId: "existing" });
      const before = (await database.query("SELECT * FROM org_members")).rows;
      const app = actionApp();
      if (kind === "private") {
        expect((await readScopeAction(app)).status).toBe(403);
      } else {
        const publicRead = await app.fetch(
          new Request(
            "http://example.test/_agent-native/actions/get-resource-access-status?resourceType=dashboard&resourceId=missing",
          ),
        );
        expect(publicRead.status).toBe(200);
        expect(await publicRead.json()).toEqual({ status: "forbidden" });
      }
      expect((await database.query("SELECT * FROM org_members")).rows).toEqual(
        before,
      );
      expect((await save(app)).status).toBe(403);
      expect(
        (await database.query("SELECT * FROM org_boundary_records")).rows,
      ).toEqual([]);
      expect((await database.query("SELECT * FROM org_members")).rows).toEqual(
        before,
      );
      expect(putUserSetting).not.toHaveBeenCalled();
    } finally {
      await database.close();
    }
  },
);

it("does not promote a pending-removal membership on a public read", async () => {
  const database = await bootstrapDatabase();
  try {
    await database.query(
      "INSERT INTO organizations (id, name) VALUES ('existing', 'Existing')",
    );
    await database.query(
      "INSERT INTO org_members (id, org_id, email, role, federation_removal_pending_at) VALUES ('pending', 'existing', 'fresh@example.test', 'member', 123)",
    );
    const before = (await database.query("SELECT * FROM org_members")).rows;
    const app = actionApp();
    const response = await app.fetch(
      new Request(
        "http://example.test/_agent-native/actions/get-resource-access-status?resourceType=dashboard&resourceId=missing",
      ),
    );
    expect(response.status).toBe(200);
    expect((await database.query("SELECT * FROM org_members")).rows).toEqual(
      before,
    );
    expect(putUserSetting).not.toHaveBeenCalled();
  } finally {
    await database.close();
  }
});

it("reports unavailable when the post-bootstrap membership read fails", async () => {
  const database = await bootstrapDatabase();
  try {
    await database.query(
      "INSERT INTO organizations (id, name) VALUES ('existing', 'Existing')",
    );
    const originalExecute = execute.getMockImplementation()!;
    let membershipReads = 0;
    execute.mockImplementation(async (query) => {
      if (query.sql.includes("FROM org_members m") && ++membershipReads === 2) {
        throw new Error("membership read failed");
      }
      return originalExecute(query);
    });
    expect((await readScopeAction(actionApp())).status).toBe(503);
    expect((await database.query("SELECT * FROM org_members")).rows).toEqual(
      [],
    );
  } finally {
    await database.close();
  }
});

it("does not bootstrap an anonymous public read", async () => {
  const database = await bootstrapDatabase();
  try {
    getSession.mockResolvedValue(null);
    const response = await actionApp(null).fetch(
      new Request(
        "http://example.test/_agent-native/actions/get-resource-access-status?resourceType=dashboard&resourceId=missing",
      ),
    );
    expect(response.status).toBe(200);
    expect((await database.query("SELECT * FROM organizations")).rows).toEqual(
      [],
    );
    expect((await database.query("SELECT * FROM org_members")).rows).toEqual(
      [],
    );
    expect(putUserSetting).not.toHaveBeenCalled();
  } finally {
    await database.close();
  }
});

it("bootstraps before workspace admission for a verified admin on an empty workspace", async () => {
  const database = await bootstrapDatabase();
  try {
    defineAppConfig({ app: { id: "analytics", workspaceId: "analytics" } });
    const app = createApp();
    await autoMountAuth(app, {
      getSession: async () => ({
        email: "fresh@example.test",
        emailVerified: true,
      }),
      trustCustomEmailVerification: true,
    });
    mountActionRoutes(
      { app },
      { "read-scope": readScope },
      {
        getOwnerFromEvent: async () => "fresh@example.test",
        resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
      },
    );
    const response = await readScopeAction(app);
    expect(response.status).toBe(200);
    const orgs = (
      await database.query<{ id: string }>("SELECT id FROM organizations")
    ).rows;
    expect(orgs).toHaveLength(1);
    expect(await response.json()).toEqual({ orgId: orgs[0].id });
    expect(
      (await database.query("SELECT email, role, org_id FROM org_members"))
        .rows,
    ).toEqual([
      { email: "fresh@example.test", role: "owner", org_id: orgs[0].id },
    ]);
  } finally {
    await database.close();
  }
});

it("still denies workspace admission when the app belongs to a different organization", async () => {
  const database = await bootstrapDatabase();
  try {
    defineAppConfig({ app: { id: "analytics", workspaceId: "analytics" } });
    await database.query(
      "UPDATE workspace_apps SET org_id = 'other' WHERE id = 'analytics'",
    );
    const app = createApp();
    await autoMountAuth(app, {
      getSession: async () => ({
        email: "fresh@example.test",
        emailVerified: true,
      }),
      trustCustomEmailVerification: true,
    });
    mountActionRoutes(
      { app },
      { "read-scope": readScope },
      {
        getOwnerFromEvent: async () => "fresh@example.test",
        resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
      },
    );
    expect((await readScopeAction(app)).status).toBe(403);
    expect((await database.query("SELECT role FROM org_members")).rows).toEqual(
      [{ role: "owner" }],
    );
    expect(
      (await database.query("SELECT org_id FROM workspace_apps")).rows,
    ).toEqual([{ org_id: "other" }]);
  } finally {
    await database.close();
  }
});

it.each([
  ["unverified", false, "fresh@example.test", false],
  ["non-admin", true, "other@example.test", false],
  ["existing organization", true, "fresh@example.test", true],
])(
  "does not bypass workspace admission for %s",
  async (_label, verified, admin, existing) => {
    const database = await bootstrapDatabase();
    try {
      defineAppConfig({ app: { id: "analytics", workspaceId: "analytics" } });
      process.env.AUTH_BOOTSTRAP_ADMINS = admin;
      if (existing)
        await database.query(
          "INSERT INTO organizations (id, name) VALUES ('existing', 'Existing')",
        );
      const before = (await database.query("SELECT * FROM organizations")).rows;
      const app = createApp();
      await autoMountAuth(app, {
        getSession: async () => ({
          email: "fresh@example.test",
          emailVerified: verified,
        }),
        trustCustomEmailVerification: true,
      });
      mountActionRoutes(
        { app },
        { "read-scope": readScope },
        {
          getOwnerFromEvent: async () => "fresh@example.test",
          resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
        },
      );
      expect((await readScopeAction(app)).status).toBe(403);
      expect(
        (await database.query("SELECT * FROM organizations")).rows,
      ).toEqual(before);
      expect((await database.query("SELECT * FROM org_members")).rows).toEqual(
        [],
      );
    } finally {
      await database.close();
    }
  },
);

it.each([
  ["unverified admin", false, "fresh@example.test", 0],
  ["non-admin", true, "someone-else@example.test", 0],
  ["ambiguous organizations", true, "fresh@example.test", 2],
])(
  "refuses %s without changing membership",
  async (_label, verified, admin, orgCount) => {
    const database = await bootstrapDatabase();
    try {
      getSession.mockResolvedValue({
        email: "fresh@example.test",
        emailVerified: verified,
      });
      process.env.AUTH_BOOTSTRAP_ADMINS = admin;
      for (let i = 0; i < orgCount; i++) {
        await database.query(
          "INSERT INTO organizations (id, name) VALUES ($1, $2)",
          [`org-${i}`, `Org ${i}`],
        );
      }
      const app = actionApp();
      expect((await readScopeAction(app)).status).toBe(403);
      expect((await save(app)).status).toBe(403);
      expect((await database.query("SELECT * FROM org_members")).rows).toEqual(
        [],
      );
      expect(
        (await database.query("SELECT * FROM organizations")).rows,
      ).toHaveLength(orgCount);
    } finally {
      await database.close();
    }
  },
);

it("keeps an explicit personal selection without bootstrapping", async () => {
  const database = await bootstrapDatabase();
  try {
    getUserSetting.mockResolvedValue({ orgId: null });
    const response = await readScopeAction(actionApp());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orgId: null });
    expect((await database.query("SELECT * FROM organizations")).rows).toEqual(
      [],
    );
    expect(putUserSetting).not.toHaveBeenCalled();
  } finally {
    await database.close();
  }
});

it("bootstraps one organization for concurrent requests", async () => {
  const database = await bootstrapDatabase();
  try {
    const originalExecute = execute.getMockImplementation()!;
    function twoRequests() {
      let arrivals = 0;
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      return async () => {
        if (arrivals >= 2) return;
        if (++arrivals === 2) release();
        await barrier;
      };
    }
    const membershipBarrier = twoRequests();
    const organizationBarrier = twoRequests();
    execute.mockImplementation(async (query) => {
      const result = await originalExecute(query);
      if (query.sql.includes("FROM org_members m")) await membershipBarrier();
      if (query.sql.includes("SELECT id FROM organizations\n")) {
        await organizationBarrier();
      }
      return result;
    });
    const app = actionApp();
    const responses = await Promise.all([
      readScopeAction(app),
      readScopeAction(app),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const orgs = (
      await database.query<{ id: string }>("SELECT id FROM organizations")
    ).rows;
    expect(orgs).toHaveLength(1);
    expect(
      await Promise.all(responses.map((response) => response.json())),
    ).toEqual([{ orgId: orgs[0].id }, { orgId: orgs[0].id }]);
    expect(
      (await database.query("SELECT email, role, org_id FROM org_members"))
        .rows,
    ).toEqual([
      { email: "fresh@example.test", role: "owner", org_id: orgs[0].id },
    ]);
  } finally {
    await database.close();
  }
});
