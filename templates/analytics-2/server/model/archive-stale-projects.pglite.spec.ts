import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, getDbExec, sql } from "@agent-native/core/db";
import { and, eq, sql as querySql } from "@agent-native/core/db/schema";
import { afterAll, expect, it, vi } from "vitest";

import { getDb, schema } from "../db/index.js";
import { archiveStaleProjects } from "./archive-stale-projects.js";
import { ensureAnalyticsDatabase } from "./database.js";

let dir: string | undefined;
afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const DAY = 86_400_000;
const now = new Date("2026-06-01T00:00:00.000Z");
const ago = (days: number) =>
  new Date(now.getTime() - days * DAY).toISOString();

it("archives only this organization's projects past an enabled cadence", async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "analytics-archive-sweep-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(dir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await ensureAnalyticsDatabase();
  const db = getDbExec();
  const rows: [string, string, string | null, string | null][] = [
    ["stale", "org", ago(100), ago(5)],
    ["fresh", "org", ago(5), ago(5)],
    ["viewed-stale", "org", ago(5), ago(200)],
    ["in-collection", "org", ago(250), ago(250)],
    ["in-trashed-collection", "org", ago(250), ago(250)],
    ["other-org", "elsewhere", ago(400), null],
  ];
  for (const [id, org, edited, opened] of rows) {
    await db.execute(
      sql`INSERT INTO analytics2_projects (id, owner_email, org_id, working_version_id, created_at, updated_at, user_updated_at, last_opened_at) VALUES (${sql.value(id)}, 'me@example.test', ${sql.value(org)}, ${sql.value(id)}, ${sql.value(ago(500))}, ${sql.value(edited)}, ${sql.value(edited)}, ${sql.value(opened)})`,
    );
  }
  await db.execute(
    sql`INSERT INTO analytics2_collections (id, owner_email, org_id, name, description, kind, favorited, trashed_at, created_at, updated_at) VALUES ('col-active', 'me@example.test', 'org', 'Active Collection', '', 'collection', false, NULL, ${sql.value(ago(300))}, ${sql.value(ago(300))})`,
  );
  await db.execute(
    sql`INSERT INTO analytics2_collections (id, owner_email, org_id, name, description, kind, favorited, trashed_at, created_at, updated_at) VALUES ('col-trashed', 'me@example.test', 'org', 'Trashed Collection', '', 'collection', false, ${sql.value(ago(10))}, ${sql.value(ago(300))}, ${sql.value(ago(10))})`,
  );
  await db.execute(
    sql`INSERT INTO analytics2_project_collections (project_id, collection_id, added_at) VALUES ('in-collection', 'col-active', ${sql.value(ago(200))})`,
  );
  await db.execute(
    sql`INSERT INTO analytics2_project_collections (project_id, collection_id, added_at) VALUES ('in-trashed-collection', 'col-trashed', ${sql.value(ago(200))})`,
  );
  const off = await archiveStaleProjects(
    "org",
    {
      noEditArchiveCadence: null,
      noViewArchiveCadence: null,
    },
    now,
  );
  expect(off).toBe(0);
  const count = await archiveStaleProjects(
    "org",
    {
      noEditArchiveCadence: 90,
      noViewArchiveCadence: 180,
    },
    now,
  );
  expect(count).toBe(3);
  const archivedIn = (orgId: string) =>
    getDb()
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.orgId, orgId),
          querySql`${schema.projects.archivedAt} IS NOT NULL`,
        ),
      )
      .orderBy(schema.projects.id);
  expect(await archivedIn("org")).toEqual([
    { id: "in-trashed-collection" },
    { id: "stale" },
    { id: "viewed-stale" },
  ]);
  expect(await archivedIn("elsewhere")).toEqual([]);
});
