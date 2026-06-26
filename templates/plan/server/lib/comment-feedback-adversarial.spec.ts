import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Plan,
  PlanBundle,
  PlanComment,
  PlanSection,
} from "../../shared/types.js";

/**
 * Deep / adversarial coverage for the COMMENTING + FEEDBACK area:
 *   - actions/get-plan-feedback.ts (aggregation, ordering, anchor summaries, threads)
 *   - server/lib/comment-notifications.ts (recipients, dedupe, self-notify, leaks)
 *   - server/plans.ts comment-row builders + author identity (spoofing)
 *
 * Strategy mirrors the existing get-plan-feedback.spec.ts and
 * comment-notifications.spec.ts mock idioms so it runs against the same module
 * graph the production action surface uses.
 */

// ---------------------------------------------------------------------------
// get-plan-feedback action under test (mock the action runtime + plan loader)
// ---------------------------------------------------------------------------
vi.mock("@agent-native/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core")>()),
  defineAction: (entry: unknown) => entry,
  embedApp: vi.fn(() => ({ title: "stub" })),
}));

const loadPlanBundleMock = vi.fn();
vi.mock("../plans.js", async () => {
  const actual =
    await vi.importActual<typeof import("../plans.js")>("../plans.js");
  return {
    ...actual,
    loadPlanBundle: (planId: string) => loadPlanBundleMock(planId),
  };
});

// comment-notifications mocks (match the existing spec exactly)
const sendEmailMock = vi.hoisted(() => vi.fn());
const renderEmailMock = vi.hoisted(() =>
  vi.fn((_args: unknown) => ({ html: "<p>Email</p>", text: "Email" })),
);
const isEmailConfiguredMock = vi.hoisted(() => vi.fn(() => true));
const selectPlanMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  // plans.ts (importActual) also uses asc / inArray; provide harmless stubs.
  asc: vi.fn((col: unknown) => ({ asc: col })),
  inArray: vi.fn((col: unknown, values: unknown) => ({ col, values })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
}));

vi.mock("@agent-native/core/server", () => ({
  emailStrong: (value: string) => `<strong>${value}</strong>`,
  getAppProductionUrl: () => "https://plans.example.test",
  isEmailConfigured: () => isEmailConfiguredMock(),
  renderEmail: (args: unknown) => renderEmailMock(args),
  sendEmail: (args: unknown) => sendEmailMock(args),
  buildDeepLink: (args: unknown) => `deeplink:${JSON.stringify(args)}`,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("../plan-content.js", () => ({
  parsePlanContent: (value: unknown) => value,
  buildPlanContentHtml: () => "<html></html>",
}));

vi.mock("../db/index.js", () => ({
  getDb: () => getDbMock(),
  schema: {
    plans: {
      id: "plans.id",
      title: "plans.title",
      ownerEmail: "plans.owner_email",
    },
    planComments: {},
    planSections: {},
    planEvents: {},
  },
}));

const getPlanFeedback = (await import("../../actions/get-plan-feedback.js"))
  .default as {
  run: (args: { planId: string }) => Promise<{
    comments: Array<PlanComment & { anchorContext?: string | null }>;
    threads: Array<{
      id: string;
      root: PlanComment & { anchorContext?: string | null };
      replies: Array<PlanComment & { anchorContext?: string | null }>;
      comments: PlanComment[];
      status: string;
      commentCount: number;
      anchorContext: string | null;
    }>;
  }>;
};

const { planCommentNotificationRecipients, notifyPlanCommentRecipients } =
  await import("./comment-notifications.js");

const {
  buildUpdatedPlanCommentRows,
  buildInitialPlanCommentRows,
  resolveCommentAuthor,
} = await import("../plans.js");

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
const plan: Plan = {
  id: "plan_1",
  title: "Invite flow",
  brief: "Make the plan scannable.",
  kind: "plan",
  status: "review",
  source: "codex",
  repoPath: null,
  currentFocus: null,
  html: null,
  markdown: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  approvedAt: null,
};

const section: PlanSection = {
  id: "sec_1",
  planId: "plan_1",
  type: "summary",
  title: "Summary",
  body: "Review this.",
  html: null,
  order: 0,
  createdBy: "agent",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function fbComment(
  overrides: Partial<PlanComment> & { id: string },
): PlanComment {
  return {
    planId: "plan_1",
    parentCommentId: null,
    sectionId: null,
    kind: "comment",
    status: "open",
    anchor: null,
    message: overrides.id,
    createdBy: "human",
    authorEmail: null,
    authorName: null,
    consumedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function feedbackBundle(comments: PlanComment[]): PlanBundle {
  return {
    plan,
    sections: [section],
    comments,
    events: [],
    summary: {
      sectionCounts: { summary: 1 },
      commentCount: comments.length,
      openCommentCount: comments.filter((c) => c.status === "open").length,
    },
  };
}

function notifyComment(
  id: string,
  overrides: Partial<PlanComment> = {},
): PlanComment {
  const seconds = String(Math.min(id.length, 59)).padStart(2, "0");
  return {
    id,
    planId: "plan_1",
    parentCommentId: null,
    sectionId: null,
    kind: "comment",
    status: "open",
    anchor: null,
    message: id,
    createdBy: "human",
    authorEmail: `${id}@example.com`,
    authorName: id,
    consumedAt: null,
    createdAt: `2026-06-05T00:00:${seconds}.000Z`,
    updatedAt: `2026-06-05T00:00:${seconds}.000Z`,
    ...overrides,
  };
}

function notifyBundle(comments: PlanComment[]): PlanBundle {
  return {
    plan: {
      id: "plan_1",
      title: "Fallback Plan Title",
      brief: "",
      kind: "plan",
      status: "review",
      source: "manual",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z",
    },
    sections: [],
    comments,
    events: [],
    summary: {
      sectionCounts: {},
      commentCount: comments.length,
      openCommentCount: comments.filter((c) => c.status === "open").length,
    },
  };
}

function dbMockForPlan() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: selectPlanMock,
      })),
    })),
  };
}

beforeEach(() => {
  loadPlanBundleMock.mockReset();
  getDbMock.mockReset();
  getDbMock.mockReturnValue(dbMockForPlan());
  isEmailConfiguredMock.mockReset();
  isEmailConfiguredMock.mockReturnValue(true);
  renderEmailMock.mockClear();
  selectPlanMock.mockReset();
  sendEmailMock.mockReset();
});

// ===========================================================================
// get-plan-feedback: aggregation + ordering + anchors
// ===========================================================================
describe("get-plan-feedback aggregation", () => {
  it("returns only unconsumed human comments and excludes agent/import/consumed", async () => {
    loadPlanBundleMock.mockResolvedValueOnce(
      feedbackBundle([
        fbComment({ id: "h-open" }),
        fbComment({ id: "h-consumed", consumedAt: "2026-01-02T00:00:00.000Z" }),
        fbComment({ id: "agent-open", createdBy: "agent" }),
        fbComment({ id: "import-open", createdBy: "import" }),
      ]),
    );
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    expect(result.comments.map((c) => c.id)).toEqual(["h-open"]);
  });

  it("summarizes a point/visual anchor as percent across/down", async () => {
    const c = fbComment({
      id: "visual",
      anchor: JSON.stringify({
        anchorKind: "visual",
        visualLabel: "Submit button",
        visualX: 73.4,
        visualY: 12.9,
      }),
    });
    loadPlanBundleMock.mockResolvedValueOnce(feedbackBundle([c]));
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    expect(result.comments[0].anchorContext).toBe(
      "Submit button at 73% across / 13% down within the target",
    );
  });

  it("summarizes a canvas markup anchor with rounded coordinates", async () => {
    const c = fbComment({
      id: "canvas",
      anchor: JSON.stringify({
        planAnnotationId: "ann_1",
        visualLabel: "Login screen",
        markupType: "callout",
        canvasX: 120.6,
        canvasY: 240.2,
      }),
    });
    loadPlanBundleMock.mockResolvedValueOnce(feedbackBundle([c]));
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    expect(result.comments[0].anchorContext).toBe(
      "Login screen callout at canvas 121, 240 (board px)",
    );
  });

  it("ignores the placeholder 'Visible plan area' section title in summaries", async () => {
    const c = fbComment({
      id: "vis-area",
      anchor: JSON.stringify({
        sectionTitle: "Visible plan area",
        textQuote: "Ship it",
      }),
    });
    loadPlanBundleMock.mockResolvedValueOnce(feedbackBundle([c]));
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    expect(result.comments[0].anchorContext).toBe('"Ship it"');
  });

  it("does not crash on malformed JSON anchors (returns null context)", async () => {
    const c = fbComment({ id: "broken", anchor: "{not json" });
    loadPlanBundleMock.mockResolvedValueOnce(feedbackBundle([c]));
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    expect(result.comments[0].anchorContext).toBeNull();
  });

  it("propagates loadPlanBundle errors for a missing plan", async () => {
    loadPlanBundleMock.mockRejectedValueOnce(
      new Error("Plan plan_x not found"),
    );
    await expect(getPlanFeedback.run({ planId: "plan_x" })).rejects.toThrow(
      "Plan plan_x not found",
    );
  });
});

// ===========================================================================
// get-plan-feedback: threads
// ===========================================================================
describe("get-plan-feedback threads", () => {
  it("groups a reply under its root and surfaces it as a thread with replies", async () => {
    const root = fbComment({
      id: "root",
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    const reply = fbComment({
      id: "reply",
      parentCommentId: "root",
      createdAt: "2026-01-01T00:00:02.000Z",
    });
    loadPlanBundleMock.mockResolvedValueOnce(feedbackBundle([root, reply]));
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].id).toBe("root");
    expect(result.threads[0].root.id).toBe("root");
    expect(result.threads[0].replies.map((r) => r.id)).toEqual(["reply"]);
    expect(result.threads[0].commentCount).toBe(2);
  });

  it("includes a thread when only a REPLY is unconsumed feedback (root consumed)", async () => {
    const root = fbComment({
      id: "root",
      consumedAt: "2026-01-01T01:00:00.000Z",
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    const reply = fbComment({
      id: "reply",
      parentCommentId: "root",
      createdAt: "2026-01-01T00:00:02.000Z",
    });
    loadPlanBundleMock.mockResolvedValueOnce(feedbackBundle([root, reply]));
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    // The thread should still surface because the reply is fresh feedback.
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].comments.map((c) => c.id)).toEqual([
      "root",
      "reply",
    ]);
  });

  it("marks a thread resolved only when no comment is open", async () => {
    const root = fbComment({ id: "root", status: "resolved" });
    const reply = fbComment({
      id: "reply",
      parentCommentId: "root",
      status: "resolved",
      createdAt: "2026-01-01T00:00:02.000Z",
    });
    loadPlanBundleMock.mockResolvedValueOnce(feedbackBundle([root, reply]));
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    // resolved root+reply, but they're still in the feedback set only if
    // unconsumed human — they are. status should be "resolved".
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].status).toBe("resolved");
  });

  it("does not infinite-loop on a self-parenting comment (orphan cycle)", async () => {
    // Adversarial: a comment that points at itself as parent.
    const selfRef = fbComment({ id: "self", parentCommentId: "self" });
    loadPlanBundleMock.mockResolvedValueOnce(feedbackBundle([selfRef]));
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].commentCount).toBe(1);
  });

  it("does not infinite-loop on a two-comment parent cycle", async () => {
    const a = fbComment({ id: "a", parentCommentId: "b" });
    const b = fbComment({
      id: "b",
      parentCommentId: "a",
      createdAt: "2026-01-01T00:00:02.000Z",
    });
    loadPlanBundleMock.mockResolvedValueOnce(feedbackBundle([a, b]));
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    // Should terminate and produce thread(s) without hanging.
    const total = result.threads.reduce((n, t) => n + t.commentCount, 0);
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it("treats a reply whose parent is missing as its own root thread", async () => {
    const orphan = fbComment({ id: "orphan", parentCommentId: "ghost" });
    loadPlanBundleMock.mockResolvedValueOnce(feedbackBundle([orphan]));
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].id).toBe("orphan");
  });
});

// ===========================================================================
// comment notifications: recipients + dedupe + self-notify + leaks
// ===========================================================================
describe("plan comment notification recipients (adversarial)", () => {
  it("dedupes plan owner who is also a thread participant to a single email", () => {
    const root = notifyComment("root", { authorEmail: "owner@example.com" });
    const reply = notifyComment("reply", {
      authorEmail: "newperson@example.com",
      parentCommentId: "root",
    });
    const recipients = planCommentNotificationRecipients({
      comment: reply,
      comments: [root, reply],
      planOwnerEmail: "owner@example.com",
    });
    const emails = recipients.map((r) => r.email);
    expect(emails.filter((e) => e === "owner@example.com")).toHaveLength(1);
  });

  it("normalizes email case/whitespace so self-notify is still suppressed", () => {
    // Actor commented with mixed-case/padded email; owner is the same person.
    const c = notifyComment("self", {
      authorEmail: "  Owner@Example.COM  ",
    });
    const recipients = planCommentNotificationRecipients({
      comment: c,
      comments: [c],
      planOwnerEmail: "owner@example.com",
    });
    expect(recipients).toEqual([]);
  });

  it("does not notify thread participants identified only by a non-human author", () => {
    const root = notifyComment("root", { authorEmail: "root@example.com" });
    const agentReply = notifyComment("agent", {
      createdBy: "agent",
      authorEmail: "agent@example.com",
      parentCommentId: "root",
    });
    const reply = notifyComment("reply", {
      authorEmail: "reply@example.com",
      parentCommentId: "root",
    });
    const recipients = planCommentNotificationRecipients({
      comment: reply,
      comments: [root, agentReply, reply],
      planOwnerEmail: "owner@example.com",
    });
    const emails = recipients.map((r) => r.email);
    expect(emails).toContain("owner@example.com");
    expect(emails).toContain("root@example.com");
    expect(emails).not.toContain("agent@example.com");
  });

  it("returns no recipients when the new comment is not human-authored", () => {
    const agent = notifyComment("agent", { createdBy: "agent" });
    expect(
      planCommentNotificationRecipients({
        comment: agent,
        comments: [agent],
        planOwnerEmail: "owner@example.com",
      }),
    ).toEqual([]);
  });

  it("does not leak a participant from a DIFFERENT thread on the same plan", () => {
    const threadAroot = notifyComment("aroot", {
      authorEmail: "aroot@example.com",
    });
    const threadBroot = notifyComment("broot", {
      authorEmail: "broot@example.com",
    });
    const threadBreply = notifyComment("breply", {
      authorEmail: "breply@example.com",
      parentCommentId: "broot",
    });
    const recipients = planCommentNotificationRecipients({
      comment: threadBreply,
      comments: [threadAroot, threadBroot, threadBreply],
      planOwnerEmail: "owner@example.com",
    });
    const emails = recipients.map((r) => r.email);
    expect(emails).toContain("broot@example.com");
    // aroot is in a separate thread and must NOT be notified.
    expect(emails).not.toContain("aroot@example.com");
  });

  it("suppresses synthetic QA owner and QA participants", () => {
    const root = notifyComment("root", {
      authorEmail: "tester+qa@example.test",
    });
    const reply = notifyComment("reply", {
      authorEmail: "reply@example.com",
      parentCommentId: "root",
    });
    const recipients = planCommentNotificationRecipients({
      comment: reply,
      comments: [root, reply],
      planOwnerEmail: "ci+qa@build.invalid",
    });
    const emails = recipients.map((r) => r.email);
    expect(emails).not.toContain("tester+qa@example.test");
    expect(emails).not.toContain("ci+qa@build.invalid");
  });
});

describe("notifyPlanCommentRecipients side effects", () => {
  it("escapes HTML in the comment excerpt to prevent injection in the email body", async () => {
    const evil = notifyComment("evil", {
      authorEmail: "evil@example.com",
      authorName: "Evil",
      message: `<img src=x onerror=alert(1)> & "quoted"`,
    });
    selectPlanMock.mockResolvedValue([
      { id: "plan_1", title: "Launch Plan", ownerEmail: "owner@example.com" },
    ]);
    await notifyPlanCommentRecipients({
      bundle: notifyBundle([evil]),
      insertedCommentIds: ["evil"],
    });
    const args = renderEmailMock.mock.calls[0]?.[0] as { paragraphs: string[] };
    expect(args.paragraphs[1]).not.toContain("<img");
    expect(args.paragraphs[1]).toContain("&lt;img");
  });

  it("truncates a huge comment body to a bounded excerpt", async () => {
    const huge = notifyComment("huge", {
      authorEmail: "huge@example.com",
      message: "x".repeat(5000),
    });
    selectPlanMock.mockResolvedValue([
      { id: "plan_1", title: "Launch Plan", ownerEmail: "owner@example.com" },
    ]);
    await notifyPlanCommentRecipients({
      bundle: notifyBundle([huge]),
      insertedCommentIds: ["huge"],
    });
    const args = renderEmailMock.mock.calls[0]?.[0] as { paragraphs: string[] };
    // 260-char cap + ellipsis, surrounded by `Comment: "..."`
    expect(args.paragraphs[1].length).toBeLessThan(400);
    expect(args.paragraphs[1]).toContain("...");
  });

  it("never emails the owner about their own comment via notify path", async () => {
    const ownComment = notifyComment("own", {
      authorEmail: "owner@example.com",
      authorName: "Owner",
    });
    selectPlanMock.mockResolvedValue([
      { id: "plan_1", title: "Launch Plan", ownerEmail: "owner@example.com" },
    ]);
    await notifyPlanCommentRecipients({
      bundle: notifyBundle([ownComment]),
      insertedCommentIds: ["own"],
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("swallows individual send failures and keeps notifying other recipients", async () => {
    const root = notifyComment("root", { authorEmail: "root@example.com" });
    const reply = notifyComment("reply", {
      authorEmail: "reply@example.com",
      parentCommentId: "root",
    });
    selectPlanMock.mockResolvedValue([
      { id: "plan_1", title: "Launch Plan", ownerEmail: "owner@example.com" },
    ]);
    sendEmailMock
      .mockRejectedValueOnce(new Error("smtp down"))
      .mockResolvedValue(undefined);
    await expect(
      notifyPlanCommentRecipients({
        bundle: notifyBundle([root, reply]),
        insertedCommentIds: ["reply"],
        priorComments: [root],
      }),
    ).resolves.toBeUndefined();
    // owner failed, root participant still attempted.
    expect(sendEmailMock.mock.calls.map(([a]) => a.to)).toEqual([
      "owner@example.com",
      "root@example.com",
    ]);
  });
});

// ===========================================================================
// comment row builders: identity spoofing + threading edge cases
// ===========================================================================
describe("comment author identity (anti-spoof)", () => {
  it("forces a human comment author to the authenticated request email, ignoring a spoofed authorEmail", () => {
    const result = resolveCommentAuthor({
      createdBy: "human",
      authorEmail: "victim@example.com",
      authorName: "Impersonated CEO",
      requestEmail: "real-reviewer@example.com",
      requestName: "Real Reviewer",
    });
    expect(result.authorEmail).toBe("real-reviewer@example.com");
    expect(result.authorName).toBe("Real Reviewer");
  });

  it("falls back to provided authorEmail for human comments only when no request identity", () => {
    const result = resolveCommentAuthor({
      createdBy: "human",
      authorEmail: "provided@example.com",
      authorName: "Provided",
      requestEmail: null,
      requestName: null,
    });
    expect(result.authorEmail).toBe("provided@example.com");
  });

  it("does not overwrite an agent comment author with the request identity", () => {
    const result = resolveCommentAuthor({
      createdBy: "agent",
      authorEmail: "bot@service.example",
      authorName: "Plan Bot",
      requestEmail: "human@example.com",
      requestName: "Human",
    });
    expect(result.authorEmail).toBe("bot@service.example");
    expect(result.authorName).toBe("Plan Bot");
  });

  it("treats whitespace-only request identity as absent", () => {
    const result = resolveCommentAuthor({
      createdBy: "human",
      authorEmail: "fallback@example.com",
      requestEmail: "   ",
      requestName: "   ",
    });
    expect(result.authorEmail).toBe("fallback@example.com");
    expect(result.authorName).toBeNull();
  });
});

describe("buildUpdatedPlanCommentRows (adversarial threading)", () => {
  it("stamps the resolved request email onto every inserted comment in a batch", () => {
    const rows = buildUpdatedPlanCommentRows({
      planId: "plan_1",
      now: "2026-06-05T00:00:00.000Z",
      requestEmail: "reviewer@example.com",
      requestName: "Reviewer",
      existingComments: [],
      comments: [
        {
          id: "c1",
          kind: "comment",
          status: "open",
          message: "one",
          createdBy: "human",
        },
        {
          id: "c2",
          parentCommentId: "c1",
          kind: "comment",
          status: "open",
          message: "two",
          createdBy: "human",
          authorEmail: "spoof@evil.example",
        },
      ],
    });
    for (const row of rows) {
      expect(row.authorEmail).toBe("reviewer@example.com");
    }
  });

  it("inherits parent anchor/section/kind onto a reply that omits them", () => {
    const rows = buildUpdatedPlanCommentRows({
      planId: "plan_1",
      now: "2026-06-05T00:00:00.000Z",
      existingComments: [
        {
          id: "existing-root",
          sectionId: "sec-x",
          kind: "annotation",
          anchor: JSON.stringify({ blockId: "b" }),
        },
      ],
      comments: [
        {
          id: "reply",
          parentCommentId: "existing-root",
          kind: "comment",
          status: "open",
          message: "inherit me",
          createdBy: "human",
        },
      ],
    });
    expect(rows[0]).toMatchObject({
      id: "reply",
      parentCommentId: "existing-root",
      sectionId: "sec-x",
      kind: "annotation",
      anchor: JSON.stringify({ blockId: "b" }),
    });
  });

  it("rejects a reply whose parent is neither existing nor pending", () => {
    expect(() =>
      buildUpdatedPlanCommentRows({
        planId: "plan_1",
        now: "2026-06-05T00:00:00.000Z",
        existingComments: [],
        comments: [
          {
            id: "reply",
            parentCommentId: "nope",
            kind: "comment",
            status: "open",
            message: "orphan",
            createdBy: "human",
          },
        ],
      }),
    ).toThrow("Parent comment nope was not found on plan plan_1.");
  });

  it("rejects duplicate ids within one batch", () => {
    expect(() =>
      buildUpdatedPlanCommentRows({
        planId: "plan_1",
        now: "2026-06-05T00:00:00.000Z",
        existingComments: [],
        comments: [
          {
            id: "dup",
            kind: "comment",
            status: "open",
            message: "a",
            createdBy: "human",
          },
          {
            id: "dup",
            kind: "comment",
            status: "open",
            message: "b",
            createdBy: "human",
          },
        ],
      }),
    ).toThrow("Duplicate comment id dup.");
  });
});

// ===========================================================================
// Additional anchor + deep-thread edge cases
// ===========================================================================
describe("get-plan-feedback anchor + deep thread edges", () => {
  it("summarizes a bare section-only anchor as the section title", async () => {
    const c = fbComment({
      id: "section-only",
      anchor: JSON.stringify({ sectionTitle: "Risks" }),
    });
    loadPlanBundleMock.mockResolvedValueOnce(feedbackBundle([c]));
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    expect(result.comments[0].anchorContext).toBe("Risks");
  });

  it("returns document coordinates for a point anchor with only x/y and no section/quote", async () => {
    const c = fbComment({
      id: "bare-point",
      anchor: JSON.stringify({ anchorKind: "point", x: 10, y: 20 }),
    });
    loadPlanBundleMock.mockResolvedValueOnce(feedbackBundle([c]));
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    expect(result.comments[0].anchorContext).toBe(
      "Pinned at 10% across / 20% down of the full plan document",
    );
  });

  it("groups a 3-level deep thread under the top-most root", async () => {
    const root = fbComment({
      id: "root",
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    const mid = fbComment({
      id: "mid",
      parentCommentId: "root",
      createdAt: "2026-01-01T00:00:02.000Z",
    });
    const leaf = fbComment({
      id: "leaf",
      parentCommentId: "mid",
      createdAt: "2026-01-01T00:00:03.000Z",
    });
    loadPlanBundleMock.mockResolvedValueOnce(feedbackBundle([leaf, mid, root]));
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].id).toBe("root");
    expect(result.threads[0].comments.map((c) => c.id)).toEqual([
      "root",
      "mid",
      "leaf",
    ]);
    expect(result.threads[0].replies.map((c) => c.id)).toEqual(["mid", "leaf"]);
  });

  it("orders threads' comments by createdAt then id for ties", async () => {
    const root = fbComment({
      id: "root",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const replyB = fbComment({
      id: "b-reply",
      parentCommentId: "root",
      createdAt: "2026-01-01T00:00:05.000Z",
    });
    const replyA = fbComment({
      id: "a-reply",
      parentCommentId: "root",
      createdAt: "2026-01-01T00:00:05.000Z",
    });
    loadPlanBundleMock.mockResolvedValueOnce(
      feedbackBundle([root, replyB, replyA]),
    );
    const result = await getPlanFeedback.run({ planId: "plan_1" });
    // equal createdAt -> id.localeCompare tiebreak ("a-reply" before "b-reply")
    expect(result.threads[0].replies.map((c) => c.id)).toEqual([
      "a-reply",
      "b-reply",
    ]);
  });
});

describe("notifyPlanCommentRecipients no-op + fallback paths", () => {
  it("does nothing when there are no inserted comment ids", async () => {
    await notifyPlanCommentRecipients({
      bundle: notifyBundle([notifyComment("x")]),
      insertedCommentIds: [],
    });
    expect(getDbMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("uses 'Someone' as the actor when a human comment has no email or name", async () => {
    const anon = notifyComment("anon", {
      authorEmail: null,
      authorName: null,
    });
    selectPlanMock.mockResolvedValue([
      { id: "plan_1", title: "Launch Plan", ownerEmail: "owner@example.com" },
    ]);
    await notifyPlanCommentRecipients({
      bundle: notifyBundle([anon]),
      insertedCommentIds: ["anon"],
    });
    const args = renderEmailMock.mock.calls[0]?.[0] as { paragraphs: string[] };
    expect(args.paragraphs[0]).toContain("Someone");
    expect(sendEmailMock.mock.calls[0]?.[0].subject).toContain(
      'Someone commented on "Launch Plan"',
    );
  });

  it("encodes a planId with special characters in the CTA url", async () => {
    const c = notifyComment("c", { authorEmail: "c@example.com" });
    const bundle = notifyBundle([c]);
    bundle.plan.id = "plan/with space?x=1";
    selectPlanMock.mockResolvedValue([
      {
        id: "plan/with space?x=1",
        title: "Launch Plan",
        ownerEmail: "owner@example.com",
      },
    ]);
    await notifyPlanCommentRecipients({
      bundle,
      insertedCommentIds: ["c"],
    });
    const args = renderEmailMock.mock.calls[0]?.[0] as {
      cta: { url: string };
    };
    expect(args.cta.url).toContain("plan%2Fwith%20space%3Fx%3D1");
    expect(args.cta.url).not.toContain("plan/with space");
  });
});

describe("buildInitialPlanCommentRows author stamping", () => {
  it("forces the request identity onto initial human comments (ignores spoof)", () => {
    const rows = buildInitialPlanCommentRows({
      planId: "plan_1",
      now: "2026-06-05T00:00:00.000Z",
      requestEmail: "owner@example.com",
      requestName: "Owner",
      comments: [
        {
          id: "c1",
          kind: "comment",
          status: "open",
          message: "hi",
          createdBy: "human",
          authorEmail: "spoof@evil.example",
          authorName: "Spoofed",
        },
      ],
    });
    expect(rows[0].authorEmail).toBe("owner@example.com");
    expect(rows[0].authorName).toBe("Owner");
  });
});

describe("comment-row builders self-parent + forward-reference handling", () => {
  it("rejects a self-parenting comment in an update batch (cycle)", () => {
    expect(() =>
      buildUpdatedPlanCommentRows({
        planId: "plan_1",
        now: "2026-06-05T00:00:00.000Z",
        existingComments: [],
        comments: [
          {
            id: "loop",
            parentCommentId: "loop",
            kind: "comment",
            status: "open",
            message: "I am my own parent",
            createdBy: "human",
          },
        ],
      }),
    ).toThrow("Updated comment threads contain a parent cycle.");
  });

  it("rejects a self-parenting comment in an initial batch (cycle)", () => {
    expect(() =>
      buildInitialPlanCommentRows({
        planId: "plan_1",
        now: "2026-06-05T00:00:00.000Z",
        comments: [
          {
            id: "loop",
            parentCommentId: "loop",
            kind: "comment",
            status: "open",
            message: "self",
            createdBy: "human",
          },
        ],
      }),
    ).toThrow("Initial comment threads contain a parent cycle.");
  });

  it("orders a forward-referenced reply after its pending root", () => {
    const rows = buildUpdatedPlanCommentRows({
      planId: "plan_1",
      now: "2026-06-05T00:00:00.000Z",
      existingComments: [],
      comments: [
        {
          id: "reply",
          parentCommentId: "root",
          kind: "comment",
          status: "open",
          message: "reply first in array",
          createdBy: "human",
        },
        {
          id: "root",
          kind: "comment",
          status: "open",
          message: "root second in array",
          createdBy: "human",
        },
      ],
    });
    // Root must be inserted before the reply so the FK is satisfiable.
    expect(rows.map((r) => r.id)).toEqual(["root", "reply"]);
  });
});
