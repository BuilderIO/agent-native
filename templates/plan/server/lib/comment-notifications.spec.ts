import { beforeEach, describe, expect, it, vi } from "vitest";

import { SOURCE_AUTHOR_COMMENT_MENTION_EMAIL } from "../../shared/comment-context.js";
import type { PlanBundle, PlanComment } from "../../shared/types.js";

const sendEmailMock = vi.hoisted(() => vi.fn());
const renderEmailMock = vi.hoisted(() =>
  vi.fn((_args: unknown) => ({ html: "<p>Email</p>", text: "Email" })),
);
const isEmailConfiguredMock = vi.hoisted(() => vi.fn(() => true));
const selectPlanMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("@agent-native/core/server", () => ({
  emailStrong: (value: string) => `<strong>${value}</strong>`,
  getAppProductionUrl: () => "https://plans.example.test",
  isEmailConfigured: () => isEmailConfiguredMock(),
  renderEmail: (args: unknown) => renderEmailMock(args),
  sendEmail: (args: unknown) => sendEmailMock(args),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => getDbMock(),
  schema: {
    plans: {
      id: "plans.id",
      title: "plans.title",
      ownerEmail: "plans.owner_email",
      sourceAuthorEmail: "plans.source_author_email",
    },
  },
}));

const { planCommentNotificationRecipients } =
  await import("./comment-notifications.js");
const { notifyPlanCommentRecipients } =
  await import("./comment-notifications.js");

function dbMock() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: selectPlanMock,
      })),
    })),
  };
}

function comment(
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

function bundle(comments: PlanComment[]): PlanBundle {
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
      openCommentCount: comments.filter((comment) => comment.status === "open")
        .length,
    },
  };
}

describe("plan comment notification recipients", () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getDbMock.mockReturnValue(dbMock());
    isEmailConfiguredMock.mockReset();
    isEmailConfiguredMock.mockReturnValue(true);
    renderEmailMock.mockClear();
    selectPlanMock.mockReset();
    sendEmailMock.mockReset();
  });

  it("notifies the plan owner for a new root comment", () => {
    const newComment = comment("reviewer", {
      authorEmail: "reviewer@example.com",
    });

    expect(
      planCommentNotificationRecipients({
        comment: newComment,
        comments: [newComment],
        planOwnerEmail: "owner@example.com",
      }),
    ).toEqual([{ email: "owner@example.com", reason: "plan-owner" }]);
  });

  it("does not notify the commenter about their own plan comment", () => {
    const newComment = comment("owner", {
      authorEmail: "owner@example.com",
    });

    expect(
      planCommentNotificationRecipients({
        comment: newComment,
        comments: [newComment],
        planOwnerEmail: "owner@example.com",
      }),
    ).toEqual([]);
  });

  it("notifies people explicitly mentioned in a comment", () => {
    const newComment = comment("reviewer", {
      authorEmail: "reviewer@example.com",
      message: "Please check @[Tiana](mailto:tiana%40example.com).",
    });

    expect(
      planCommentNotificationRecipients({
        comment: newComment,
        comments: [newComment],
        planOwnerEmail: "owner@example.com",
      }),
    ).toEqual([
      { email: "owner@example.com", reason: "plan-owner" },
      { email: "tiana@example.com", reason: "mention" },
    ]);
  });

  it("routes source-author placeholder mentions to the private source author email", () => {
    const newComment = comment("reviewer", {
      authorEmail: "reviewer@example.com",
      message: `Please check @[Sami](mailto:${encodeURIComponent(
        SOURCE_AUTHOR_COMMENT_MENTION_EMAIL,
      )}).`,
    });

    expect(
      planCommentNotificationRecipients({
        comment: newComment,
        comments: [newComment],
        planOwnerEmail: "svc-pr-recap@builder.io",
        sourceAuthorEmail: "sami@builder.io",
      }),
    ).toEqual([{ email: "sami@builder.io", reason: "mention" }]);
  });

  it("notifies prior human thread participants for replies", () => {
    const root = comment("root", { authorEmail: "root@example.com" });
    const participant = comment("participant", {
      authorEmail: "participant@example.com",
      parentCommentId: root.id,
    });
    const reply = comment("reply", {
      authorEmail: "reply@example.com",
      parentCommentId: root.id,
    });

    expect(
      planCommentNotificationRecipients({
        comment: reply,
        comments: [root, participant, reply],
        planOwnerEmail: "owner@example.com",
      }),
    ).toEqual([
      { email: "owner@example.com", reason: "plan-owner" },
      { email: "root@example.com", reason: "thread-participant" },
      { email: "participant@example.com", reason: "thread-participant" },
    ]);
  });

  it("suppresses synthetic QA and non-human recipients", () => {
    const root = comment("root", {
      authorEmail: "root+qa@example.test",
    });
    const agent = comment("agent", {
      createdBy: "agent",
      authorEmail: "agent@example.com",
      parentCommentId: root.id,
    });
    const reply = comment("reply", {
      authorEmail: "reply@example.com",
      parentCommentId: root.id,
    });

    expect(
      planCommentNotificationRecipients({
        comment: reply,
        comments: [root, agent, reply],
        planOwnerEmail: "owner+qa@example.test",
      }),
    ).toEqual([]);
  });

  it("sends the shared transactional email for inserted plan comments", async () => {
    const newComment = comment("reviewer", {
      authorEmail: "reviewer@example.com",
      authorName: "Reviewer",
      message: `This <needs> "escaping" & a look.`,
    });
    selectPlanMock.mockResolvedValue([
      {
        id: "plan_1",
        title: "Launch Plan",
        ownerEmail: "owner@example.com",
        sourceAuthorEmail: null,
      },
    ]);

    await notifyPlanCommentRecipients({
      bundle: bundle([newComment]),
      insertedCommentIds: [newComment.id],
    });

    expect(renderEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        heading: "New comment on your plan",
        cta: {
          label: "Open plan",
          url: "https://plans.example.test/plans/plan_1",
        },
      }),
    );
    const emailArgs = renderEmailMock.mock.calls[0]?.[0] as {
      paragraphs: string[];
    };
    expect(emailArgs.paragraphs[1]).toContain(
      "This &lt;needs&gt; &quot;escaping&quot; &amp; a look.",
    );
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: "owner@example.com",
      subject: `Reviewer commented on "Launch Plan"`,
      html: "<p>Email</p>",
      text: "Email",
    });
  });

  it("does not notify later batch commenters for earlier replies", async () => {
    const root = comment("root", {
      authorEmail: "root@example.com",
      authorName: "Root",
    });
    const firstReply = comment("first-reply", {
      authorEmail: "first@example.com",
      authorName: "First",
      parentCommentId: root.id,
    });
    const secondReply = comment("second-reply", {
      authorEmail: "second@example.com",
      authorName: "Second",
      parentCommentId: root.id,
    });
    selectPlanMock.mockResolvedValue([
      {
        id: "plan_1",
        title: "Launch Plan",
        ownerEmail: "owner@example.com",
        sourceAuthorEmail: null,
      },
    ]);

    await notifyPlanCommentRecipients({
      bundle: bundle([root, firstReply, secondReply]),
      insertedCommentIds: [firstReply.id, secondReply.id],
      priorComments: [root],
    });

    expect(sendEmailMock.mock.calls.map(([args]) => args.to)).toEqual([
      "owner@example.com",
      "root@example.com",
      "owner@example.com",
      "root@example.com",
      "first@example.com",
    ]);
  });

  it("does nothing when transactional email is not configured", async () => {
    isEmailConfiguredMock.mockReturnValue(false);

    await notifyPlanCommentRecipients({
      bundle: bundle([comment("reviewer")]),
      insertedCommentIds: ["reviewer"],
    });

    expect(getDbMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
