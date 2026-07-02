/**
 * SHARING + ACCESS CONTROL end-to-end matrix.
 *
 * Drives the REAL plan actions (create / list / get / update / publish) against
 * a REAL in-memory libSQL database with the REAL core sharing helpers
 * (accessFilter / resolveAccess / assertAccess) and the REAL request context.
 *
 * Only side effects that would touch the filesystem / network / email are
 * mocked (local-plan-files, comment-notifications); everything load-bearing for
 * access control runs for real, so any unauthorized read/write surfaces here.
 *
 * The shared `getDb` is swapped to the test libSQL instance via a mock of
 * `../server/db/index.js` (the same physical module both the actions and
 * `server/plans.ts` import), and the plan resource is registered against that
 * DB in beforeAll.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runWithRequestContext } from "@agent-native/core/server/request-context";
import {
  accessFilter,
  registerShareableResource,
  resolveAccess,
} from "@agent-native/core/sharing";
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

import * as planSchema from "./db/schema.js";
import {
  LOCAL_PLAN_OWNER_EMAIL,
  resolvePlanAccessContext,
} from "./lib/local-identity.js";

// ---------------------------------------------------------------------------
// Test DB wiring. A single libSQL :memory: db is shared across the file; rows
// are reset between tests. The plan resource is registered against it so the
// core sharing helpers reach this DB.
// ---------------------------------------------------------------------------
let client: Client;
let db: LibSQLDatabase<typeof planSchema>;
let dbDir: string;
let dbFile: string;

vi.mock("./db/index.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  getDb: () => db,
  schema: planSchema,
}));

// Keep email + filesystem effects inert.
vi.mock("./lib/comment-notifications.js", () => ({
  notifyPlanCommentRecipients: vi.fn(async () => undefined),
}));
vi.mock("./lib/local-plan-files.js", () => ({
  writePlanLocalFiles: vi.fn(async () => ({ written: false })),
  localPlansDir: () => "/tmp/plans-test",
  localPlanFolder: (id: string) => `/tmp/plans-test/${id}`,
}));

// Imported lazily AFTER the mocks above are registered.
type AnyAction = { run: (args: any) => Promise<any> };
let createVisualPlan: AnyAction;
let listVisualPlans: AnyAction;
let getVisualPlan: AnyAction;
let getPlanAccessStatus: AnyAction;
let requestPlanAccess: AnyAction;
let updateVisualPlan: AnyAction;
let shareResource: AnyAction;
let listResourceShares: AnyAction;
let setResourceVisibility: AnyAction;
let unshareResource: AnyAction;

const OWNER = "owner@example.com";
const OTHER = "outsider@example.com";
const VIEWER = "viewer@example.com";
const EDITOR = "editor@example.com";
const ORG = "org-1";
const OTHER_ORG = "org-2";
const ACCESS_MATRIX_SETUP_TIMEOUT_MS = 30_000;

async function resetTables() {
  // guard:allow-unscoped -- test-only fixture cleanup resets the isolated temp DB.
  await client.executeMultiple(`
    DELETE FROM plan_events;
    DELETE FROM plan_versions;
    DELETE FROM plan_comments;
    DELETE FROM plan_sections;
    DELETE FROM plan_shares;
    DELETE FROM plans;
    DELETE FROM organizations;
  `);
}

function asUser(
  ctx: { userEmail?: string; orgId?: string; userName?: string },
  fn: () => Promise<any> | any,
) {
  return runWithRequestContext(ctx, fn);
}

/** Create a plan owned by `ownerEmail` (optionally in an org). */
async function createPlanAs(
  ownerEmail: string | undefined,
  orgId: string | undefined,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const result = await asUser({ userEmail: ownerEmail, orgId }, () =>
    createVisualPlan.run({
      title: "Plan",
      brief: "A brief",
      source: "manual",
      status: "review",
      sections: [],
      comments: [],
      ...overrides,
    }),
  );
  return result.planId as string;
}

async function seedOrg(id: string, name: string) {
  await client.execute({
    sql: `INSERT INTO organizations (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`,
    args: [id, name, OWNER, Date.now()],
  });
}

async function setVisibility(
  actorEmail: string,
  orgId: string | undefined,
  planId: string,
  visibility: "private" | "org" | "public",
) {
  return asUser({ userEmail: actorEmail, orgId }, () =>
    setResourceVisibility.run({
      resourceType: "plan",
      resourceId: planId,
      visibility,
    }),
  );
}

async function rawPlan(planId: string) {
  // guard:allow-unscoped -- test-only fixture assertion reads the row just created.
  const [row] = await db
    .select()
    .from(planSchema.plans)
    .where(eq(planSchema.plans.id, planId));
  return row as any;
}

async function rawEvents(planId: string) {
  // guard:allow-unscoped -- test-only fixture assertion reads rows for the row just created.
  return db
    .select()
    .from(planSchema.planEvents)
    .where(eq(planSchema.planEvents.planId, planId));
}

beforeAll(async () => {
  process.env.PLAN_GUEST_ABUSE_DISABLED = "1";
  // Force hosted-style behavior off the local single-user fallback unless a
  // test explicitly opts into local mode.
  process.env.PLAN_LOCAL_MODE = "0";

  // A temp FILE db (not :memory:) so every pooled libSQL connection — drizzle
  // queries, raw executeMultiple, the share actions — sees the same tables.
  // ":memory:" gives each connection its own private database.
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-access-"));
  dbFile = path.join(dbDir, "test.db");
  client = createClient({ url: `file:${dbFile}` });
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
    CREATE TABLE plan_comments (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      parent_comment_id TEXT,
      section_id TEXT,
      kind TEXT NOT NULL DEFAULT 'comment',
      status TEXT NOT NULL DEFAULT 'open',
      anchor TEXT,
      message TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'human',
      author_email TEXT,
      author_name TEXT,
      resolution_target TEXT,
      mentions_json TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      consumed_at TEXT,
      deleted_at TEXT,
      deleted_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE plan_events (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT,
      created_by TEXT NOT NULL DEFAULT 'agent',
      created_at TEXT NOT NULL
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
    CREATE TABLE plan_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE plan_assets (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      data TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      allowed_domain TEXT,
      a2a_secret TEXT
    );
  `);

  registerShareableResource({
    type: "plan",
    resourceTable: planSchema.plans,
    sharesTable: planSchema.planShares,
    displayName: "Plan",
    titleColumn: "title",
    getResourcePath: (plan: any) => `/plans/${plan.id}`,
    getDb: () => db,
    resolveAccessContext: resolvePlanAccessContext,
  });

  createVisualPlan = (await import("../actions/create-visual-plan.js"))
    .default as AnyAction;
  listVisualPlans = (await import("../actions/list-visual-plans.js"))
    .default as AnyAction;
  getVisualPlan = (await import("../actions/get-visual-plan.js"))
    .default as AnyAction;
  getPlanAccessStatus = (await import("../actions/get-plan-access-status.js"))
    .default as AnyAction;
  requestPlanAccess = (await import("../actions/request-plan-access.js"))
    .default as AnyAction;
  updateVisualPlan = (await import("../actions/update-visual-plan.js"))
    .default as AnyAction;
  shareResource = (
    await import("@agent-native/core/sharing/actions/share-resource")
  ).default as AnyAction;
  listResourceShares = (
    await import("@agent-native/core/sharing/actions/list-resource-shares")
  ).default as AnyAction;
  setResourceVisibility = (
    await import("@agent-native/core/sharing/actions/set-resource-visibility")
  ).default as AnyAction;
  unshareResource = (
    await import("@agent-native/core/sharing/actions/unshare-resource")
  ).default as AnyAction;
}, ACCESS_MATRIX_SETUP_TIMEOUT_MS);

afterAll(() => {
  client?.close();
  if (dbDir) fs.rmSync(dbDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetTables();
});

// ===========================================================================
// 1. OWNER read/edit (allow)
// ===========================================================================
describe("owner access", () => {
  it("owner can read and edit their own private plan", async () => {
    const planId = await createPlanAs(OWNER, undefined);

    const got = await asUser({ userEmail: OWNER }, () =>
      getVisualPlan.run({ id: planId }),
    );
    expect(got.planId).toBe(planId);

    const updated = await asUser({ userEmail: OWNER }, () =>
      updateVisualPlan.run({
        planId,
        title: "Renamed by owner",
        contentPatches: [],
        sections: [],
        comments: [],
        consumedCommentIds: [],
      }),
    );
    expect(updated.plan.title).toBe("Renamed by owner");
    expect((await rawPlan(planId)).title).toBe("Renamed by owner");
  });

  it("owner sees only their own plan in the scoped list", async () => {
    const mine = await createPlanAs(OWNER, undefined);
    await createPlanAs(OTHER, undefined); // someone else's private plan

    const list = await asUser({ userEmail: OWNER }, () =>
      listVisualPlans.run({}),
    );
    expect(list.map((p: any) => p.id)).toEqual([mine]);
  });

  it("generic sharing actions honor the local single-user owner for signed local browsers", async () => {
    const previous = process.env.PLAN_LOCAL_MODE;
    process.env.PLAN_LOCAL_MODE = "1";
    try {
      const planId = await createPlanAs(OWNER, ORG);
      let row = await rawPlan(planId);
      expect(row.ownerEmail).toBe(LOCAL_PLAN_OWNER_EMAIL);
      expect(row.orgId).toBeNull();

      await asUser({ userEmail: OWNER, orgId: ORG }, async () => {
        await expect(resolveAccess("plan", planId)).resolves.toMatchObject({
          role: "owner",
        });
        await expect(
          listResourceShares.run({
            resourceType: "plan",
            resourceId: planId,
          }),
        ).resolves.toMatchObject({
          ownerEmail: LOCAL_PLAN_OWNER_EMAIL,
          visibility: "private",
          role: "owner",
        });
        await expect(
          setResourceVisibility.run({
            resourceType: "plan",
            resourceId: planId,
            visibility: "org",
          }),
        ).resolves.toEqual({ ok: true, visibility: "org" });
      });

      row = await rawPlan(planId);
      expect(row.orgId).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.PLAN_LOCAL_MODE;
      else process.env.PLAN_LOCAL_MODE = previous;
    }
  });
});

// ===========================================================================
// 2. NON-owner read/edit of a private plan (DENY)
// ===========================================================================
describe("non-owner on a private plan (deny)", () => {
  it("a different signed-in user cannot READ another user's private plan", async () => {
    const planId = await createPlanAs(OWNER, undefined);

    await expect(
      asUser({ userEmail: OTHER }, () => getVisualPlan.run({ id: planId })),
    ).rejects.toThrow(); // loadPlanBundle -> resolveAccess null -> "not found"
  });

  it("a different signed-in user cannot EDIT another user's private plan", async () => {
    const planId = await createPlanAs(OWNER, undefined);

    await expect(
      asUser({ userEmail: OTHER }, () =>
        updateVisualPlan.run({
          planId,
          title: "Hijacked",
          contentPatches: [],
          sections: [],
          comments: [],
          consumedCommentIds: [],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    // The title must be unchanged.
    expect((await rawPlan(planId)).title).toBe("Plan");
  });

  it("the private plan never appears in another user's list", async () => {
    const planId = await createPlanAs(OWNER, undefined);
    const list = await asUser({ userEmail: OTHER }, () =>
      listVisualPlans.run({}),
    );
    expect(list.map((p: any) => p.id)).not.toContain(planId);
  });
});

// ===========================================================================
// 3. Private-link recovery metadata (existence only, no content)
// ===========================================================================
describe("private plan access status and requests", () => {
  it("reveals a real private plan URL without revealing the plan content", async () => {
    await seedOrg(ORG, "Acme Planning");
    const planId = await createPlanAs(OWNER, ORG, {
      brief: "PRIVATE-PLAN-SECRET",
    });

    const status = await asUser({ userEmail: OTHER }, () =>
      getPlanAccessStatus.run({ planId }),
    );
    expect(status).toMatchObject({
      exists: true,
      hasAccess: false,
      signedIn: true,
      viewerEmail: OTHER,
      role: null,
      orgId: null,
      orgName: null,
      visibility: "private",
    });
    expect(JSON.stringify(status)).not.toContain("PRIVATE-PLAN-SECRET");
    expect(JSON.stringify(status)).not.toContain("Acme Planning");

    await expect(
      asUser({ userEmail: OTHER }, () => getVisualPlan.run({ id: planId })),
    ).rejects.toThrow();
  });

  it("returns a distinct missing-plan status", async () => {
    await expect(
      asUser({ userEmail: OTHER }, () =>
        getPlanAccessStatus.run({ planId: "plan_nope" }),
      ),
    ).resolves.toMatchObject({
      exists: false,
      hasAccess: false,
      signedIn: true,
      viewerEmail: OTHER,
      role: null,
      visibility: null,
    });
  });

  it("includes the org name for inaccessible org-visible plans", async () => {
    await seedOrg(ORG, "Acme Planning");
    const planId = await createPlanAs(OWNER, ORG, {
      brief: "ORG-ONLY-PLAN-SECRET",
    });
    await setVisibility(OWNER, ORG, planId, "org");

    const status = await asUser({ userEmail: OTHER, orgId: OTHER_ORG }, () =>
      getPlanAccessStatus.run({ planId }),
    );

    expect(status).toMatchObject({
      exists: true,
      hasAccess: false,
      signedIn: true,
      viewerEmail: OTHER,
      role: null,
      orgId: ORG,
      orgName: "Acme Planning",
      visibility: "org",
    });
    expect(JSON.stringify(status)).not.toContain("ORG-ONLY-PLAN-SECRET");
  });

  it("records a signed-in request for access without granting access", async () => {
    const planId = await createPlanAs(OWNER, undefined);

    const result = await asUser({ userEmail: OTHER }, () =>
      requestPlanAccess.run({ planId }),
    );
    expect(result).toMatchObject({
      ok: true,
      alreadyHasAccess: false,
    });

    await expect(
      asUser({ userEmail: OTHER }, () => getVisualPlan.run({ id: planId })),
    ).rejects.toThrow();
    expect(await rawEvents(planId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "plan.access_requested",
          createdBy: "human",
          message: `${OTHER} requested access to this plan.`,
        }),
      ]),
    );
  });

  it("requires a signed-in account to request access", async () => {
    const planId = await createPlanAs(OWNER, undefined);

    await expect(
      asUser({}, () => requestPlanAccess.run({ planId })),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

// ===========================================================================
// 4. Shared-with reviewer: read (allow) + edit gated by share role
// ===========================================================================
describe("explicit user shares", () => {
  it("a VIEWER share grants read but NOT edit", async () => {
    const planId = await createPlanAs(OWNER, undefined);
    await asUser({ userEmail: OWNER }, () =>
      shareResource.run({
        resourceType: "plan",
        resourceId: planId,
        principalType: "user",
        principalId: VIEWER,
        role: "viewer",
      }),
    );

    // read allowed
    const got = await asUser({ userEmail: VIEWER }, () =>
      getVisualPlan.run({ id: planId }),
    );
    expect(got.planId).toBe(planId);

    // edit denied (viewer < editor)
    await expect(
      asUser({ userEmail: VIEWER }, () =>
        updateVisualPlan.run({
          planId,
          title: "Viewer tried to edit",
          contentPatches: [],
          sections: [],
          comments: [],
          consumedCommentIds: [],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await rawPlan(planId)).title).toBe("Plan");

    // appears in viewer's scoped list (shared-with-me)
    const list = await asUser({ userEmail: VIEWER }, () =>
      listVisualPlans.run({}),
    );
    expect(list.map((p: any) => p.id)).toContain(planId);
  });

  it("an EDITOR share grants read AND edit", async () => {
    const planId = await createPlanAs(OWNER, undefined);
    await asUser({ userEmail: OWNER }, () =>
      shareResource.run({
        resourceType: "plan",
        resourceId: planId,
        principalType: "user",
        principalId: EDITOR,
        role: "editor",
      }),
    );

    const updated = await asUser({ userEmail: EDITOR }, () =>
      updateVisualPlan.run({
        planId,
        title: "Editor edit",
        contentPatches: [],
        sections: [],
        comments: [],
        consumedCommentIds: [],
      }),
    );
    expect(updated.plan.title).toBe("Editor edit");
  });

  it("a non-owner/non-admin share holder cannot re-share or change visibility", async () => {
    const planId = await createPlanAs(OWNER, undefined);
    await asUser({ userEmail: OWNER }, () =>
      shareResource.run({
        resourceType: "plan",
        resourceId: planId,
        principalType: "user",
        principalId: EDITOR,
        role: "editor",
      }),
    );

    // editor (not admin/owner) must not be able to grant access to others
    await expect(
      asUser({ userEmail: EDITOR }, () =>
        shareResource.run({
          resourceType: "plan",
          resourceId: planId,
          principalType: "user",
          principalId: OTHER,
          role: "editor",
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      setVisibility(EDITOR, undefined, planId, "public"),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

// ===========================================================================
// 4. Public / published review link: read-only (allow read, deny write/delete)
// ===========================================================================
describe("public review link", () => {
  it("a signed-in NON-owner can READ a public plan but NOT edit it", async () => {
    const planId = await createPlanAs(OWNER, undefined);
    await setVisibility(OWNER, undefined, planId, "public");

    // read allowed for any signed-in user
    const got = await asUser({ userEmail: OTHER }, () =>
      getVisualPlan.run({ id: planId }),
    );
    expect(got.planId).toBe(planId);

    // public visibility must NOT imply edit
    await expect(
      asUser({ userEmail: OTHER }, () =>
        updateVisualPlan.run({
          planId,
          title: "Public viewer edit",
          contentPatches: [],
          sections: [],
          comments: [],
          consumedCommentIds: [],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await rawPlan(planId)).title).toBe("Plan");
  });

  it("an anonymous public-link VIEWER can read but cannot comment", async () => {
    const planId = await createPlanAs(OWNER, undefined);
    await setVisibility(OWNER, undefined, planId, "public");

    const anon =
      "public-123e4567-e89b-12d3-a456-426614174000@agent-native.local";

    // read works (resolveAccess honors public)
    const got = await asUser({ userEmail: anon }, () =>
      getVisualPlan.run({ id: planId }),
    );
    expect(got.planId).toBe(planId);

    // commenting is blocked for the synthetic anonymous identity
    await expect(
      asUser({ userEmail: anon }, () =>
        updateVisualPlan.run({
          planId,
          contentPatches: [],
          sections: [],
          comments: [
            {
              message: "anon comment",
              kind: "comment",
              status: "open",
              createdBy: "human",
            },
          ],
          consumedCommentIds: [],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("a real signed-in account CAN comment on a public plan (read-only viewer + account)", async () => {
    const planId = await createPlanAs(OWNER, undefined);
    await setVisibility(OWNER, undefined, planId, "public");

    const result = await asUser({ userEmail: OTHER, userName: "Other" }, () =>
      updateVisualPlan.run({
        planId,
        contentPatches: [],
        sections: [],
        comments: [
          {
            message: "Looks good, one nit.",
            kind: "comment",
            status: "open",
            createdBy: "human",
          },
        ],
        consumedCommentIds: [],
      }),
    );
    expect(result.comments.length).toBe(1);
    expect(result.comments[0].authorEmail).toBe(OTHER);
    // The plan body itself is untouched by a comment-only call.
    expect((await rawPlan(planId)).title).toBe("Plan");
  });

  it("a public plan does NOT appear in other users' default scoped lists", async () => {
    const planId = await createPlanAs(OWNER, undefined);
    await setVisibility(OWNER, undefined, planId, "public");

    const list = await asUser({ userEmail: OTHER }, () =>
      listVisualPlans.run({}),
    );
    expect(list.map((p: any) => p.id)).not.toContain(planId);
  });
});

// ===========================================================================
// 5. Org visibility
// ===========================================================================
describe("org visibility", () => {
  it("an org-visible plan is readable by same-org members, not other orgs", async () => {
    const planId = await createPlanAs(OWNER, ORG);
    await setVisibility(OWNER, ORG, planId, "org");

    // same org member reads
    const got = await asUser({ userEmail: VIEWER, orgId: ORG }, () =>
      getVisualPlan.run({ id: planId }),
    );
    expect(got.planId).toBe(planId);

    // other org cannot read
    await expect(
      asUser({ userEmail: OTHER, orgId: OTHER_ORG }, () =>
        getVisualPlan.run({ id: planId }),
      ),
    ).rejects.toThrow();
  });

  it("org visibility grants read but not edit to a non-owner org member", async () => {
    const planId = await createPlanAs(OWNER, ORG);
    await setVisibility(OWNER, ORG, planId, "org");

    await expect(
      asUser({ userEmail: VIEWER, orgId: ORG }, () =>
        updateVisualPlan.run({
          planId,
          title: "org member edit",
          contentPatches: [],
          sections: [],
          comments: [],
          consumedCommentIds: [],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("org-visible plan appears in same-org member's list but not other orgs", async () => {
    const planId = await createPlanAs(OWNER, ORG);
    await setVisibility(OWNER, ORG, planId, "org");

    const sameOrg = await asUser({ userEmail: VIEWER, orgId: ORG }, () =>
      listVisualPlans.run({}),
    );
    expect(sameOrg.map((p: any) => p.id)).toContain(planId);

    const otherOrg = await asUser({ userEmail: OTHER, orgId: OTHER_ORG }, () =>
      listVisualPlans.run({}),
    );
    expect(otherOrg.map((p: any) => p.id)).not.toContain(planId);
  });
});

// ===========================================================================
// 6. Visibility transitions + revocation
// ===========================================================================
describe("visibility transitions and revocation", () => {
  it("public -> private revokes a non-owner's read access", async () => {
    const planId = await createPlanAs(OWNER, undefined);
    await setVisibility(OWNER, undefined, planId, "public");

    // readable while public
    await asUser({ userEmail: OTHER }, () => getVisualPlan.run({ id: planId }));

    // flip back to private
    await setVisibility(OWNER, undefined, planId, "private");
    expect((await rawPlan(planId)).visibility).toBe("private");

    await expect(
      asUser({ userEmail: OTHER }, () => getVisualPlan.run({ id: planId })),
    ).rejects.toThrow();
  });

  it("unshare revokes a previously-granted viewer", async () => {
    const planId = await createPlanAs(OWNER, undefined);
    await asUser({ userEmail: OWNER }, () =>
      shareResource.run({
        resourceType: "plan",
        resourceId: planId,
        principalType: "user",
        principalId: VIEWER,
        role: "viewer",
      }),
    );
    // viewer can read
    await asUser({ userEmail: VIEWER }, () =>
      getVisualPlan.run({ id: planId }),
    );

    await asUser({ userEmail: OWNER }, () =>
      unshareResource.run({
        resourceType: "plan",
        resourceId: planId,
        principalType: "user",
        principalId: VIEWER,
      }),
    );

    await expect(
      asUser({ userEmail: VIEWER }, () => getVisualPlan.run({ id: planId })),
    ).rejects.toThrow();
    const list = await asUser({ userEmail: VIEWER }, () =>
      listVisualPlans.run({}),
    );
    expect(list.map((p: any) => p.id)).not.toContain(planId);
  });
});

// ===========================================================================
// 7. Adversarial / fuzz
// ===========================================================================
describe("adversarial", () => {
  it("cannot read or edit a non-existent plan id", async () => {
    await expect(
      asUser({ userEmail: OTHER }, () =>
        getVisualPlan.run({ id: "plan_nope" }),
      ),
    ).rejects.toThrow();
    await expect(
      asUser({ userEmail: OTHER }, () =>
        updateVisualPlan.run({
          planId: "plan_nope",
          title: "x",
          contentPatches: [],
          sections: [],
          comments: [],
          consumedCommentIds: [],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("a SQL-injection-shaped plan id does not leak other plans", async () => {
    const planId = await createPlanAs(OWNER, undefined);
    const evil = `' OR '1'='1`;
    await expect(
      asUser({ userEmail: OTHER }, () => getVisualPlan.run({ id: evil })),
    ).rejects.toThrow();
    // The owner's plan is still private and intact.
    expect((await rawPlan(planId)).visibility).toBe("private");
  });

  it("an unauthenticated hosted request (no identity) cannot read a private plan", async () => {
    const planId = await createPlanAs(OWNER, undefined);
    await expect(
      asUser({}, () => getVisualPlan.run({ id: planId })),
    ).rejects.toThrow();
  });

  it("an unauthenticated hosted request cannot edit a private plan", async () => {
    const planId = await createPlanAs(OWNER, undefined);
    await expect(
      asUser({}, () =>
        updateVisualPlan.run({
          planId,
          title: "anon edit",
          contentPatches: [],
          sections: [],
          comments: [],
          consumedCommentIds: [],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await rawPlan(planId)).title).toBe("Plan");
  });

  it("an unauthenticated hosted list returns no rows (no identity = no scope)", async () => {
    await createPlanAs(OWNER, undefined);
    const list = await asUser({}, () => listVisualPlans.run({}));
    expect(list).toEqual([]);
  });

  it("a viewer cannot mark another user's open comments consumed", async () => {
    // owner makes a public plan and another account leaves a comment
    const planId = await createPlanAs(OWNER, undefined);
    await setVisibility(OWNER, undefined, planId, "public");
    const commentResult = await asUser({ userEmail: VIEWER }, () =>
      updateVisualPlan.run({
        planId,
        contentPatches: [],
        sections: [],
        comments: [
          {
            message: "open question",
            kind: "comment",
            status: "open",
            createdBy: "human",
          },
        ],
        consumedCommentIds: [],
      }),
    );
    const commentId = commentResult.comments[0].id as string;

    // A non-owner public viewer tries to resolve/consume it. consumedCommentIds
    // makes this NOT a comment-only request, so it must hit the editor gate.
    await expect(
      asUser({ userEmail: OTHER }, () =>
        updateVisualPlan.run({
          planId,
          contentPatches: [],
          sections: [],
          comments: [],
          consumedCommentIds: [commentId],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    // Comment is still unconsumed.
    const [row] = await db
      .select()
      .from(planSchema.planComments)
      .where(eq(planSchema.planComments.id, commentId));
    expect((row as any).consumedAt).toBeNull();
  });
});

// ===========================================================================
// 8. Local single-user mode (no-login) ownership fallback
// ===========================================================================
const LOCAL_OWNER = "local@agent-native.local";

describe("local single-user mode", () => {
  beforeEach(() => {
    process.env.PLAN_LOCAL_MODE = "1";
    delete process.env.AUTH_MODE;
  });
  afterAll(() => {
    process.env.PLAN_LOCAL_MODE = "0";
  });

  // Faithful to the runtime: in local mode the framework's anonymousOwner
  // resolver (`resolvePlanAnonymousOwner`) injects the local single-user
  // identity into the request context, so the SAME identity is on every
  // create/read/list/edit. This is what core-routes-plugin / agent-chat do.
  it("the local single-user identity can create, read, list and edit its own plan", async () => {
    const planId = await asUser({ userEmail: LOCAL_OWNER }, async () => {
      const r = await createVisualPlan.run({
        title: "Local plan",
        brief: "b",
        source: "manual",
        status: "review",
        sections: [],
        comments: [],
      });
      return r.planId as string;
    });

    await asUser({ userEmail: LOCAL_OWNER }, () =>
      getVisualPlan.run({ id: planId }),
    );
    const list = await asUser({ userEmail: LOCAL_OWNER }, () =>
      listVisualPlans.run({}),
    );
    expect(list.map((p: any) => p.id)).toContain(planId);

    const updated = await asUser({ userEmail: LOCAL_OWNER }, () =>
      updateVisualPlan.run({
        planId,
        title: "Local edit",
        contentPatches: [],
        sections: [],
        comments: [],
        consumedCommentIds: [],
      }),
    );
    expect(updated.plan.title).toBe("Local edit");
    expect((await rawPlan(planId)).ownerEmail).toBe(LOCAL_OWNER);
  });

  // In local mode, the CLI/no-login agent and a signed-in local browser are the
  // same single-user workspace. A dev/auth session must not strand a locally
  // created private plan behind the synthetic local owner.
  it("a signed-in local browser can read and edit a local-owned plan", async () => {
    const planId = await asUser({ userEmail: LOCAL_OWNER }, async () => {
      const r = await createVisualPlan.run({
        title: "Local-owned",
        brief: "b",
        source: "manual",
        status: "review",
        sections: [],
        comments: [],
      });
      return r.planId as string;
    });

    const readable = await asUser({ userEmail: OTHER }, () =>
      getVisualPlan.run({ id: planId }),
    );
    expect(readable.plan.id).toBe(planId);

    const updated = await asUser({ userEmail: OTHER }, () =>
      updateVisualPlan.run({
        planId,
        title: "Local browser edit",
        contentPatches: [],
        sections: [],
        comments: [],
        consumedCommentIds: [],
      }),
    );
    expect(updated.plan.title).toBe("Local browser edit");
    expect((await rawPlan(planId)).ownerEmail).toBe(LOCAL_OWNER);
  });

  it("local create with no injected identity can read back the plan it just wrote", async () => {
    const created = await asUser({}, () =>
      createVisualPlan.run({
        title: "No injected identity",
        brief: "b",
        source: "manual",
        status: "review",
        sections: [],
        comments: [],
      }),
    );

    expect(created.plan.title).toBe("No injected identity");
    const [row] = await db
      .select()
      .from(planSchema.plans)
      .where(eq(planSchema.plans.id, created.planId as string));
    expect(row).toBeTruthy();
    expect((row as any).ownerEmail).toBe(LOCAL_OWNER);

    const readable = await asUser({}, () =>
      getVisualPlan.run({ id: created.planId as string }),
    );
    expect(readable.plan.id).toBe(created.planId);
  });
});
