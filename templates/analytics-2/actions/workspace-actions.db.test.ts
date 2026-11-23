import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  arbitraryFromJsonSchema,
  checkActionProperties,
} from "@agent-native/core/action-properties";
import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { sql } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
  appMemberRoles,
} from "@agent-native/core/org";
import {
  createThread as createStoredThread,
  getThread,
  updateThreadData,
  runWithRequestContext,
} from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "../server/db/index.js";
import { declareWorkspaceAccess } from "../server/lib/workspace-access.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import {
  createProject as createStoredProject,
  listProjects,
  touchProject,
  updateProject as updateStoredProject,
} from "../server/model/projects-store.js";
import { getProjectDocument } from "../server/model/projects-store.js";
import { readShellProjects } from "../server/model/shell-projects.js";
import createProject from "./create-project.js";
import createThread from "./create-thread.js";
import getActivity from "./get-workspace-activity.js";
import getShell from "./get-workspace-shell.js";
import listWorkspaceProjects from "./list-projects.js";
import renameThread from "./rename-thread.js";
import searchWorkspace from "./search-workspace.js";
import trashProject from "./trash-project.js";

const round = mkdtempSync(join(tmpdir(), "workspace-actions-"));
const previousDatabase = process.env.DATABASE_URL;
const orgA = `qa-actions-a-${randomUUID()}`;
const orgB = `qa-actions-b-${randomUUID()}`;
const owner = "workspace-owner@example.test";
const viewer = "workspace-viewer@example.test";
const other = "workspace-other@example.test";
const appId = "analytics-2";
function asActor<T>(email: string, orgId: string, call: () => T) {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId,
      authUserId: email,
      userName: "QA test account",
      isSyntheticTraffic: true,
    },
    call,
  );
}
const actionContext = (email = owner, orgId = orgA) => ({
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId,
});

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_workspace_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  for (const id of [orgA, orgB]) {
    await getDb().insert(organizations).values({
      id,
      name: "QA test workspace",
      createdBy: owner,
      createdAt: Date.now(),
    });
  }
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
        orgId: orgB,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: viewer,
        role: "member",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: other,
        role: "member",
        joinedAt: Date.now(),
      },
    ]);
  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId: orgA,
    email: viewer,
    appId,
    role: "viewer",
    updatedBy: owner,
    updatedAt: Date.now(),
  });
});
afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round);
  if (
    owned !== resolve(tmpdir()) &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(resolve(tmpdir()) + "/workspace-actions-")
  ) {
    rmSync(owned, { recursive: true, force: true });
  } else throw new Error("Refused cleanup outside this test round");
});

describe("workspace action authority and persistence", () => {
  it("lists recorded app visits and sharing for owned projects in the current workspace", async () => {
    const scope = { ownerEmail: owner, orgId: orgA };
    const prefix = "Project list details";
    const draft = await createStoredProject({
      ...scope,
      title: `${prefix} draft`,
    });
    const published = await createStoredProject({
      ...scope,
      title: `${prefix} published`,
    });
    const workspaceShared = await createStoredProject({
      ...scope,
      title: `${prefix} workspace`,
    });
    const publishedDocument = await seedLegacyPublishedProject(
      scope,
      published.id,
    );
    await getDb()
      .update(schema.projects)
      .set({ visibility: "org" })
      .where(eq(schema.projects.id, workspaceShared.id));
    await getDb().insert(schema.projectShares).values({
      id: randomUUID(),
      resourceId: published.id,
      principalType: "user",
      principalId: viewer,
      role: "viewer",
    });
    const lastAppView = "2026-02-01T12:00:00.000Z";
    await getDb()
      .insert(schema.projectViews)
      .values(
        [
          {
            orgId: orgA,
            viewerEmail: owner,
            viewKind: "app",
            viewedAt: lastAppView,
          },
          {
            orgId: orgA,
            viewerEmail: viewer,
            viewKind: "app",
            viewedAt: "2026-02-02T12:00:00.000Z",
          },
          {
            orgId: orgA,
            viewerEmail: owner,
            viewKind: null,
            viewedAt: "2026-02-03T12:00:00.000Z",
          },
          {
            orgId: orgB,
            viewerEmail: owner,
            viewKind: "app",
            viewedAt: "2026-02-04T12:00:00.000Z",
          },
        ].map((view) => ({
          ...view,
          id: randomUUID(),
          projectId: published.id,
        })),
      );

    const { projects } = await asActor(owner, orgA, () =>
      listWorkspaceProjects.run(
        listWorkspaceProjects.schema.parse({ search: prefix }),
        actionContext(),
      ),
    );
    expect(projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: published.id,
          lastPublishedAt: publishedDocument.updatedAt,
          yourAccess: "owner",
          sharedWith: { workspace: false, directCount: 1 },
          appViews: 2,
          appLastViewedAt: lastAppView,
        }),
        expect.objectContaining({
          id: draft.id,
          lastPublishedAt: null,
          yourAccess: "owner",
          sharedWith: { workspace: false, directCount: 0 },
          appViews: null,
          appLastViewedAt: null,
        }),
        expect.objectContaining({
          id: workspaceShared.id,
          sharedWith: { workspace: true, directCount: 0 },
        }),
      ]),
    );
    expect(JSON.stringify(projects)).not.toContain(viewer);
  });

  it("lists all 66 owned projects beyond recents and separates lifecycle and org scopes", async () => {
    const prefix = `QA test complete list ${randomUUID()}`;
    const ids: string[] = [];
    for (let index = 1; index <= 66; index++) {
      const project = await createStoredProject({
        ownerEmail: owner,
        orgId: orgA,
        title: `${prefix} ${String(index).padStart(2, "0")}`,
      });
      ids.push(project.id);
    }
    await createStoredProject({
      ownerEmail: owner,
      orgId: orgB,
      title: `${prefix} foreign org`,
    });
    await createStoredProject({
      ownerEmail: other,
      orgId: orgA,
      title: `${prefix} foreign owner`,
    });
    const read = (view: "active" | "archive" | "trash") =>
      asActor(owner, orgA, () =>
        listWorkspaceProjects.run({ view, search: prefix }, actionContext()),
      );
    const active = await read("active");
    expect(active.projects).toHaveLength(66);
    expect(new Set(active.projects.map((project) => project.id))).toEqual(
      new Set(ids),
    );
    expect(
      active.projects.find((project) => project.title.endsWith(" 66"))?.id,
    ).toBe(ids[65]);
    const favoriteId = ids[0];
    if (!favoriteId) throw new Error("Expected a project ID");
    await updateStoredProject({
      ownerEmail: owner,
      orgId: orgA,
      projectId: favoriteId,
      favorited: true,
    });
    await getDb()
      .update(schema.projects)
      .set({ lastOpenedAt: "2020-01-01T00:00:00.000Z" })
      .where(eq(schema.projects.id, favoriteId));
    const activity = await readShellProjects({
      ownerEmail: owner,
      orgId: orgA,
    });
    expect(activity.recent).toHaveLength(10);
    expect(activity.recent.some(({ id }) => id === favoriteId)).toBe(false);
    expect(activity.favorites.map((project) => project.id)).toEqual([
      favoriteId,
    ]);
    const archivedId = ids[0];
    const trashedId = ids[1];
    if (!archivedId || !trashedId) throw new Error("Expected two project IDs");
    await updateStoredProject({
      ownerEmail: owner,
      orgId: orgA,
      projectId: archivedId,
      archived: true,
    });
    await updateStoredProject({
      ownerEmail: owner,
      orgId: orgA,
      projectId: trashedId,
      trashed: true,
    });
    expect((await read("active")).projects).toHaveLength(64);
    expect(
      (await read("archive")).projects.map((project) => project.id),
    ).toEqual([ids[0]]);
    expect((await read("trash")).projects.map((project) => project.id)).toEqual(
      [ids[1]],
    );
    expect(
      listWorkspaceProjects.schema.safeParse({ ownerEmail: other, orgId: orgB })
        .success,
    ).toBe(false);
  });
  it("reuses an identical role declaration across development module evaluations", () => {
    expect(() => declareWorkspaceAccess()).not.toThrow();
    expect(() => declareWorkspaceAccess()).not.toThrow();
  });
  it("does not authorize an ambient deploy identity without request context", async () => {
    const previous = process.env.AGENT_USER_EMAIL;
    process.env.AGENT_USER_EMAIL = owner;
    try {
      await expect(createProject.run({}, actionContext())).rejects.toThrow(
        "Sign in",
      );
    } finally {
      if (previous === undefined) delete process.env.AGENT_USER_EMAIL;
      else process.env.AGENT_USER_EMAIL = previous;
    }
  });
  it("creates a readable private project only in the selected organization", async () => {
    const result = await asActor(owner, orgA, () =>
      createProject.run({ title: "QA test scoped project" }, actionContext()),
    );
    expect(result.href).toBe(`/project/${result.id}/latest`);
    expect(
      (await getProjectDocument({ ownerEmail: owner, orgId: orgA }, result.id))
        ?.title,
    ).toBe("QA test scoped project");
    expect(
      await getProjectDocument({ ownerEmail: owner, orgId: orgB }, result.id),
    ).toBeNull();
    expect(
      await getProjectDocument({ ownerEmail: other, orgId: orgA }, result.id),
    ).toBeNull();
  });
  it("blocks an actual viewer from project creation while allowing a private workspace-scoped thread", async () => {
    await expect(
      asActor(viewer, orgA, () => createProject.run({}, actionContext(viewer))),
    ).rejects.toThrow();
    const thread = await asActor(viewer, orgA, () =>
      createThread.run({}, actionContext(viewer)),
    );
    const saved = await getThread(thread.id);
    expect(saved?.ownerEmail).toBe(viewer);
    expect(saved?.orgId).toBe(orgA);
    // oracle-change: bdc48318a1's app-global scope expectation is retired.
    // The reviewed organization namespace prevents SDK restores across workspaces.
    expect(saved?.scope).toEqual({
      type: "workspace-app",
      id: `analytics-2:org:${encodeURIComponent(orgA)}`,
    });
    expect(saved?.source?.appId).toBe(appId);
  });
  it("renames only an owned thread in the active workspace", async () => {
    const thread = await asActor(owner, orgA, () =>
      createThread.run({}, actionContext()),
    );
    await expect(
      asActor(other, orgA, () =>
        renameThread.run(
          { threadId: thread.id, title: "Other title" },
          actionContext(other),
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asActor(owner, orgB, () =>
        renameThread.run(
          { threadId: thread.id, title: "Wrong workspace" },
          actionContext(owner, orgB),
        ),
      ),
    ).rejects.toThrow();
    const result = await asActor(owner, orgA, () =>
      renameThread.run(
        { threadId: thread.id, title: "Revenue by region" },
        actionContext(),
      ),
    );
    expect(result).toEqual({ id: thread.id, title: "Revenue by region" });
    expect((await getThread(thread.id))?.title).toBe("Revenue by region");
    const toolResult = await runWithRequestContext(
      {
        userEmail: owner,
        orgId: orgA,
        authUserId: owner,
        run: { browserTabId: `qa-tab-${randomUUID()}` },
      },
      () =>
        renameThread.run(
          { threadId: thread.id, title: "Agent title" },
          { ...actionContext(), caller: "tool" },
        ),
    );
    expect(toolResult).toMatchObject({
      id: thread.id,
      title: "Agent title",
      navigation: { status: "requested" },
    });
  });
  it("returns only this app's current-organization recent conversations", async () => {
    const make = (sourceApp: string, orgId: string) =>
      asActor(owner, orgId, () =>
        createStoredThread(owner, {
          title: "QA test conversation",
          orgId,
          scope: {
            type: "workspace-app",
            id: `${encodeURIComponent(sourceApp)}:org:${encodeURIComponent(orgId)}`,
          },
          source: { appId: sourceApp },
          initialData: {
            threadData: "{}",
            preview: "QA test fixture",
            messageCount: 1,
          },
        }),
      );
    const mine = await make(appId, orgA);
    const foreignApp = await make("another-app", orgA);
    const foreignOrg = await make(appId, orgB);
    const result = await asActor(owner, orgA, () =>
      getShell.run({}, actionContext()),
    );
    expect(result.recents.some((item) => item.id === mine.id)).toBe(true);
    expect(result.recents.some((item) => item.id === foreignApp.id)).toBe(
      false,
    );
    expect(result.recents.some((item) => item.id === foreignOrg.id)).toBe(
      false,
    );
    const activity = await asActor(owner, orgA, () =>
      getActivity.run({}, actionContext()),
    );
    expect(activity).toEqual({
      recents: result.recents,
      favorites: result.favorites,
      homeRecents: result.homeRecents,
      needsSampleWorkspace:
        result.homeRecents.projects.length === 0 &&
        result.collections.length === 0,
    });
    expect(result.workspace.id).toBe(orgA);
    expect(result.features.isManagerOrAbove).toBe(true);
    expect(result.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: orgA, memberCount: 3, role: "Admin" }),
        expect.objectContaining({ id: orgB, memberCount: 1, role: "Admin" }),
      ]),
    );
  });
  it("does not promote delegated membership into organization administrator capabilities", async () => {
    await runWithRequestContext(
      {
        userEmail: owner,
        orgId: orgA,
        a2aIdentityAssurance: "org-member",
        isSyntheticTraffic: true,
      },
      async () => {
        const shell = await getShell.run({}, actionContext());
        expect(shell.features.isManagerOrAbove).toBe(false);
        expect(shell.features.canCreateProject).toBe(false);
        await expect(createProject.run({}, actionContext())).rejects.toThrow();
      },
    );
  });
  it("uses the source title bound and rejects unstoreable names before writes", async () => {
    const accepted = "a".repeat(500);
    const result = await asActor(owner, orgA, () =>
      createProject.run({ title: accepted }, actionContext()),
    );
    expect(
      (await getProjectDocument({ ownerEmail: owner, orgId: orgA }, result.id))
        ?.title,
    ).toBe(accepted);
    await expect(
      asActor(owner, orgA, () =>
        createProject.run({ title: "a".repeat(501) }, actionContext()),
      ),
    ).rejects.toThrow();
    await expect(
      asActor(owner, orgA, () =>
        createProject.run({ title: String.fromCharCode(0) }, actionContext()),
      ),
    ).rejects.toThrow();
  });
  it("checks action input/output contracts over real writes and reads", async () => {
    await asActor(owner, orgA, async () => {
      const chartColor = arbitraryFromJsonSchema({
        enum: ["#4d56dc", "#749700", "#BE442D"],
      });
      const labels = arbitraryFromJsonSchema({
        enum: [{ a: "Alpha" }, { b: "Beta" }],
      });
      const vegaSpec = arbitraryFromJsonSchema({
        enum: [null, { mark: "point" }],
      });
      const sliders = arbitraryFromJsonSchema({
        enum: [
          { min: 0, max: 10, step: 1 },
          { min: -5, max: 0, step: 0.5 },
        ],
      });
      await checkActionProperties(createProject, {
        context: actionContext(),
        runs: 12,
        seed: 29,
        overrides: {
          "/title": arbitraryFromJsonSchema({ type: "string", maxLength: 500 }),
          "/starter/cells/-/chartSpec/colors/-": chartColor,
          "/cells/-/chartSpec/colors/-": chartColor,
          "/starter/cells/-/chartSpec/seriesLabels": labels,
          "/cells/-/chartSpec/seriesLabels": labels,
          "/starter/cells/-/optionLabels": labels,
          "/cells/-/optionLabels": labels,
          "/starter/cells/-/spec": vegaSpec,
          "/cells/-/spec": vegaSpec,
          "/starter/cells/-/sliderOptions": sliders,
          "/cells/-/sliderOptions": sliders,
        },
      });
      await checkActionProperties(createThread, {
        context: actionContext(),
        runs: 5,
        seed: 31,
      });
      await checkActionProperties(getShell, {
        context: actionContext(),
        runs: 3,
        seed: 37,
      });
    });
  });
  it("searches all 66 matching projects while isolating private workspaces and cell text", async () => {
    const needle = `QA-search-${randomUUID()}`;
    const ids: string[] = [];
    for (let index = 0; index < 66; index += 1) {
      ids.push(
        (
          await createStoredProject({
            ownerEmail: owner,
            orgId: orgA,
            title: `${needle}-${index}`,
          })
        ).id,
      );
    }
    const foreignOrg = await createStoredProject({
      ownerEmail: owner,
      orgId: orgB,
      title: needle,
    });
    const foreignOwner = await createStoredProject({
      ownerEmail: other,
      orgId: orgA,
      title: needle,
    });
    const request = {
      text: needle,
      fields: ["title" as const],
      dateRange: null,
      includeArchived: false,
      creatorIds: [],
      categoryIds: [],
      statusIds: [],
    };
    const results = await asActor(owner, orgA, () =>
      searchWorkspace.run(request, actionContext()),
    );
    expect(
      results.results.filter((row) => row.kind === "project"),
    ).toHaveLength(66);
    expect(results.results.some((row) => row.id === ids[65])).toBe(true);
    const transportShape = await asActor(owner, orgA, () =>
      searchWorkspace.run({ text: needle, fields: ["title"] }, actionContext()),
    );
    expect(
      transportShape.results.filter((row) => row.kind === "project"),
    ).toHaveLength(66);
    const noFields = await asActor(owner, orgA, () =>
      searchWorkspace.run({ text: needle }, actionContext()),
    );
    // oracle-change: omitted fields now use the action's default search fields.
    expect(
      noFields.results
        .filter((row) => row.kind === "project")
        .map((row) => row.id)
        .sort(),
    ).toEqual([...ids].sort());
    const emptyFields = await asActor(owner, orgA, () =>
      searchWorkspace.run({ text: needle, fields: [] }, actionContext()),
    );
    expect(
      emptyFields.results.filter((row) => row.kind === "project"),
    ).toHaveLength(0);
    expect(
      results.results.some(
        (row) => row.id === foreignOrg.id || row.id === foreignOwner.id,
      ),
    ).toBe(false);
    const cellProject = await createStoredProject({
      ownerEmail: owner,
      orgId: orgA,
      title: "QA test cell search",
      cells: [
        {
          kind: "sql",
          source: `SELECT '${needle}_cell' AS marker`,
          dataConnectionId: null,
          databaseSchema: null,
          resultVariable: "dataframe",
          outputResult: true,
          label: null,
          hidden: false,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
        },
      ],
    });
    const cellResults = await asActor(owner, orgA, () =>
      searchWorkspace.run(
        { ...request, text: `${needle}_cell`, fields: ["cellContents"] },
        actionContext(),
      ),
    );
    expect(cellResults.results.map((row) => row.id)).toEqual([cellProject.id]);
    const cellResult = cellResults.results[0];
    if (cellResult.kind !== "project")
      throw new Error("Expected source cell result");
    expect(cellResult.cellMatches[0]?.snippet).toContain(needle);
    await asActor(owner, orgA, () =>
      checkActionProperties(searchWorkspace, {
        context: actionContext(),
        runs: 5,
        seed: 101,
      }),
    );
  });
  it("keeps blank search recents at the five viewed projects specified by the dialog", async () => {
    const viewed = [];
    for (let index = 0; index < 7; index += 1) {
      const project = await createStoredProject({
        ownerEmail: owner,
        orgId: orgA,
        title: `QA test viewed ${index}`,
      });
      await touchProject({ ownerEmail: owner, orgId: orgA }, project.id);
      viewed.push(project.id);
    }
    const result = await asActor(owner, orgA, () =>
      searchWorkspace.run(
        {
          text: "",
          fields: ["title"],
          dateRange: null,
          includeArchived: false,
          creatorIds: [],
          categoryIds: [],
          statusIds: [],
        },
        actionContext(),
      ),
    );
    expect(result.results).toHaveLength(5);
    expect(
      result.results.every(
        (row) => row.kind === "project" && viewed.includes(row.id),
      ),
    ).toBe(true);
  });
  it("narrows conversation matches by workspace before the source's five-thread cut", async () => {
    const needle = `QA-thread-search-${randomUUID()}`;
    const ownIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const thread = await asActor(owner, orgA, () =>
        createStoredThread(owner, {
          title: needle,
          orgId: orgA,
          scope: {
            type: "workspace-app",
            id: `analytics-2:org:${encodeURIComponent(orgA)}`,
          },
          source: { appId },
          initialData: { threadData: "{}", preview: needle, messageCount: 1 },
        }),
      );
      ownIds.push(thread.id);
    }
    for (let index = 0; index < 55; index += 1) {
      await asActor(owner, orgB, () =>
        createStoredThread(owner, {
          title: needle,
          orgId: orgB,
          scope: {
            type: "workspace-app",
            id: `analytics-2:org:${encodeURIComponent(orgB)}`,
          },
          source: { appId },
          initialData: { threadData: "{}", preview: needle, messageCount: 1 },
        }),
      );
    }
    const request = {
      text: needle,
      fields: ["title" as const],
      dateRange: null,
      includeArchived: false,
      creatorIds: [],
      categoryIds: [],
      statusIds: [],
    };
    const result = await asActor(owner, orgA, () =>
      searchWorkspace.run(request, actionContext()),
    );
    const threads = result.results.filter((row) => row.kind === "thread");
    expect(threads).toHaveLength(5);
    expect(threads.every((row) => ownIds.includes(row.id))).toBe(true);
    const olderThanSevenDays = Date.now() - 8 * 86_400_000;
    await getDb().execute(sql`UPDATE chat_threads
      SET created_at = ${olderThanSevenDays}, updated_at = ${olderThanSevenDays}
      WHERE title = ${needle}`);
    const filtered = await asActor(owner, orgA, () =>
      searchWorkspace.run({ ...request, dateRange: "7d" }, actionContext()),
    );
    expect(filtered.results.some((row) => row.kind === "thread")).toBe(false);
  });
  it("moves only an authorized project to trash and removes it from active reads", async () => {
    const project = await createStoredProject({
      ownerEmail: owner,
      orgId: orgA,
      title: "QA test trash",
    });
    await expect(
      asActor(owner, orgB, () =>
        trashProject.run({ projectId: project.id }, actionContext(owner, orgB)),
      ),
    ).rejects.toThrow();
    await expect(
      asActor(other, orgA, () =>
        trashProject.run({ projectId: project.id }, actionContext(other)),
      ),
    ).rejects.toThrow();
    const result = await asActor(owner, orgA, () =>
      trashProject.run({ projectId: project.id }, actionContext()),
    );
    expect(result.id).toBe(project.id);
    expect(
      (await listProjects({ ownerEmail: owner, orgId: orgA })).some(
        (row) => row.id === project.id,
      ),
    ).toBe(false);
    expect(
      (await getProjectDocument({ ownerEmail: owner, orgId: orgA }, project.id))
        ?.trashedAt,
    ).toBeTruthy();
    await asActor(owner, orgA, () =>
      checkActionProperties(trashProject, {
        context: actionContext(),
        runs: 3,
        seed: 103,
        overrides: {
          "/projectId": arbitraryFromJsonSchema({ const: project.id }),
        },
      }),
    );
  });

  it("partitions new conversation scopes by the selected organization", async () => {
    const a = await asActor(owner, orgA, () =>
      createThread.run({}, actionContext(owner, orgA)),
    );
    const b = await asActor(owner, orgB, () =>
      createThread.run({}, actionContext(owner, orgB)),
    );
    const savedA = await getThread(a.id);
    const savedB = await getThread(b.id);
    expect(savedA?.scope).toEqual({
      type: "workspace-app",
      id: `analytics-2:org:${encodeURIComponent(orgA)}`,
    });
    expect(savedB?.scope).toEqual({
      type: "workspace-app",
      id: `analytics-2:org:${encodeURIComponent(orgB)}`,
    });
    expect(savedA?.scope?.id).not.toBe(savedB?.scope?.id);
    await updateThreadData(
      a.id,
      JSON.stringify({
        messages: [
          {
            message: {
              id: "qa-a",
              role: "user",
              content: [{ type: "text", text: "QA test namespace A" }],
            },
            parentId: null,
          },
        ],
        headId: "qa-a",
      }),
      "QA test namespace A",
      "QA test namespace A",
      1,
    );
    await updateThreadData(
      b.id,
      JSON.stringify({
        messages: [
          {
            message: {
              id: "qa-b",
              role: "user",
              content: [{ type: "text", text: "QA test namespace B" }],
            },
            parentId: null,
          },
        ],
        headId: "qa-b",
      }),
      "QA test namespace B",
      "QA test namespace B",
      1,
    );
    const homeA = await asActor(owner, orgA, () =>
      getShell.run({}, actionContext(owner, orgA)),
    );
    const homeB = await asActor(owner, orgB, () =>
      getShell.run({}, actionContext(owner, orgB)),
    );
    expect(homeA.recents.some((row) => row.id === a.id)).toBe(true);
    expect(homeA.recents.some((row) => row.id === b.id)).toBe(false);
    expect(homeB.recents.some((row) => row.id === b.id)).toBe(true);
    expect(homeB.recents.some((row) => row.id === a.id)).toBe(false);
  });
});
