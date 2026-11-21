import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import {
  getReviewCommentById,
  mirrorReviewComments,
} from "@agent-native/core/review";
import consumeReviewFeedback from "@agent-native/core/review/actions/consume-review-feedback";
import createReviewComment from "@agent-native/core/review/actions/create-review-comment";
import deleteReviewComment from "@agent-native/core/review/actions/delete-review-comment";
import listReviewComments from "@agent-native/core/review/actions/list-review-comments";
import reactToReviewComment from "@agent-native/core/review/actions/react-to-review-comment";
import replyReviewComment from "@agent-native/core/review/actions/reply-review-comment";
import resolveReviewThread from "@agent-native/core/review/actions/resolve-review-thread";
import updateReviewComment from "@agent-native/core/review/actions/update-review-comment";
import { runWithRequestContext } from "@agent-native/core/server";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

const TEST_DB_PATH = join(
  tmpdir(),
  `plan-comment-mirror-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = { userEmail: "owner@example.test", orgId: "mirror-org" };

vi.mock("./comment-notifications.js", () => ({
  notifyPlanCommentRecipients: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/collab")>()),
  deleteCollabState: vi.fn(async () => undefined),
}));

interface Runnable<T = unknown> {
  schema: z.ZodType;
  run: (args: unknown, ctx?: unknown) => Promise<T>;
}

type ActionModule = { default: unknown };
const action = <T = Record<string, unknown>>(module: ActionModule) =>
  module.default as Runnable<T>;

let dbModule: typeof import("../db/index.js");
let mirror: typeof import("./plan-comment-mirror.js");
let createPlan: Runnable<{ planId: string }>;
let updatePlan: Runnable;
let replyToComment: Runnable<{ commentId: string }>;
let resolveComment: Runnable<{ resolutionNoteId?: string }>;
let deleteComment: Runnable;
let consumeFeedback: Runnable;
let restoreVersion: Runnable;
let deletePlan: Runnable;
let previousLocalMode: string | undefined;

beforeAll(async () => {
  previousLocalMode = process.env.PLAN_LOCAL_MODE;
  process.env.PLAN_LOCAL_MODE = "0";
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.APP_URL = "https://plan.example.test";
  dbModule = await import("../db/index.js");
  mirror = await import("./plan-comment-mirror.js");
  createPlan = action(await import("../../actions/create-visual-plan.js"));
  updatePlan = action(await import("../../actions/update-visual-plan.js"));
  replyToComment = action(
    await import("../../actions/reply-to-plan-comment.js"),
  );
  resolveComment = action(
    await import("../../actions/resolve-plan-comment.js"),
  );
  deleteComment = action(await import("../../actions/delete-plan-comment.js"));
  consumeFeedback = action(
    await import("../../actions/consume-plan-feedback.js"),
  );
  restoreVersion = action(
    await import("../../actions/restore-plan-version.js"),
  );
  deletePlan = action(await import("../../actions/delete-visual-plan.js"));
  const dbPlugin = (await import("../plugins/db.js")).default;
  await dbPlugin(undefined);
  const reviewPlugin = (await import("../plugins/review.js")).default;
  await (reviewPlugin as (app: unknown) => unknown)(undefined);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL, identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
    role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at INTEGER
  )`);
}, 120000);

afterAll(() => {
  if (previousLocalMode === undefined) delete process.env.PLAN_LOCAL_MODE;
  else process.env.PLAN_LOCAL_MODE = previousLocalMode;
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

function call<T>(
  runnable: Runnable<T>,
  args: Record<string, unknown>,
  ctx?: unknown,
) {
  return runWithRequestContext(OWNER, () =>
    runnable.run(runnable.schema.parse(args), ctx),
  );
}

const stored = (id: string) =>
  getReviewCommentById(id, {}, { bypassScope: true });

const textAnchor = JSON.stringify({
  anchorKind: "text",
  sectionId: "intro",
  textQuote: "Ship the importer",
  contextBefore: "First, ",
  contextAfter: " next week.",
  targetKind: "text",
});

const canvasAnchor = JSON.stringify({
  anchorKind: "point",
  targetKind: "canvas",
  canvasX: 120,
  canvasY: 64,
  planAnnotationId: "note-1",
  markupType: "callout",
});

async function newPlan(
  comments: Array<Record<string, unknown>> = [],
): Promise<string> {
  const plan = await call(createPlan, {
    title: "Mirror plan",
    brief: "Plan comments in the review kit",
    sections: [
      {
        id: "intro",
        type: "summary",
        title: "Intro",
        body: "First, Ship the importer next week.",
      },
      { id: "risks", type: "risks", title: "Risks", body: "None yet." },
    ],
    comments,
  });
  return plan.planId;
}

async function sectionId(planId: string, title: string) {
  const { getDb, schema } = dbModule;
  const rows = await getDb()
    .select({ id: schema.planSections.id, title: schema.planSections.title })
    .from(schema.planSections)
    .where(eq(schema.planSections.planId, planId));
  return rows.find((row) => row.title === title)?.id;
}

async function planCopies(planId: string) {
  const { getDb, schema } = dbModule;
  const rows = await getDb()
    .select()
    .from(schema.planComments)
    .where(eq(schema.planComments.planId, planId))
    .orderBy(asc(schema.planComments.createdAt), asc(schema.planComments.id));
  const parents = new Map(rows.map((row) => [row.id, row.parentCommentId]));
  const root = (id: string): string => {
    const parent = parents.get(id);
    return parent ? root(parent) : id;
  };
  return rows
    .filter((row) => row.deletedAt === null)
    .map((row) => mirror.planCommentCopy(row, root(row.id)));
}

async function expectStoresAgree(planId: string) {
  const { getDb, schema } = dbModule;
  const [sharing] = await getDb()
    .select({
      ownerEmail: schema.plans.ownerEmail,
      orgId: schema.plans.orgId,
      visibility: schema.plans.visibility,
    })
    .from(schema.plans)
    .where(eq(schema.plans.id, planId))
    .limit(1);
  const copies = await planCopies(planId);
  expect(
    await mirror.comparePlanComments(
      { resourceType: "plan", resourceId: planId, ...sharing },
      copies,
    ),
  ).toEqual({ checked: copies.length, differences: [] });
  return copies;
}

async function kitRows(planId: string) {
  const { rows } = await getDbExec().execute({
    sql: "SELECT * FROM agent_review_comments WHERE resource_type = 'plan' AND resource_id = ? ORDER BY id",
    args: [planId],
  });
  return rows;
}

describe("Plan comments in the review kit", () => {
  it("copies a new plan's comments, replies to replies included, with their kind, routing and anchors", async () => {
    const planId = await newPlan([
      {
        id: "seed-root",
        sectionId: "intro",
        kind: "question",
        anchor: textAnchor,
        message:
          "Can @[Sam](mailto:sam%40example.test) confirm the importer date?",
      },
      { id: "seed-reply", parentCommentId: "seed-root", message: "Checking" },
      {
        id: "seed-nested",
        parentCommentId: "seed-reply",
        message: "Confirmed for Tuesday",
      },
      {
        id: "seed-canvas",
        kind: "annotation",
        anchor: canvasAnchor,
        message: "Move this callout",
        resolutionTarget: "agent",
      },
    ]);

    const copies = await expectStoresAgree(planId);
    expect(copies).toHaveLength(4);
    expect(await stored("seed-root")).toMatchObject({
      resourceType: "plan",
      resourceId: planId,
      threadId: "seed-root",
      parentCommentId: null,
      surfaceId: await sectionId(planId, "Intro"),
      kind: "question",
      resolutionTarget: "agent",
      anchorKind: "plan-anchor",
      anchorVersion: 1,
      anchor: expect.objectContaining({ textQuote: "Ship the importer" }),
      mentions: [{ email: "sam@example.test", label: "Sam" }],
      createdBy: "human",
      authorEmail: OWNER.userEmail,
      ownerEmail: OWNER.userEmail,
      status: "open",
    });
    expect(await stored("seed-nested")).toMatchObject({
      threadId: "seed-root",
      parentCommentId: "seed-reply",
      kind: "question",
    });
    expect(await stored("seed-canvas")).toMatchObject({
      threadId: "seed-canvas",
      kind: "annotation",
      resolutionTarget: "agent",
      anchor: expect.objectContaining({ canvasX: 120, canvasY: 64 }),
    });
  });

  it("keeps the kit matching plan_comments through every comment action", async () => {
    const planId = await newPlan([
      {
        id: "flow-root",
        sectionId: "intro",
        anchor: textAnchor,
        message: "Tighten this step",
      },
      {
        id: "flow-canvas",
        kind: "annotation",
        anchor: canvasAnchor,
        message: "Callout overlaps the frame",
      },
    ]);
    await expectStoresAgree(planId);

    const reply = await call(replyToComment, {
      planId,
      commentId: "flow-root",
      body: "Tightened in the next revision",
    });
    await expectStoresAgree(planId);
    expect(await stored(reply.commentId)).toMatchObject({
      threadId: "flow-root",
      parentCommentId: "flow-root",
      createdBy: "agent",
      body: "Tightened in the next revision",
    });

    await call(updatePlan, {
      planId,
      comments: [
        {
          id: "flow-added",
          sectionId: await sectionId(planId, "Risks"),
          kind: "decision",
          message: "Keep the old importer behind a flag",
        },
      ],
    });
    await expectStoresAgree(planId);
    expect(await stored("flow-added")).toMatchObject({
      kind: "decision",
      surfaceId: await sectionId(planId, "Risks"),
    });

    await call(updatePlan, {
      planId,
      comments: [
        {
          id: "flow-canvas",
          kind: "correction",
          anchor: canvasAnchor,
          message: "Callout overlaps the header",
          resolutionTarget: "human",
        },
      ],
    });
    await expectStoresAgree(planId);
    expect(await stored("flow-canvas")).toMatchObject({
      body: "Callout overlaps the header",
      kind: "correction",
      resolutionTarget: "human",
    });

    await call(consumeFeedback, { planId, commentIds: ["flow-root"] });
    await expectStoresAgree(planId);
    expect((await stored("flow-root"))?.consumedAt).toEqual(expect.any(String));

    await call(updatePlan, { planId, consumedCommentIds: ["flow-added"] });
    await expectStoresAgree(planId);
    expect((await stored("flow-added"))?.consumedAt).toEqual(
      expect.any(String),
    );

    const resolved = await call(resolveComment, {
      planId,
      commentId: "flow-root",
      status: "resolved",
      resolutionNote: "Done in revision 2",
    });
    await expectStoresAgree(planId);
    expect(await stored("flow-root")).toMatchObject({
      status: "resolved",
      resolvedBy: OWNER.userEmail,
    });
    expect(await stored(reply.commentId)).toMatchObject({
      status: "resolved",
    });
    expect(resolved.resolutionNoteId).toEqual(expect.any(String));
    expect(await stored(String(resolved.resolutionNoteId))).toMatchObject({
      threadId: "flow-root",
      body: "Done in revision 2",
      status: "resolved",
    });
    const firstResolvedAt = (await stored("flow-root"))?.resolvedAt;

    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2030-01-01T00:00:00.000Z"),
    });
    try {
      await call(resolveComment, {
        planId,
        commentId: "flow-root",
        status: "resolved",
      });
    } finally {
      vi.useRealTimers();
    }
    const reResolved = (await planCopies(planId)).find(
      (copy) => copy.id === "flow-root",
    );
    expect(reResolved?.resolvedAt).toBe("2030-01-01T00:00:00.000Z");
    await expectStoresAgree(planId);
    expect((await stored("flow-root"))?.resolvedAt).toBe(firstResolvedAt);

    await call(resolveComment, {
      planId,
      commentId: "flow-root",
      status: "open",
    });
    await expectStoresAgree(planId);
    expect(await stored("flow-root")).toMatchObject({
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
    });

    await call(updatePlan, {
      planId,
      comments: [
        {
          id: "flow-canvas",
          kind: "correction",
          status: "resolved",
          message: "Callout overlaps the header",
        },
      ],
    });
    await expectStoresAgree(planId);
    expect((await stored("flow-canvas"))?.status).toBe("resolved");

    await call(deleteComment, { planId, commentId: "flow-root" });
    await expectStoresAgree(planId);
    expect(await stored("flow-root")).toMatchObject({
      status: "deleted",
      body: "",
      deletedBy: OWNER.userEmail,
    });
    expect((await stored(reply.commentId))?.status).toBe("deleted");
  });

  it("moves the kit's comments with a restored version's sections", async () => {
    const planId = await newPlan([
      { id: "restore-root", sectionId: "risks", message: "Name the risk" },
    ]);
    const { getDb, schema } = dbModule;
    await call(updatePlan, {
      planId,
      sections: [{ title: "Rollout", body: "Ship behind a flag" }],
      note: "Add rollout",
    });
    const rolloutId = await sectionId(planId, "Rollout");
    await call(updatePlan, {
      planId,
      comments: [
        { id: "restore-rollout", sectionId: rolloutId, message: "Which flag?" },
      ],
    });
    expect((await stored("restore-rollout"))?.surfaceId).toBe(rolloutId);
    const versions = await getDb()
      .select({
        id: schema.planVersions.id,
        changeLabel: schema.planVersions.changeLabel,
      })
      .from(schema.planVersions)
      .where(eq(schema.planVersions.planId, planId));
    const beforeRollout = versions.find(
      (version) => version.changeLabel === "Add rollout",
    );
    expect(beforeRollout).toBeDefined();

    await call(restoreVersion, { planId, versionId: beforeRollout?.id });

    await expectStoresAgree(planId);
    expect((await stored("restore-rollout"))?.surfaceId).toBeNull();
    expect((await stored("restore-root"))?.surfaceId).toBe(
      await sectionId(planId, "Risks"),
    );
  });

  it("deletes a plan's comments from the kit with the plan", async () => {
    const planId = await newPlan([
      { id: "gone-root", message: "Will this survive?" },
      { id: "gone-reply", parentCommentId: "gone-root", message: "No" },
    ]);
    await expectStoresAgree(planId);

    await call(deletePlan, {
      planId,
      mode: "hard",
      confirmation: `DELETE ${planId}`,
    });

    await expectStoresAgree(planId);
    expect(await stored("gone-root")).toMatchObject({
      status: "deleted",
      deletedBy: OWNER.userEmail,
    });
    expect((await stored("gone-reply"))?.status).toBe("deleted");
  });

  it("gives a new comment a fresh ID when a deleted plan's copy in the kit still holds it", async () => {
    const goneId = await newPlan([
      { id: "reused-root", message: "First time" },
      { id: "reused-reply", parentCommentId: "reused-root", message: "Reply" },
    ]);
    await call(deletePlan, {
      planId: goneId,
      mode: "hard",
      confirmation: `DELETE ${goneId}`,
    });

    const planId = await newPlan([
      { id: "reused-root", message: "Second time" },
      { parentCommentId: "reused-root", message: "Reply again" },
    ]);
    await call(updatePlan, {
      planId,
      comments: [{ id: "reused-reply", message: "Added later" }],
    });

    const copies = await expectStoresAgree(planId);
    const root = copies.find((copy) => copy.body === "Second time");
    expect(root?.id).toEqual(expect.any(String));
    expect(root?.id).not.toBe("reused-root");
    expect(
      copies.find((copy) => copy.body === "Reply again")?.parentCommentId,
    ).toBe(root?.id);
    const added = copies.find((copy) => copy.body === "Added later");
    expect(added?.id).toEqual(expect.any(String));
    expect(added?.id).not.toBe("reused-reply");
    for (const id of ["reused-root", "reused-reply"]) {
      expect(await stored(id)).toMatchObject({
        status: "deleted",
        resourceId: goneId,
      });
    }
  });

  it("gives a new comment a fresh ID when a comment written through the kit holds it", async () => {
    const planId = await newPlan();
    const at = "2026-11-21T12:00:00.000Z";
    await mirrorReviewComments({ resourceType: "plan", resourceId: planId }, [
      {
        id: "kit-held-here",
        threadId: "kit-held-here",
        parentCommentId: null,
        body: "Written through the kit",
        authorEmail: "kit-author@example.test",
        authorName: null,
        createdBy: "human",
        resolved: false,
        createdAt: at,
        updatedAt: at,
      },
    ]);

    await call(updatePlan, {
      planId,
      comments: [{ id: "kit-held-here", message: "Written in Plan" }],
    });

    expect(await stored("kit-held-here")).toMatchObject({
      status: "open",
      body: "Written through the kit",
      authorEmail: "kit-author@example.test",
    });
    const added = (await planCopies(planId)).find(
      (copy) => copy.body === "Written in Plan",
    );
    expect(added?.id).toEqual(expect.any(String));
    expect(added?.id).not.toBe("kit-held-here");
    expect(await stored(added?.id ?? "")).toMatchObject({
      status: "open",
      body: "Written in Plan",
    });
  });

  it("hides a deleted plan's comments from the kit, even from people it was shared with", async () => {
    const viewer = { userEmail: "viewer@example.test", orgId: "viewer-org" };
    const planId = await newPlan([
      { id: "trashed-root", message: "Still visible?" },
    ]);
    await dbModule
      .getDb()
      .insert(dbModule.schema.planShares)
      .values({
        id: `share-${planId}`,
        resourceId: planId,
        principalType: "user",
        principalId: viewer.userEmail,
        role: "viewer",
        createdBy: OWNER.userEmail,
      });
    const list = action<{ comments: Array<{ id: string }> }>({
      default: listReviewComments,
    });
    const args = list.schema.parse({
      resourceType: "plan",
      resourceId: planId,
    });
    const listAs = (who: typeof viewer) =>
      runWithRequestContext(who, () => list.run(args, who));

    expect((await listAs(viewer)).comments.map(({ id }) => id)).toEqual([
      "trashed-root",
    ]);

    await call(deletePlan, { planId, mode: "soft" });
    await expect(listAs(viewer)).rejects.toThrow();
    await expect(listAs(OWNER)).rejects.toThrow();

    await call(deletePlan, { planId, mode: "restore" });
    expect((await listAs(viewer)).comments.map(({ id }) => id)).toEqual([
      "trashed-root",
    ]);
  });

  it("rolls the kit's copy back with a comment write that fails", async () => {
    const planId = await newPlan();
    const { getDb, schema } = dbModule;

    await expect(
      getDb().transaction(async (tx) => {
        await tx.insert(schema.planComments).values({
          id: "rolled-back",
          planId,
          message: "Never saved",
          kind: "comment",
          status: "open",
          createdAt: "2026-11-20T10:00:00.000Z",
          updatedAt: "2026-11-20T10:00:00.000Z",
        });
        await mirror.mirrorPlanComments(tx, planId, ["rolled-back"]);
        expect(await stored("rolled-back")).not.toBeNull();
        throw new Error("The plan write failed");
      }),
    ).rejects.toThrow("The plan write failed");

    expect(await stored("rolled-back")).toBeNull();
  });

  it("copies comments written before the mirror, and copying again changes nothing", async () => {
    const planId = await newPlan();
    const { getDb, schema } = dbModule;
    const at = (minute: number) =>
      `2026-10-01T10:${String(minute).padStart(2, "0")}:00.000Z`;
    const legacy = {
      planId,
      parentCommentId: null,
      sectionId: null,
      kind: "comment" as const,
      status: "open" as const,
      anchor: null,
      createdBy: "human" as const,
      authorEmail: "reviewer@example.test",
      authorName: "Reviewer",
      resolutionTarget: null,
      mentionsJson: null,
      resolvedBy: null,
      resolvedAt: null,
      consumedAt: null,
      deletedAt: null,
      deletedBy: null,
    };
    await getDb()
      .insert(schema.planComments)
      .values([
        {
          ...legacy,
          id: "legacy-root",
          kind: "question",
          sectionId: await sectionId(planId, "Intro"),
          anchor: textAnchor,
          message: "Why Tuesday?",
          status: "resolved",
          resolvedBy: OWNER.userEmail,
          resolvedAt: at(5),
          consumedAt: at(6),
          createdAt: at(1),
          updatedAt: at(6),
        },
        {
          ...legacy,
          id: "legacy-reply",
          parentCommentId: "legacy-root",
          message: "Because of the freeze",
          createdBy: "agent",
          resolutionTarget: "human",
          status: "resolved",
          resolvedBy: OWNER.userEmail,
          resolvedAt: at(5),
          createdAt: at(2),
          updatedAt: at(5),
        },
        {
          ...legacy,
          id: "legacy-nested",
          parentCommentId: "legacy-reply",
          message: "Thanks",
          createdAt: at(3),
          updatedAt: at(3),
        },
        {
          ...legacy,
          id: "legacy-mentions",
          message: "Looping in ops",
          mentionsJson: JSON.stringify([
            { email: "ops@example.test", label: "Ops", role: "editor" },
          ]),
          createdAt: at(4),
          updatedAt: at(4),
        },
        {
          ...legacy,
          id: "legacy-unreadable",
          anchor: "not json",
          message: "Pinned somewhere",
          createdAt: at(7),
          updatedAt: at(7),
        },
        {
          ...legacy,
          id: "legacy-deleted",
          message: "Removed before the mirror",
          deletedAt: at(9),
          deletedBy: OWNER.userEmail,
          createdAt: at(8),
          updatedAt: at(9),
        },
      ]);

    const first = await mirror.copyPlanCommentsToReviewKit();

    expect(first.failedPlans).toEqual([]);
    expect(first.differences).toEqual([]);
    expect(first.comments).toBeGreaterThanOrEqual(5);
    await expectStoresAgree(planId);
    expect(await stored("legacy-root")).toMatchObject({
      threadId: "legacy-root",
      kind: "question",
      status: "resolved",
      resolvedBy: OWNER.userEmail,
      resolvedAt: at(5),
      consumedAt: at(6),
      resolutionTarget: "agent",
      anchorKind: "plan-anchor",
    });
    expect(await stored("legacy-nested")).toMatchObject({
      threadId: "legacy-root",
      parentCommentId: "legacy-reply",
    });
    expect(await stored("legacy-reply")).toMatchObject({
      createdBy: "agent",
      resolutionTarget: "human",
    });
    expect(await stored("legacy-mentions")).toMatchObject({
      resolutionTarget: "human",
      mentions: [{ email: "ops@example.test", label: "Ops", role: "editor" }],
    });
    expect(await stored("legacy-unreadable")).toMatchObject({
      anchor: null,
      anchorKind: null,
      metadata: { anchorText: "not json" },
    });
    expect(await stored("legacy-deleted")).toBeNull();

    const before = await kitRows(planId);
    const second = await mirror.copyPlanCommentsToReviewKit();

    expect(second).toEqual(first);
    expect(await kitRows(planId)).toEqual(before);
  });

  it("marks a comment Plan deleted since its copy deleted on the next copy", async () => {
    const planId = await newPlan([
      { id: "drift-root", message: "Copied, then deleted around the mirror" },
    ]);
    const { getDb, schema } = dbModule;
    await getDb()
      .update(schema.planComments)
      .set({ deletedAt: "2026-11-20T11:00:00.000Z", deletedBy: "ops@x.test" })
      .where(eq(schema.planComments.id, "drift-root"));

    const report = await mirror.copyPlanCommentsToReviewKit();

    expect(report.failedPlans).toEqual([]);
    expect(report.differences).toEqual([]);
    expect(await stored("drift-root")).toMatchObject({
      status: "deleted",
      deletedBy: "ops@x.test",
    });
    await expectStoresAgree(planId);
  });

  it("clears a gone plan's comments, and keeps ones written through the kit on a plan that's still here", async () => {
    const planId = await newPlan([
      { id: "orphan-kept", message: "Still in Plan" },
    ]);
    const at = "2026-11-20T12:00:00.000Z";
    await mirrorReviewComments({ resourceType: "plan", resourceId: planId }, [
      {
        id: "kit-written-root",
        threadId: "kit-written-root",
        parentCommentId: null,
        body: "Written through the kit before Plan registered",
        authorEmail: OWNER.userEmail,
        authorName: null,
        createdBy: "human",
        resolved: false,
        createdAt: at,
        updatedAt: at,
      },
    ]);
    await mirrorReviewComments(
      { resourceType: "plan", resourceId: "plan-deleted-elsewhere" },
      [
        {
          id: "kit-only-root",
          threadId: "kit-only-root",
          parentCommentId: null,
          body: "On a plan another server deleted",
          authorEmail: OWNER.userEmail,
          authorName: null,
          createdBy: "human",
          resolved: false,
          createdAt: at,
          updatedAt: at,
        },
      ],
    );

    const report = await mirror.copyPlanCommentsToReviewKit();

    expect(report.failedPlans).toEqual([]);
    expect(report.differences).toEqual([]);
    expect(await stored("orphan-kept")).toMatchObject({ status: "open" });
    expect(await stored("kit-written-root")).toMatchObject({
      status: "open",
      body: "Written through the kit before Plan registered",
    });
    expect(report.kitWrittenComments).toContainEqual({
      planId,
      id: "kit-written-root",
    });
    expect(await stored("kit-only-root")).toMatchObject({ status: "deleted" });
  });

  it("refuses plan comment writes through the kit's own actions", async () => {
    const planId = await newPlan([
      { id: "kit-root", message: "Written in Plan", resolutionTarget: "agent" },
    ]);
    const plan = { resourceType: "plan", resourceId: planId };
    const kitWrites: Array<[Runnable, Record<string, unknown>]> = [
      [
        action({ default: createReviewComment }),
        { ...plan, body: "Written around Plan" },
      ],
      [
        action({ default: replyReviewComment }),
        { ...plan, commentId: "kit-root", body: "A reply around Plan" },
      ],
      [
        action({ default: updateReviewComment }),
        { ...plan, commentId: "kit-root", body: "Edited around Plan" },
      ],
      [
        action({ default: reactToReviewComment }),
        { ...plan, commentId: "kit-root", reaction: "👀", active: true },
      ],
      [
        action({ default: resolveReviewThread }),
        { ...plan, threadId: "kit-root" },
      ],
      [
        action({ default: consumeReviewFeedback }),
        { ...plan, commentIds: ["kit-root"] },
      ],
      [
        action({ default: deleteReviewComment }),
        { ...plan, commentId: "kit-root" },
      ],
    ];

    for (const [kitAction, args] of kitWrites) {
      await expect(call(kitAction, args, OWNER)).rejects.toThrow(
        "Plan comments are written with",
      );
    }
    await expectStoresAgree(planId);
  });
});
