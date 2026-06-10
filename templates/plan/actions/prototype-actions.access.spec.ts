/**
 * AUTHZ / ownership matrix for the NEW prototype actions:
 *   - create-prototype-plan
 *   - convert-visual-plan-to-prototype
 *
 * These landed with the prototype prototype feature and had no access spec of
 * their own. This file drives the REAL actions against a REAL libSQL DB with the
 * REAL core sharing helpers (registerShareableResource / resolveAccess /
 * assertAccess) and the REAL request context, mocking only filesystem/email side
 * effects. It pins:
 *
 *   create-prototype-plan
 *     - owner scoping: the new plan row is owned by the request user
 *       (requirePlanOwnerEmailForWrite), private, and org-tagged from context.
 *     - an unauthenticated hosted request (no identity, PLAN_LOCAL_MODE=0) is
 *       rejected ("requires an authenticated user"), nothing persisted.
 *     - a guest-author identity may NOT create on a hosted deploy.
 *     - one user cannot create a plan that another user can read.
 *
 *   convert-visual-plan-to-prototype
 *     - requires EDITOR on the SOURCE plan (assertPlanEditor) — a non-owner with
 *       no access, a viewer-only share holder, and a public-link reader must all
 *       be rejected and must NOT mutate the owner's plan row.
 *     - the owner CAN convert their own convertible plan.
 *
 * Mirrors the proven setup in publish-visual-plan.access.spec.ts /
 * sharing-access-matrix.spec.ts.
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
let createPrototypePlan: AnyAction;
let convertVisualPlanToPrototype: AnyAction;
let createVisualPlan: AnyAction;
let getVisualPlan: AnyAction;
let shareResource: AnyAction;
let setResourceVisibility: AnyAction;

const OWNER = "owner@example.com";
const OTHER = "outsider@example.com";
const VIEWER = "viewer@example.com";
const ORG = "org-1";
const ACCESS_SPEC_SETUP_TIMEOUT_MS = 30_000;

function asUser(
  ctx: { userEmail?: string; orgId?: string; userName?: string },
  fn: () => Promise<any> | any,
) {
  return runWithRequestContext(ctx, fn);
}

async function rawPlan(planId: string) {
  // guard:allow-unscoped -- test-only fixture assertion reads the row just created.
  const [row] = await db
    .select()
    .from(planSchema.plans)
    .where(eq(planSchema.plans.id, planId));
  return row as any;
}

async function rawSections(planId: string) {
  // guard:allow-unscoped -- test-only fixture assertion reads rows for the row just created.
  return db
    .select()
    .from(planSchema.planSections)
    .where(eq(planSchema.planSections.planId, planId));
}

async function rawEvents(planId: string) {
  // guard:allow-unscoped -- test-only fixture assertion reads rows for the row just created.
  return db
    .select()
    .from(planSchema.planEvents)
    .where(eq(planSchema.planEvents.planId, planId));
}

async function countPlans() {
  // guard:allow-unscoped -- test-only fixture count verifies rejected creates persist nothing.
  const rows = await db.select().from(planSchema.plans);
  return rows.length;
}

/**
 * Create a prototype plan as the given user. Returns the plan id (or null if the
 * action threw — used by negative tests). Prototype plans embed a canvas derived
 * from their screens, which makes them convertible.
 */
async function createPrototypeAs(
  ownerEmail: string | undefined,
  orgId?: string,
): Promise<string> {
  const r = await asUser({ userEmail: ownerEmail, orgId }, () =>
    createPrototypePlan.run({
      title: "Proto",
      brief: "What should the flow feel like?",
      source: "manual",
      status: "review",
      screens: [
        {
          title: "Start",
          summary: "first",
          html: '<button data-goto="finish">Go</button>',
        },
        { title: "Finish", summary: "second", html: "<p>Done</p>" },
      ],
      transitions: [{ from: "start", to: "finish", label: "Go" }],
      sections: [],
      comments: [],
    }),
  );
  return r.planId as string;
}

beforeAll(async () => {
  process.env.PLAN_GUEST_ABUSE_DISABLED = "1";
  process.env.PLAN_LOCAL_MODE = "0";

  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-proto-access-"));
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
      source_url TEXT,
      owner_email TEXT NOT NULL, org_id TEXT, visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE plan_sections (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'custom', title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', html TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE plan_comments (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, parent_comment_id TEXT, section_id TEXT, kind TEXT NOT NULL DEFAULT 'comment', status TEXT NOT NULL DEFAULT 'open', anchor TEXT, message TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'human', author_email TEXT, author_name TEXT, resolution_target TEXT, mentions_json TEXT, resolved_by TEXT, resolved_at TEXT, consumed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE plan_events (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, type TEXT NOT NULL, message TEXT NOT NULL, payload TEXT, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL);
    CREATE TABLE plan_versions (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL DEFAULT 'local@localhost', plan_id TEXT NOT NULL, title TEXT NOT NULL, snapshot_json TEXT NOT NULL, change_label TEXT, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL);
    CREATE TABLE plan_shares (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL, principal_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', created_by TEXT NOT NULL, created_at TEXT NOT NULL);
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

  createPrototypePlan = (await import("./create-prototype-plan.js"))
    .default as AnyAction;
  convertVisualPlanToPrototype = (
    await import("./convert-visual-plan-to-prototype.js")
  ).default as AnyAction;
  createVisualPlan = (await import("./create-visual-plan.js"))
    .default as AnyAction;
  getVisualPlan = (await import("./get-visual-plan.js")).default as AnyAction;
  shareResource = (
    await import("@agent-native/core/sharing/actions/share-resource")
  ).default as AnyAction;
  setResourceVisibility = (
    await import("@agent-native/core/sharing/actions/set-resource-visibility")
  ).default as AnyAction;
}, ACCESS_SPEC_SETUP_TIMEOUT_MS);

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

// ===========================================================================
// create-prototype-plan: owner scoping
// ===========================================================================
describe("create-prototype-plan: owner scoping", () => {
  it("create-visual-plan can import existing plan text without a separate skill action", async () => {
    const planText = `# Existing Import Plan

## Implementation

- templates/plan/actions/create-visual-plan.ts - accept planText and preserve source markdown.
- skills/visual-plans/SKILL.md - route existing plans through /visual-plan.

## Risks

- Keep compatibility callers working while removing the separate skill.`;

    const result = await asUser({ userEmail: OWNER, orgId: ORG }, () =>
      createVisualPlan.run({
        planText,
        repoPath: "/repo",
        status: "review",
        sections: [],
        comments: [],
      }),
    );
    const row = await rawPlan(result.planId as string);
    expect(row.title).toBe("Existing Import Plan");
    expect(row.source).toBe("imported");
    expect(row.markdown).toBe(planText);
    expect(row.content).toBeTruthy();

    const sections = await rawSections(result.planId as string);
    expect(sections.some((section) => section.createdBy === "import")).toBe(
      true,
    );
    expect(sections.some((section) => section.type === "diagram")).toBe(true);

    const events = await rawEvents(result.planId as string);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "plan.imported",
          createdBy: "import",
        }),
      ]),
    );
  });

  it("scopes the new plan to the request user, private + org from context", async () => {
    const planId = await createPrototypeAs(OWNER, ORG);
    const row = await rawPlan(planId);
    expect(row.ownerEmail).toBe(OWNER);
    expect(row.visibility).toBe("private");
    expect(row.orgId).toBe(ORG);
  });

  it("owner can read back their own created prototype plan", async () => {
    const planId = await createPrototypeAs(OWNER);
    const got = await asUser({ userEmail: OWNER }, () =>
      getVisualPlan.run({ id: planId }),
    );
    expect(got.planId).toBe(planId);
  });

  it("a plan one user creates is NOT readable by a different signed-in user", async () => {
    const planId = await createPrototypeAs(OWNER);
    await expect(
      asUser({ userEmail: OTHER }, () => getVisualPlan.run({ id: planId })),
    ).rejects.toThrow();
  });

  it("a non-owner read goes through loadPlanBundle's ForbiddenError (statusCode 403, clean 4xx)", async () => {
    const planId = await createPrototypeAs(OWNER);
    // The task's re-verify item: loadPlanBundle conflates not-found/no-access
    // into a 403 ForbiddenError so a missing/private plan never surfaces a 500.
    await expect(
      asUser({ userEmail: OTHER }, () => getVisualPlan.run({ id: planId })),
    ).rejects.toMatchObject({ statusCode: 403 });
    // Same 403 for a truly non-existent id (no existence leak).
    await expect(
      asUser({ userEmail: OTHER }, () =>
        getVisualPlan.run({ id: "plan_nope" }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("an unauthenticated hosted request (no identity) cannot create a prototype plan and persists nothing", async () => {
    await expect(
      asUser({}, () =>
        createPrototypePlan.run({
          title: "Anon proto",
          brief: "q",
          source: "manual",
          status: "review",
          screens: [],
          transitions: [],
          sections: [],
          comments: [],
        }),
      ),
    ).rejects.toThrow(/requires an authenticated user/i);
    expect(await countPlans()).toBe(0);
  });

  it("a legacy guest-author identity cannot create a prototype plan on a hosted deploy", async () => {
    const guest =
      "guest-123e4567-e89b-12d3-a456-426614174000@agent-native.guest";
    await expect(
      asUser({ userEmail: guest }, () =>
        createPrototypePlan.run({
          title: "Guest proto",
          brief: "q",
          source: "manual",
          status: "review",
          screens: [],
          transitions: [],
          sections: [],
          comments: [],
        }),
      ),
    ).rejects.toThrow(/requires an authenticated user/i);
    expect(await countPlans()).toBe(0);
  });
});

// ===========================================================================
// convert-visual-plan-to-prototype: requires editor on the source plan
// ===========================================================================
describe("convert-visual-plan-to-prototype: editor gate", () => {
  it("owner can convert their own convertible plan", async () => {
    const planId = await createPrototypeAs(OWNER);
    // Strip the prototype so convert re-derives it from the canvas; otherwise
    // it would short-circuit to the existing prototype. Either way the editor
    // gate is the load-bearing check; this confirms the happy path still works.
    const res = await asUser({ userEmail: OWNER }, () =>
      convertVisualPlanToPrototype.run({ planId }),
    );
    expect(res.planId).toBe(planId);
    expect(res.plan.content?.prototype).toBeTruthy();
  });

  it("a different signed-in user with NO access cannot convert another user's private plan", async () => {
    const planId = await createPrototypeAs(OWNER);
    const before = await rawPlan(planId);
    await expect(
      asUser({ userEmail: OTHER }, () =>
        convertVisualPlanToPrototype.run({ planId }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    // The owner's plan row is untouched.
    const after = await rawPlan(planId);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.currentFocus).toBe(before.currentFocus);
  });

  it("a VIEWER-only share holder cannot convert (convert is a write, needs editor)", async () => {
    const planId = await createPrototypeAs(OWNER);
    await asUser({ userEmail: OWNER }, () =>
      shareResource.run({
        resourceType: "plan",
        resourceId: planId,
        principalType: "user",
        principalId: VIEWER,
        role: "viewer",
      }),
    );
    const before = await rawPlan(planId);
    await expect(
      asUser({ userEmail: VIEWER }, () =>
        convertVisualPlanToPrototype.run({ planId }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const after = await rawPlan(planId);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("a non-owner reader of a PUBLIC plan cannot convert it", async () => {
    const planId = await createPrototypeAs(OWNER);
    await asUser({ userEmail: OWNER }, () =>
      setResourceVisibility.run({
        resourceType: "plan",
        resourceId: planId,
        visibility: "public",
      }),
    );
    const before = await rawPlan(planId);
    await expect(
      asUser({ userEmail: OTHER }, () =>
        convertVisualPlanToPrototype.run({ planId }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const after = await rawPlan(planId);
    // Title/content/currentFocus must be unchanged by the rejected convert.
    expect(after.currentFocus).toBe(before.currentFocus);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("an EDITOR share holder CAN convert", async () => {
    const planId = await createPrototypeAs(OWNER);
    await asUser({ userEmail: OWNER }, () =>
      shareResource.run({
        resourceType: "plan",
        resourceId: planId,
        principalType: "user",
        principalId: VIEWER,
        role: "editor",
      }),
    );
    const res = await asUser({ userEmail: VIEWER }, () =>
      convertVisualPlanToPrototype.run({ planId }),
    );
    expect(res.planId).toBe(planId);
  });

  it("cannot convert a non-existent plan id (editor gate rejects, no leak)", async () => {
    await expect(
      asUser({ userEmail: OTHER }, () =>
        convertVisualPlanToPrototype.run({ planId: "plan_nope" }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("a same-org member of an ORG-visible plan cannot convert it (org read != editor)", async () => {
    const planId = await createPrototypeAs(OWNER, ORG);
    await asUser({ userEmail: OWNER, orgId: ORG }, () =>
      setResourceVisibility.run({
        resourceType: "plan",
        resourceId: planId,
        visibility: "org",
      }),
    );
    const before = await rawPlan(planId);
    await expect(
      asUser({ userEmail: VIEWER, orgId: ORG }, () =>
        convertVisualPlanToPrototype.run({ planId }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const after = await rawPlan(planId);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("the editor gate (403) precedes the content checks — a non-editor never learns the plan's content shape", async () => {
    // A real visual plan with NO convertible content (no canvas frames). The
    // owner would get a 400 ("No HTML canvas wireframes..."), but a non-editor
    // must be stopped at the 403 gate first, never reaching the 400 that would
    // leak the plan's convertibility.
    const planId = await asUser({ userEmail: OWNER }, async () => {
      const r = await createVisualPlan.run({
        title: "Text only",
        brief: "no canvas",
        source: "manual",
        status: "review",
        sections: [],
        comments: [],
      });
      return r.planId as string;
    });
    await expect(
      asUser({ userEmail: OTHER }, () =>
        convertVisualPlanToPrototype.run({ planId }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
