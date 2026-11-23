import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { createThread } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { workspaceChatScope } from "../app/lib/workspace-chat-scope.js";
import { getDb, schema } from "../server/db/index.js";
import {
  addCell,
  deleteCell,
  moveCell,
  updateCell,
} from "../server/model/cells-store.js";
import { withFixedClock } from "../server/model/clock.js";
import {
  createProject,
  updateProject,
} from "../server/model/projects-store.js";
import { runAnalytics2Migrations } from "../server/plugins/db.js";
import searchWorkspace from "./search-workspace.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "analytics-search-date-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(dir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await runMigrations(ORG_MIGRATIONS, { table: "test_org_migrations" })(
    undefined,
  );
  await runAnalytics2Migrations();
  await getDb().execute(
    sql`INSERT INTO organizations (id,name,created_by,created_at) VALUES ('org-date','Date','me@example.test',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES ('member-date','org-date','me@example.test','member',1)`,
  );
});
afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

it("returns the latest completed edit as a single thread search result", async () => {
  const ownerEmail = "me@example.test";
  const orgId = "org-date";
  const threadOptions = {
    orgId,
    scope: workspaceChatScope(orgId),
    source: { appId: "analytics-2" },
    title: "Count Tables in Connected Data",
    initialData: { threadData: "{}", preview: "Count tables", messageCount: 2 },
  };
  for (const id of ["source", "first-edit", "latest-edit", "pending-edit"]) {
    await createThread(ownerEmail, { ...threadOptions, id });
  }
  await getDb().execute(
    sql`UPDATE chat_threads SET created_at = 1 WHERE id = 'source'`,
  );
  await getDb().execute(sql`
    UPDATE chat_threads
    SET edit_root_id = 'source', edit_prefix_count = 1, created_at = 2
    WHERE id = 'first-edit'
  `);
  await getDb().execute(sql`
    UPDATE chat_threads
    SET edit_root_id = 'source', edit_prefix_count = 1, created_at = 3
    WHERE id = 'latest-edit'
  `);
  await getDb().execute(sql`
    UPDATE chat_threads
    SET edit_root_id = 'source', edit_prefix_count = 2, created_at = 4
    WHERE id = 'pending-edit'
  `);
  const { results } = await runWithRequestContext(
    { orgId, userEmail: ownerEmail },
    () =>
      searchWorkspace.run(
        searchWorkspace.schema.parse({ text: "Count Tables" }),
        {} as never,
      ),
  );
  expect(results.map(({ href }) => href)).toEqual(["/thread/latest-edit"]);
});

it("ranks exact and partial title matches before content matches", async () => {
  const ownerEmail = "me@example.test";
  const orgId = "org-date";
  const scope = { ownerEmail, orgId };
  const content = await createProject({
    ...scope,
    title: "Conversion review",
    description: "Signup",
    at: "2026-03-01T00:00:00.000Z",
  });
  const partial = await createProject({
    ...scope,
    title: "Signup funnel",
    at: "2026-02-01T00:00:00.000Z",
  });
  const exact = await createThread(ownerEmail, {
    id: "signup-thread",
    orgId,
    scope: workspaceChatScope(orgId),
    source: { appId: "analytics-2" },
    title: "Signup",
    initialData: { threadData: "{}", preview: "", messageCount: 1 },
  });
  const { results } = await runWithRequestContext(
    { orgId, userEmail: ownerEmail },
    () =>
      searchWorkspace.run(
        searchWorkspace.schema.parse({ text: "signup" }),
        {} as never,
      ),
  );
  expect(results.map(({ id }) => id)).toEqual([
    exact.id,
    partial.id,
    content.id,
  ]);
});

it("report1794899641.937429 search shows the last content edit, not a favorite", async () => {
  const scope = { ownerEmail: "me@example.test", orgId: "org-date" };
  const project = await createProject({
    ...scope,
    title: "Date fixture",
    at: "2026-01-01T00:00:00.000Z",
    cells: [
      {
        kind: "markdown",
        markdown: "original",
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
      },
    ],
  });
  const cell = project.cells[0];
  if (!cell || cell.contents.kind !== "markdown")
    throw new Error("Missing fixture cell");
  await withFixedClock("2026-02-01T00:00:00.000Z", () =>
    updateCell({
      ...scope,
      projectId: project.id,
      versionId: project.workingVersionId,
      cellId: cell.id,
      contents: { ...cell.contents, markdown: "edited" },
    }),
  );
  await withFixedClock("2026-03-01T00:00:00.000Z", () =>
    updateProject({ ...scope, projectId: project.id, favorited: true }),
  );
  const result = await runWithRequestContext(
    { orgId: scope.orgId, userEmail: scope.ownerEmail },
    () =>
      searchWorkspace.run(
        searchWorkspace.schema.parse({ text: "Date fixture" }),
        {} as never,
      ),
  );
  expect(result.results.find((item) => item.id === project.id)?.updatedAt).toBe(
    "2026-02-01T00:00:00.000Z",
  );
  const filtered = await runWithRequestContext(
    { orgId: scope.orgId, userEmail: scope.ownerEmail },
    () =>
      searchWorkspace.run(
        searchWorkspace.schema.parse({
          text: "Date fixture",
          dateFrom: "2026-02-01T00:00:00.000Z",
          dateTo: "2026-02-28T23:59:59.999Z",
          dateField: "lastEdited",
        }),
        {} as never,
      ),
  );
  expect(filtered.results.map((item) => item.id)).toContain(project.id);
  const added = await withFixedClock("2026-04-01T00:00:00.000Z", () =>
    addCell({
      ...scope,
      projectId: project.id,
      versionId: project.workingVersionId,
      contents: { ...cell.contents, id: "another-cell", markdown: "added" },
    }),
  );
  const savedUserEdit = async () => {
    const [row] = await getDb()
      .select({ at: schema.projects.userUpdatedAt })
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    return row?.at;
  };
  expect(await savedUserEdit()).toBe("2026-04-01T00:00:00.000Z");
  await withFixedClock("2026-05-01T00:00:00.000Z", () =>
    moveCell({
      ...scope,
      projectId: project.id,
      versionId: project.workingVersionId,
      cellId: added.id,
      position: 0,
    }),
  );
  expect(await savedUserEdit()).toBe("2026-05-01T00:00:00.000Z");
  await withFixedClock("2026-06-01T00:00:00.000Z", () =>
    deleteCell({
      ...scope,
      projectId: project.id,
      versionId: project.workingVersionId,
      cellId: added.id,
    }),
  );
  const afterDelete = await runWithRequestContext(
    { orgId: scope.orgId, userEmail: scope.ownerEmail },
    () =>
      searchWorkspace.run(
        searchWorkspace.schema.parse({ text: "Date fixture" }),
        {} as never,
      ),
  );
  expect(
    afterDelete.results.find((item) => item.id === project.id)?.updatedAt,
  ).toBe("2026-06-01T00:00:00.000Z");
});

it("preserves a legacy project's prior timestamp across favorites and newer edits across delayed metadata writes", async () => {
  const scope = { ownerEmail: "me@example.test", orgId: "org-date" };
  const project = await createProject({
    ...scope,
    title: "Legacy date",
    at: "2026-01-01T00:00:00.000Z",
  });
  await getDb()
    .update(schema.projects)
    .set({ userUpdatedAt: null, updatedAt: "2026-02-01T00:00:00.000Z" })
    .where(eq(schema.projects.id, project.id));
  await withFixedClock("2026-03-01T00:00:00.000Z", () =>
    updateProject({ ...scope, projectId: project.id, favorited: true }),
  );
  const searchDate = async () => {
    const result = await runWithRequestContext(
      { orgId: scope.orgId, userEmail: scope.ownerEmail },
      () =>
        searchWorkspace.run(
          searchWorkspace.schema.parse({ text: "Legacy date" }),
          {} as never,
        ),
    );
    return result.results.find((item) => item.id === project.id)?.updatedAt;
  };
  expect(await searchDate()).toBe("2026-02-01T00:00:00.000Z");
  await withFixedClock("2026-05-01T00:00:00.000Z", () =>
    updateProject({
      ...scope,
      projectId: project.id,
      description: "newer edit",
    }),
  );
  await withFixedClock("2026-04-01T00:00:00.000Z", () =>
    updateProject({
      ...scope,
      projectId: project.id,
      description: "delayed edit",
    }),
  );
  expect(await searchDate()).toBe("2026-05-01T00:00:00.000Z");
});
