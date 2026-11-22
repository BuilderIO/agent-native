import { ReviewCommentRevisionConflictError } from "@agent-native/core/review";
import { beforeEach, describe, expect, it, vi } from "vitest";

type KitComment = {
  id: string;
  resourceType: string;
  resourceId: string;
  authorEmail: string;
  body: string;
  mentions: Array<{ label: string; email: string }>;
  updatedAt: string;
  revision: number;
};

const state = vi.hoisted(() => ({
  comments: [] as KitComment[],
  conflict: false,
}));
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockGetUserEmail = vi.hoisted(() =>
  vi.fn<() => string | null>(() => "author@example.com"),
);
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockIsOrgMember = vi.hoisted(() => vi.fn());
const kitUpdates = vi.hoisted(() => [] as unknown[]);
vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetUserEmail(),
  getRequestOrgId: () => null,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/org", () => ({
  isOrgMember: (...args: unknown[]) => mockIsOrgMember(...args),
}));

vi.mock("../server/lib/recordings.js", () => ({
  sameOwnerEmail: (
    left: string | null | undefined,
    right: string | null | undefined,
  ) =>
    !!left &&
    !!right &&
    left.trim().toLowerCase() === right.trim().toLowerCase(),
}));

vi.mock("../server/lib/recording-comments.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/recording-comments.js")
  >()),
  findRecordingComment: async (id: string) =>
    state.comments.find((comment) => comment.id === id) ?? null,
}));

vi.mock("@agent-native/core/review/actions/update-review-comment", () => ({
  default: {
    run: async (args: {
      commentId: string;
      body: string;
      mentions: KitComment["mentions"];
      expectedRevision?: number;
    }) => {
      kitUpdates.push(args);
      const comment = state.comments.find(({ id }) => id === args.commentId);
      if (!comment) throw new Error(`Comment not found: ${args.commentId}`);
      if (state.conflict) {
        throw new ReviewCommentRevisionConflictError(
          comment.id,
          comment.revision + 1,
        );
      }
      Object.assign(comment, {
        body: args.body,
        mentions: args.mentions,
        updatedAt: new Date().toISOString(),
        revision: comment.revision + 1,
      });
      return { ...comment };
    },
  },
}));

import action from "./update-comment";

async function run(args: { id: string; content: string }) {
  return action.run(action.schema.parse(args));
}

beforeEach(() => {
  vi.resetAllMocks();
  kitUpdates.length = 0;
  mockAssertAccess.mockResolvedValue({
    role: "viewer",
    resource: { enableComments: true, organizationId: "org-1" },
  });
  state.conflict = false;
  state.comments = [
    {
      id: "comment-1",
      resourceType: "recording",
      resourceId: "recording-1",
      authorEmail: "author@example.com",
      body: "Original text",
      mentions: [],
      updatedAt: "2026-07-29T00:00:00.000Z",
      revision: 3,
    },
  ];
  mockGetUserEmail.mockReturnValue("author@example.com");
  mockIsOrgMember.mockResolvedValue(true);
});

describe("update-comment", () => {
  it("requires a signed-in author", async () => {
    mockGetUserEmail.mockReturnValue(null);

    await expect(
      run({ id: "comment-1", content: "Updated text" }),
    ).rejects.toThrow("Sign in required to edit comments.");
    expect(mockAssertAccess).not.toHaveBeenCalled();
  });

  it("rejects a recording editor who is not the comment author", async () => {
    mockGetUserEmail.mockReturnValue("editor@example.com");

    await expect(
      run({ id: "comment-1", content: "Updated text" }),
    ).rejects.toThrow("Only the comment author can edit this comment.");
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "recording",
      "recording-1",
      "viewer",
    );
    expect(state.comments[0]?.body).toBe("Original text");
    expect(kitUpdates).toEqual([]);
  });

  it("updates an author's comment with normalized email matching", async () => {
    mockGetUserEmail.mockReturnValue(" Author@Example.com ");

    const result = await run({
      id: "comment-1",
      content: "  Updated text  ",
    });

    expect(result).toEqual({
      id: "comment-1",
      content: "Updated text",
      mentions: [],
      updatedAt: expect.any(String),
    });
    expect(state.comments[0]).toMatchObject({
      body: "Updated text",
      updatedAt: result.updatedAt,
    });
    expect(kitUpdates).toEqual([
      expect.objectContaining({
        resourceType: "recording",
        resourceId: "recording-1",
        commentId: "comment-1",
        expectedRevision: 3,
      }),
    ]);
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "recording",
      "recording-1",
      "viewer",
    );
    expect(mockWriteAppState).toHaveBeenCalledWith("refresh-signal", {
      ts: expect.any(Number),
    });
  });

  it("rejects blank comment text", () => {
    expect(() =>
      action.schema.parse({ id: "comment-1", content: "   " }),
    ).toThrow();
  });

  it("preserves an existing mention when the optional field is omitted", async () => {
    state.comments[0].body = "Original text @Member";
    state.comments[0].mentions = [
      { label: "Member", email: "member@example.com" },
    ];

    const result = await run({
      id: "comment-1",
      content: "Updated text @Member",
    });

    expect(state.comments[0].mentions).toEqual([
      { label: "Member", email: "member@example.com" },
    ]);
    expect(result.mentions).toEqual([{ name: "Member" }]);
  });

  it("fails loudly when the comment changed concurrently", async () => {
    state.conflict = true;

    await expect(
      run({ id: "comment-1", content: "Updated text" }),
    ).rejects.toThrow("changed before this edit could be saved");
    expect(state.comments[0]?.body).toBe("Original text");
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });
});
