import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { registerShareableResource } from "@agent-native/core/sharing";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
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

let client: Client;
let db: LibSQLDatabase<typeof planSchema>;
let dbDir: string;

vi.mock("../server/db/index.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  getDb: () => db,
  schema: planSchema,
}));

vi.mock("../server/lib/local-plan-files.js", () => ({
  writePlanLocalFiles: vi.fn(async () => ({ written: false })),
  localPlansDir: () => "/tmp/plans-test",
  localPlanFolder: (id: string) => `/tmp/plans-test/${id}`,
}));

type AnyAction = { run: (args: any) => Promise<any> };

let listPlanVersions: AnyAction;
let getPlanVersion: AnyAction;
let restorePlanVersion: AnyAction;
let createPlanVersionSnapshot: typeof import("../server/lib/plan-versions.js").createPlanVersionSnapshot;

const OWNER = "owner@example.com";
const OTHER = "other@example.com";
const PLAN_ID = "plan_history";
const CREATED_AT = "2026-06-01T12:00:00.000Z";

const originalPlanLocalMode = process.env.PLAN_LOCAL_MODE;

const savedContent = {
  version: 2,
  title: "Saved plan",
  brief: "Saved brief",
  blocks: [
    {
      id: "intro",
      type: "rich-text",
      title: "Intro",
      data: { markdown: "Saved body copy." },
    },
  ],
};

const changedContent = {
  version: 2,
  title: "Changed plan",
  brief: "Changed brief",
  blocks: [
    {
      id: "intro",
      type: "rich-text",
      title: "Intro",
      data: { markdown: "Changed body copy." },
    },
  ],
};

async function resetTables() {
  // guard:allow-unscoped -- test-only fixture cleanup resets the isolated temp DB.
  await client.executeMultiple(`
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
    title: "Saved plan",
    brief: "Saved brief",
    status: "review",
    source: "manual",
    repoPath: "/repo",
    currentFocus: "history",
    html: null,
    markdown: "# Saved plan\n\nSaved body copy.",
    content: JSON.stringify(savedContent),
    hostedPlanId: "hosted_1",
    hostedPlanUrl: "https://example.test/plans/hosted_1",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    approvedAt: null,
    ownerEmail: OWNER,
    orgId: null,
    visibility: "private",
  });
  await db.insert(planSchema.planSections).values({
    id: "sec_saved",
    planId: PLAN_ID,
    type: "summary",
    title: "Saved section",
    body: "Saved section body.",
    html: null,
    order: 0,
    createdBy: "agent",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
}

async function mutatePlanAfterSnapshot() {
  // guard:allow-unscoped -- test-only fixture mutation updates the seeded plan in an isolated temp DB.
  await db
    .update(planSchema.plans)
    .set({
      title: "Changed plan",
      brief: "Changed brief",
      markdown: "# Changed plan",
      content: JSON.stringify(changedContent),
      updatedAt: "2026-06-02T12:00:00.000Z",
    })
    .where(eq(planSchema.plans.id, PLAN_ID));
  await db
    .delete(planSchema.planSections)
    .where(eq(planSchema.planSections.planId, PLAN_ID));
  await db.insert(planSchema.planSections).values({
    id: "sec_changed",
    planId: PLAN_ID,
    type: "implementation",
    title: "Changed section",
    body: "Changed section body.",
    html: null,
    order: 0,
    createdBy: "agent",
    createdAt: CREATED_AT,
    updatedAt: "2026-06-02T12:00:00.000Z",
  });
  await db.insert(planSchema.planComments).values({
    id: "comment_keep",
    planId: PLAN_ID,
    parentCommentId: null,
    sectionId: "sec_changed",
    kind: "comment",
    status: "open",
    anchor: null,
    message: "Keep this comment through restore.",
    createdBy: "human",
    authorEmail: OWNER,
    authorName: "Owner",
    resolutionTarget: null,
    mentionsJson: null,
    resolvedBy: null,
    resolvedAt: null,
    consumedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
}

beforeAll(async () => {
  process.env.PLAN_LOCAL_MODE = "0";
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-versions-"));
  client = createClient({ url: `file:${path.join(dbDir, "test.db")}` });
  db = drizzle(client, { schema: planSchema });
  await client.execute("PRAGMA foreign_keys = ON");
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
      section_id TEXT REFERENCES plan_sections(id),
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
  `);

  registerShareableResource({
    type: "plan",
    resourceTable: planSchema.plans,
    sharesTable: planSchema.planShares,
    displayName: "Plan",
    titleColumn: "title",
    getResourcePath: (plan: any) => `/plans/${plan.id}`,
    getDb: () => db,
  });

  listPlanVersions = (await import("./list-plan-versions.js"))
    .default as AnyAction;
  getPlanVersion = (await import("./get-plan-version.js")).default as AnyAction;
  restorePlanVersion = (await import("./restore-plan-version.js"))
    .default as AnyAction;
  createPlanVersionSnapshot = (await import("../server/lib/plan-versions.js"))
    .createPlanVersionSnapshot;
});

afterAll(() => {
  client?.close();
  if (dbDir) fs.rmSync(dbDir, { recursive: true, force: true });
  if (originalPlanLocalMode === undefined) delete process.env.PLAN_LOCAL_MODE;
  else process.env.PLAN_LOCAL_MODE = originalPlanLocalMode;
});

beforeEach(async () => {
  await resetTables();
});

function asOwner(fn: () => Promise<any> | any) {
  return runWithRequestContext({ userEmail: OWNER }, fn);
}

describe("plan version actions", () => {
  it("lists, previews, and restores saved plan history", async () => {
    await seedPlan();
    const snapshot = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: "Before edit",
      createdBy: "agent",
    });
    expect(snapshot.created).toBe(true);
    expect(snapshot.id).toBeTruthy();

    await mutatePlanAfterSnapshot();

    const list = await asOwner(() =>
      listPlanVersions.run({ planId: PLAN_ID, limit: 10 }),
    );
    expect(list.count).toBe(1);
    expect(list.versions[0]).toMatchObject({
      id: snapshot.id,
      title: "Saved plan",
      label: "Before edit",
      preview: "Saved body copy.",
    });

    const detail = await asOwner(() =>
      getPlanVersion.run({ planId: PLAN_ID, versionId: snapshot.id }),
    );
    expect(detail.plan).toMatchObject({
      title: "Saved plan",
      brief: "Saved brief",
      hostedPlanId: "hosted_1",
    });
    expect(detail.sections.map((section: any) => section.id)).toEqual([
      "sec_saved",
    ]);

    const restored = await asOwner(() =>
      restorePlanVersion.run({ planId: PLAN_ID, versionId: snapshot.id }),
    );
    expect(restored.plan).toMatchObject({
      title: "Saved plan",
      brief: "Saved brief",
      hostedPlanId: "hosted_1",
    });

    const [row] = await db
      .select()
      .from(planSchema.plans)
      .where(eq(planSchema.plans.id, PLAN_ID));
    expect(row.title).toBe("Saved plan");
    expect(row.markdown).toContain("Saved body copy.");

    const sections = await db
      .select()
      .from(planSchema.planSections)
      .where(eq(planSchema.planSections.planId, PLAN_ID));
    expect(sections.map((section) => section.id)).toEqual(["sec_saved"]);

    const comments = await db
      .select()
      .from(planSchema.planComments)
      .where(eq(planSchema.planComments.planId, PLAN_ID));
    expect(comments.map((comment) => comment.id)).toEqual(["comment_keep"]);
    expect(comments[0].sectionId).toBeNull();

    const versions = await db
      .select()
      .from(planSchema.planVersions)
      .where(eq(planSchema.planVersions.planId, PLAN_ID));
    expect(versions).toHaveLength(2);

    const events = await db
      .select()
      .from(planSchema.planEvents)
      .where(eq(planSchema.planEvents.planId, PLAN_ID));
    expect(events.map((event) => event.type)).toContain(
      "plan.version.restored",
    );
  });

  it("does not reveal snapshots across plan ownership boundaries", async () => {
    await seedPlan();
    await createPlanVersionSnapshot(PLAN_ID, { force: true });

    await expect(
      runWithRequestContext({ userEmail: OTHER }, () =>
        listPlanVersions.run({ planId: PLAN_ID }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("restore preserves comment sectionId for sections that survive, nulls it only for sections absent from the snapshot", async () => {
    // Seed a plan with TWO sections.
    await db.insert(planSchema.plans).values({
      id: PLAN_ID,
      title: "Two-section plan",
      brief: "brief",
      status: "review",
      source: "manual",
      repoPath: null,
      currentFocus: null,
      html: null,
      markdown: "# Two sections",
      content: JSON.stringify(savedContent),
      hostedPlanId: null,
      hostedPlanUrl: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      approvedAt: null,
      ownerEmail: OWNER,
      orgId: null,
      visibility: "private",
    });
    await db.insert(planSchema.planSections).values([
      {
        id: "sec_a",
        planId: PLAN_ID,
        type: "summary",
        title: "Section A",
        body: "Body A.",
        html: null,
        order: 0,
        createdBy: "agent",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      {
        id: "sec_b",
        planId: PLAN_ID,
        type: "summary",
        title: "Section B",
        body: "Body B.",
        html: null,
        order: 1,
        createdBy: "agent",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ]);

    // Snapshot with both sections present.
    const snapshot = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: "Both sections",
      createdBy: "agent",
    });
    expect(snapshot.created).toBe(true);

    // Add comments anchored to both sections in the snapshot. Restore deletes
    // and re-inserts all sections internally, so both anchors must survive that
    // FK-sensitive replacement.
    await db.insert(planSchema.planComments).values([
      {
        id: "comment_on_a",
        planId: PLAN_ID,
        parentCommentId: null,
        sectionId: "sec_a",
        kind: "comment",
        status: "open",
        anchor: null,
        message: "Comment on surviving section A.",
        createdBy: "human",
        authorEmail: OWNER,
        authorName: "Owner",
        resolutionTarget: null,
        mentionsJson: null,
        resolvedBy: null,
        resolvedAt: null,
        consumedAt: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      {
        id: "comment_on_b",
        planId: PLAN_ID,
        parentCommentId: null,
        sectionId: "sec_b",
        kind: "comment",
        status: "open",
        anchor: null,
        message: "Comment on removed section B.",
        createdBy: "human",
        authorEmail: OWNER,
        authorName: "Owner",
        resolutionTarget: null,
        mentionsJson: null,
        resolvedBy: null,
        resolvedAt: null,
        consumedAt: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ]);
    const restored = await asOwner(() =>
      restorePlanVersion.run({ planId: PLAN_ID, versionId: snapshot.id! }),
    );
    expect(restored.planId).toBe(PLAN_ID);

    const comments = await db
      .select()
      .from(planSchema.planComments)
      .where(eq(planSchema.planComments.planId, PLAN_ID))
      .then((rows) => rows.sort((a, b) => a.id.localeCompare(b.id)));

    // sec_a is in the snapshot → comment_on_a must keep its anchor.
    const commentOnA = comments.find((c) => c.id === "comment_on_a");
    expect(commentOnA?.sectionId).toBe("sec_a");

    // sec_b is also in the snapshot (restore re-inserts it) →
    // comment_on_b must also keep its anchor.
    const commentOnB = comments.find((c) => c.id === "comment_on_b");
    expect(commentOnB?.sectionId).toBe("sec_b");
  });

  it("restore nulls sectionId only for comments anchored to sections absent from the snapshot", async () => {
    // sec_saved is in the snapshot; sec_gone is NOT — comment on sec_gone must
    // be detached, comment on sec_saved must keep its anchor.
    await seedPlan(); // seeds sec_saved
    // Add sec_gone to the live plan (not captured in the snapshot we're about
    // to take, because we snapshot BEFORE adding it).
    const snapshot = await createPlanVersionSnapshot(PLAN_ID, {
      force: true,
      label: "Only sec_saved",
      createdBy: "agent",
    });
    expect(snapshot.created).toBe(true);

    // Now add sec_gone and comments on both sections.
    await db.insert(planSchema.planSections).values({
      id: "sec_gone",
      planId: PLAN_ID,
      type: "summary",
      title: "Gone section",
      body: "Will disappear on restore.",
      html: null,
      order: 1,
      createdBy: "agent",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    await db.insert(planSchema.planComments).values([
      {
        id: "comment_surviving",
        planId: PLAN_ID,
        parentCommentId: null,
        sectionId: "sec_saved",
        kind: "comment",
        status: "open",
        anchor: null,
        message: "On the section that survives the restore.",
        createdBy: "human",
        authorEmail: OWNER,
        authorName: "Owner",
        resolutionTarget: null,
        mentionsJson: null,
        resolvedBy: null,
        resolvedAt: null,
        consumedAt: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      {
        id: "comment_orphaned",
        planId: PLAN_ID,
        parentCommentId: null,
        sectionId: "sec_gone",
        kind: "comment",
        status: "open",
        anchor: null,
        message: "On the section removed by restore.",
        createdBy: "human",
        authorEmail: OWNER,
        authorName: "Owner",
        resolutionTarget: null,
        mentionsJson: null,
        resolvedBy: null,
        resolvedAt: null,
        consumedAt: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ]);

    await asOwner(() =>
      restorePlanVersion.run({ planId: PLAN_ID, versionId: snapshot.id! }),
    );

    const comments = await db
      .select()
      .from(planSchema.planComments)
      .where(eq(planSchema.planComments.planId, PLAN_ID));

    const surviving = comments.find((c) => c.id === "comment_surviving");
    const orphaned = comments.find((c) => c.id === "comment_orphaned");

    // Comment on sec_saved: section is in the snapshot, must keep its anchor.
    expect(surviving?.sectionId).toBe("sec_saved");
    // Comment on sec_gone: section NOT in snapshot, must be detached.
    expect(orphaned?.sectionId).toBeNull();
  });
});
