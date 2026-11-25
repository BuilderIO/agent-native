import { createHash } from "node:crypto";

import { signShortLivedToken } from "@agent-native/core/server/short-lived-token";
import { ForbiddenError } from "@agent-native/core/sharing";
import { beforeEach, describe, expect, it, vi } from "vitest";

type KitComment = {
  id: string;
  resourceId: string;
  threadId: string;
  parentCommentId: string | null;
  authorEmail: string;
};

const state = vi.hoisted(() => ({ comments: [] as KitComment[] }));
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockGetUserEmail = vi.hoisted(() =>
  vi.fn<() => string | null>(() => "author@example.com"),
);
const mockWriteAppState = vi.hoisted(() => vi.fn());
const kitDeletes = vi.hoisted(() => [] as unknown[][]);
vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetUserEmail(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("../server/lib/recording-comments.js", () => ({
  RECORDING_REVIEW_RESOURCE: "recording",
  findRecordingComment: async (id: string) =>
    state.comments.find((comment) => comment.id === id) ?? null,
  recordingKitComments: async (resourceId: string, threadId?: string) =>
    state.comments.filter(
      (comment) =>
        comment.resourceId === resourceId &&
        (!threadId || comment.threadId === threadId),
    ),
  commentDeleteContext: (ctx?: { userEmail?: string }) => ({
    ...ctx,
    userEmail: ctx?.userEmail ?? mockGetUserEmail() ?? undefined,
  }),
}));

vi.mock("@agent-native/core/review/actions/delete-review-comment", () => ({
  default: {
    run: async (
      args: { resourceId: string; commentId: string },
      ctx: { userEmail?: string },
    ) => {
      kitDeletes.push([args, ctx.userEmail]);
      const target = state.comments.find(
        (comment) => comment.id === args.commentId,
      );
      if (!target) throw new Error(`Comment not found: ${args.commentId}`);
      state.comments = state.comments.filter((comment) =>
        target.parentCommentId
          ? comment.id !== target.id
          : comment.resourceId !== target.resourceId ||
            comment.threadId !== target.threadId,
      );
      return { id: target.id, status: "deleted" };
    },
  },
}));

import action from "./delete-comment";

function deletedThrough(commentId: string, email: string) {
  return [
    [
      { resourceType: "recording", resourceId: "recording-1", commentId },
      email,
    ],
  ];
}

beforeEach(() => {
  vi.resetAllMocks();
  kitDeletes.length = 0;
  mockAssertAccess.mockResolvedValue({ role: "viewer", resource: {} });
  mockGetUserEmail.mockReturnValue("author@example.com");
  state.comments = [
    {
      id: "comment-1",
      resourceId: "recording-1",
      threadId: "comment-1",
      parentCommentId: null,
      authorEmail: "author@example.com",
    },
    {
      id: "comment-1-reply",
      resourceId: "recording-1",
      threadId: "comment-1",
      parentCommentId: "comment-1",
      authorEmail: "reply@example.com",
    },
    {
      id: "comment-1-reply-2",
      resourceId: "recording-1",
      threadId: "comment-1",
      parentCommentId: "comment-1-reply",
      authorEmail: "reply-2@example.com",
    },
    {
      id: "comment-2",
      resourceId: "recording-1",
      threadId: "comment-2",
      parentCommentId: null,
      authorEmail: "other@example.com",
    },
    {
      id: "comment-1-cross-record-reply",
      resourceId: "recording-2",
      threadId: "comment-1",
      parentCommentId: "comment-1",
      authorEmail: "other@example.com",
    },
  ];
});

describe("delete-comment", () => {
  it.each([
    { role: "viewer", email: "author@example.com", enableComments: true },
    { role: "viewer", email: "author@example.com", enableComments: false },
    { role: "editor", email: "editor@example.com", enableComments: true },
    { role: "editor", email: "editor@example.com", enableComments: false },
  ])(
    "refuses a password-protected deletion by $role without proof with enableComments=$enableComments",
    async ({ role, email, enableComments }) => {
      mockGetUserEmail.mockReturnValue(email);
      mockAssertAccess.mockResolvedValue({
        role,
        resource: {
          enableComments,
          password: "fake-password",
          sharePasswordVersion: "initial",
        },
      });
      const original = [...state.comments];
      await expect(action.run({ id: "comment-1" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect(state.comments).toEqual(original);
      expect(mockWriteAppState).not.toHaveBeenCalled();
      expect(kitDeletes).toEqual([]);
    },
  );

  it.each([true, false])(
    "lets the owner delete on a password-protected recording without proof with enableComments=%s",
    async (enableComments) => {
      mockGetUserEmail.mockReturnValue("owner@example.com");
      mockAssertAccess.mockResolvedValue({
        role: "owner",
        resource: {
          enableComments,
          password: "fake-password",
          sharePasswordVersion: "initial",
        },
      });
      const result = await action.run(action.schema.parse({ id: "comment-1" }));
      expect(result.deletedCommentIds).toEqual([
        "comment-1",
        "comment-1-reply",
        "comment-1-reply-2",
      ]);
      expect(kitDeletes).toEqual(
        deletedThrough("comment-1", "owner@example.com"),
      );
    },
  );

  it.each([
    { role: "viewer", email: "author@example.com" },
    { role: "editor", email: "editor@example.com" },
  ])(
    "refuses deletion from Trash for a nonowner: %j",
    async ({ role, email }) => {
      mockGetUserEmail.mockReturnValue(email);
      mockAssertAccess.mockResolvedValue({
        role,
        resource: { enableComments: true, trashedAt: "2026-01-01T00:00:00Z" },
      });
      const original = [...state.comments];
      await expect(
        action.run(action.schema.parse({ id: "comment-1" })),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(state.comments).toEqual(original);
      expect(mockWriteAppState).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "preserves owner cleanup in Trash with enableComments=%s",
    async (enableComments) => {
      mockGetUserEmail.mockReturnValue("owner@example.com");
      mockAssertAccess.mockResolvedValue({
        role: "owner",
        resource: { enableComments, trashedAt: "2026-01-01T00:00:00Z" },
      });
      const result = await action.run(action.schema.parse({ id: "comment-1" }));
      expect(result.deletedCommentIds).toEqual([
        "comment-1",
        "comment-1-reply",
        "comment-1-reply-2",
      ]);
    },
  );

  it("lets an author delete whatever case their email was stored in", async () => {
    state.comments = state.comments.map((comment) =>
      comment.id === "comment-1"
        ? { ...comment, authorEmail: "Author@Example.com" }
        : comment,
    );
    mockAssertAccess.mockImplementation(async (_type, _id, role) => {
      if (role === "editor") throw new ForbiddenError();
      return { role: "viewer", resource: { trashedAt: null } };
    });

    const result = await action.run(action.schema.parse({ id: "comment-1" }));

    expect(result.deletedCommentIds).toEqual([
      "comment-1",
      "comment-1-reply",
      "comment-1-reply-2",
    ]);
  });

  it.each([true, false])(
    "deletes a comment and descendants with enableComments=%s",
    async (enableComments) => {
      mockAssertAccess.mockResolvedValue({
        role: "viewer",
        resource: { enableComments, trashedAt: null },
      });
      const result = await action.run(action.schema.parse({ id: "comment-1" }));

      expect(result).toEqual({
        id: "comment-1",
        deletedCommentIds: [
          "comment-1",
          "comment-1-reply",
          "comment-1-reply-2",
        ],
      });
      expect(state.comments.map((comment) => comment.id)).toEqual([
        "comment-2",
        "comment-1-cross-record-reply",
      ]);
      expect(kitDeletes).toEqual(
        deletedThrough("comment-1", "author@example.com"),
      );
      expect(mockWriteAppState).toHaveBeenCalledWith("refresh-signal", {
        ts: expect.any(Number),
      });
    },
  );

  it("deletes only the reply it is given", async () => {
    mockGetUserEmail.mockReturnValue("reply@example.com");
    mockAssertAccess.mockImplementation(async (_type, _id, role) => {
      if (role === "editor") throw new ForbiddenError();
      return { role: "viewer", resource: { enableComments: true } };
    });

    const result = await action.run({ id: "comment-1-reply" });

    expect(result.deletedCommentIds).toEqual(["comment-1-reply"]);
    expect(state.comments.map((comment) => comment.id)).toEqual([
      "comment-1",
      "comment-1-reply-2",
      "comment-2",
      "comment-1-cross-record-reply",
    ]);
  });

  it("refuses a reply the copy has not linked to its thread yet", async () => {
    state.comments.push({
      id: "unlinked-reply",
      resourceId: "recording-1",
      threadId: "comment-1",
      parentCommentId: null,
      authorEmail: "author@example.com",
    });
    const original = [...state.comments];

    await expect(action.run({ id: "unlinked-reply" })).rejects.toMatchObject({
      errorCode: "reply_not_linked",
      statusCode: 409,
    });
    expect(state.comments).toEqual(original);
    expect(kitDeletes).toEqual([]);
  });

  it("deletes a thread whose first comment is already gone through the reply that now leads it", async () => {
    state.comments = [
      {
        id: "left-first",
        resourceId: "recording-1",
        threadId: "deleted-root",
        parentCommentId: null,
        authorEmail: "author@example.com",
      },
      {
        id: "left-second",
        resourceId: "recording-1",
        threadId: "deleted-root",
        parentCommentId: "left-first",
        authorEmail: "author@example.com",
      },
    ];

    const result = await action.run({ id: "left-first" });

    expect(result.deletedCommentIds).toEqual(["left-first", "left-second"]);
    expect(kitDeletes).toEqual(
      deletedThrough("left-first", "author@example.com"),
    );
  });

  it("refuses the first of several unlinked replies whose thread's first comment is gone", async () => {
    state.comments = ["left-first", "left-second"].map((id) => ({
      id,
      resourceId: "recording-1",
      threadId: "deleted-root",
      parentCommentId: null,
      authorEmail: "author@example.com",
    }));

    await expect(action.run({ id: "left-first" })).rejects.toMatchObject({
      errorCode: "reply_not_linked",
      statusCode: 409,
    });
    expect(kitDeletes).toEqual([]);
  });

  it("recognizes the author regardless of email case", async () => {
    state.comments[0].authorEmail = "Author@Example.com";
    mockGetUserEmail.mockReturnValue("author@example.COM");
    mockAssertAccess.mockImplementation(async (_type, _id, role) => {
      if (role === "editor") throw new ForbiddenError();
      return { role: "viewer", resource: { enableComments: true } };
    });
    expect(await action.run({ id: "comment-1" })).toMatchObject({
      id: "comment-1",
    });
    expect(state.comments.map((comment) => comment.id)).not.toContain(
      "comment-1",
    );
  });

  it("still refuses deletion by an unrelated viewer", async () => {
    mockGetUserEmail.mockReturnValue("unrelated@example.com");
    mockAssertAccess.mockImplementation(async (_type, _id, role) => {
      if (role === "editor") throw new ForbiddenError();
      return { role: "viewer", resource: { enableComments: true } };
    });
    const original = [...state.comments];
    await expect(action.run({ id: "comment-1" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(state.comments).toEqual(original);
  });
});

it.each([true, false])(
  "deletes the unlocked author's comment with purpose-scoped proof with enableComments=%s",
  async (enableComments) => {
    const password = "fake-stored-password";
    mockAssertAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        enableComments,
        password,
        sharePasswordVersion: "initial",
      },
    });
    const scope = createHash("sha256")
      .update(JSON.stringify(["recording-1", password, "initial"]))
      .digest("hex");
    const token = signShortLivedToken({
      resourceId: `clips-comment:recording-1:${scope}`,
      ttlSeconds: 600,
    });
    await expect(
      action.run(
        { id: "comment-1" },
        { requestHeaders: new Headers({ "x-clips-comment-token": token }) },
      ),
    ).resolves.toMatchObject({
      deletedCommentIds: ["comment-1", "comment-1-reply", "comment-1-reply-2"],
    });
  },
);
