import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { eq, ne } from "drizzle-orm";
import { beforeAll, afterAll, expect, it, vi } from "vitest";

import { getDb, schema } from "../db/index.js";
import { runAnalytics2Migrations } from "../plugins/db.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { listPopularProjects, recordProjectView } from "./project-views.js";

let tempDir: string | undefined;
const scope = { ownerEmail: "me@example.test", orgId: "org-views" };

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "analytics-views-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(tempDir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await runAnalytics2Migrations(undefined);
  await ensureAnalyticsDatabase();
  const now = new Date().toISOString();
  const project = (
    id: string,
    owner: string,
    visibility: "private" | "org",
    title: string,
    orgId = "org-views",
  ) =>
    getDb()
      .insert(schema.projects)
      .values({
        id,
        ownerEmail: owner,
        orgId,
        visibility,
        title,
        workingVersionId: `${id}-v1`,
        createdAt: now,
        updatedAt: now,
      });
  await project("project-mine", "me@example.test", "private", "Mine");
  await project(
    "project-theirs-org",
    "me@example.test",
    "org",
    "Another owned app",
  );
  await project(
    "project-theirs-private",
    "them@example.test",
    "private",
    "Theirs private",
  );
  await project(
    "project-other-org",
    "them@example.test",
    "org",
    "Not shared with this viewer",
    "other-org",
  );
  await project(
    "project-never-opened",
    "me@example.test",
    "private",
    "Untouched",
  );
  await project(
    "project-published-zero",
    "me@example.test",
    "private",
    "Never viewed app",
  );
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

it("report 1794900494.750729 ranks published apps by app opens in the last week", async () => {
  await getDb().insert(schema.projectVersions).values({
    id: "project-mine-v1",
    projectId: "project-mine",
    number: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "creator@example.test",
  });
  await getDb()
    .update(schema.projects)
    .set({ publishedVersionId: "published" })
    .where(ne(schema.projects.id, "project-never-opened"));
  await recordProjectView(
    scope,
    "project-mine",
    "ana@example.test",
    "app",
    "same-view",
  );
  await recordProjectView(
    scope,
    "project-mine",
    "ana@example.test",
    "app",
    "same-view",
  );
  await recordProjectView(scope, "project-mine", "ben@example.test", "app");
  for (let i = 0; i < 4; i += 1) {
    await recordProjectView(
      scope,
      "project-theirs-org",
      "ana@example.test",
      "app",
    );
  }
  await recordProjectView(
    scope,
    "project-theirs-private",
    "ana@example.test",
    "app",
  );
  await recordProjectView(
    scope,
    "project-other-org",
    "ana@example.test",
    "app",
  );
  await recordProjectView(scope, "project-mine", "ana@example.test");
  await recordProjectView(
    scope,
    "project-never-opened",
    "ana@example.test",
    "app",
  );

  const popular = await listPopularProjects(scope, { limit: 6 });
  expect(popular.map((row) => [row.id, row.viewCount])).toEqual([
    ["project-theirs-org", 4],
    ["project-mine", 2],
    ["project-published-zero", 0],
  ]);
  expect(popular[2]?.lastViewedAt).toBeNull();
  expect(popular[1]).toMatchObject({
    ownerEmail: "me@example.test",
    creatorEmail: "creator@example.test",
  });
  expect(popular[2]?.creatorEmail).toBeNull();
});

it("shows zero counts when the window has passed", async () => {
  const projects = await listPopularProjects(scope, {
    limit: 6,
    windowDays: -1,
  });
  expect(
    projects.map((row) => [row.id, row.viewCount, row.lastViewedAt]),
  ).toEqual([
    ["project-theirs-org", 0, null],
    ["project-published-zero", 0, null],
    ["project-mine", 0, null],
  ]);
});

it("report 1794900494.750729 preserves the initial creator after owner transfer", async () => {
  await getDb().insert(schema.projects).values({
    id: "transferred",
    ownerEmail: "creator@example.test",
    orgId: scope.orgId,
    visibility: "org",
    title: "Transferred",
    workingVersionId: "transferred-v1",
    publishedVersionId: "transferred-published",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  });
  await getDb().insert(schema.projectVersions).values({
    id: "transferred-v1",
    projectId: "transferred",
    number: "1",
    createdAt: "2026-01-01T00:00:00Z",
    createdBy: "creator@example.test",
  });
  await getDb()
    .update(schema.projects)
    .set({ ownerEmail: "new-owner@example.test" })
    .where(eq(schema.projects.id, "transferred"));
  const transferred = (await listPopularProjects(scope)).find(
    (row) => row.id === "transferred",
  );
  expect(transferred).toMatchObject({
    ownerEmail: "new-owner@example.test",
    creatorEmail: "creator@example.test",
  });
});
