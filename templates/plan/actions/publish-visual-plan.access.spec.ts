/**
 * publish-visual-plan ACCESS + SECURITY surface.
 *
 * publish-visual-plan is the share/account bridge: it loads a plan, then pushes
 * the full plan content (MDX + repoPath) to a connected hosted instance using a
 * DEVICE-level bearer token, and writes hostedPlanId/hostedPlanUrl back onto the
 * plan row. This spec drives the REAL action against a REAL libSQL DB with the
 * REAL core access helpers, mocking only `fetch` and the publish-auth resolver.
 *
 * It pins the access level publish enforces (currently viewer-level read, NOT
 * editor/owner) and the scope of the hostedPlanUrl write-back. Where the
 * behavior is weaker than the rest of the write surface, the test is written to
 * FAIL so the gap is visible (see the two `BUG:` tests).
 */
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
  afterEach,
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
vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyPlanCommentRecipients: vi.fn(async () => undefined),
}));
vi.mock("../server/lib/local-plan-files.js", () => ({
  writePlanLocalFiles: vi.fn(async () => ({ written: false })),
  localPlansDir: () => "/tmp/plans-test",
  localPlanFolder: (id: string) => `/tmp/plans-test/${id}`,
}));

// Control the publish auth resolution. By default "connected".
const publishAuth = {
  value: { url: "https://hosted.example.com", token: "tok_device" } as {
    url: string;
    token: string;
  } | null,
};
vi.mock("../server/lib/plan-publish.js", () => ({
  resolvePlanHostedUrl: () =>
    publishAuth.value?.url ?? "https://plan.agent-native.com",
  resolvePlanPublishAuth: () => publishAuth.value,
  planConnectCommand: (u: string) => `agent-native connect ${u}`,
  DEFAULT_PLAN_HOSTED_URL: "https://plan.agent-native.com",
}));

type AnyAction = { run: (args: any) => Promise<any> };
let createVisualPlan: AnyAction;
let publishVisualPlan: AnyAction;

const OWNER = "owner@example.com";
const OTHER = "outsider@example.com";
const VIEWER = "viewer@example.com";

const fetchMock = vi.fn();

async function createPlanAs(
  ownerEmail: string,
  orgId?: string,
): Promise<string> {
  const r = await runWithRequestContext({ userEmail: ownerEmail, orgId }, () =>
    createVisualPlan.run({
      title: "Plan",
      brief: "secret brief",
      source: "manual",
      status: "review",
      repoPath: "/Users/owner/private-repo",
      sections: [],
      comments: [],
    }),
  );
  return r.planId as string;
}

async function setVisibility(
  planId: string,
  visibility: "private" | "org" | "public",
) {
  // guard:allow-unscoped -- test-only fixture setup mutates the row just created.
  await db
    .update(planSchema.plans)
    .set({ visibility })
    .where(eq(planSchema.plans.id, planId));
}

async function shareViewer(planId: string, principalId: string) {
  await db.insert(planSchema.planShares).values({
    id: `share_${principalId}`,
    resourceId: planId,
    principalType: "user",
    principalId,
    role: "viewer",
    createdBy: OWNER,
    createdAt: "2026-06-05T00:00:00.000Z",
  } as any);
}

async function rawPlan(planId: string) {
  // guard:allow-unscoped -- test-only fixture assertion reads the row just created.
  const [row] = await db
    .select()
    .from(planSchema.plans)
    .where(eq(planSchema.plans.id, planId));
  return row as any;
}

beforeAll(async () => {
  process.env.PLAN_GUEST_ABUSE_DISABLED = "1";
  process.env.PLAN_LOCAL_MODE = "0";
  vi.stubGlobal("fetch", fetchMock);

  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-publish-"));
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
    CREATE TABLE plan_sections (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'custom', title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', html TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE plan_comments (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, parent_comment_id TEXT, section_id TEXT, kind TEXT NOT NULL DEFAULT 'comment', status TEXT NOT NULL DEFAULT 'open', anchor TEXT, message TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'human', author_email TEXT, author_name TEXT, resolution_target TEXT, mentions_json TEXT, resolved_by TEXT, resolved_at TEXT, consumed_at TEXT, deleted_at TEXT, deleted_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE plan_events (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, type TEXT NOT NULL, message TEXT NOT NULL, payload TEXT, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL);
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

  createVisualPlan = (await import("./create-visual-plan.js"))
    .default as AnyAction;
  publishVisualPlan = (await import("./publish-visual-plan.js"))
    .default as AnyAction;
});

afterAll(() => {
  client?.close();
  vi.unstubAllGlobals();
  if (dbDir) fs.rmSync(dbDir, { recursive: true, force: true });
});

beforeEach(async () => {
  // guard:allow-unscoped -- test-only fixture cleanup resets the isolated temp DB.
  await client.executeMultiple(`
    DELETE FROM plan_events; DELETE FROM plan_comments; DELETE FROM plan_sections;
    DELETE FROM plan_versions; DELETE FROM plan_shares; DELETE FROM plans;
  `);
  fetchMock.mockReset();
  publishAuth.value = {
    url: "https://hosted.example.com",
    token: "tok_device",
  };
});

function mockImportOk(hostedId = "hosted_123") {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ planId: hostedId, url: `/plans/${hostedId}` }),
    text: async () => "",
  } as any);
}

describe("publish-visual-plan: connected/needsAuth branches", () => {
  it("returns needsAuth (no fetch) when no account is connected", async () => {
    publishAuth.value = null;
    const planId = await createPlanAs(OWNER);
    const res = await runWithRequestContext({ userEmail: OWNER }, () =>
      publishVisualPlan.run({ planId }),
    );
    expect(res.needsAuth).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("owner can publish a connected plan and the hosted id is stored", async () => {
    mockImportOk("hosted_abc");
    const planId = await createPlanAs(OWNER);
    const res = await runWithRequestContext({ userEmail: OWNER }, () =>
      publishVisualPlan.run({ planId }),
    );
    expect(res.hostedPlanId).toBe("hosted_abc");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // bearer token forwarded
    const [, init] = fetchMock.mock.calls[0];
    expect((init as any).headers.authorization).toBe("Bearer tok_device");
    expect((await rawPlan(planId)).hostedPlanId).toBe("hosted_abc");
  });

  it("a token rejected (401) by the hosted instance surfaces needsAuth, not a hard error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({}),
      text: async () => "nope",
    } as any);
    const planId = await createPlanAs(OWNER);
    const res = await runWithRequestContext({ userEmail: OWNER }, () =>
      publishVisualPlan.run({ planId }),
    );
    expect(res.needsAuth).toBe(true);
    expect((await rawPlan(planId)).hostedPlanId).toBeNull();
  });
});

describe("publish-visual-plan: access level required to publish", () => {
  it("an outsider with NO access cannot publish another user's private plan", async () => {
    mockImportOk();
    const planId = await createPlanAs(OWNER);
    // loadPlanBundle -> resolveAccess null -> throws "not found"; no exfiltration.
    await expect(
      runWithRequestContext({ userEmail: OTHER }, () =>
        publishVisualPlan.run({ planId }),
      ),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // BUG PIN: publish is a consequential distribution action that pushes the
  // FULL plan content (incl. repoPath) to a DEVICE-scoped hosted account and
  // mutates the plan row (hostedPlanId/hostedPlanUrl). Yet it only requires
  // VIEWER-level read access (loadPlanBundle), unlike update-visual-plan which
  // requires `editor`. A user/org/public viewer who can merely READ a plan can
  // therefore exfiltrate it to their own connected instance and stamp a hosted
  // URL onto the owner's row. This test asserts the SECURE expectation
  // (viewer-only publish should be rejected); it currently FAILS, pinning the
  // gap.
  it("BUG: a viewer-only share holder must NOT be able to publish (exfiltrate) the plan", async () => {
    mockImportOk();
    const planId = await createPlanAs(OWNER);
    await shareViewer(planId, VIEWER);

    await expect(
      runWithRequestContext({ userEmail: VIEWER }, () =>
        publishVisualPlan.run({ planId }),
      ),
    ).rejects.toBeTruthy();
    // The plan's full content (repoPath included) must NOT have been forwarded
    // to the device's hosted instance by a mere viewer.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // BUG PIN (related): public-link viewers can publish too. A public plan is
  // readable by any authenticated user (and anonymous public viewers); publish
  // only gates on read, so any of them can push the plan to their device's
  // hosted account.
  it("BUG: a non-owner reader of a PUBLIC plan must NOT be able to publish it", async () => {
    mockImportOk();
    const planId = await createPlanAs(OWNER);
    await setVisibility(planId, "public");

    await expect(
      runWithRequestContext({ userEmail: OTHER }, () =>
        publishVisualPlan.run({ planId }),
      ),
    ).rejects.toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("publish-visual-plan: prototype.mdx round-trip", () => {
  it("publishes prototype.mdx when the plan has a prototype", async () => {
    mockImportOk("hosted_proto");
    const planId = await runWithRequestContext({ userEmail: OWNER }, () =>
      createVisualPlan.run({
        title: "Proto Plan",
        brief: "a prototype plan",
        source: "manual",
        status: "draft",
        sections: [],
        comments: [],
        content: {
          version: 2,
          blocks: [],
          prototype: {
            title: "Proto",
            brief: "brief",
            surface: "mobile",
            initialScreenId: "s1",
            screens: [
              {
                id: "s1",
                title: "Home",
                html: "<div>Home</div>",
              },
            ],
          },
        },
      }),
    ).then((r: any) => r.planId as string);

    await runWithRequestContext({ userEmail: OWNER }, () =>
      publishVisualPlan.run({ planId }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.mdx).toHaveProperty("prototype.mdx");
    expect(body.mdx["prototype.mdx"]).toContain("PrototypeScreen");
  });

  it("does NOT include prototype.mdx when the plan has no prototype", async () => {
    mockImportOk("hosted_noproto");
    const planId = await createPlanAs(OWNER);

    await runWithRequestContext({ userEmail: OWNER }, () =>
      publishVisualPlan.run({ planId }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.mdx).not.toHaveProperty("prototype.mdx");
  });
});

describe("publish-visual-plan: hostedPlanUrl write-back scope", () => {
  // BUG PIN: the final write-back
  //   getDb().update(plans).set({hostedPlanId, hostedPlanUrl}).where(eq(id))
  // is UNSCOPED. Any caller who passes the read gate writes these columns. On a
  // PUBLIC plan, a non-owner reader could overwrite the owner's hostedPlanUrl
  // (the "Open Published Plan" link) to point at an attacker-controlled origin.
  // This asserts the SECURE expectation (a non-owner publish on a public plan
  // does not mutate the owner's hosted columns); it currently FAILS.
  it("BUG: a non-owner publishing a PUBLIC plan must not overwrite the owner's hostedPlanUrl", async () => {
    const planId = await createPlanAs(OWNER);
    await setVisibility(planId, "public");

    // Owner first publishes to the real hosted instance.
    mockImportOk("hosted_owner");
    await runWithRequestContext({ userEmail: OWNER }, () =>
      publishVisualPlan.run({ planId }),
    );
    const ownerUrl = (await rawPlan(planId)).hostedPlanUrl as string;
    expect(ownerUrl).toContain("hosted.example.com");

    // Attacker (a public-plan reader) connects THEIR device to a malicious host
    // and publishes the same plan, hoping to poison the stored hostedPlanUrl.
    publishAuth.value = {
      url: "https://attacker.example",
      token: "tok_attacker",
    };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ planId: "hosted_evil", url: "/plans/hosted_evil" }),
      text: async () => "",
    } as any);

    await runWithRequestContext({ userEmail: OTHER }, () =>
      publishVisualPlan.run({ planId }),
    ).catch(() => undefined);

    // The owner's stored hosted URL must remain the legitimate one.
    expect((await rawPlan(planId)).hostedPlanUrl).toBe(ownerUrl);
  });
});
