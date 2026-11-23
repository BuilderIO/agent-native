import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getDb, schema } from "../server/db/index.js";
import { createCollection } from "../server/model/collections-store.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import { createProject } from "../server/model/projects-store.js";
import { runAnalytics2Migrations } from "../server/plugins/db.js";

const mocks = vi.hoisted(() => ({
  profiles: vi.fn(),
}));

vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfilesWithStatus: mocks.profiles,
}));

import listProjects from "./list-projects.js";

let tempDir: string | undefined;

const ORG_ID = "org-project-list-cols";
const ADA = "ada@example.test";
const GRACE = "grace@example.test";
const ANON = "anon@example.test";

const DAY_MS = 86_400_000;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "analytics-list-cols-"));
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
    sql`INSERT INTO organizations (id,name,created_by,created_at) VALUES (${ORG_ID},'List Columns Org',${ADA},1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES
      ('m-ada',${ORG_ID},${ADA},'owner',1),
      ('m-grace',${ORG_ID},${GRACE},'member',1),
      ('m-anon',${ORG_ID},${ANON},'member',1)`,
  );
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

beforeEach(() => {
  mocks.profiles.mockReset();
  mocks.profiles.mockResolvedValue({
    profiles: new Map([
      [ADA, { email: ADA, name: "Ada Lovelace" }],
      [GRACE, { email: GRACE, name: "Grace Hopper" }],
      [ANON, { email: ANON, name: ANON }],
    ]),
    incomplete: false,
  });
});

describe("list-projects column metadata", () => {
  it("report 1794901508.878089 returns windowed app view counts and resolved member names", async () => {
    const now = Date.now();
    const published = await createProject({
      ownerEmail: ADA,
      orgId: ORG_ID,
      projectId: "prj-cols-published",
      title: "Published KPI App",
    });
    await getDb()
      .update(schema.projectVersions)
      .set({ createdBy: GRACE })
      .where(eq(schema.projectVersions.projectId, published.id));
    await seedLegacyPublishedProject(
      { ownerEmail: ADA, orgId: ORG_ID },
      published.id,
    );

    const draft = await createProject({
      ownerEmail: ADA,
      orgId: ORG_ID,
      projectId: "prj-cols-draft",
      title: "Draft Analysis",
    });

    const sharedGrace = await createProject({
      ownerEmail: GRACE,
      orgId: ORG_ID,
      projectId: "prj-cols-grace",
      title: "Grace Shared App",
    });
    const anonProject = await createProject({
      ownerEmail: ANON,
      orgId: ORG_ID,
      projectId: "prj-cols-anon",
      title: "Anon Shared App",
    });
    for (const id of [sharedGrace.id, anonProject.id]) {
      await getDb()
        .update(schema.projects)
        .set({ visibility: "org" })
        .where(eq(schema.projects.id, id));
    }

    const collection = await createCollection({
      ownerEmail: ADA,
      orgId: ORG_ID,
      name: "Shared Team Apps",
    });
    await getDb()
      .insert(schema.projectCollections)
      .values([
        {
          projectId: sharedGrace.id,
          collectionId: collection.id,
          addedAt: new Date(now).toISOString(),
        },
        {
          projectId: anonProject.id,
          collectionId: collection.id,
          addedAt: new Date(now).toISOString(),
        },
      ]);

    await getDb()
      .insert(schema.projectViews)
      .values([
        {
          id: "viw-2d",
          projectId: published.id,
          orgId: ORG_ID,
          viewerEmail: ADA,
          viewKind: "app",
          viewedAt: new Date(now - 2 * DAY_MS).toISOString(),
        },
        {
          id: "viw-10d",
          projectId: published.id,
          orgId: ORG_ID,
          viewerEmail: GRACE,
          viewKind: "app",
          viewedAt: new Date(now - 10 * DAY_MS).toISOString(),
        },
        {
          id: "viw-20d",
          projectId: published.id,
          orgId: ORG_ID,
          viewerEmail: ANON,
          viewKind: "app",
          viewedAt: new Date(now - 20 * DAY_MS).toISOString(),
        },
        {
          id: "viw-45d",
          projectId: published.id,
          orgId: ORG_ID,
          viewerEmail: ADA,
          viewKind: "app",
          viewedAt: new Date(now - 45 * DAY_MS).toISOString(),
        },
        {
          id: "viw-notebook-1d",
          projectId: published.id,
          orgId: ORG_ID,
          viewerEmail: ADA,
          viewKind: null,
          viewedAt: new Date(now - 1 * DAY_MS).toISOString(),
        },
      ]);

    const active = await runWithRequestContext(
      { orgId: ORG_ID, userEmail: ADA },
      () =>
        listProjects.run(
          listProjects.schema.parse({ view: "active" }),
          {} as never,
        ),
    );
    const activeById = new Map(active.projects.map((row) => [row.id, row]));

    expect(activeById.get(published.id)).toMatchObject({
      appViews: 4,
      appViewsByDuration: {
        ALL_TIME: 4,
        ONE_WEEK: 1,
        TWO_WEEKS: 2,
        ONE_MONTH: 3,
      },
      ownerEmail: ADA,
      ownerName: "Ada Lovelace",
      creatorEmail: GRACE,
      creatorName: "Grace Hopper",
      yourAccess: "owner",
      sharedWith: { workspace: false, directCount: 0 },
    });

    expect(activeById.get(draft.id)).toMatchObject({
      appViews: null,
      appViewsByDuration: null,
      ownerEmail: ADA,
      ownerName: "Ada Lovelace",
      creatorEmail: ADA,
      creatorName: "Ada Lovelace",
    });

    const inCollection = await runWithRequestContext(
      { orgId: ORG_ID, userEmail: ADA },
      () =>
        listProjects.run(
          listProjects.schema.parse({
            view: "active",
            collectionId: collection.id,
          }),
          {} as never,
        ),
    );
    const colById = new Map(inCollection.projects.map((row) => [row.id, row]));

    expect(colById.get(sharedGrace.id)).toMatchObject({
      ownerEmail: GRACE,
      ownerName: "Grace Hopper",
      creatorEmail: GRACE,
      creatorName: "Grace Hopper",
      yourAccess: "read",
      sharedWith: { workspace: true, directCount: 0 },
    });

    expect(colById.get(anonProject.id)).toMatchObject({
      ownerEmail: ANON,
      ownerName: null,
      creatorEmail: ANON,
      creatorName: null,
      yourAccess: "read",
      sharedWith: { workspace: true, directCount: 0 },
    });
  });
});
