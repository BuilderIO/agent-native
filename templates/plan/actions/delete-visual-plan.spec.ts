import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { registerShareableResource } from "@agent-native/core/sharing";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { closeDbExec } from "@agent-native/core/db";
import * as planSchema from "../server/db/schema.js";

let client: Client;
let db: LibSQLDatabase<typeof planSchema>;
let dbDir: string;
let previousDatabaseUrl: string | undefined;
let previousPlanDatabaseUrl: string | undefined;

vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: planSchema,
}));

type AnyAction = { run: (args: any) => Promise<any> };
let deleteVisualPlan: AnyAction;

const OWNER = "owner@example.com";
const OTHER = "other@example.com";
const PLAN_ID = "plan_delete_test";
const NOW = "2026-06-17T12:00:00.000Z";

function asUser(userEmail: string, fn: () => Promise<any> | any) {
  return runWithRequestContext({ userEmail }, fn);
}

async function resetTables() {
  // guard:allow-unscoped -- test-only fixture cleanup resets isolated temp DB.
  await client.executeMultiple(`
    DROP TABLE IF EXISTS _collab_docs;
    DELETE FROM plan_assets;
    DELETE FROM plan_reports;
    DELETE FROM plan_versions;
    DELETE FROM plan_events;
    DELETE FROM plan_comments;
    DELETE FROM plan_sections;
    DELETE FROM plan_shares;
    DELETE FROM plans;
  `);
}

async function seedPlan() {
  await db.insert(planSchema.plans).values({
    id: PLAN_ID,
    title: "Delete me",
    brief: "Delete action fixture",
    kind: "plan",
    status: "review",
    source: "manual",
    repoPath: null,
    currentFocus: null,
    html: null,
    markdown: "# Delete me",
    content: null,
    hostedPlanId: null,
    hostedPlanUrl: null,
    sourceUrl: null,
    recapIdempotencyKey: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    approvedAt: null,
    ownerEmail: OWNER,
    orgId: null,
    visibility: "public",
  });
  await db.insert(planSchema.planSections).values({
    id: "sec_delete",
    planId: PLAN_ID,
    type: "summary",
    title: "Summary",
    body: "Fixture",
    html: null,
    order: 0,
    createdBy: "agent",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(planSchema.planComments).values({
    id: "cmt_delete",
    planId: PLAN_ID,
    parentCommentId: null,
    sectionId: "sec_delete",
    kind: "comment",
    status: "open",
    anchor: null,
    message: "Fixture comment",
    createdBy: "human",
    authorEmail: OWNER,
    authorName: "Owner",
    resolutionTarget: null,
    mentionsJson: null,
    resolvedBy: null,
    resolvedAt: null,
    consumedAt: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(planSchema.planEvents).values({
    id: "evt_delete",
    planId: PLAN_ID,
    type: "plan.created",
    message: "Created",
    payload: null,
    createdBy: "agent",
    createdAt: NOW,
  });
  await db.insert(planSchema.planReports).values({
    id: "rpt_delete",
    planId: PLAN_ID,
    reason: "other",
    details: "Fixture report",
    status: "open",
    reporterEmail: OTHER,
    reporterName: "Other",
    pageUrl: null,
    occurrenceCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(planSchema.planVersions).values({
    id: "ver_delete",
    ownerEmail: OWNER,
    planId: PLAN_ID,
    title: "Snapshot",
    snapshotJson: JSON.stringify({ plan: { title: "Delete me" } }),
    changeLabel: "Fixture",
    createdBy: "agent",
    createdAt: NOW,
  });
  await db.insert(planSchema.planShares).values({
    id: "share_delete",
    resourceId: PLAN_ID,
    principalType: "user",
    principalId: OTHER,
    role: "viewer",
    createdBy: OWNER,
    createdAt: NOW,
  });
  await db.insert(planSchema.planAssets).values({
    id: "asset_delete",
    planId: PLAN_ID,
    filename: "fixture.png",
    mimeType: "image/png",
    data: "ZmFrZQ==",
    byteSize: 4,
    createdAt: NOW,
  });
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS _collab_docs (
      doc_id TEXT PRIMARY KEY,
      yjs_state TEXT NOT NULL,
      text_snapshot TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO _collab_docs (doc_id, yjs_state, text_snapshot, version, updated_at)
      VALUES ('plan:${PLAN_ID}', 'state', 'exact', 0, '${NOW}');
    INSERT INTO _collab_docs (doc_id, yjs_state, text_snapshot, version, updated_at)
      VALUES ('plan:${PLAN_ID}:block_1', 'state', 'block', 0, '${NOW}');
  `);
}

async function countRows(table: string, column = "plan_id") {
  const { rows } = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`,
    args: [PLAN_ID],
  });
  return Number((rows[0] as { n?: number })?.n ?? 0);
}

async function readPlan() {
  // guard:allow-unscoped -- test-only fixture assertion reads the seeded row in an isolated temp DB.
  const [plan] = await db
    .select()
    .from(planSchema.plans)
    .where(eq(planSchema.plans.id, PLAN_ID));
  return plan;
}

beforeAll(async () => {
  process.env.PLAN_LOCAL_MODE = "0";

  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-delete-action-"));
  const dbUrl = `file:${path.join(dbDir, "test.db")}`;
  previousDatabaseUrl = process.env.DATABASE_URL;
  previousPlanDatabaseUrl = process.env.PLAN_DATABASE_URL;
  process.env.DATABASE_URL = dbUrl;
  process.env.PLAN_DATABASE_URL = dbUrl;
  await closeDbExec();
  client = createClient({ url: dbUrl });
  db = drizzle(client, { schema: planSchema });

  await client.executeMultiple(`
    CREATE TABLE plans (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      brief TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'plan',
      status TEXT NOT NULL DEFAULT 'draft',
      source TEXT NOT NULL DEFAULT 'manual',
      repo_path TEXT,
      current_focus TEXT,
      html TEXT,
      markdown TEXT,
      content TEXT,
      hosted_plan_id TEXT,
      hosted_plan_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approved_at TEXT,
      usage_agent TEXT,
      usage_model TEXT,
      usage_input_tokens INTEGER,
      usage_output_tokens INTEGER,
      usage_cache_read_tokens INTEGER,
      usage_cache_write_tokens INTEGER,
      usage_cost_cents_x100 INTEGER,
      usage_cost_source TEXT,
      usage_recorded_at TEXT,
      source_url TEXT,
      source_type TEXT,
      source_repo TEXT,
      source_pr_number INTEGER,
      source_pr_state TEXT,
      source_pr_merged_at TEXT,
      recap_idempotency_key TEXT,
      deleted_at TEXT, deleted_by TEXT,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE plan_sections (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'custom', title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', html TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE plan_comments (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, parent_comment_id TEXT, section_id TEXT, kind TEXT NOT NULL DEFAULT 'comment', status TEXT NOT NULL DEFAULT 'open', anchor TEXT, message TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'human', author_email TEXT, author_name TEXT, resolution_target TEXT, mentions_json TEXT, resolved_by TEXT, resolved_at TEXT, consumed_at TEXT, deleted_at TEXT, deleted_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE plan_events (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, type TEXT NOT NULL, message TEXT NOT NULL, payload TEXT, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL);
    CREATE TABLE plan_reports (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, reason TEXT NOT NULL, details TEXT, status TEXT NOT NULL DEFAULT 'open', reporter_email TEXT, reporter_name TEXT, page_url TEXT, occurrence_count INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE plan_versions (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL DEFAULT 'local@localhost', plan_id TEXT NOT NULL, title TEXT NOT NULL, snapshot_json TEXT NOT NULL, change_label TEXT, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL);
    CREATE TABLE plan_shares (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL, principal_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', created_by TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE plan_assets (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL, data TEXT NOT NULL, byte_size INTEGER NOT NULL, created_at TEXT NOT NULL);
  `);

  registerShareableResource({
    type: "plan",
    resourceTable: planSchema.plans,
    sharesTable: planSchema.planShares,
    displayName: "Plan",
    titleColumn: "title",
    getResourcePath: (p: any) => `/plans/${p.id}`,
    getDb: () => db,
  });

  deleteVisualPlan = (await import("./delete-visual-plan.js"))
    .default as AnyAction;
});

afterAll(async () => {
  await closeDbExec();
  client?.close();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousPlanDatabaseUrl === undefined)
    delete process.env.PLAN_DATABASE_URL;
  else process.env.PLAN_DATABASE_URL = previousPlanDatabaseUrl;
  if (dbDir) fs.rmSync(dbDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetTables();
});

describe("delete-visual-plan", () => {
  it("soft-deletes an owned plan and makes it private", async () => {
    await seedPlan();

    const result = await asUser(OWNER, () =>
      deleteVisualPlan.run({ planId: PLAN_ID, mode: "soft" }),
    );

    expect(result).toMatchObject({ planId: PLAN_ID, mode: "soft" });
    const plan = await readPlan();
    expect(plan.deletedAt).toBeTruthy();
    expect(plan.deletedBy).toBe(OWNER);
    expect(plan.visibility).toBe("private");
    expect(await countRows("plan_comments")).toBe(1);
  });

  it("restores a soft-deleted plan without restoring public visibility", async () => {
    await seedPlan();
    await asUser(OWNER, () =>
      deleteVisualPlan.run({ planId: PLAN_ID, mode: "soft" }),
    );

    const result = await asUser(OWNER, () =>
      deleteVisualPlan.run({ planId: PLAN_ID, mode: "restore" }),
    );

    expect(result).toMatchObject({ planId: PLAN_ID, mode: "restore" });
    const plan = await readPlan();
    expect(plan.deletedAt).toBeNull();
    expect(plan.deletedBy).toBeNull();
    expect(plan.visibility).toBe("private");
  });

  it("requires exact confirmation before hard delete", async () => {
    await seedPlan();

    await expect(
      asUser(OWNER, () =>
        deleteVisualPlan.run({
          planId: PLAN_ID,
          mode: "hard",
          confirmation: "DELETE",
        }),
      ),
    ).rejects.toThrow(`DELETE ${PLAN_ID}`);

    const plan = await readPlan();
    expect(plan).toBeTruthy();
  });

  it("hard-deletes the plan and all plan-scoped rows", async () => {
    await seedPlan();

    const result = await asUser(OWNER, () =>
      deleteVisualPlan.run({
        planId: PLAN_ID,
        mode: "hard",
        confirmation: `DELETE ${PLAN_ID}`,
      }),
    );

    expect(result).toMatchObject({
      planId: PLAN_ID,
      mode: "hard",
      hardDeleted: true,
      deletedCounts: {
        comments: 1,
        sections: 1,
        reports: 1,
        versions: 1,
        shares: 1,
        assets: 1,
        plans: 1,
      },
    });
    expect(await countRows("plans", "id")).toBe(0);
    expect(await countRows("plan_comments")).toBe(0);
    expect(await countRows("plan_sections")).toBe(0);
    expect(await countRows("plan_events")).toBe(0);
    expect(await countRows("plan_reports")).toBe(0);
    expect(await countRows("plan_versions")).toBe(0);
    expect(await countRows("plan_shares", "resource_id")).toBe(0);
    expect(await countRows("plan_assets")).toBe(0);
    const collabRows = await client.execute({
      sql: `SELECT doc_id FROM _collab_docs WHERE doc_id = ? OR doc_id LIKE ?`,
      args: [`plan:${PLAN_ID}`, `plan:${PLAN_ID}:%`],
    });
    expect(collabRows.rows).toHaveLength(0);
  });

  it("rejects non-owners", async () => {
    await seedPlan();

    await expect(
      asUser(OTHER, () =>
        deleteVisualPlan.run({ planId: PLAN_ID, mode: "soft" }),
      ),
    ).rejects.toThrow(/Requires owner role|No access/);
  });
});
