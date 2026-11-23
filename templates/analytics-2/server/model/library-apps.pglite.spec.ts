import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import getProject from "../../actions/get-project.js";
import listLibrary from "../../actions/list-library-apps.js";
import { getDb, schema } from "../db/index.js";
import { runAnalytics2Migrations } from "../plugins/db.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { listLibraryApps } from "./library-apps.js";
import { getReadableProjectDocument } from "./projects-store.js";

const scope = { ownerEmail: "member@example.test", orgId: "org-library" };
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "analytics-library-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(tempDir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await runMigrations(
    ORG_MIGRATIONS.map(({ name: _name, ...migration }) => migration),
    { table: "test_org_migrations" },
  )(undefined);
  await runAnalytics2Migrations(undefined);
  await ensureAnalyticsDatabase();
  await getDb().execute(
    sql`INSERT INTO organizations (id, name, created_by, created_at) VALUES ('org-library', 'Library fixture', 'member@example.test', 1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ('library-member', 'org-library', 'member@example.test', 'member', 1)`,
  );
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.statuses)
    .values([
      {
        id: "endorsed",
        orgId: scope.orgId,
        ownerEmail: "owner@example.test",
        name: "Endorsed",
        endorsed: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "library",
        orgId: scope.orgId,
        ownerEmail: "owner@example.test",
        name: "Library",
        inLibrary: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "other",
        orgId: scope.orgId,
        ownerEmail: "owner@example.test",
        name: "Other",
        createdAt: now,
        updatedAt: now,
      },
    ]);
  const rows = [
    ["mine", scope.ownerEmail, "private", "endorsed", true, scope.orgId],
    ["direct", "owner@example.test", "private", "library", true, scope.orgId],
    ["org", "owner@example.test", "org", "endorsed", true, scope.orgId],
    [
      "org-grant",
      "owner@example.test",
      "private",
      "endorsed",
      true,
      scope.orgId,
    ],
    ["archived", scope.ownerEmail, "private", "endorsed", true, scope.orgId],
    ["trashed", scope.ownerEmail, "private", "endorsed", true, scope.orgId],
    ["hidden", "owner@example.test", "private", "endorsed", true, scope.orgId],
    ["draft", "owner@example.test", "org", "endorsed", false, scope.orgId],
    ["unmarked", "owner@example.test", "org", "other", true, scope.orgId],
    ["foreign", scope.ownerEmail, "org", "endorsed", true, "other-org"],
  ] as const;
  for (const [id, ownerEmail, visibility, statusId, published, orgId] of rows) {
    await getDb()
      .insert(schema.projects)
      .values({
        id,
        ownerEmail,
        orgId,
        visibility,
        statusId,
        title: id,
        workingVersionId: `${id}-work`,
        publishedVersionId: published ? `${id}-pub` : null,
        createdAt: now,
        updatedAt: now,
      });
    if (published)
      await getDb()
        .insert(schema.projectVersions)
        .values({
          id: `${id}-pub`,
          projectId: id,
          number: "1",
          kind: "published",
          capturedOutputCount: 0,
          createdAt: now,
          createdBy: ownerEmail,
        });
  }
  await getDb()
    .update(schema.projects)
    .set({ archivedAt: now })
    .where(eq(schema.projects.id, "archived"));
  await getDb()
    .update(schema.projects)
    .set({ trashedAt: now })
    .where(eq(schema.projects.id, "trashed"));
  await getDb().insert(schema.projectShares).values({
    id: "grant-org",
    resourceId: "org-grant",
    principalType: "org",
    principalId: scope.orgId,
    role: "viewer",
    createdBy: "owner@example.test",
    createdAt: now,
  });
  await getDb().insert(schema.projectShares).values({
    id: "grant-direct",
    resourceId: "direct",
    principalType: "user",
    principalId: scope.ownerEmail,
    role: "viewer",
    createdBy: "owner@example.test",
    createdAt: now,
  });
});
afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  await rm(tempDir, { recursive: true, force: true });
});

it("report 1794899298.142179 lists only accessible published Library apps and follows ownership changes", async () => {
  const run = (cursor?: { updatedAt: string; id: string }) =>
    runWithRequestContext(
      { userEmail: scope.ownerEmail, orgId: scope.orgId },
      () =>
        listLibrary.run(
          {
            limit: 2,
            ...(cursor
              ? { afterUpdatedAt: cursor.updatedAt, afterId: cursor.id }
              : {}),
          },
          {} as never,
        ),
    );
  const first = await run();
  expect(first.nextCursor).not.toBeNull();
  const second = await run(first.nextCursor ?? undefined);
  expect(second.nextCursor).toBeNull();
  expect([...first.apps, ...second.apps].map((app) => app.id).sort()).toEqual([
    "direct",
    "mine",
    "org",
    "org-grant",
  ]);
  expect((await listLibraryApps(scope)).map((app) => app.id).sort()).toEqual([
    "direct",
    "mine",
    "org",
    "org-grant",
  ]);
  for (const projectId of ["direct", "org", "org-grant"]) {
    const result = await runWithRequestContext(
      { userEmail: scope.ownerEmail, orgId: scope.orgId },
      () =>
        getProject.run(
          {
            projectId,
            version: "latest",
            surface: "app",
            viewId: "00000000-0000-4000-8000-000000000001",
          },
          {} as never,
        ),
    );
    expect(result.project.id).toBe(projectId);
  }
  expect(
    await getReadableProjectDocument(scope, "direct", "latest"),
  ).not.toBeNull();
  expect(
    await getReadableProjectDocument(scope, "hidden", "latest"),
  ).toBeNull();
  await getDb().insert(schema.projectShares).values({
    id: "foreign-grant",
    resourceId: "foreign",
    principalType: "user",
    principalId: scope.ownerEmail,
    role: "viewer",
    createdBy: scope.ownerEmail,
    createdAt: new Date().toISOString(),
  });
  expect(
    (await listLibraryApps(scope)).some((app) => app.id === "foreign"),
  ).toBe(false);
  await getDb()
    .delete(schema.projectShares)
    .where(eq(schema.projectShares.id, "grant-direct"));
  expect(
    (await listLibraryApps(scope)).some((app) => app.id === "direct"),
  ).toBe(false);
  await expect(
    runWithRequestContext(
      { userEmail: scope.ownerEmail, orgId: scope.orgId },
      () =>
        getProject.run(
          {
            projectId: "direct",
            version: "latest",
            surface: "app",
            viewId: "00000000-0000-4000-8000-000000000002",
          },
          {} as never,
        ),
    ),
  ).rejects.toMatchObject({ statusCode: 404 });
  await getDb().insert(schema.projectShares).values({
    id: "grant-direct",
    resourceId: "direct",
    principalType: "user",
    principalId: scope.ownerEmail,
    role: "viewer",
    createdBy: "owner@example.test",
    createdAt: new Date().toISOString(),
  });
  await getDb()
    .update(schema.projects)
    .set({ ownerEmail: "new-owner@example.test", visibility: "private" })
    .where(eq(schema.projects.id, "mine"));
  expect((await listLibraryApps(scope)).map((app) => app.id).sort()).toEqual([
    "direct",
    "org",
    "org-grant",
  ]);
});

it("report 1794899298.142179 pages through more than fifty accessible published apps", async () => {
  const now = new Date().toISOString();
  for (let i = 0; i < 52; i++) {
    const id = `bulk-${i}`;
    await getDb()
      .insert(schema.projects)
      .values({
        id,
        ownerEmail: scope.ownerEmail,
        orgId: scope.orgId,
        title: id,
        statusId: "endorsed",
        workingVersionId: `${id}-work`,
        publishedVersionId: `${id}-pub`,
        createdAt: now,
        updatedAt: now,
      });
    await getDb()
      .insert(schema.projectVersions)
      .values({
        id: `${id}-pub`,
        projectId: id,
        number: "1",
        kind: "published",
        createdAt: now,
        createdBy: scope.ownerEmail,
      });
  }
  const run = (cursor?: { updatedAt: string; id: string }) =>
    runWithRequestContext(
      { userEmail: scope.ownerEmail, orgId: scope.orgId },
      () =>
        listLibrary.run(
          {
            limit: 50,
            ...(cursor
              ? { afterUpdatedAt: cursor.updatedAt, afterId: cursor.id }
              : {}),
          },
          {} as never,
        ),
    );
  const first = await run();
  expect(first.nextCursor).not.toBeNull();
  const second = await run(first.nextCursor ?? undefined);
  expect(second.nextCursor).toBeNull();
  const ids = [...first.apps, ...second.apps].map((app) => app.id);
  expect(new Set(ids).size).toBe(55);
  expect(ids).toContain("bulk-51");
});
