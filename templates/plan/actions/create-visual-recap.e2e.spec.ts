/**
 * create-visual-recap: END-TO-END publish pipeline (real local DB).
 *
 * Proves the visual-recap PUBLISH pipeline works against a real (local libsql)
 * DB through the FULL action path — `createVisualRecap.run()` →
 * `import-visual-plan-source` (kind="recap") → `parsePlanMdxFolder(mdx,
 * { salvageInvalidBlocks: true })` → `normalizePlanContent(..., salvage)` → row
 * write → visibility apply — not just unit-level normalize.
 *
 * Background: recaps were 422-ing in prod when the agent emitted a block that
 * PARSES but FAILS schema (ai-services #5448 tabs missing `id` + child `data`;
 * #5449 api-endpoint `responses[].status` missing; #5450 empty `body`). We
 * shipped graceful per-block degradation: `import-visual-plan-source` passes
 * `salvageInvalidBlocks: true` for `kind==="recap"`, so the parser salvages the
 * invalid block into an "Unsupported block" placeholder (a `callout` whose
 * `data.body` contains `__unknown_block__:`) and PUBLISHES the rest.
 *
 * These tests use REAL MDX strings (authored the way the recap agent emits
 * them), and for each degraded case first PROVE the same MDX rejects under the
 * strict (non-salvage) parse — `parsePlanMdxFolder(mdx)` — then prove it
 * PUBLISHES as a recap end-to-end. The reliable parse-but-fail reproduction is
 * the JSON-attribute array forms (`<Endpoint responses={[…]}>`,
 * `<TabsBlock tabs={[…]}>`): they parse into a real block via the registry's
 * `fromAttrs` (which reads the array verbatim) yet fail `planBlockSchema`.
 */
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
import * as planSchema from "../server/db/schema.js";
import { registerShareableResource } from "@agent-native/core/sharing";
import { runWithRequestContext } from "@agent-native/core/server/request-context";

let client: Client;
let db: LibSQLDatabase<typeof planSchema>;
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
// Strict (non-salvage) parser, imported once setup is done, used to PROVE each
// degraded MDX parses-but-fails before asserting it publishes under salvage.
let parsePlanMdxFolder: (
  folder: { "plan.mdx": string },
  options?: { salvageInvalidBlocks?: boolean },
) => Promise<{ blocks: Array<{ id: string; type: string; data?: any }> }>;

const OWNER = "owner@example.com";
const ORG = "org-1";

/** Stable salvage marker (see `parsePlanContentWithSalvage` in plan-content.ts). */
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

/** Does the stored content JSON carry a salvage placeholder? */
function hasUnknownPlaceholder(content: string | null | undefined): boolean {
  return typeof content === "string" && content.includes(UNKNOWN_MARKER);
}

/** Parse stored content JSON back into the normalized block list. */
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

/* -------------------------------------------------------------------------- */
/* MDX fixtures — authored the way the recap agent emits them.                */
/* -------------------------------------------------------------------------- */

/**
 * CLEAN recap: rich-text + a properly-nested `<Columns><Column …>` before/after
 * comparison. Every block validates; nothing is salvaged.
 */
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

/**
 * DEGRADED recap (the key case): an `<Endpoint>` whose `responses` JSON array is
 * missing the required `status` on each entry (ai-services #5449). The block
 * PARSES (the registry `fromAttrs` reads the array verbatim) but FAILS
 * `planBlockSchema` (`responses[].status` is required). A valid leading
 * rich-text block sits before it and must survive.
 */
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

/**
 * DEGRADED recap, second block type: a `<TabsBlock>` whose first tab is missing
 * the required `id` and whose first child block is missing its `data` payload
 * (ai-services #5448). Parses into a real tabs block via the JSON `tabs={[…]}`
 * attribute, fails `planBlockSchema`, and is salvaged.
 */
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
  client = createClient({ url: `file:${path.join(dbDir, "test.db")}` });
  db = drizzle(client, { schema: planSchema });

  await client.executeMultiple(`
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
      source_pr_state TEXT, source_pr_merged_at TEXT, recap_idempotency_key TEXT,
      deleted_at TEXT, deleted_by TEXT,
      owner_email TEXT NOT NULL, org_id TEXT, visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE plan_sections (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'custom', title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', html TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE plan_comments (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, parent_comment_id TEXT, section_id TEXT, kind TEXT NOT NULL DEFAULT 'comment', status TEXT NOT NULL DEFAULT 'open', anchor TEXT, message TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'human', author_email TEXT, author_name TEXT, resolution_target TEXT, mentions_json TEXT, resolved_by TEXT, resolved_at TEXT, consumed_at TEXT, deleted_at TEXT, deleted_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE plan_events (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, type TEXT NOT NULL, message TEXT NOT NULL, payload TEXT, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL);
    CREATE TABLE plan_versions (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL DEFAULT 'local@localhost', plan_id TEXT NOT NULL, title TEXT NOT NULL, snapshot_json TEXT NOT NULL, change_label TEXT, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL);
    CREATE TABLE plan_shares (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL, principal_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', created_by TEXT NOT NULL, created_at TEXT NOT NULL);
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

afterAll(() => {
  client?.close();
  if (dbDir) fs.rmSync(dbDir, { recursive: true, force: true });
});

beforeEach(async () => {
  // guard:allow-unscoped -- test-only fixture cleanup resets the isolated temp DB.
  await client.executeMultiple(`
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

    // run() resolved with a /recaps/<id> url + path and a planId.
    expect(result.planId).toBeTruthy();
    const planId = result.planId as string;
    expect(planId).toMatch(/^recap-/);
    expect(result.url).toBe(`/recaps/${planId}`);
    expect(result.path).toBe(`/recaps/${planId}`);

    // The plan row was actually written to the DB as a recap with org visibility.
    const row = await rawPlan(planId);
    expect(row).toBeTruthy();
    expect(row?.kind).toBe("recap");
    expect(row?.visibility).toBe("org");
    expect(row?.orgId).toBe(ORG);

    // Stored content has NO salvage placeholder and keeps the columns block.
    expect(hasUnknownPlaceholder(row?.content)).toBe(false);
    const blocks = storedBlocks(row?.content);
    expect(blocks.some((b) => b.type === "columns")).toBe(true);
    expect(blocks.some((b) => b.type === "rich-text")).toBe(true);
  });

  it("PUBLISHES a DEGRADED recap (api-endpoint missing responses[].status) that strict parse REJECTS", async () => {
    // 1. PROVE parse-but-fail-schema: strict (non-salvage) parse REJECTS this MDX.
    await expect(parsePlanMdxFolder(DEGRADED_ENDPOINT_MDX)).rejects.toThrow();
    // The salvage parse keeps the valid sibling and turns the bad block into a
    // placeholder (the underlying degradation contract).
    const salvaged = await parsePlanMdxFolder(DEGRADED_ENDPOINT_MDX, {
      salvageInvalidBlocks: true,
    });
    expect(salvaged.blocks.map((b) => b.type)).toEqual([
      "rich-text",
      "callout",
    ]);

    // 2. PUBLISH end-to-end through the real action + DB write.
    const result = await asOwner(() =>
      createVisualRecap.run({
        mdx: DEGRADED_ENDPOINT_MDX,
        visibility: "org",
      }),
    );

    // run() resolved (did NOT 422) and returned a /recaps/<id> url + planId.
    expect(result.planId).toBeTruthy();
    const planId = result.planId as string;
    expect(planId).toMatch(/^recap-/);
    expect(result.url).toBe(`/recaps/${planId}`);

    // Row written to DB.
    const row = await rawPlan(planId);
    expect(row).toBeTruthy();
    expect(row?.kind).toBe("recap");
    expect(row?.visibility).toBe("org");

    // The valid sibling rich-text survived; the bad endpoint became an
    // __unknown_block__ placeholder recording its original type.
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
    // No raw endpoint block survived (it was replaced, not kept).
    expect(blocks.some((b) => b.type === "api-endpoint")).toBe(false);
  });

  it("PUBLISHES a DEGRADED recap (tabs missing tab id + child data) that strict parse REJECTS", async () => {
    // 1. PROVE parse-but-fail-schema for a different block type.
    await expect(parsePlanMdxFolder(DEGRADED_TABS_MDX)).rejects.toThrow();
    const salvaged = await parsePlanMdxFolder(DEGRADED_TABS_MDX, {
      salvageInvalidBlocks: true,
    });
    expect(salvaged.blocks.map((b) => b.type)).toEqual([
      "rich-text",
      "callout",
    ]);

    // 2. PUBLISH end-to-end.
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
