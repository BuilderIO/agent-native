import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { registerShareableResource } from "@agent-native/core/sharing";

const { PGlite } = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
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

type SqlStatement = string | { sql: string; args?: unknown[] };

function postgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => "$" + ++index);
}

async function execute(statement: SqlStatement) {
  if (typeof statement === "string") {
    const results = [];
    for (const sql of statement
      .split(";")
      .map((value) => value.trim())
      .filter(Boolean))
      results.push(await client.query(postgresSql(sql)));
    return results.at(-1);
  }
  return client.query(postgresSql(statement.sql), statement.args ?? []);
}

let client: PGlite;
let db: PgliteDatabase<typeof planSchema>;
let dbDir: string;

vi.mock("../server/db/index.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  getDb: () => db,
  schema: planSchema,
}));
vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyPlanCommentRecipients: vi.fn(async () => undefined),
}));
vi.mock("../server/lib/local-plan-files.js", () => ({
  writePlanLocalFiles: vi.fn(async () => ({ written: false })),
  localPlansDir: () => "/tmp/plans-test",
  localPlanFolder: (id: string) => `/tmp/plans-test/${id}`,
}));

type AnyAction = { run: (args: any) => Promise<any> };
let createVisualRecap: AnyAction;
let parsePlanMdxFolder: (
  folder: { "plan.mdx": string },
  options?: { salvageInvalidBlocks?: boolean },
) => Promise<{ blocks: Array<{ id: string; type: string; data?: any }> }>;

const OWNER = "owner@example.com";
const ORG = "org-1";

const UNKNOWN_MARKER = "__unknown_block__:";

function asOwner(fn: () => Promise<any> | any) {
  return runWithRequestContext({ userEmail: OWNER, orgId: ORG }, fn);
}

async function rawPlan(planId: string) {
  // guard:allow-unscoped -- test-only fixture assertion reads the row just created.
  const [row] = await db
    .select()
    .from(planSchema.plans)
    .where(eq(planSchema.plans.id, planId));
  return row as typeof planSchema.plans.$inferSelect | undefined;
}

function hasUnknownPlaceholder(content: string | null | undefined): boolean {
  return typeof content === "string" && content.includes(UNKNOWN_MARKER);
}

function storedBlocks(
  content: string | null | undefined,
): Array<{ id: string; type: string; data?: any }> {
  if (typeof content !== "string") return [];
  return (JSON.parse(content).blocks ?? []) as Array<{
    id: string;
    type: string;
    data?: any;
  }>;
}

const CLEAN_RECAP_MDX = {
  "plan.mdx": `---
title: Clean Recap
brief: A before/after recap that publishes cleanly.
---

# Visual Recap

This recap derives from a real diff and publishes with no salvage.

<Columns id="schema-compare">

<Column id="col-before" label="Before">

\`content\` was stored as raw text.

</Column>

<Column id="col-after" label="After">

\`content\` is now normalized JSON.

</Column>

</Columns>`,
};

const DEGRADED_ENDPOINT_MDX = {
  "plan.mdx": `---
title: Endpoint Recap
brief: Endpoint missing response status — must still publish.
---

# Visual Recap

This recap survives even though one block is imperfectly authored.

<Endpoint method="POST" path="/v1/messages" summary="Create a message" responses={[{ "description": "OK" }, { "description": "Rate limited" }]}>

Creates a message and streams the response.

</Endpoint>`,
};

const DEGRADED_TABS_MDX = {
  "plan.mdx": `---
title: Tabs Recap
brief: Tabs missing tab id and child data — must still publish.
---

# Visual Recap

This files-touched recap survives a malformed tabs block.

<TabsBlock tabs={[{ "label": "Before", "blocks": [{ "id": "child-x", "type": "rich-text" }] }]} />`,
};

beforeAll(async () => {
  process.env.PLAN_GUEST_ABUSE_DISABLED = "1";
  process.env.PLAN_LOCAL_MODE = "0";

  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-recap-e2e-"));
  client = await PGlite.create(dbDir);
  db = drizzle(client, { schema: planSchema });

  await execute(`
    CREATE TABLE plans (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, brief TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'plan',
      status TEXT NOT NULL DEFAULT 'draft', source TEXT NOT NULL DEFAULT 'manual',
      repo_path TEXT, current_focus TEXT, html TEXT, markdown TEXT, content TEXT,
      hosted_plan_id TEXT, hosted_plan_url TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, approved_at TEXT,
      usage_agent TEXT, usage_model TEXT,
      usage_input_tokens INTEGER, usage_output_tokens INTEGER,
      usage_cache_read_tokens INTEGER, usage_cache_write_tokens INTEGER,
      usage_cost_cents_x100 INTEGER, usage_cost_source TEXT, usage_recorded_at TEXT,
      source_url TEXT, source_type TEXT, source_repo TEXT, source_pr_number INTEGER,
      source_pr_state TEXT, source_pr_merged_at TEXT, source_author_email TEXT, source_author_name TEXT, source_author_login TEXT, recap_idempotency_key TEXT,
      deleted_at TEXT, deleted_by TEXT,
      owner_email TEXT NOT NULL, org_id TEXT, visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE plan_sections (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'custom', title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', html TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE plan_comments (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, parent_comment_id TEXT, section_id TEXT, kind TEXT NOT NULL DEFAULT 'comment', status TEXT NOT NULL DEFAULT 'open', anchor TEXT, message TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'human', author_email TEXT, author_name TEXT, resolution_target TEXT, mentions_json TEXT, resolved_by TEXT, resolved_at TEXT, consumed_at TEXT, deleted_at TEXT, deleted_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE plan_events (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, type TEXT NOT NULL, message TEXT NOT NULL, payload TEXT, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL);
    CREATE TABLE plan_versions (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL DEFAULT 'local@localhost', plan_id TEXT NOT NULL, title TEXT NOT NULL, snapshot_json TEXT NOT NULL, change_label TEXT, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL, chat_context TEXT, summary_status TEXT, summary_source TEXT, block_count INTEGER, section_count INTEGER, has_canvas BOOLEAN, has_prototype BOOLEAN, preview_text TEXT);
    CREATE TABLE plan_shares (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL, principal_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', created_by TEXT NOT NULL, created_at TEXT NOT NULL, notified_at TEXT);
    CREATE UNIQUE INDEX plans_recap_idempotency_key_unique_idx
      ON plans(owner_email, COALESCE(org_id, ''), recap_idempotency_key)
      WHERE kind = 'recap' AND recap_idempotency_key IS NOT NULL;
  `);

  registerShareableResource({
    type: "plan",
    resourceTable: planSchema.plans,
    sharesTable: planSchema.planShares,
    displayName: "Plan",
    titleColumn: "title",
    getResourcePath: (p: any) => `/recaps/${p.id}`,
    getDb: () => db,
  });

  createVisualRecap = (await import("./create-visual-recap.js"))
    .default as AnyAction;
  parsePlanMdxFolder = (await import("../server/plan-mdx.js"))
    .parsePlanMdxFolder as typeof parsePlanMdxFolder;
});

afterAll(async () => {
  await client?.close();
  if (dbDir) fs.rmSync(dbDir, { recursive: true, force: true });
});

beforeEach(async () => {
  // guard:allow-unscoped -- test-only fixture cleanup resets the isolated temp DB.
  await execute(`
    DELETE FROM plan_events; DELETE FROM plan_comments; DELETE FROM plan_sections;
    DELETE FROM plan_versions; DELETE FROM plan_shares; DELETE FROM plans;
  `);
});

describe("create-visual-recap: end-to-end publish pipeline", () => {
  it("publishes a CLEAN recap end-to-end with no salvage placeholder", async () => {
    const result = await asOwner(() =>
      createVisualRecap.run({
        mdx: CLEAN_RECAP_MDX,
        visibility: "org",
      }),
    );

    expect(result.planId).toBeTruthy();
    const planId = result.planId as string;
    expect(planId).toMatch(/^recap-/);
    expect(result.url).toBe(`/recaps/${planId}`);
    expect(result.path).toBe(`/recaps/${planId}`);

    const row = await rawPlan(planId);
    expect(row).toBeTruthy();
    expect(row?.kind).toBe("recap");
    expect(row?.visibility).toBe("org");
    expect(row?.orgId).toBe(ORG);

    expect(hasUnknownPlaceholder(row?.content)).toBe(false);
    const blocks = storedBlocks(row?.content);
    expect(blocks.some((b) => b.type === "columns")).toBe(true);
    expect(blocks.some((b) => b.type === "rich-text")).toBe(true);
  });

  it("PUBLISHES a DEGRADED recap (api-endpoint missing responses[].status) that strict parse REJECTS", async () => {
    await expect(parsePlanMdxFolder(DEGRADED_ENDPOINT_MDX)).rejects.toThrow();
    const salvaged = await parsePlanMdxFolder(DEGRADED_ENDPOINT_MDX, {
      salvageInvalidBlocks: true,
    });
    expect(salvaged.blocks.map((b) => b.type)).toEqual([
      "rich-text",
      "callout",
    ]);

    const result = await asOwner(() =>
      createVisualRecap.run({
        mdx: DEGRADED_ENDPOINT_MDX,
        visibility: "org",
      }),
    );

    expect(result.planId).toBeTruthy();
    const planId = result.planId as string;
    expect(planId).toMatch(/^recap-/);
    expect(result.url).toBe(`/recaps/${planId}`);

    const row = await rawPlan(planId);
    expect(row).toBeTruthy();
    expect(row?.kind).toBe("recap");
    expect(row?.visibility).toBe("org");

    expect(hasUnknownPlaceholder(row?.content)).toBe(true);
    const blocks = storedBlocks(row?.content);
    expect(blocks.some((b) => b.type === "rich-text")).toBe(true);
    const placeholder = blocks.find(
      (b) =>
        b.type === "callout" &&
        typeof b.data?.body === "string" &&
        b.data.body.includes(UNKNOWN_MARKER),
    );
    expect(placeholder).toBeTruthy();
    expect(placeholder?.data.body).toContain("api-endpoint");
    expect(blocks.some((b) => b.type === "api-endpoint")).toBe(false);
  });

  it("PUBLISHES a DEGRADED recap (tabs missing tab id + child data) that strict parse REJECTS", async () => {
    await expect(parsePlanMdxFolder(DEGRADED_TABS_MDX)).rejects.toThrow();
    const salvaged = await parsePlanMdxFolder(DEGRADED_TABS_MDX, {
      salvageInvalidBlocks: true,
    });
    expect(salvaged.blocks.map((b) => b.type)).toEqual([
      "rich-text",
      "callout",
    ]);

    const result = await asOwner(() =>
      createVisualRecap.run({
        mdx: DEGRADED_TABS_MDX,
        visibility: "org",
      }),
    );

    expect(result.planId).toBeTruthy();
    const planId = result.planId as string;
    expect(result.url).toBe(`/recaps/${planId}`);

    const row = await rawPlan(planId);
    expect(row?.kind).toBe("recap");
    expect(hasUnknownPlaceholder(row?.content)).toBe(true);
    const blocks = storedBlocks(row?.content);
    expect(blocks.some((b) => b.type === "rich-text")).toBe(true);
    const placeholder = blocks.find(
      (b) =>
        b.type === "callout" &&
        typeof b.data?.body === "string" &&
        b.data.body.includes(UNKNOWN_MARKER),
    );
    expect(placeholder).toBeTruthy();
    expect(placeholder?.data.body).toContain("tabs");
    expect(blocks.some((b) => b.type === "tabs")).toBe(false);
  });
});
