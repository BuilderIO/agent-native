import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { getDb } from "../server/db/index.js";
import {
  addProjectToCollection,
  createCollection,
} from "../server/model/collections-store.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import {
  createProject,
  updateProject,
} from "../server/model/projects-store.js";
import { runAnalytics2Migrations } from "../server/plugins/db.js";
import listCollections from "./list-collections.js";
import listProjects from "./list-projects.js";

let tempDir: string | undefined;

beforeAll(async () => {
  await setup();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeDbExec();
  vi.unstubAllEnvs();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

const owner = "owner@example.test";
const scope = { ownerEmail: owner, orgId: "org-1" };

async function setup() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "analytics-collections-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(tempDir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await runMigrations(ORG_MIGRATIONS, { table: "test_org_migrations" })(
    undefined,
  );
  await runAnalytics2Migrations(undefined);
  await ensureAnalyticsDatabase();
  for (const statement of [
    `INSERT INTO organizations (id,name,created_by,created_at) VALUES ('org-1','Example workspace',${`'${owner}'`},1)`,
    `INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('owner','org-1',${`'${owner}'`},'owner',1)`,
  ])
    await getDb().execute(sql.raw(statement));
}

const asOwner = <T>(fn: () => Promise<T>) =>
  runWithRequestContext({ userEmail: owner, orgId: "org-1" }, fn);

/**
 * Row 119: the sample collection has a description and example projects, and a
 * reader needs both the count and the description. The count must be of live
 * projects, so a trashed or archived project does not inflate it.
 */
it("returns the seeded sample collection with its description and live project count", async () => {
  const collection = await asOwner(() =>
    createCollection({
      ...scope,
      collectionId: "collection-sample",
      name: "Starting point",
      description: "Example projects built on the sample data.",
    }),
  );
  const live = await asOwner(() =>
    createProject({ ...scope, projectId: "project-live", title: "Revenue" }),
  );
  const trashed = await asOwner(() =>
    createProject({ ...scope, projectId: "project-trashed", title: "Funnel" }),
  );
  await asOwner(() =>
    createProject({ ...scope, projectId: "project-archived", title: "Old" }),
  );
  for (const projectId of [
    "project-live",
    "project-trashed",
    "project-archived",
  ]) {
    await asOwner(() =>
      addProjectToCollection({
        ...scope,
        collectionId: collection.id,
        projectId,
      }),
    );
  }
  await asOwner(() =>
    updateProject({ ...scope, projectId: trashed.id, trashed: true }),
  );
  await asOwner(() =>
    updateProject({ ...scope, projectId: "project-archived", archived: true }),
  );
  // Sharing is a column on the collection, not something inferred from members.
  await getDb().execute(
    sql`UPDATE analytics2_collections SET visibility = 'org' WHERE id = 'collection-sample' AND org_id = ${scope.orgId} AND owner_email = ${scope.ownerEmail}`,
  );

  const result = await asOwner(() =>
    listCollections.run(listCollections.schema.parse({}), {} as never),
  );
  expect(result.collections).toHaveLength(1);
  expect(result.collections[0]).toMatchObject({
    id: "collection-sample",
    name: "Starting point",
    description: "Example projects built on the sample data.",
    projectCount: 1,
    ownedByYou: true,
    favorited: false,
    sharedWithWorkspace: true,
    isPrivate: false,
  });
  expect(live.id).toBe("project-live");

  // A second collection stays private: the sharing label must follow the column,
  // not the presence of projects. This is the requirement the retired
  // list-collections-private.behavior spec asserted against the old action shape.
  await asOwner(() =>
    createCollection({
      ...scope,
      collectionId: "collection-private",
      name: "Only mine",
      description: "",
    }),
  );
  const both = await asOwner(() =>
    listCollections.run(listCollections.schema.parse({}), {} as never),
  );
  const privateRow = both.collections.find(
    (row) => row.id === "collection-private",
  );
  expect(privateRow).toMatchObject({
    projectCount: 0,
    sharedWithWorkspace: false,
    isPrivate: true,
  });

  const single = await asOwner(() =>
    listCollections.run(
      listCollections.schema.parse({ id: "collection-sample" }),
      {} as never,
    ),
  );
  expect(single.collections.map((row) => row.id)).toEqual([
    "collection-sample",
  ]);

  const contents = await asOwner(() =>
    listProjects.run(
      listProjects.schema.parse({ collectionId: "collection-sample" }),
      {} as never,
    ),
  );
  expect(contents.projects.map((project) => project.title)).toEqual([
    "Revenue",
  ]);
});

it("returns collection managers and members backed by ownership and share grants", async () => {
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('mgr','org-1','manager@example.test','member',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('mem','org-1','member@example.test','member',1)`,
  );
  const collection = await asOwner(() =>
    createCollection({
      ...scope,
      collectionId: "collection-shared",
      name: "Executive metrics",
      description: "Core KPIs",
    }),
  );
  const now = new Date().toISOString();
  await getDb().execute(
    sql`INSERT INTO analytics2_collection_shares
      (id, resource_id, principal_type, principal_id, role, created_by, created_at)
      VALUES ('sh-mgr', ${collection.id}, 'user', 'manager@example.test', 'admin', ${owner}, ${now})`,
  );
  await getDb().execute(
    sql`INSERT INTO analytics2_collection_shares
      (id, resource_id, principal_type, principal_id, role, created_by, created_at)
      VALUES ('sh-mem', ${collection.id}, 'user', 'member@example.test', 'editor', ${owner}, ${now})`,
  );

  const result = await asOwner(() =>
    listCollections.run(
      listCollections.schema.parse({ id: collection.id }),
      {} as never,
    ),
  );
  expect(result.collections).toHaveLength(1);
  expect(result.collections[0]?.members).toEqual([
    expect.objectContaining({ email: owner, role: "owner" }),
    expect.objectContaining({
      email: "manager@example.test",
      role: "manager",
    }),
    expect.objectContaining({
      email: "member@example.test",
      role: "member",
    }),
  ]);

  const asMember = await runWithRequestContext(
    { userEmail: "member@example.test", orgId: "org-1" },
    () =>
      listCollections.run(
        listCollections.schema.parse({ id: collection.id }),
        {} as never,
      ),
  );
  expect(asMember.collections[0]?.members.map((m) => m.email)).toEqual([
    owner,
    "member@example.test",
  ]);
});
