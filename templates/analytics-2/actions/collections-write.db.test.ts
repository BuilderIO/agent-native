import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "../server/db/index.js";
import { projectCollections } from "../server/db/schema.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createProject } from "../server/model/projects-store.js";
import addProjectToCollection from "./add-project-to-collection.js";
import createCollection from "./create-collection.js";
import deleteCollection from "./delete-collection.js";
import favoriteCollection from "./favorite-collection.js";
import getProject from "./get-project.js";
import listCollections from "./list-collections.js";
import removeProjectFromCollection from "./remove-project-from-collection.js";
import updateCollection from "./update-collection.js";

const round = mkdtempSync(join(tmpdir(), "collection-writes-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "coll-owner@example.test";
const other = "coll-other@example.test";
const orgId = `qa-coll-${randomUUID()}`;
const context = (email = owner) => ({
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId: "analytics-2",
});

function asActor<T>(call: () => T, email = owner) {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId,
      authUserId: email,
      userName: "QA collections",
      isSyntheticTraffic: true,
    },
    call,
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_collection_writes_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA collection writes",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb()
    .insert(orgMembers)
    .values([
      {
        id: randomUUID(),
        orgId,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId,
        email: other,
        role: "owner",
        joinedAt: Date.now(),
      },
    ]);
  await getDb()
    .insert(appMemberRoles)
    .values(
      [owner, other].map((email) => ({
        id: randomUUID(),
        orgId,
        email,
        appId: "analytics-2",
        role: "owner" as const,
        updatedBy: owner,
        updatedAt: Date.now(),
      })),
    );
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
    owned.startsWith(temporary + "/collection-writes-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("collection writes", () => {
  it("creates a collection and files a project into it", async () => {
    const created = await asActor(() =>
      createCollection.run(
        { name: "QA revenue", description: "Weekly numbers" },
        context(),
      ),
    );
    expect(created.collection.name).toBe("QA revenue");
    expect(created.collection.description).toBe("Weekly numbers");

    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA filed project",
    });
    const linked = await asActor(() =>
      addProjectToCollection.run(
        { projectId: project.id, collectionId: created.collection.id },
        context(),
      ),
    );
    expect(linked).toEqual({
      projectId: project.id,
      collectionId: created.collection.id,
    });

    const read = await asActor(() =>
      listCollections.run({ id: created.collection.id }, context()),
    );
    expect(read.collections[0]).toMatchObject({
      id: created.collection.id,
      projectCount: 1,
    });
  });

  it("stars and unstars a collection", async () => {
    const created = await asActor(() =>
      createCollection.run({ name: "QA star me" }, context()),
    );
    expect(created.collection.favorited).toBe(false);

    const starred = await asActor(() =>
      favoriteCollection.run(
        { collectionId: created.collection.id, favorited: true },
        context(),
      ),
    );
    expect(starred.collection.favorited).toBe(true);
    const listed = await asActor(() =>
      listCollections.run({ id: created.collection.id }, context()),
    );
    expect(listed.collections[0]?.favorited).toBe(true);

    const unstarred = await asActor(() =>
      favoriteCollection.run(
        { collectionId: created.collection.id, favorited: false },
        context(),
      ),
    );
    expect(unstarred.collection.favorited).toBe(false);
  });

  it("renames a collection and removes a project from it", async () => {
    const created = await asActor(() =>
      createCollection.run({ name: "QA rename me" }, context()),
    );
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA removable project",
    });
    await asActor(() =>
      addProjectToCollection.run(
        { projectId: project.id, collectionId: created.collection.id },
        context(),
      ),
    );

    const updated = await asActor(() =>
      updateCollection.run(
        {
          collectionId: created.collection.id,
          name: "QA renamed",
          description: "Now described",
        },
        context(),
      ),
    );
    expect(updated.collection).toMatchObject({
      name: "QA renamed",
      description: "Now described",
    });

    const removed = await asActor(() =>
      removeProjectFromCollection.run(
        { projectId: project.id, collectionId: created.collection.id },
        context(),
      ),
    );
    expect(removed).toEqual({
      projectId: project.id,
      collectionId: created.collection.id,
    });
    const read = await asActor(() =>
      listCollections.run({ id: created.collection.id }, context()),
    );
    expect(read.collections[0]).toMatchObject({ projectCount: 0 });
  });

  it("deletes a collection and leaves its projects in place", async () => {
    const created = await asActor(() =>
      createCollection.run({ name: "QA delete me" }, context()),
    );
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA survives deletion",
    });
    await asActor(() =>
      addProjectToCollection.run(
        { projectId: project.id, collectionId: created.collection.id },
        context(),
      ),
    );

    const deleted = await asActor(() =>
      deleteCollection.run({ collectionId: created.collection.id }, context()),
    );
    expect(deleted).toEqual({ collectionId: created.collection.id });

    const read = await asActor(() => listCollections.run({}, context()));
    expect(
      read.collections.some((row) => row.id === created.collection.id),
    ).toBe(false);
    const projects = await asActor(() =>
      getProject.run({ projectId: project.id }, context()),
    );
    expect(projects.project.title).toBe("QA survives deletion");
  });

  it("does not let another member file their project into my collection", async () => {
    const created = await asActor(() =>
      createCollection.run({ name: "QA private collection" }, context()),
    );
    const theirs = await createProject({
      ownerEmail: other,
      orgId,
      title: "Their project",
    });
    await expect(
      asActor(
        () =>
          addProjectToCollection.run(
            { projectId: theirs.id, collectionId: created.collection.id },
            context(other),
          ),
        other,
      ),
    ).rejects.toThrow();
    const rows = await getDb().select().from(projectCollections);
    expect(rows.some((row) => row.projectId === theirs.id)).toBe(false);
  });
});
