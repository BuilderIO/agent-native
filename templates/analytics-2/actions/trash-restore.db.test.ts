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
import { cells } from "../server/db/schema.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import {
  createProject,
  getProjectDocument,
  listProjects as listProjectsFromStore,
} from "../server/model/projects-store.js";
import archiveProject from "./archive-project.js";
import deleteProject from "./delete-project.js";
import favoriteProject from "./favorite-project.js";
import listProjects from "./list-projects.js";
import restoreProject from "./restore-project.js";
import touchProjectAction from "./touch-project.js";
import trashProject from "./trash-project.js";
import unarchiveProject from "./unarchive-project.js";

const round = mkdtempSync(join(tmpdir(), "trash-restore-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "trash-owner@example.test";
const orgId = `qa-trash-${randomUUID()}`;
const context = {
  caller: "frontend" as const,
  userEmail: owner,
  orgId,
  appId: "analytics-2",
};

function asActor<T>(call: () => T) {
  return runWithRequestContext(
    {
      userEmail: owner,
      orgId,
      authUserId: owner,
      userName: "QA trash",
      isSyntheticTraffic: true,
    },
    call,
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_trash_restore_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA trash",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: owner,
    role: "owner",
    joinedAt: Date.now(),
  });
  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId,
    email: owner,
    appId: "analytics-2",
    role: "owner",
    updatedBy: owner,
    updatedAt: Date.now(),
  });
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
    owned.startsWith(temporary + "/trash-restore-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("restore-project and delete-project", () => {
  it("restores a trashed project and removes it from the trash listing", async () => {
    const scope = { ownerEmail: owner, orgId };
    const project = await createProject({
      ...scope,
      title: "QA restore me",
      cells: [],
    });
    await asActor(() => trashProject.run({ projectId: project.id }, context));

    const trashed = await asActor(() =>
      listProjects.run({ view: "trash" }, context),
    );
    expect(trashed.projects.map((entry) => entry.id)).toEqual([project.id]);

    const restored = await asActor(() =>
      restoreProject.run({ projectId: project.id }, context),
    );
    expect(restored.project.trashedAt).toBeNull();

    const trashAfter = await asActor(() =>
      listProjects.run({ view: "trash" }, context),
    );
    expect(trashAfter.projects).toEqual([]);
    const active = await asActor(() => listProjects.run({}, context));
    expect(active.projects.map((entry) => entry.id)).toEqual([project.id]);
  });

  it("permanently deletes only a trashed project and takes its cells with it", async () => {
    const scope = { ownerEmail: owner, orgId };
    const project = await createProject({
      ...scope,
      title: "QA delete me",
      cells: [
        {
          kind: "markdown",
          markdown: "gone soon",
          label: null,
          hidden: false,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
        },
      ],
    });

    // A live project is refused: permanent deletion exists only in the trash.
    await expect(
      asActor(() => deleteProject.run({ projectId: project.id }, context)),
    ).rejects.toThrow(/trash/i);
    expect(await getProjectDocument(scope, project.id)).not.toBeNull();

    await asActor(() => trashProject.run({ projectId: project.id }, context));
    const deleted = await asActor(() =>
      deleteProject.run({ projectId: project.id }, context),
    );
    expect(deleted).toEqual({ id: project.id, deleted: true });
    expect(await getProjectDocument(scope, project.id)).toBeNull();
    expect(await getDb().select().from(cells)).toEqual([]);
  });

  it("moves a project to the archive and back without touching the trash", async () => {
    const scope = { ownerEmail: owner, orgId };
    const project = await createProject({
      ...scope,
      title: "QA archive me",
      cells: [],
    });

    const archived = await asActor(() =>
      archiveProject.run({ projectId: project.id }, context),
    );
    expect(archived.project.archivedAt).not.toBeNull();
    expect(archived.project.trashedAt).toBeNull();

    const archiveView = await asActor(() =>
      listProjects.run({ view: "archive" }, context),
    );
    expect(archiveView.projects.map((entry) => entry.id)).toEqual([project.id]);
    const activeView = await asActor(() => listProjects.run({}, context));
    expect(activeView.projects.map((entry) => entry.id)).not.toContain(
      project.id,
    );

    const restored = await asActor(() =>
      unarchiveProject.run({ projectId: project.id }, context),
    );
    expect(restored.project.archivedAt).toBeNull();
    expect(await getProjectDocument(scope, project.id)).not.toBeNull();
  });

  it("toggles favorites and the favorites filter sees the change", async () => {
    const scope = { ownerEmail: owner, orgId };
    const project = await createProject({
      ...scope,
      title: "QA favorite me",
      cells: [],
    });

    const favorited = await asActor(() =>
      favoriteProject.run({ projectId: project.id, favorited: true }, context),
    );
    expect(favorited.project.favorited).toBe(true);
    const listed = await listProjectsFromStore({
      ownerEmail: owner,
      orgId,
      favorited: true,
    });
    expect(listed.map((entry) => entry.id)).toEqual([project.id]);

    const cleared = await asActor(() =>
      favoriteProject.run({ projectId: project.id, favorited: false }, context),
    );
    expect(cleared.project.favorited).toBe(false);
    const none = await listProjectsFromStore({
      ownerEmail: owner,
      orgId,
      favorited: true,
    });
    expect(none).toEqual([]);
  });

  it("records an open so recents and last-viewed order by it", async () => {
    const scope = { ownerEmail: owner, orgId };
    const older = await createProject({
      ...scope,
      title: "QA older",
      cells: [],
    });
    const newer = await createProject({
      ...scope,
      title: "QA newer",
      cells: [],
    });

    const opened = await asActor(() =>
      touchProjectAction.run({ projectId: older.id }, context),
    );
    expect(opened.id).toBe(older.id);
    expect(opened.openedAt).toEqual(expect.any(String));

    const listed = await listProjectsFromStore({
      ownerEmail: owner,
      orgId,
    });
    const byId = new Map(listed.map((entry) => [entry.id, entry]));
    expect(byId.get(older.id)?.lastOpenedAt).not.toBeNull();
    // The view is recorded after creation, so the touched project is strictly
    // the more recently viewed of the two.
    expect(
      (byId.get(older.id)?.lastOpenedAt ?? "").localeCompare(
        byId.get(newer.id)?.lastOpenedAt ?? "",
      ),
    ).toBeGreaterThan(0);
  });
});
