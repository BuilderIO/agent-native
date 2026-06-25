/**
 * Unit tests for the burst-coalescing behaviour added to
 * createPlanVersionSnapshot in plan-versions.ts.
 *
 * Tests run against an in-process libsql SQLite database so the real Drizzle
 * query layer is exercised; vi.setSystemTime controls wall-clock timing.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as planSchema from "../db/schema.js";

// ---------------------------------------------------------------------------
// DB wiring — injected via vi.mock so createPlanVersionSnapshot picks it up
// ---------------------------------------------------------------------------

let client: Client;
let db: LibSQLDatabase<typeof planSchema>;
let dbDir: string;

vi.mock("../db/index.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  getDb: () => db,
  schema: planSchema,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER = "coalesce-test@example.com";
const PLAN_ID = "plan_coalesce_test";

const BASE_CONTENT = JSON.stringify({
  version: 2,
  title: "Test plan",
  brief: "Test brief",
  blocks: [
    {
      id: "blk_abc",
      type: "rich-text",
      title: "Intro",
      data: { markdown: "Hello world." },
    },
  ],
});

const UPDATED_CONTENT_1 = JSON.stringify({
  version: 2,
  title: "Test plan",
  brief: "Test brief",
  blocks: [
    {
      id: "blk_abc",
      type: "rich-text",
      title: "Intro",
      data: { markdown: "Hello world, edited once." },
    },
  ],
});

const CREATED_AT = "2026-06-09T10:00:00.000Z";

async function resetTables() {
  // guard:allow-unscoped -- test-only fixture cleanup resets the isolated temp DB.
  await client.executeMultiple(`
    DELETE FROM plan_versions;
    DELETE FROM plan_sections;
    DELETE FROM plans;
  `);
}

async function seedPlan(content: string = BASE_CONTENT) {
  await db.insert(planSchema.plans).values({
    id: PLAN_ID,
    title: "Test plan",
    brief: "Test brief",
    status: "draft",
    source: "manual",
    repoPath: null,
    currentFocus: null,
    html: null,
    markdown: "# Test plan",
    content,
    hostedPlanId: null,
    hostedPlanUrl: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    approvedAt: null,
    ownerEmail: OWNER,
    orgId: null,
    visibility: "private",
  });
}

async function setPlanContent(content: string) {
  // guard:allow-unscoped -- test-only mutation updates plan content in the isolated temp DB.
  const { eq } = await import("drizzle-orm");
  await db
    .update(planSchema.plans)
    .set({ content, updatedAt: new Date().toISOString() })
    .where(eq(planSchema.plans.id, PLAN_ID));
}

async function setPlanMarkdown(markdown: string) {
  // guard:allow-unscoped -- test-only mutation updates plan markdown in the isolated temp DB.
  const { eq } = await import("drizzle-orm");
  await db
    .update(planSchema.plans)
    .set({ markdown, updatedAt: new Date().toISOString() })
    .where(eq(planSchema.plans.id, PLAN_ID));
}

async function countVersionRows(): Promise<number> {
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select({ id: planSchema.planVersions.id })
    .from(planSchema.planVersions)
    .where(eq(planSchema.planVersions.planId, PLAN_ID));
  return rows.length;
}

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------

beforeAll(async () => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-coalesce-"));
  client = createClient({ url: `file:${path.join(dbDir, "test.db")}` });
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
    CREATE TABLE plan_sections (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'custom',
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      html TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT 'agent',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE plan_versions (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      plan_id TEXT NOT NULL,
      title TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      change_label TEXT,
      created_by TEXT NOT NULL DEFAULT 'agent',
      created_at TEXT NOT NULL
    );
  `);
});

afterAll(() => {
  client?.close();
  if (dbDir) fs.rmSync(dbDir, { recursive: true, force: true });
});

// Use fake timers so we control the clock precisely.
beforeEach(async () => {
  await resetTables();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-09T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createPlanVersionSnapshot — burst coalescing", () => {
  it("creates a snapshot on first forced call", async () => {
    const { createPlanVersionSnapshot } = await import("./plan-versions.js");
    await seedPlan();
    const result = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: "Edited markdown block blk_abc",
      createdBy: "agent",
    });
    expect(result.created).toBe(true);
    expect(result.id).toBeTruthy();
    expect(await countVersionRows()).toBe(1);
  });

  it("coalesces a second forced call with the same label within the window", async () => {
    const { createPlanVersionSnapshot } = await import("./plan-versions.js");
    await seedPlan();

    // First burst: creates snapshot of pre-edit state
    const first = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: "Edited markdown block blk_abc",
      createdBy: "agent",
    });
    expect(first.created).toBe(true);

    // Simulate plan content changing (the actual edit happened)
    await setPlanContent(UPDATED_CONTENT_1);

    // 30 seconds later — still within the 90 s window
    vi.advanceTimersByTime(30_000);

    const second = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: "Edited markdown block blk_abc",
      createdBy: "agent",
    });
    expect(second.created).toBe(false);
    expect(second.reason).toBe("coalesced");
    expect(await countVersionRows()).toBe(1);
  });

  it("coalesces multiple calls across a full typing burst", async () => {
    const { createPlanVersionSnapshot } = await import("./plan-versions.js");
    await seedPlan();

    const LABEL = "Edited markdown block blk_abc";

    for (let tick = 0; tick < 10; tick++) {
      // Use markdown (stored verbatim in the snapshot) so each tick produces
      // a distinct snapshotJson that bypasses the identical-content duplicate guard.
      await setPlanMarkdown(`# Test plan — edit ${tick}`);
      vi.advanceTimersByTime(5_000); // 5 s between saves
      const result = await createPlanVersionSnapshot(PLAN_ID, {
        force: true,
        label: LABEL,
        createdBy: "agent",
      });
      if (tick === 0) {
        expect(result.created).toBe(true);
      } else {
        expect(result.created).toBe(false);
        expect(result.reason).toBe("coalesced");
      }
    }

    // Total elapsed: 50 s → still within 90 s window → exactly 1 row
    expect(await countVersionRows()).toBe(1);
  });

  it("starts a new snapshot when the coalescing window expires", async () => {
    const { createPlanVersionSnapshot } = await import("./plan-versions.js");
    await seedPlan();

    const LABEL = "Edited markdown block blk_abc";

    const first = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: LABEL,
      createdBy: "agent",
    });
    expect(first.created).toBe(true);

    await setPlanMarkdown("# Test plan — edit after first snapshot");

    // Advance past the 90 s coalescing window
    vi.advanceTimersByTime(91_000);

    const second = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: LABEL,
      createdBy: "agent",
    });
    expect(second.created).toBe(true);
    expect(second.id).toBeTruthy();
    expect(await countVersionRows()).toBe(2);
  });

  it("starts a new snapshot immediately when the label differs", async () => {
    const { createPlanVersionSnapshot } = await import("./plan-versions.js");
    await seedPlan();

    const first = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: "Edited markdown block blk_abc",
      createdBy: "agent",
    });
    expect(first.created).toBe(true);

    await setPlanMarkdown("# Test plan — edited blk_abc");

    // Only 5 s later — well within window — but with a different label
    vi.advanceTimersByTime(5_000);

    const second = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: "Edited markdown block blk_xyz", // different block
      createdBy: "agent",
    });
    expect(second.created).toBe(true);
    expect(second.id).not.toBe(first.id);
    expect(await countVersionRows()).toBe(2);
  });

  it("never coalesces explicit safety snapshots (Before restore)", async () => {
    const { createPlanVersionSnapshot } = await import("./plan-versions.js");
    await seedPlan();

    // Simulate a prior inline-edit snapshot with the same pre-restore content
    const first = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: "Before restore",
      createdBy: "agent",
    });
    expect(first.created).toBe(true);

    await setPlanContent(UPDATED_CONTENT_1);

    // 5 s later — within window — but safety snapshots must preserve the
    // immediate pre-restore state when content has changed.
    vi.advanceTimersByTime(5_000);

    const second = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: "Before restore",
      createdBy: "agent",
    });
    expect(second.created).toBe(true);
    expect(await countVersionRows()).toBe(2);
  });

  it("allows a new 'Before restore' when content differs and window has elapsed", async () => {
    const { createPlanVersionSnapshot } = await import("./plan-versions.js");
    await seedPlan();

    const first = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: "Before restore",
      createdBy: "agent",
    });
    expect(first.created).toBe(true);

    await setPlanContent(UPDATED_CONTENT_1);
    vi.advanceTimersByTime(91_000);

    const second = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: "Before restore",
      createdBy: "agent",
    });
    expect(second.created).toBe(true);
    expect(await countVersionRows()).toBe(2);
  });

  it("skips when content is byte-identical regardless of label or timing (duplicate guard)", async () => {
    const { createPlanVersionSnapshot } = await import("./plan-versions.js");
    await seedPlan();

    const first = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: "Before source import",
      createdBy: "agent",
    });
    expect(first.created).toBe(true);

    // Advance past the coalescing window — but do NOT change the plan content
    vi.advanceTimersByTime(120_000);

    const second = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: "Before source import",
      createdBy: "agent",
    });
    expect(second.created).toBe(false);
    expect(second.reason).toBe("duplicate");
    expect(await countVersionRows()).toBe(1);
  });

  it("does not coalesce when force is false (interval guard applies instead)", async () => {
    const { createPlanVersionSnapshot } = await import("./plan-versions.js");
    await seedPlan();

    // First snapshot without force
    const first = await createPlanVersionSnapshot(PLAN_ID, {
      force: false,
      label: "Edited markdown block blk_abc",
      createdBy: "agent",
    });
    expect(first.created).toBe(true);

    await setPlanContent(UPDATED_CONTENT_1);
    vi.advanceTimersByTime(30_000);

    // Within 5-min SNAPSHOT_INTERVAL_MS → interval guard fires, not coalesce
    const second = await createPlanVersionSnapshot(PLAN_ID, {
      force: false,
      label: "Edited markdown block blk_abc",
      createdBy: "agent",
    });
    expect(second.created).toBe(false);
    expect(second.reason).toBe("interval");
  });
});
