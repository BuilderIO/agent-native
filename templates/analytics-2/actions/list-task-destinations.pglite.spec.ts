import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, getDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { runAnalytics2Migrations } from "../server/plugins/db.js";
import { collectTaskDestinations } from "./list-task-destinations.js";

let tempDir: string | undefined;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "analytics-task-dest-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(tempDir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await runMigrations(ORG_MIGRATIONS, { table: "test_org_migrations" })(
    undefined,
  );
  await runAnalytics2Migrations(undefined);

  const exec = getDbExec();
  await exec.execute({
    sql: `CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT
    )`,
  });
  await exec.execute({
    sql: `CREATE TABLE IF NOT EXISTS workspace_user_groups (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      member_emails_json TEXT NOT NULL
    )`,
  });
  await exec.execute({
    sql: `CREATE TABLE IF NOT EXISTS workspace_connections (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      label TEXT,
      status TEXT NOT NULL
    )`,
  });
  await exec.execute({
    sql: `INSERT INTO "user" (id, email, name) VALUES ('u-1', 'named@example.test', 'Named Member')`,
  });
  await exec.execute({
    sql: `INSERT INTO org_members (id, org_id, email, role, joined_at, federation_removal_pending_at) VALUES
      ('m-1', 'org-1', 'named@example.test', 'admin', 1, NULL),
      ('m-2', 'org-1', 'roster-only@example.test', 'member', 2, NULL),
      ('m-3', 'org-1', 'pending-removal@example.test', 'member', 3, 999)`,
  });
  await exec.execute({
    sql: `INSERT INTO workspace_user_groups (id, org_id, name, member_emails_json) VALUES
      ('g-1', 'org-1', 'Data Team', '["named@example.test"]'),
      ('g-2', 'org-1', 'Empty Group', '[]')`,
  });
  await exec.execute({
    sql: `INSERT INTO workspace_connections (id, org_id, provider, label, status) VALUES
      ('s-1', 'org-1', 'slack-bot', '#analytics-alerts', 'connected'),
      ('s-2', 'org-1', 'slack-bot', '#disconnected', 'disconnected')`,
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeDbExec();
  vi.unstubAllEnvs();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

it("lists active org members even without a user table row, plus populated groups and connected Slack", async () => {
  const destinations = await collectTaskDestinations({
    userEmail: "named@example.test",
    orgId: "org-1",
  });
  expect(destinations).toEqual([
    {
      kind: "user",
      id: "named@example.test",
      label: "Named Member",
      platform: "email",
    },
    {
      kind: "user",
      id: "roster-only@example.test",
      label: "roster-only@example.test",
      platform: "email",
    },
    {
      kind: "group",
      id: "g-1",
      label: "Data Team",
      platform: "email",
    },
    {
      kind: "slack",
      id: "s-1",
      label: "#analytics-alerts",
      platform: "slack",
    },
  ]);
});
