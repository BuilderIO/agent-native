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
import { projects } from "../server/db/schema.js";
import {
  createDataCategory,
  readDataCategories,
} from "../server/model/data-resource-metadata.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createProject } from "../server/model/projects-store.js";
import createDataCategoryAction from "./create-data-category.js";
import deleteDataCategory from "./delete-data-category.js";
import listProjectCategories from "./list-project-categories.js";
import updateDataCategory from "./update-data-category.js";
import updateProjectCategories from "./update-project-categories.js";

const round = mkdtempSync(join(tmpdir(), "delete-data-category-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "categories-owner@example.test";
const member = "categories-member@example.test";
const orgA = `qa-delete-cat-a-${randomUUID()}`;

const context = (email = owner) => ({
  caller: "frontend" as const,
  userEmail: email,
  orgId: orgA,
  appId: "analytics-2",
});

function asActor<T>(email: string, call: () => T) {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId: orgA,
      authUserId: email,
      userName: "QA category account",
      isSyntheticTraffic: true,
    },
    call,
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_delete_category_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb()
    .insert(organizations)
    .values([
      {
        id: orgA,
        name: "QA delete category workspace",
        createdBy: owner,
        createdAt: Date.now(),
      },
    ]);
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
        email: member,
        role: "member",
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
    ]);
});

beforeEach(async () => {
  await getDb()
    .delete(projects)
    .where(inArray(projects.orgId, [orgA]));
  await deleteOrgSetting(orgA, "analytics.data.categories:v1");
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
    owned.startsWith(temporary + "/delete-data-category-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("category descriptions", () => {
  it("persists descriptions through creation, update, and catalogue reads", async () => {
    const created = await asActor(owner, () =>
      createDataCategoryAction.run(
        createDataCategoryAction.schema.parse({
          name: "Described",
          color: "#d64545",
          description: "First description",
        }),
        context(),
      ),
    );
    expect(created.category.description).toBe("First description");
    await asActor(owner, () =>
      updateDataCategory.run(
        updateDataCategory.schema.parse({
          id: created.category.id,
          name: "Described",
          color: "#d64545",
          description: "Updated description",
        }),
        context(),
      ),
    );
    expect(
      (await readDataCategories({ ownerEmail: owner, orgId: orgA }))
        .categories[0]?.description,
    ).toBe("Updated description");
  });
});

describe("delete data category", () => {
  it("removes the catalogue entry and every project assignment", async () => {
    const projectId = (
      await createProject({
        ownerEmail: owner,
        orgId: orgA,
        title: "QA project",
      })
    ).id;
    const keep = await createDataCategory(
      { ownerEmail: owner, orgId: orgA },
      { name: "Keep", color: "#d64545" },
    );
    const remove = await createDataCategory(
      { ownerEmail: owner, orgId: orgA },
      { name: "Remove me", color: "#d97a3a" },
    );
    await asActor(owner, () =>
      updateProjectCategories.run(
        { projectId, categoryIds: [keep.id, remove.id] },
        context(),
      ),
    );

    const removed = await asActor(owner, () =>
      deleteDataCategory.run({ id: remove.id }, context()),
    );
    expect(removed).toEqual({ removedId: remove.id });

    const catalogue = await readDataCategories({
      ownerEmail: owner,
      orgId: orgA,
    });
    expect(catalogue.categories.map((category) => category.name)).toEqual([
      "Keep",
    ]);

    const read = await asActor(owner, () =>
      listProjectCategories.run({}, context()),
    );
    expect(read.assignments).toEqual([{ projectId, categoryIds: [keep.id] }]);
  });

  it("refuses an unknown id with a 404 instead of a silent success", async () => {
    await expect(
      asActor(owner, () =>
        deleteDataCategory.run({ id: "cat_missing" }, context()),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("refuses a member who is not a workspace administrator", async () => {
    const category = await createDataCategory(
      { ownerEmail: owner, orgId: orgA },
      { name: "Owned by admin", color: "#6b7280" },
    );
    await expect(
      asActor(member, () =>
        deleteDataCategory.run({ id: category.id }, context(member)),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const catalogue = await readDataCategories({
      ownerEmail: owner,
      orgId: orgA,
    });
    expect(catalogue.categories).toHaveLength(1);
  });

  it("creates through the action so the UI path and the delete path share one catalogue", async () => {
    const created = await asActor(owner, () =>
      createDataCategoryAction.run(
        { name: "Round trip", color: "#2f9e9e" },
        context(),
      ),
    );
    await asActor(owner, () =>
      deleteDataCategory.run({ id: created.category.id }, context()),
    );
    const catalogue = await readDataCategories({
      ownerEmail: owner,
      orgId: orgA,
    });
    expect(catalogue.categories).toEqual([]);
  });
});

describe("update data category", () => {
  it("persists an administrator edit and rejects member edits and duplicate names", async () => {
    const scope = { ownerEmail: owner, orgId: orgA };
    const first = await createDataCategory(scope, {
      name: "Original",
      color: "#aabbcc",
    });
    await createDataCategory(scope, { name: "Taken", color: "#aabbcc" });
    const input = { id: first.id, name: "Edited", color: "#112233" };
    await expect(
      asActor(member, () => updateDataCategory.run(input, context(member))),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      asActor(owner, () =>
        updateDataCategory.run({ ...input, name: "Taken" }, context()),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await asActor(owner, () => updateDataCategory.run(input, context()));
    expect(
      (await readDataCategories(scope)).categories.find(
        (item) => item.id === first.id,
      ),
    ).toMatchObject(input);
  });
});
