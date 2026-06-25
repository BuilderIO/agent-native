import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { registerShareableResource } from "@agent-native/core/sharing";
import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as planSchema from "../server/db/schema.js";

let client: Client;
let db: LibSQLDatabase<typeof planSchema>;
let dbDir: string;

vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: planSchema,
}));

type AnyAction = { run: (args: any) => Promise<any> };
let reportVisualPlan: AnyAction;

const OWNER = "owner@example.com";
const PUBLIC_VIEWER =
  "public-00000000-0000-4000-8000-000000000001@agent-native.local";

function asUser(
  ctx: { userEmail?: string; userName?: string; orgId?: string },
  fn: () => Promise<any> | any,
) {
  return runWithRequestContext(ctx, fn);
}

async function insertPlan(
  id: string,
  visibility: "private" | "org" | "public" = "private",
) {
  const now = new Date().toISOString();
  await db.insert(planSchema.plans).values({
    id,
    title: "Moderation target",
    brief: "A plan that may need moderation.",
    kind: "plan",
    status: "review",
    source: "manual",
    repoPath: null,
    currentFocus: null,
    html: null,
    markdown: null,
    content: null,
    hostedPlanId: null,
    hostedPlanUrl: null,
    approvedAt: null,
    sourceUrl: null,
    createdAt: now,
    updatedAt: now,
    ownerEmail: OWNER,
    orgId: null,
    visibility,
  });
}

async function reportsForPlan(planId: string) {
  // guard:allow-unscoped -- test-only fixture assertion reads isolated temp DB.
  return db
    .select()
    .from(planSchema.planReports)
    .where(eq(planSchema.planReports.planId, planId));
}

beforeAll(async () => {
  process.env.PLAN_LOCAL_MODE = "0";

  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-report-action-"));
  client = createClient({ url: `file:${path.join(dbDir, "test.db")}` });
  db = drizzle(client, { schema: planSchema });
  await client.executeMultiple(`
    CREATE TABLE plans (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, brief TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'plan',
      status TEXT NOT NULL DEFAULT 'draft', source TEXT NOT NULL DEFAULT 'manual',
      repo_path TEXT, current_focus TEXT, html TEXT, markdown TEXT, content TEXT,
      hosted_plan_id TEXT, hosted_plan_url TEXT, source_url TEXT,
      source_type TEXT,
      source_repo TEXT,
      source_pr_number INTEGER,
      source_pr_state TEXT,
      source_pr_merged_at TEXT,
      recap_idempotency_key TEXT,
      deleted_at TEXT, deleted_by TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, approved_at TEXT,
      usage_agent TEXT, usage_model TEXT,
      usage_input_tokens INTEGER, usage_output_tokens INTEGER,
      usage_cache_read_tokens INTEGER, usage_cache_write_tokens INTEGER,
      usage_cost_cents_x100 INTEGER, usage_cost_source TEXT, usage_recorded_at TEXT,
      owner_email TEXT NOT NULL, org_id TEXT, visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE plan_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE plan_reports (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      reporter_email TEXT,
      reporter_name TEXT,
      page_url TEXT,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
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

  reportVisualPlan = (await import("./report-visual-plan.js"))
    .default as AnyAction;
}, 30_000);

afterAll(() => {
  client?.close();
  if (dbDir) fs.rmSync(dbDir, { recursive: true, force: true });
});

beforeEach(async () => {
  // guard:allow-unscoped -- test-only fixture cleanup resets isolated temp DB.
  await client.executeMultiple(`
    DELETE FROM plan_reports;
    DELETE FROM plan_shares;
    DELETE FROM plans;
  `);
});

describe("report-visual-plan", () => {
  it("persists a bounded report for a public plan viewer", async () => {
    await insertPlan("plan-public", "public");

    const result = await asUser(
      { userEmail: PUBLIC_VIEWER, userName: "Public Viewer" },
      () =>
        reportVisualPlan.run({
          planId: "plan-public",
          reason: "spam",
          details: "This looks promotional.",
          pageUrl: "https://plan.example.com/plans/plan-public",
        }),
    );

    expect(result).toMatchObject({ ok: true, duplicate: false });
    const rows = await reportsForPlan("plan-public");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      planId: "plan-public",
      reason: "spam",
      details: "This looks promotional.",
      reporterEmail: PUBLIC_VIEWER,
      reporterName: "Public Viewer",
      pageUrl: "https://plan.example.com/plans/plan-public",
      status: "open",
      occurrenceCount: 1,
    });
  });

  it("updates an existing open report by the same reporter instead of inserting duplicates", async () => {
    await insertPlan("plan-duplicate", "public");

    await asUser({ userEmail: PUBLIC_VIEWER }, () =>
      reportVisualPlan.run({
        planId: "plan-duplicate",
        reason: "spam",
        details: "First note",
      }),
    );
    const result = await asUser({ userEmail: PUBLIC_VIEWER }, () =>
      reportVisualPlan.run({
        planId: "plan-duplicate",
        reason: "privacy",
        details: "Updated note",
      }),
    );

    expect(result).toMatchObject({ ok: true, duplicate: true });
    const rows = await reportsForPlan("plan-duplicate");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: "privacy",
      details: "Updated note",
      occurrenceCount: 2,
    });
  });

  it("rejects unidentified callers before writing a report", async () => {
    await insertPlan("plan-no-identity", "public");

    await expect(() =>
      asUser({}, () =>
        reportVisualPlan.run({
          planId: "plan-no-identity",
          reason: "spam",
        }),
      ),
    ).rejects.toThrow(/Open the public plan before reporting/i);
    await expect(reportsForPlan("plan-no-identity")).resolves.toHaveLength(0);
  });

  it("rejects private plans even for the owner", async () => {
    await insertPlan("plan-private", "private");

    await expect(() =>
      asUser({ userEmail: OWNER }, () =>
        reportVisualPlan.run({
          planId: "plan-private",
          reason: "other",
        }),
      ),
    ).rejects.toThrow(/Only public plans can be reported/i);
    await expect(reportsForPlan("plan-private")).resolves.toHaveLength(0);
  });

  it("rejects unknown plan ids without creating report rows", async () => {
    await expect(() =>
      asUser({ userEmail: PUBLIC_VIEWER }, () =>
        reportVisualPlan.run({
          planId: "missing",
          reason: "spam",
        }),
      ),
    ).rejects.toThrow(/Plan missing not found/i);
    await expect(reportsForPlan("missing")).resolves.toHaveLength(0);
  });

  it("validates reason, details length, and page URL shape", async () => {
    await insertPlan("plan-validation", "public");

    await expect(() =>
      asUser({ userEmail: PUBLIC_VIEWER }, () =>
        reportVisualPlan.run({
          planId: "plan-validation",
          reason: "not-a-real-reason",
        }),
      ),
    ).rejects.toThrow();
    await expect(() =>
      asUser({ userEmail: PUBLIC_VIEWER }, () =>
        reportVisualPlan.run({
          planId: "plan-validation",
          reason: "spam",
          details: "x".repeat(1001),
        }),
      ),
    ).rejects.toThrow();
    await expect(() =>
      asUser({ userEmail: PUBLIC_VIEWER }, () =>
        reportVisualPlan.run({
          planId: "plan-validation",
          reason: "spam",
          pageUrl: "not a url",
        }),
      ),
    ).rejects.toThrow();

    await expect(reportsForPlan("plan-validation")).resolves.toHaveLength(0);
  });
});
