/**
 * create-visual-recap: sourceUrl persistence.
 *
 * Verifies that:
 * 1. A valid http(s) sourceUrl is stored on the plan row when provided on
 *    create (new recap).
 * 2. A valid sourceUrl is stored when replacing an existing recap (planId path).
 * 3. An invalid (non-URL) sourceUrl is rejected before the plan is written.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveOrgIdForEmail } from "@agent-native/core/org";
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
vi.mock("@agent-native/core/org", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/org")>();
  return {
    ...actual,
    resolveOrgIdForEmail: vi.fn(async () => null),
  };
});

type AnyAction = { run: (args: any) => Promise<any> };
let createVisualRecap: AnyAction;

const OWNER = "owner@example.com";
const ORG = "org-1";
const PR_URL = "https://github.com/BuilderIO/agent-native/pull/1234";

function asOwner(fn: () => Promise<any> | any) {
  return runWithRequestContext({ userEmail: OWNER, orgId: ORG }, fn);
}

function asOwnerWithoutOrg(fn: () => Promise<any> | any) {
  return runWithRequestContext({ userEmail: OWNER }, fn);
}

async function rawPlan(planId: string) {
  // guard:allow-unscoped -- test-only fixture assertion reads the row just created.
  const [row] = await db
    .select()
    .from(planSchema.plans)
    .where(eq(planSchema.plans.id, planId));
  return row as typeof planSchema.plans.$inferSelect | undefined;
}

const MINIMAL_MDX = {
  "plan.mdx": `---\ntitle: Test Recap\nbrief: A recap.\n---\n\n# Test\n\nMinimal content.`,
};

const EMPTY_WIREFRAME_RECAP_MDX = {
  "plan.mdx": `---
title: Empty Wireframe Recap
brief: Should fail before publishing.
---

<Columns id="ui-comparison">

<Column id="before" label="Before">

<WireframeBlock id="empty-before" title="Before state">
  <Screen surface="browser" />
</WireframeBlock>

</Column>

<Column id="after" label="After">

<WireframeBlock id="filled-after" title="After state">
  <Screen surface="browser" html='<div style="display:flex;flex-direction:column;gap:12px;padding:16px;height:100%"><h1>Resources</h1><p class="wf-muted">Local repo instructions loaded.</p><button class="primary">Save</button></div>' />
</WireframeBlock>

</Column>

</Columns>`,
};

beforeAll(async () => {
  process.env.PLAN_GUEST_ABUSE_DISABLED = "1";
  process.env.PLAN_LOCAL_MODE = "0";

  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-recap-sourceurl-"));
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
});

afterAll(() => {
  client?.close();
  if (dbDir) fs.rmSync(dbDir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.mocked(resolveOrgIdForEmail).mockResolvedValue(null);
  // guard:allow-unscoped -- test-only fixture cleanup resets the isolated temp DB.
  await client.executeMultiple(`
    DELETE FROM plan_events; DELETE FROM plan_comments; DELETE FROM plan_sections;
    DELETE FROM plan_versions; DELETE FROM plan_shares; DELETE FROM plans;
  `);
});

describe("create-visual-recap: sourceUrl", () => {
  it("stores sourceUrl on create when provided", async () => {
    const result = await asOwner(() =>
      createVisualRecap.run({
        mdx: MINIMAL_MDX,
        visibility: "org",
        sourceUrl: PR_URL,
      }),
    );
    expect(result.planId).toBeTruthy();
    const row = await rawPlan(result.planId as string);
    expect(row?.sourceUrl).toBe(PR_URL);
  });

  it("reuses a recap with the same idempotency key", async () => {
    const idempotencyKey = "visual-recap-test-key";
    const first = await asOwner(() =>
      createVisualRecap.run({
        mdx: MINIMAL_MDX,
        visibility: "org",
        sourceUrl: PR_URL,
        idempotencyKey,
      }),
    );
    const planId = first.planId as string;

    const second = await asOwner(() =>
      createVisualRecap.run({
        mdx: {
          "plan.mdx":
            "---\ntitle: Retried Recap\nbrief: Reused by idempotency.\n---\n\n# Retried\n",
        },
        visibility: "org",
        sourceUrl: PR_URL,
        idempotencyKey,
      }),
    );

    expect(second.planId).toBe(planId);
    const rows = await db
      .select({
        id: planSchema.plans.id,
        title: planSchema.plans.title,
        recapIdempotencyKey: planSchema.plans.recapIdempotencyKey,
      })
      .from(planSchema.plans);
    expect(rows).toEqual([
      {
        id: planId,
        title: "Retried Recap",
        recapIdempotencyKey: idempotencyKey,
      },
    ]);

    await expect(
      client.execute({
        sql: `
          INSERT INTO plans (
            id, title, brief, kind, status, source, created_at, updated_at,
            owner_email, org_id, visibility, recap_idempotency_key
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          "duplicate-recap",
          "Duplicate Recap",
          "Duplicate key should be rejected.",
          "recap",
          "review",
          "imported",
          new Date().toISOString(),
          new Date().toISOString(),
          OWNER,
          ORG,
          "private",
          idempotencyKey,
        ],
      }),
    ).rejects.toThrow();
  });

  it("leaves sourceUrl null when not provided on create", async () => {
    const result = await asOwner(() =>
      createVisualRecap.run({
        mdx: MINIMAL_MDX,
        visibility: "org",
      }),
    );
    const row = await rawPlan(result.planId as string);
    expect(row?.sourceUrl).toBeNull();
  });

  it("binds the current org when applying org visibility to an unscoped existing recap", async () => {
    const first = await asOwnerWithoutOrg(() =>
      createVisualRecap.run({
        mdx: MINIMAL_MDX,
        visibility: "private",
      }),
    );
    const planId = first.planId as string;
    const before = await rawPlan(planId);
    expect(before?.orgId).toBeNull();
    expect(before?.visibility).toBe("private");

    await asOwner(() =>
      createVisualRecap.run({
        planId,
        mdx: MINIMAL_MDX,
        visibility: "org",
      }),
    );

    const after = await rawPlan(planId);
    expect(after?.visibility).toBe("org");
    expect(after?.orgId).toBe(ORG);
  });

  it("uses the owner's active org when an org-visible recap request has no org context", async () => {
    vi.mocked(resolveOrgIdForEmail).mockResolvedValueOnce(ORG);

    const result = await asOwnerWithoutOrg(() =>
      createVisualRecap.run({
        mdx: MINIMAL_MDX,
        visibility: "org",
      }),
    );

    expect(resolveOrgIdForEmail).toHaveBeenCalledWith(OWNER);
    const row = await rawPlan(result.planId as string);
    expect(row?.visibility).toBe("org");
    expect(row?.orgId).toBe(ORG);
  });

  it("rejects org-visible recap requests when no org can be resolved", async () => {
    await expect(
      asOwnerWithoutOrg(() =>
        createVisualRecap.run({
          mdx: MINIMAL_MDX,
          visibility: "org",
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
    });

    const rows = await db
      .select({ id: planSchema.plans.id })
      .from(planSchema.plans);
    expect(rows).toHaveLength(0);
  });

  it("stores sourceUrl when replacing an existing recap (planId path)", async () => {
    // Create a recap without a sourceUrl first.
    const first = await asOwner(() =>
      createVisualRecap.run({ mdx: MINIMAL_MDX, visibility: "org" }),
    );
    const planId = first.planId as string;
    const before = await rawPlan(planId);
    expect(before?.sourceUrl).toBeNull();

    // Replace with a sourceUrl.
    await asOwner(() =>
      createVisualRecap.run({
        planId,
        mdx: MINIMAL_MDX,
        visibility: "org",
        sourceUrl: PR_URL,
      }),
    );
    const after = await rawPlan(planId);
    expect(after?.sourceUrl).toBe(PR_URL);
  });

  it("rejects a non-URL string as sourceUrl", async () => {
    await expect(
      asOwner(() =>
        createVisualRecap.run({
          mdx: MINIMAL_MDX,
          visibility: "org",
          sourceUrl: "not-a-url",
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a non-http(s) URL as sourceUrl", async () => {
    await expect(
      asOwner(() =>
        createVisualRecap.run({
          mdx: MINIMAL_MDX,
          visibility: "org",
          sourceUrl: "ftp://example.com/pr/1",
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects nested recap wireframes that would render as empty frames", async () => {
    const error = await asOwner(() =>
      createVisualRecap.run({
        mdx: EMPTY_WIREFRAME_RECAP_MDX,
        visibility: "org",
      }),
    ).then(
      () => null,
      (err) => err,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/empty wireframes[\s\S]*empty-before/i);
    // Malformed source is a CLIENT error: it must surface as a 422 (so the
    // action route echoes the real message and the recap publisher does not
    // retry a deterministic authoring error), NOT a generic 500.
    expect(error.statusCode).toBe(422);

    // guard:allow-unscoped -- test-only assertion reads the isolated temp DB.
    const rows = await db
      .select({ id: planSchema.plans.id })
      .from(planSchema.plans);
    expect(rows).toHaveLength(0);
  });
});
