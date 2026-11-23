import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { getDb, schema } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createProject } from "../server/model/projects-store.js";
import { runAnalytics2Migrations } from "../server/plugins/db.js";

const mocks = vi.hoisted(() => ({
  profiles: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listThreads: async () => [],
    getThread: async () => null,
  };
});

vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfilesWithStatus: mocks.profiles,
}));

import searchWorkspace from "./search-workspace.js";

let tempDir: string | undefined;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "analytics-search-owner-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(tempDir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await runMigrations(ORG_MIGRATIONS, { table: "test_org_migrations" })(
    undefined,
  );
  await runAnalytics2Migrations(undefined);
  await ensureAnalyticsDatabase();
  await getDb().execute(
    sql`INSERT INTO organizations (id,name,created_by,created_at) VALUES ('org-names','Names fixture','ada@example.test',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('m-ada','org-names','ada@example.test','owner',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('m-grace','org-names','grace@example.test','member',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('m-anon','org-names','anon@example.test','member',1)`,
  );

  const now = new Date().toISOString();
  await createProject({
    ownerEmail: "ada@example.test",
    orgId: "org-names",
    projectId: "prj-ada",
    title: "Quarterly margin",
    at: now,
  });
  await createProject({
    ownerEmail: "grace@example.test",
    orgId: "org-names",
    projectId: "prj-grace",
    title: "Quarterly retention",
    at: now,
  });
  await createProject({
    ownerEmail: "anon@example.test",
    orgId: "org-names",
    projectId: "prj-anon",
    title: "Quarterly cohort",
    at: now,
  });
  for (const id of ["prj-grace", "prj-anon"]) {
    await getDb()
      .update(schema.projects)
      .set({ visibility: "org" })
      .where(eq(schema.projects.id, id));
  }
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

beforeEach(() => {
  mocks.profiles.mockReset();
});

it("resolves owner full names instead of raw emails in search results", async () => {
  mocks.profiles.mockResolvedValue({
    profiles: new Map([
      ["ada@example.test", { email: "ada@example.test", name: "Ada Lovelace" }],
      [
        "grace@example.test",
        { email: "grace@example.test", name: "Grace Hopper" },
      ],
      [
        "anon@example.test",
        { email: "anon@example.test", name: "anon@example.test" },
      ],
    ]),
    incomplete: false,
  });

  const { results } = await runWithRequestContext(
    { orgId: "org-names", userEmail: "ada@example.test" },
    () =>
      searchWorkspace.run(
        searchWorkspace.schema.parse({ text: "Quarterly" }),
        {} as never,
      ),
  );

  const byId = new Map(
    results
      .filter((row) => row.kind === "project")
      .map((row) => [row.id, row.ownerName]),
  );

  expect(byId.get("prj-ada")).toBe("Ada Lovelace");
  expect(byId.get("prj-grace")).toBe("Grace Hopper");
  expect(byId.get("prj-anon")).toBe("");
  expect(JSON.stringify(results)).not.toContain("@example.test");
});

it("report M5-T2-F-13 populates accessLabel for owned, org-visible, and directly shared projects", async () => {
  const now = new Date().toISOString();
  await createProject({
    ownerEmail: "grace@example.test",
    orgId: "org-names",
    projectId: "prj-grace-edit",
    title: "Quarterly edit shared",
    at: now,
  });
  await createProject({
    ownerEmail: "grace@example.test",
    orgId: "org-names",
    projectId: "prj-grace-admin",
    title: "Quarterly admin shared",
    at: now,
  });
  await getDb().insert(schema.projectShares).values([
    {
      id: "share-edit",
      resourceId: "prj-grace-edit",
      principalType: "user",
      principalId: "ada@example.test",
      role: "editor",
      createdBy: "grace@example.test",
      createdAt: now,
    },
    {
      id: "share-admin",
      resourceId: "prj-grace-admin",
      principalType: "user",
      principalId: "ada@example.test",
      role: "admin",
      createdBy: "grace@example.test",
      createdAt: now,
    },
  ]);

  mocks.profiles.mockResolvedValue({
    profiles: new Map([
      ["ada@example.test", { email: "ada@example.test", name: "Ada Lovelace" }],
      [
        "grace@example.test",
        { email: "grace@example.test", name: "Grace Hopper" },
      ],
    ]),
    incomplete: false,
  });

  const { results } = await runWithRequestContext(
    { orgId: "org-names", userEmail: "ada@example.test" },
    () =>
      searchWorkspace.run(
        searchWorkspace.schema.parse({ text: "Quarterly" }),
        {} as never,
      ),
  );

  const accessById = new Map(
    results
      .filter((row) => row.kind === "project")
      .map((row) => [row.id, row.accessLabel]),
  );

  expect(accessById.get("prj-ada")).toBe("Full access");
  expect(accessById.get("prj-grace")).toBe("Can view");
  expect(accessById.get("prj-grace-edit")).toBe("Can edit");
  expect(accessById.get("prj-grace-admin")).toBe("Full access");
});
