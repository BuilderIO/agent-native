import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { inArray } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { deleteOrgSetting } from "@agent-native/core/settings";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "../server/db/index.js";
import {
  projectCategories,
  projectShares,
  projects,
} from "../server/db/schema.js";
import { createDataCategory } from "../server/model/data-resource-metadata.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createProject } from "../server/model/projects-store.js";
import listProjectCategories from "./list-project-categories.js";
import updateProjectCategories from "./update-project-categories.js";

const round = mkdtempSync(join(tmpdir(), "project-categories-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "projects-owner@example.test";
const otherOwner = "projects-other@example.test";
const orgA = `qa-projects-a-${randomUUID()}`;
const orgB = `qa-projects-b-${randomUUID()}`;

const context = (email = owner, orgId = orgA) => ({
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId: "analytics-2",
});

function asActor<T>(email: string, orgId: string, call: () => T) {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId,
      authUserId: email,
      userName: "QA project account",
      isSyntheticTraffic: true,
    },
    call,
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_project_categories_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb()
    .insert(organizations)
    .values(
      [orgA, orgB].map((id) => ({
        id,
        name: "QA project categories workspace",
        createdBy: owner,
        createdAt: Date.now(),
      })),
    );
  await getDb()
    .insert(orgMembers)
    .values([
      {
        id: randomUUID(),
        orgId: orgA,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: otherOwner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgB,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
    ]);
  await getDb()
    .insert(appMemberRoles)
    .values([
      {
        id: randomUUID(),
        orgId: orgA,
        email: owner,
        appId: "analytics-2",
        role: "owner",
        updatedBy: owner,
        updatedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: otherOwner,
        appId: "analytics-2",
        role: "owner",
        updatedBy: owner,
        updatedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgB,
        email: owner,
        appId: "analytics-2",
        role: "owner",
        updatedBy: owner,
        updatedAt: Date.now(),
      },
    ]);
});

beforeEach(async () => {
  // Deleting the project cascades its assignments, so each case starts clean.
  await getDb()
    .delete(projects)
    .where(inArray(projects.orgId, [orgA, orgB]));
  // The category catalogue is an organisation setting, shared by the data
  // surfaces; clear it so each case owns its own catalogue.
  await deleteOrgSetting(orgA, "analytics.data.categories:v1");
  await deleteOrgSetting(orgB, "analytics.data.categories:v1");
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round),
    temporary = resolve(tmpdir());
  if (
    owned !== temporary &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(temporary + "/project-categories-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

async function newProject(email = owner, orgId = orgA, title = "QA project") {
  return (await createProject({ ownerEmail: email, orgId, title })).id;
}

describe("project categories", () => {
  it("applies catalogue categories to a project and reads them back", async () => {
    const projectId = await newProject();
    const deepDive = await createDataCategory(
      { ownerEmail: owner, orgId: orgA },
      { name: "Deep dive", color: "#d64545" },
    );
    const dashboard = await createDataCategory(
      { ownerEmail: owner, orgId: orgA },
      { name: "Dashboard", color: "#d97a3a" },
    );

    const saved = await asActor(owner, orgA, () =>
      updateProjectCategories.run(
        { projectId, categoryIds: [deepDive.id, dashboard.id] },
        context(),
      ),
    );
    expect(saved).toEqual({
      projectId,
      categoryIds: [deepDive.id, dashboard.id],
    });

    const read = await asActor(owner, orgA, () =>
      listProjectCategories.run({}, context()),
    );
    expect(read.categories.map((category) => category.name)).toEqual([
      "Deep dive",
      "Dashboard",
    ]);
    // Assignments are a set, so the read order inside a project is not
    // significant; the saved order is what the write returned above.
    expect(read.assignments).toHaveLength(1);
    expect(read.assignments[0]?.projectId).toBe(projectId);
    expect([...(read.assignments[0]?.categoryIds ?? [])].sort()).toEqual(
      [deepDive.id, dashboard.id].sort(),
    );
  });

  it("replaces the list and clears it with an empty list", async () => {
    const projectId = await newProject();
    const deepDive = await createDataCategory(
      { ownerEmail: owner, orgId: orgA },
      { name: "Deep dive", color: "#d64545" },
    );
    const dashboard = await createDataCategory(
      { ownerEmail: owner, orgId: orgA },
      { name: "Dashboard", color: "#d97a3a" },
    );
    await asActor(owner, orgA, () =>
      updateProjectCategories.run(
        { projectId, categoryIds: [deepDive.id, dashboard.id] },
        context(),
      ),
    );
    const replaced = await asActor(owner, orgA, () =>
      updateProjectCategories.run(
        { projectId, categoryIds: [dashboard.id] },
        context(),
      ),
    );
    expect(replaced.categoryIds).toEqual([dashboard.id]);
    const cleared = await asActor(owner, orgA, () =>
      updateProjectCategories.run({ projectId, categoryIds: [] }, context()),
    );
    expect(cleared.categoryIds).toEqual([]);
    const read = await asActor(owner, orgA, () =>
      listProjectCategories.run({}, context()),
    );
    expect(read.assignments).toEqual([]);
  });

  it("keeps one complete replacement when two category writes overlap", async () => {
    const projectId = await newProject();
    const scope = { ownerEmail: owner, orgId: orgA };
    const deepDive = await createDataCategory(scope, {
      name: "Deep dive",
      color: "#d64545",
    });
    const dashboard = await createDataCategory(scope, {
      name: "Dashboard",
      color: "#d97a3a",
    });

    await Promise.all(
      [deepDive.id, dashboard.id].map((categoryId) =>
        asActor(owner, orgA, () =>
          updateProjectCategories.run(
            { projectId, categoryIds: [categoryId] },
            context(),
          ),
        ),
      ),
    );

    const read = await asActor(owner, orgA, () =>
      listProjectCategories.run({}, context()),
    );
    expect(read.assignments).toEqual([
      { projectId, categoryIds: [expect.stringMatching(/^cat_/)] },
    ]);
    expect([deepDive.id, dashboard.id]).toContain(
      read.assignments[0]?.categoryIds[0],
    );
  });

  it("refuses a category id that is not in this workspace's catalogue", async () => {
    const projectId = await newProject();
    await expect(
      asActor(owner, orgA, () =>
        updateProjectCategories.run(
          { projectId, categoryIds: ["cat_not_a_category"] },
          context(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "project_category_not_found",
    });
    expect(
      await getDb()
        .select()
        .from(projectCategories)
        .where(inArray(projectCategories.projectId, [projectId])),
    ).toEqual([]);
  });

  it("keeps another member's project and another organisation out of the catalogue read", async () => {
    await newProject(owner, orgA, "Mine");
    const theirs = await newProject(otherOwner, orgA, "Theirs");
    const foreign = await newProject(owner, orgB, "Foreign");
    const category = await createDataCategory(
      { ownerEmail: owner, orgId: orgA },
      { name: "Dashboard", color: "#d97a3a" },
    );
    const foreignCategory = await createDataCategory(
      { ownerEmail: owner, orgId: orgB },
      { name: "External", color: "#c9a227" },
    );
    await asActor(otherOwner, orgA, () =>
      updateProjectCategories.run(
        { projectId: theirs, categoryIds: [category.id] },
        context(otherOwner, orgA),
      ),
    );
    await asActor(owner, orgB, () =>
      updateProjectCategories.run(
        { projectId: foreign, categoryIds: [foreignCategory.id] },
        context(owner, orgB),
      ),
    );

    const read = await asActor(owner, orgA, () =>
      listProjectCategories.run({}, context()),
    );
    expect(read.assignments).toEqual([]);
    expect(read.categories.map((entry) => entry.name)).toEqual(["Dashboard"]);

    // A project outside the request scope is the same not-found answer as a
    // missing id, so an id can never be moved across a workspace boundary.
    await expect(
      asActor(owner, orgA, () =>
        updateProjectCategories.run(
          { projectId: foreign, categoryIds: [] },
          context(),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "project_not_found",
    });
  });

  it("returns the shared project's categories without exposing its owner's other assignments", async () => {
    const shared = await newProject();
    const privateProject = await newProject();
    const category = await createDataCategory(
      { ownerEmail: owner, orgId: orgA },
      { name: "Dashboard", color: "#d97a3a" },
    );
    for (const projectId of [shared, privateProject]) {
      await asActor(owner, orgA, () =>
        updateProjectCategories.run(
          { projectId, categoryIds: [category.id] },
          context(),
        ),
      );
    }
    await getDb()
      .insert(projectShares)
      .values({
        id: `pshare_${randomUUID()}`,
        resourceId: shared,
        principalType: "user",
        principalId: otherOwner,
        role: "viewer",
        createdBy: owner,
      });

    const read = (projectId: string) =>
      asActor(otherOwner, orgA, () =>
        listProjectCategories.run({ projectId }, context(otherOwner, orgA)),
      );
    expect((await read(shared)).assignments).toEqual([
      { projectId: shared, categoryIds: [category.id] },
    ]);
    await expect(read(privateProject)).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "project_not_found",
    });
  });

  it("keeps a project's categories after an unrelated project is written", async () => {
    const kept = await newProject(owner, orgA, "Kept");
    const other = await newProject(owner, orgA, "Other");
    const category = await createDataCategory(
      { ownerEmail: owner, orgId: orgA },
      { name: "Scratchpad", color: "#6b7280" },
    );
    await asActor(owner, orgA, () =>
      updateProjectCategories.run(
        { projectId: kept, categoryIds: [category.id] },
        context(),
      ),
    );
    await asActor(owner, orgA, () =>
      updateProjectCategories.run(
        { projectId: other, categoryIds: [] },
        context(),
      ),
    );
    const read = await asActor(owner, orgA, () =>
      listProjectCategories.run({}, context()),
    );
    expect(read.assignments).toEqual([
      { projectId: kept, categoryIds: [category.id] },
    ]);
  });
});
