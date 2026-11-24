import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import {
  getReviewCommentById,
  listReviewCommentReactors,
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
import { eq } from "drizzle-orm";
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
let comments: typeof import("./plan-comments.js");
let plans: typeof import("../plans.js");
let createPlan: Runnable<{ planId: string }>;
let updatePlan: Runnable;
let replyToComment: Runnable<{ commentId: string }>;
let resolveComment: Runnable<{ resolutionNoteId?: string }>;
let deleteComment: Runnable;
let consumeFeedback: Runnable;
let restoreVersion: Runnable;
let deletePlan: Runnable;
let reactToComment: Runnable<{ reactions: unknown }>;
let getPlan: Runnable<{ comments: Array<{ id: string; reactions?: unknown }> }>;
let previousLocalMode: string | undefined;

beforeAll(async () => {
  previousLocalMode = process.env.PLAN_LOCAL_MODE;
  process.env.PLAN_LOCAL_MODE = "0";
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.APP_URL = "https://plan.example.test";
  dbModule = await import("../db/index.js");
  mirror = await import("./plan-comment-mirror.js");
  comments = await import("./plan-comments.js");
  plans = await import("../plans.js");
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
  reactToComment = action(
    await import("../../actions/react-to-plan-comment.js"),
  );
  getPlan = action(await import("../../actions/get-visual-plan.js"));
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

// oracle-change: the kit is the only comment store now, so the two-store agreement checks went
async function oldRows(planId: string) {
  const { getDb, schema } = dbModule;
  return getDb()
    .select()
    .from(schema.planComments)
    .where(eq(schema.planComments.planId, planId));
}

async function expectOnlyInKit(planId: string) {
  expect(await oldRows(planId)).toEqual([]);
  return comments.listPlanCommentRows(planId);
}

async function kitRows(planId: string) {
  const { rows } = await getDbExec().execute({
    sql: "SELECT * FROM agent_review_comments WHERE resource_type = 'plan' AND resource_id = ? ORDER BY id",
    args: [planId],
  });
  return rows;
}

describe("Plan comments in the review kit", () => {
  it("writes a new plan's comments to the kit, replies to replies included, with their kind, routing and anchors", async () => {
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

    expect(await expectOnlyInKit(planId)).toHaveLength(4);
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

  it("writes every comment action to the kit and nothing to plan_comments", async () => {
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
    await expectOnlyInKit(planId);

    const reply = await call(replyToComment, {
      planId,
      commentId: "flow-root",
      body: "Tightened in the next revision",
    });
    await expectOnlyInKit(planId);
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
    await expectOnlyInKit(planId);
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
    await expectOnlyInKit(planId);
    expect(await stored("flow-canvas")).toMatchObject({
      body: "Callout overlaps the header",
      kind: "correction",
      resolutionTarget: "human",
    });

    await call(consumeFeedback, { planId, commentIds: ["flow-root"] });
    await expectOnlyInKit(planId);
    expect((await stored("flow-root"))?.consumedAt).toEqual(expect.any(String));

    await call(updatePlan, { planId, consumedCommentIds: ["flow-added"] });
    await expectOnlyInKit(planId);
    expect((await stored("flow-added"))?.consumedAt).toEqual(
      expect.any(String),
    );

    const resolved = await call(resolveComment, {
      planId,
      commentId: "flow-root",
      status: "resolved",
      resolutionNote: "Done in revision 2",
    });
    await expectOnlyInKit(planId);
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
    await expectOnlyInKit(planId);
    expect((await stored("flow-root"))?.resolvedAt).toBe(firstResolvedAt);

    await call(resolveComment, {
      planId,
      commentId: "flow-root",
      status: "open",
    });
    await expectOnlyInKit(planId);
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
    await expectOnlyInKit(planId);
    expect((await stored("flow-canvas"))?.status).toBe("resolved");

    await call(deleteComment, { planId, commentId: "flow-root" });
    expect((await expectOnlyInKit(planId)).map(({ id }) => id)).not.toContain(
      "flow-root",
    );
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

    await expectOnlyInKit(planId);
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
    await expectOnlyInKit(planId);

    expect(
      await call(deletePlan, {
        planId,
        mode: "hard",
        confirmation: `DELETE ${planId}`,
      }),
    ).toMatchObject({ deletedCounts: { comments: 2 } });

    expect(await expectOnlyInKit(planId)).toEqual([]);
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

    const rows = await expectOnlyInKit(planId);
    const root = rows.find((row) => row.message === "Second time");
    expect(root?.id).toEqual(expect.any(String));
    expect(root?.id).not.toBe("reused-root");
    expect(
      rows.find((row) => row.message === "Reply again")?.parentCommentId,
    ).toBe(root?.id);
    const added = rows.find((row) => row.message === "Added later");
    expect(added?.id).toEqual(expect.any(String));
    expect(added?.id).not.toBe("reused-reply");
    for (const id of ["reused-root", "reused-reply"]) {
      expect(await stored(id)).toMatchObject({
        status: "deleted",
        resourceId: goneId,
      });
    }
  });

  it("gives a new comment a fresh ID when another plan's comment in the kit holds it", async () => {
    const otherPlanId = await newPlan();
    const planId = await newPlan();
    const at = "2026-11-21T12:00:00.000Z";
    await mirrorReviewComments(
      { resourceType: "plan", resourceId: otherPlanId },
      [
        {
          id: "kit-held-elsewhere",
          threadId: "kit-held-elsewhere",
          parentCommentId: null,
          body: "Written on the other plan",
          authorEmail: "kit-author@example.test",
          authorName: null,
          createdBy: "human",
          resolved: false,
          createdAt: at,
          updatedAt: at,
        },
      ],
    );

    await call(updatePlan, {
      planId,
      comments: [{ id: "kit-held-elsewhere", message: "Written in Plan" }],
    });

    expect(await stored("kit-held-elsewhere")).toMatchObject({
      status: "open",
      resourceId: otherPlanId,
      body: "Written on the other plan",
      authorEmail: "kit-author@example.test",
    });
    const rows = await expectOnlyInKit(planId);
    expect(rows.map(({ message }) => message)).not.toContain(
      "Written on the other plan",
    );
    const added = rows.find((row) => row.message === "Written in Plan");
    expect(added?.id).toEqual(expect.any(String));
    expect(added?.id).not.toBe("kit-held-elsewhere");
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

  it("rolls a comment write back with the plan write that fails", async () => {
    const planId = await newPlan();

    await expect(
      dbModule.getDb().transaction(async (tx) => {
        await comments.writePlanCommentRows(tx, planId, [
          comments.completePlanCommentRow({
            id: "rolled-back",
            planId,
            message: "Never saved",
            createdAt: "2026-11-20T10:00:00.000Z",
            updatedAt: "2026-11-20T10:00:00.000Z",
          }),
        ]);
        expect(await stored("rolled-back")).not.toBeNull();
        throw new Error("The plan write failed");
      }),
    ).rejects.toThrow("The plan write failed");

    expect(await stored("rolled-back")).toBeNull();
  });

  it("adds comments only plan_comments has to the kit, and adding again changes nothing", async () => {
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

    const first = await mirror.addMissingPlanCommentsToReviewKit();

    expect(first.failedPlans).toEqual([]);
    expect(first.added).toBeGreaterThanOrEqual(5);
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
    const second = await mirror.addMissingPlanCommentsToReviewKit();

    expect(second).toMatchObject({ added: 0, failedPlans: [] });
    expect(await kitRows(planId)).toEqual(before);
  });

  it("leaves comments the kit already has as it has them, deleted ones too", async () => {
    const planId = await newPlan([
      { id: "kept-edited", message: "As the kit has it" },
      { id: "kept-deleted", message: "Deleted in the kit" },
    ]);
    await call(deleteComment, { planId, commentId: "kept-deleted" });
    const at = "2026-10-01T10:00:00.000Z";
    await dbModule
      .getDb()
      .insert(dbModule.schema.planComments)
      .values(
        ["kept-edited", "kept-deleted"].map((id) => ({
          id,
          planId,
          message: "As plan_comments had it",
          createdAt: at,
          updatedAt: at,
        })),
      );

    const report = await mirror.addMissingPlanCommentsToReviewKit();

    expect(report.failedPlans).toEqual([]);
    expect(await stored("kept-edited")).toMatchObject({
      status: "open",
      body: "As the kit has it",
    });
    expect(await stored("kept-deleted")).toMatchObject({
      status: "deleted",
      body: "",
    });
  });

  it("doesn't bring back a comment deleted after the writer read it", async () => {
    const planId = await newPlan([
      { id: "stale-root", message: "Read, then deleted" },
    ]);
    const stale = (await comments.listPlanCommentRows(planId)).find(
      (row) => row.id === "stale-root",
    );
    if (!stale) throw new Error("Plan didn't write stale-root to the kit");
    await call(deleteComment, { planId, commentId: "stale-root" });

    await dbModule.getDb().transaction(async (tx) => {
      await comments.writePlanCommentRows(tx, planId, [
        { ...stale, consumedAt: "2026-11-22T10:00:00.000Z" },
      ]);
    });

    expect(await stored("stale-root")).toMatchObject({
      status: "deleted",
      body: "",
    });
  });

  it("keeps an edit made after the writer read the comment", async () => {
    const planId = await newPlan([
      { id: "patched-root", kind: "question", message: "Before the edit" },
    ]);
    await call(updatePlan, {
      planId,
      comments: [
        { id: "patched-root", kind: "correction", message: "After the edit" },
      ],
    });

    await dbModule.getDb().transaction(async (tx) => {
      await comments.writePlanCommentRows(
        tx,
        planId,
        [],
        [
          {
            id: "patched-root",
            consumedAt: "2026-11-22T10:00:00.000Z",
            updatedAt: "2026-11-22T10:00:00.000Z",
          },
        ],
      );
    });

    expect(await stored("patched-root")).toMatchObject({
      body: "After the edit",
      kind: "correction",
      consumedAt: "2026-11-22T10:00:00.000Z",
    });
  });

  it("deletes the replies a thread has when the delete runs, and refuses replies after it", async () => {
    const planId = await newPlan([{ id: "late-root", message: "Thread" }]);
    const reply = (id: string) =>
      comments.completePlanCommentRow({
        id,
        planId,
        parentCommentId: "late-root",
        message: "Saved late",
        createdAt: "2026-11-22T10:00:00.000Z",
        updatedAt: "2026-11-22T10:00:00.000Z",
      });
    await dbModule.getDb().transaction(async (tx) => {
      await comments.writePlanCommentRows(tx, planId, [reply("late-reply")]);
    });

    const deleted = await dbModule
      .getDb()
      .transaction((tx) =>
        comments.deletePlanCommentThread(
          tx,
          planId,
          "late-root",
          OWNER.userEmail,
          "2026-11-22T10:01:00.000Z",
        ),
      );

    expect(deleted).toEqual(["late-root", "late-reply"]);
    expect(await stored("late-reply")).toMatchObject({ status: "deleted" });
    await expect(
      dbModule.getDb().transaction(async (tx) => {
        await comments.writePlanCommentRows(tx, planId, [reply("too-late")]);
      }),
    ).rejects.toThrow("which isn't on it");
    expect(await stored("too-late")).toBeNull();
  });

  it("keeps what Plan doesn't store when Plan changes a comment", async () => {
    const planId = await newPlan();
    const at = "2026-11-21T12:00:00.000Z";
    await mirrorReviewComments({ resourceType: "plan", resourceId: planId }, [
      {
        id: "kit-shaped",
        threadId: "kit-shaped",
        parentCommentId: null,
        targetId: "frame-1",
        anchor: { x: 0.25, y: 0.5 },
        anchorKind: "frame-point",
        anchorVersion: 2,
        body: "Written around Plan",
        authorEmail: "bot@example.test",
        authorName: null,
        createdBy: "system",
        kind: "review",
        resolved: false,
        createdAt: at,
        updatedAt: at,
        metadata: { images: ["shot.png"] },
        reactions: [{ actorEmail: "viewer@example.test", reaction: "👀" }],
      },
    ]);

    await call(consumeFeedback, { planId, commentIds: ["kit-shaped"] });
    await call(resolveComment, {
      planId,
      commentId: "kit-shaped",
      status: "resolved",
    });

    expect(await stored("kit-shaped")).toMatchObject({
      status: "resolved",
      consumedAt: expect.any(String),
      body: "Written around Plan",
      createdBy: "system",
      kind: "review",
      targetId: "frame-1",
      anchor: { x: 0.25, y: 0.5 },
      anchorKind: "frame-point",
      anchorVersion: 2,
      metadata: { images: ["shot.png"] },
    });
    expect(await listReviewCommentReactors(["kit-shaped"])).toEqual({
      "kit-shaped": { "👀": ["viewer@example.test"] },
    });
  });

  it("refuses a comment write on a plan in the trash", async () => {
    const planId = await newPlan();
    await call(deletePlan, { planId, mode: "soft" });

    await expect(
      dbModule.getDb().transaction(async (tx) => {
        await comments.writePlanCommentRows(tx, planId, [
          comments.completePlanCommentRow({
            id: "trashed-write",
            planId,
            message: "Written after the trash",
            createdAt: "2026-11-22T10:00:00.000Z",
            updatedAt: "2026-11-22T10:00:00.000Z",
          }),
        ]);
      }),
    ).rejects.toThrow(`Plan ${planId} not found`);

    await call(deletePlan, { planId, mode: "restore" });
    expect(await stored("trashed-write")).toBeNull();
  });

  it("marks a comment consumed once when its ID is sent twice", async () => {
    const planId = await newPlan([{ id: "twice-consumed", message: "Once" }]);

    await call(consumeFeedback, {
      planId,
      commentIds: ["twice-consumed", "twice-consumed"],
    });

    expect((await stored("twice-consumed"))?.consumedAt).toEqual(
      expect.any(String),
    );
  });

  it("saves a comment whose section is gone without a section", async () => {
    const planId = await newPlan();

    await dbModule.getDb().transaction(async (tx) => {
      await comments.writePlanCommentRows(tx, planId, [
        comments.completePlanCommentRow({
          id: "sectionless",
          planId,
          sectionId: "restored-away",
          message: "Its section went",
          createdAt: "2026-11-22T10:00:00.000Z",
          updatedAt: "2026-11-22T10:00:00.000Z",
        }),
      ]);
    });

    expect(await stored("sectionless")).toMatchObject({
      body: "Its section went",
      surfaceId: null,
    });
  });

  it("keeps the ID of a new comment this plan already has, and saves it once", async () => {
    const planId = await newPlan([{ id: "sent-twice", message: "First send" }]);
    const resent = {
      id: "sent-twice",
      planId,
      kind: "comment" as const,
      status: "open" as const,
      message: "Second send",
      createdAt: "2026-11-22T10:00:00.000Z",
      updatedAt: "2026-11-22T10:00:00.000Z",
    };

    const rows = await plans.withFreshIdsForKitHeldComments(planId, [resent]);
    expect(rows.map(({ id }) => id)).toEqual(["sent-twice"]);
    await dbModule.getDb().transaction(async (tx) => {
      await comments.writePlanCommentRows(
        tx,
        planId,
        rows.map(comments.completePlanCommentRow),
      );
    });

    expect(
      (await expectOnlyInKit(planId)).map(({ id, message }) => [id, message]),
    ).toEqual([["sent-twice", "First send"]]);
  });

  it("counts a plan's live and open comments from the kit", async () => {
    const planId = await newPlan([
      { id: "count-open", message: "Still open" },
      { id: "count-resolved", message: "Resolved" },
      { id: "count-deleted", message: "Deleted" },
    ]);
    await call(resolveComment, {
      planId,
      commentId: "count-resolved",
      status: "resolved",
    });
    await call(deleteComment, { planId, commentId: "count-deleted" });

    expect((await comments.countPlanComments([planId])).get(planId)).toEqual({
      comments: 2,
      open: 1,
    });
  });

  it("keeps a person's reactions and their agent's apart, and shows each their own", async () => {
    const planId = await newPlan([{ id: "react-root", message: "React here" }]);
    const react = (active: boolean, ctx?: unknown) =>
      call(
        reactToComment,
        { planId, commentId: "react-root", reaction: "👍", active },
        ctx,
      );
    const agent = { caller: "tool" };

    expect((await react(true)).reactions).toEqual([
      { reaction: "👍", count: 1, reactedByMe: true },
    ]);
    expect((await react(true, agent)).reactions).toEqual([
      { reaction: "👍", count: 2, reactedByMe: true },
    ]);
    expect((await react(true)).reactions).toEqual([
      { reaction: "👍", count: 2, reactedByMe: true },
    ]);
    expect((await react(false)).reactions).toEqual([
      { reaction: "👍", count: 1, reactedByMe: false },
    ]);
    expect(await listReviewCommentReactors(["react-root"])).toEqual({
      "react-root": { "👍": ["agent:owner@example.test"] },
    });

    const read = async (ctx?: unknown) =>
      (
        await call(getPlan, { id: planId, includeMdx: false }, ctx)
      ).comments.find((comment) => comment.id === "react-root")?.reactions;
    expect(await read()).toEqual([
      { reaction: "👍", count: 1, reactedByMe: false },
    ]);
    expect(await read(agent)).toEqual([
      { reaction: "👍", count: 1, reactedByMe: true },
    ]);
  });

  it("refuses a reaction on a deleted comment, another plan's, or a plan in the trash", async () => {
    const planId = await newPlan([
      { id: "react-kept", message: "Kept" },
      { id: "react-gone", message: "Deleted" },
    ]);
    const otherPlanId = await newPlan([
      { id: "react-other", message: "Other" },
    ]);
    await call(deleteComment, { planId, commentId: "react-gone" });
    const react = (target: string, commentId: string) =>
      call(reactToComment, {
        planId: target,
        commentId,
        reaction: "🎉",
        active: true,
      });

    await expect(react(planId, "react-gone")).rejects.toThrow(
      `Comment react-gone isn't on plan ${planId}.`,
    );
    await expect(react(planId, "react-other")).rejects.toThrow(
      `Comment react-other isn't on plan ${planId}.`,
    );
    await call(deletePlan, { planId: otherPlanId, mode: "soft" });
    await expect(react(otherPlanId, "react-other")).rejects.toThrow(
      `Plan ${otherPlanId} not found`,
    );
    expect(
      await listReviewCommentReactors(["react-gone", "react-other"]),
    ).toEqual({ "react-gone": {}, "react-other": {} });
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
    expect(await expectOnlyInKit(planId)).toHaveLength(1);
    expect(await stored("kit-root")).toMatchObject({
      status: "open",
      body: "Written in Plan",
    });
  });
});
