import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { getDb, schema } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import { createProject } from "../server/model/projects-store.js";
import { writeCellOutput } from "../server/model/runs-store.js";
import { runAnalytics2Migrations } from "../server/plugins/db.js";
import getProject from "./get-project.js";
import listWorkspaceProjects from "./list-projects.js";
import searchWorkspace from "./search-workspace.js";
import updateProject from "./update-project.js";

/**
 * Workspace search has to answer with the rows the caller can actually see and
 * has to honour every filter bar control:
 *
 * - a creator filter names a person, so a member's organisation-visible project
 *   is found (the owner-only browser listing never widened to do this);
 * - a category filter matches the project's category assignments instead of
 *   dropping every result;
 * - a text query still finds the caller's conversations when a date, category
 *   or status filter is also set.
 *
 * Each assertion below fails on the pre-fix action.
 */

const threadFixture = {
  id: "thread-1",
  orgId: "org-search",
  title: "Alpha forecast review",
  preview: "alpha numbers for the quarter",
  updatedAt: new Date().toISOString(),
  createdAt: new Date(Date.now() - 60_000).toISOString(),
};
let threadFixtures = [threadFixture];

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listThreads: async () => threadFixtures,
    getThread: async () => null,
  };
});

let tempDir: string | undefined;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "analytics-search-"));
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
    sql`INSERT INTO organizations (id,name,created_by,created_at) VALUES ('org-search','Search fixture','me@example.test',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('member-me','org-search','me@example.test','member',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('member-them','org-search','them@example.test','member',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('member-stranger','org-search','stranger@example.test','member',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO organizations (id,name,created_by,created_at) VALUES ('org-other','Other fixture','me@example.test',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('member-other','org-other','me@example.test','member',1)`,
  );
  const project = (
    id: string,
    ownerEmail: string,
    visibility: string,
    title: string,
    updatedAt: string,
  ) =>
    getDb().execute(
      sql`INSERT INTO analytics2_projects
        (id, owner_email, org_id, visibility, title, description, language, working_version_id, created_at, updated_at)
        VALUES (${id}, ${ownerEmail}, 'org-search', ${visibility}, ${title}, '', 'python', ${`${id}-v1`}, ${updatedAt}, ${updatedAt})`,
    );
  const now = new Date().toISOString();
  await project(
    "project-mine",
    "me@example.test",
    "private",
    "Mine alpha",
    now,
  );
  await createProject({
    ownerEmail: "them@example.test",
    orgId: "org-search",
    projectId: "project-theirs",
    title: "Their alpha forecast",
    at: now,
  });
  await getDb()
    .update(schema.projects)
    .set({ visibility: "org" })
    .where(eq(schema.projects.id, "project-theirs"));
  await createProject({
    ownerEmail: "them@example.test",
    orgId: "org-search",
    projectId: "project-theirs-private",
    title: "Their private alpha",
    cells: [
      {
        id: "shared-cell",
        kind: "sql",
        source: "select 42 as answer",
        dataConnectionId: null,
        databaseSchema: null,
        resultVariable: "answer",
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
  await writeCellOutput({
    ownerEmail: "them@example.test",
    orgId: "org-search",
    projectId: "project-theirs-private",
    cellId: "shared-cell",
    runId: null,
    status: "complete",
    output: { type: "text", text: "forty two" },
  });
  await getDb().execute(
    sql`INSERT INTO analytics2_project_categories (project_id, category_id, added_at) VALUES ('project-mine','cat-1',${now})`,
  );
  await getDb().execute(
    sql`INSERT INTO analytics2_project_categories (project_id, category_id, added_at) VALUES ('project-theirs','cat-2',${now})`,
  );
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

const baseQuery = {
  text: "",
  fields: [] as Array<"title" | "description" | "cellContents">,
  dateRange: null,
  includeArchived: false,
  creatorIds: [] as string[],
  categoryIds: [] as string[],
  statusIds: [] as string[],
};

const search = (overrides: Partial<typeof baseQuery>) =>
  runWithRequestContext(
    { orgId: "org-search", userEmail: "me@example.test" },
    () =>
      searchWorkspace.run(
        { ...baseQuery, ...overrides },
        {} as never,
      ) as Promise<{
        results: Array<{ kind: string; id: string; title: string }>;
      }>,
  );

it("finds a member's organisation-visible project by creator", async () => {
  const { results } = await search({ creatorIds: ["them@example.test"] });
  expect(results.map((row) => row.id)).toEqual(["project-theirs"]);
});

it("matches the selected category instead of dropping every row", async () => {
  const { results } = await search({ categoryIds: ["cat-1"] });
  expect(results.map((row) => row.id)).toEqual(["project-mine"]);
  // A category that nothing carries stays empty: the filter selects rows, it
  // never falls back to "show everything".
  const { results: none } = await search({ categoryIds: ["cat-absent"] });
  expect(none.map((row) => row.id)).toEqual([]);
});

it("never shows another member's private project", async () => {
  const { results } = await search({ text: "alpha", fields: ["title"] });
  const projects = results.filter((row) => row.kind === "project");
  expect(projects.map((row) => row.id).sort()).toEqual([
    "project-mine",
    "project-theirs",
  ]);
});

it("keeps the caller's conversations under a status filter", async () => {
  const { results } = await search({
    text: "alpha",
    fields: ["title"],
    statusIds: ["status-draft"],
  });
  expect(
    results.filter((row) => row.kind === "thread").map((row) => row.id),
  ).toEqual(["thread-1"]);
});

it("preserves an empty thread title and a deliberately named New thread", async () => {
  threadFixtures = [
    { ...threadFixture, id: "untitled", title: "", preview: "alpha" },
    { ...threadFixture, id: "named", title: "New thread", preview: "alpha" },
  ];
  try {
    const { results } = await search({ text: "alpha", fields: ["title"] });
    expect(
      results
        .filter((row) => row.kind === "thread")
        .map(({ id, title }) => ({ id, title })),
    ).toEqual([
      { id: "untitled", title: "" },
      { id: "named", title: "New thread" },
    ]);
  } finally {
    threadFixtures = [threadFixture];
  }
});

it("searches project titles when an agent omits fields but honors an explicit empty list", async () => {
  const run = (input: unknown) =>
    runWithRequestContext(
      { orgId: "org-search", userEmail: "me@example.test" },
      () =>
        searchWorkspace.run(searchWorkspace.schema.parse(input), {} as never),
    );
  const omitted = await run({ text: "Mine alpha" });
  expect(
    omitted.results
      .filter((row) => row.kind === "project")
      .map((row) => row.id),
  ).toEqual(["project-mine"]);
  const empty = await run({ text: "Mine alpha", fields: [] });
  expect(empty.results.filter((row) => row.kind === "project")).toEqual([]);
});

it("report A2-SEARCH-READ-ACL: search and project reads honor workspace grants", async () => {
  const scope = { orgId: "org-search", ownerEmail: "them@example.test" };
  await seedLegacyPublishedProject(scope, "project-theirs");
  await seedLegacyPublishedProject(scope, "project-theirs-private");
  const now = new Date().toISOString();
  await getDb().execute(sql`INSERT INTO analytics2_project_shares
    (id, resource_id, principal_type, principal_id, role, created_by, created_at)
    VALUES ('search-grant', 'project-theirs-private', 'user', 'me@example.test', 'viewer', 'them@example.test', ${now})`);
  const runSearch = () => search({ text: "alpha", fields: ["title"] });
  const open = (projectId: string) =>
    runWithRequestContext(
      { orgId: "org-search", userEmail: "me@example.test" },
      () => getProject.run({ projectId }, {} as never),
    );
  try {
    // oracle-change: project sharing is core; scoped grants determine access.
    const ids = (await runSearch()).results
      .filter((r) => r.kind === "project")
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual([
      "project-mine",
      "project-theirs",
      "project-theirs-private",
    ]);
    expect((await open("project-theirs")).project.id).toBe("project-theirs");
    const strangerSearch = await runWithRequestContext(
      { orgId: "org-search", userEmail: "stranger@example.test" },
      () =>
        searchWorkspace.run(
          searchWorkspace.schema.parse({ text: "Their private alpha" }),
          {} as never,
        ),
    );
    expect(strangerSearch.results.map((row) => row.id)).not.toContain(
      "project-theirs-private",
    );
    await expect(
      runWithRequestContext(
        { orgId: "org-search", userEmail: "stranger@example.test" },
        () =>
          getProject.run({ projectId: "project-theirs-private" }, {} as never),
      ),
    ).rejects.toBeDefined();
    const foreignSearch = await runWithRequestContext(
      { orgId: "org-other", userEmail: "me@example.test" },
      () =>
        searchWorkspace.run(
          searchWorkspace.schema.parse({ text: "Their private alpha" }),
          {} as never,
        ),
    );
    expect(foreignSearch.results.map((row) => row.id)).not.toContain(
      "project-theirs-private",
    );
    await expect(
      runWithRequestContext(
        { orgId: "org-other", userEmail: "me@example.test" },
        () =>
          getProject.run({ projectId: "project-theirs-private" }, {} as never),
      ),
    ).rejects.toBeDefined();
    const shared = await open("project-theirs-private");
    expect(shared.project.id).toBe("project-theirs-private");
    expect(
      shared.project.cells.map((cell) => ({
        id: cell.id,
        contents: cell.contents,
      })),
    ).toMatchObject([
      {
        id: "shared-cell",
        contents: { kind: "sql", source: "select 42 as answer" },
      },
    ]);
    expect(shared.outputs["shared-cell"]?.output).toEqual({
      type: "text",
      text: "forty two",
    });
    await expect(
      runWithRequestContext(
        { orgId: "org-search", userEmail: "me@example.test" },
        () =>
          updateProject.run(
            { projectId: "project-theirs-private", title: "changed" },
            {} as never,
          ),
      ),
    ).rejects.toBeDefined();
    await getDb().execute(
      sql`DELETE FROM analytics2_project_shares WHERE id = 'search-grant'`,
    );
    expect((await runSearch()).results.map((r) => r.id)).not.toContain(
      "project-theirs-private",
    );
    await expect(open("project-theirs-private")).rejects.toBeDefined();
    await getDb().execute(sql`INSERT INTO analytics2_project_shares
      (id, resource_id, principal_type, principal_id, role, created_by, created_at)
      VALUES ('search-org-grant', 'project-theirs-private', 'org', 'org-search', 'viewer', 'them@example.test', ${now})`);
    expect((await runSearch()).results.map((r) => r.id)).toContain(
      "project-theirs-private",
    );
    expect((await open("project-theirs-private")).project.id).toBe(
      "project-theirs-private",
    );
    await getDb().execute(
      sql`DELETE FROM analytics2_project_shares WHERE id = 'search-org-grant'`,
    );
    await getDb().execute(sql`INSERT INTO analytics2_project_shares
      (id, resource_id, principal_type, principal_id, role, created_by, created_at)
      VALUES ('search-group-grant', 'project-theirs-private', 'group', 'group-search', 'viewer', 'them@example.test', ${now})`);
    expect((await runSearch()).results.map((r) => r.id)).not.toContain(
      "project-theirs-private",
    );
    await expect(open("project-theirs-private")).rejects.toBeDefined();
  } finally {
    await getDb().execute(
      sql`DELETE FROM analytics2_project_shares WHERE id IN ('search-grant', 'search-org-grant', 'search-group-grant')`,
    );
  }
});

it("report 1794899792.156109 exposes the published app only for published search results", async () => {
  const scope = { ownerEmail: "me@example.test", orgId: "org-search" };
  const published = await createProject({
    ...scope,
    title: "Published search fixture",
    cells: [],
  });
  const draft = await createProject({
    ...scope,
    title: "Draft search fixture",
    cells: [],
  });
  await seedLegacyPublishedProject(scope, published.id);
  const { results } = await search({
    text: "search fixture",
    fields: ["title"],
  });
  expect(results.find((row) => row.id === published.id)).toMatchObject({
    publishedAppHref: `/app/${published.id}/latest`,
  });
  expect(results.find((row) => row.id === draft.id)).not.toHaveProperty(
    "publishedAppHref",
  );
});

it("report 1794901508.878089 returns real publication dates and rejects a broken pointer", async () => {
  const scope = { ownerEmail: "me@example.test", orgId: "org-search" };
  const draft = await createProject({
    ...scope,
    title: "List metadata draft",
    cells: [],
  });
  const live = await createProject({
    ...scope,
    title: "List metadata live",
    cells: [],
  });
  await seedLegacyPublishedProject(scope, live.id);
  const runList = () =>
    runWithRequestContext(
      { orgId: scope.orgId, userEmail: scope.ownerEmail },
      () =>
        listWorkspaceProjects.run(
          listWorkspaceProjects.schema.parse({ search: "List metadata" }),
          {} as never,
        ),
    );
  const result = await runList();
  const liveRow = result.projects.find((row) => row.id === live.id);
  const draftRow = result.projects.find((row) => row.id === draft.id);
  expect(liveRow?.lastPublishedAt).toEqual(expect.any(String));
  expect(draftRow?.lastPublishedAt).toBeNull();
  await getDb()
    .update(schema.projects)
    .set({ publishedVersionId: "missing-version" })
    .where(eq(schema.projects.id, live.id));
  await expect(runList()).rejects.toThrow(
    "published project version is missing or invalid",
  );
});

it("returns the original creator independently of the current owner, with unknown for missing history", async () => {
  const scope = { ownerEmail: "me@example.test", orgId: "org-search" };
  const original = await createProject({
    ...scope,
    title: "Creator metadata original",
    cells: [],
  });
  const unknown = await createProject({
    ...scope,
    title: "Creator metadata unknown",
    cells: [],
  });
  await getDb()
    .update(schema.projectVersions)
    .set({ createdBy: "creator@example.test" })
    .where(eq(schema.projectVersions.projectId, original.id));
  await getDb()
    .update(schema.projectVersions)
    .set({ createdBy: "" })
    .where(eq(schema.projectVersions.projectId, unknown.id));
  const { projects } = await runWithRequestContext(
    { orgId: scope.orgId, userEmail: scope.ownerEmail },
    () =>
      listWorkspaceProjects.run(
        listWorkspaceProjects.schema.parse({ search: "Creator metadata" }),
        {} as never,
      ),
  );
  expect(projects.find((row) => row.id === original.id)?.creatorEmail).toBe(
    "creator@example.test",
  );
  expect(
    projects.find((row) => row.id === unknown.id)?.creatorEmail,
  ).toBeNull();
});

it("treats a bare YYYY-MM-DD dateTo ('Before' filter) as inclusive through end of that day", async () => {
  const scope = { ownerEmail: "me@example.test", orgId: "org-search" };
  const targetDay = "2026-03-04";
  const middayThread = {
    id: "thread-before-inclusive",
    orgId: "org-search",
    title: "Before inclusive midday check",
    preview: "midday item on target date",
    updatedAt: `${targetDay}T14:30:00.000Z`,
    createdAt: `${targetDay}T14:30:00.000Z`,
  };
  const nextDayThread = {
    id: "thread-after-exclusive",
    orgId: "org-search",
    title: "Before inclusive next day check",
    preview: "next day item",
    updatedAt: "2026-03-05T00:05:00.000Z",
    createdAt: "2026-03-05T00:05:00.000Z",
  };
  const priorThreads = threadFixtures;
  threadFixtures = [middayThread, nextDayThread];
  try {
    const result = await runWithRequestContext(
      { orgId: scope.orgId, userEmail: scope.ownerEmail },
      () =>
        searchWorkspace.run(
          searchWorkspace.schema.parse({
            text: "Before inclusive",
            dateTo: targetDay,
          }),
          {} as never,
        ),
    );
    const ids = result.results.map((row) => row.id);
    expect(ids).toContain("thread-before-inclusive");
    expect(ids).not.toContain("thread-after-exclusive");
  } finally {
    threadFixtures = priorThreads;
  }
});
