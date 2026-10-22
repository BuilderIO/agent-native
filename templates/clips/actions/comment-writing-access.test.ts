import { ForbiddenError } from "@agent-native/core/sharing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  comment: {
    id: "comment-1",
    recordingId: "recording-1",
    organizationId: "org-1",
    threadId: "thread-1",
    parentId: null,
    authorEmail: "author@example.com",
    content: "Original text",
    videoTimestampMs: 12542,
    mentionsJson: null,
    emojiReactionsJson: "{}",
    resolved: false,
  },
  inserted: [] as Record<string, unknown>[],
}));
const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockNotify = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<null>>(async () => null),
);
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "author@example.com",
  getRequestUserName: () => "Author",
}));
vi.mock("../server/lib/activity-notifications.js", () => ({
  notifyRecordingComment: (...args: unknown[]) => mockNotify(...args),
  notifyRecordingReaction: (...args: unknown[]) => mockNotify(...args),
}));
vi.mock("../server/lib/comment-mentions.js", () => ({
  resolveCommentMentions: async () => [],
}));
vi.mock("../server/lib/recordings.js", () => ({
  nanoid: () => "new-comment",
  sameOwnerEmail: (left: string, right: string) => left === right,
}));
vi.mock("../server/db/index.js", () => {
  const recordings = {
    id: "recording.id",
    organizationId: "recording.organizationId",
  };
  const recordingComments = {
    id: "comment.id",
    recordingId: "comment.recordingId",
    organizationId: "comment.organizationId",
    threadId: "comment.threadId",
    content: "comment.content",
    emojiReactionsJson: "comment.emojiReactionsJson",
  };
  return {
    schema: { recordings, recordingComments },
    getDb: () => ({
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () =>
              table === recordings
                ? [{ organizationId: "org-1" }]
                : [{ ...state.comment }],
          }),
        }),
      }),
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          state.inserted.push(row);
        },
      }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => {
            mockUpdate(patch);
            Object.assign(state.comment, patch);
            return { returning: async () => [{ id: state.comment.id }] };
          },
        }),
      }),
    }),
  };
});

import addComment from "./add-comment";
import reactToComment from "./react-to-comment";
import replyToComment from "./reply-to-comment";
import resolveComment from "./resolve-comment";
import updateComment from "./update-comment";

const writers = [
  {
    name: "new comment",
    run: () =>
      addComment.run({
        recordingId: "recording-1",
        content: "New text",
        videoTimestampMs: 0,
      }),
  },
  {
    name: "reply through add-comment",
    run: () =>
      addComment.run({
        recordingId: "recording-1",
        content: "Reply text",
        videoTimestampMs: 12542,
        parentId: "comment-1",
        threadId: "thread-1",
      }),
  },
  {
    name: "reply-to-comment",
    run: () =>
      replyToComment.run({ commentId: "comment-1", content: "Reply text" }),
  },
  {
    name: "edit",
    run: () => updateComment.run({ id: "comment-1", content: "Updated text" }),
  },
  {
    name: "reaction",
    run: () => reactToComment.run({ commentId: "comment-1", emoji: "👍" }),
  },
  {
    name: "resolve",
    run: () => resolveComment.run({ id: "comment-1", resolved: true }),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.inserted = [];
  Object.assign(state.comment, {
    content: "Original text",
    emojiReactionsJson: "{}",
    resolved: false,
  });
  mockAssertAccess.mockResolvedValue({
    role: "viewer",
    resource: { enableComments: true },
  });
});

describe.each(writers)("$name comment writing access", ({ run }) => {
  it.each(["viewer", "owner"])(
    "refuses disabled comments for a %s before side effects",
    async (role) => {
      mockAssertAccess.mockResolvedValue({
        role,
        resource: { enableComments: false },
      });
      await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
      expect(state.inserted).toEqual([]);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockNotify).not.toHaveBeenCalled();
      expect(mockWriteAppState).not.toHaveBeenCalled();
    },
  );

  it("still allows writing when comments are enabled", async () => {
    await expect(run()).resolves.toBeDefined();
    expect(mockWriteAppState).toHaveBeenCalled();
    expect(state.inserted.length + mockUpdate.mock.calls.length).toBe(1);
  });

  it("refuses an expired recording for a viewer", async () => {
    mockAssertAccess.mockResolvedValue({
      role: "viewer",
      resource: { enableComments: true, expiresAt: "2000-01-01T00:00:00.000Z" },
    });
    await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
    expect(state.inserted).toEqual([]);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("preserves the owner's expiry exemption when comments are enabled", async () => {
    mockAssertAccess.mockResolvedValue({
      role: "owner",
      resource: { enableComments: true, expiresAt: "2000-01-01T00:00:00.000Z" },
    });
    await expect(run()).resolves.toBeDefined();
  });

  it("preserves recording access denial", async () => {
    mockAssertAccess.mockRejectedValue(new ForbiddenError());
    await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
    expect(state.inserted).toEqual([]);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

it("replies retain the parent thread, organization, frame, and return contract", async () => {
  const result = await replyToComment.run({
    commentId: "comment-1",
    content: "Reply text",
  });
  expect(result).toMatchObject({
    id: "new-comment",
    threadId: "thread-1",
    parentId: "comment-1",
    notified: null,
  });
  expect(state.inserted).toEqual([
    expect.objectContaining({
      recordingId: "recording-1",
      organizationId: "org-1",
      threadId: "thread-1",
      parentId: "comment-1",
      content: "Reply text",
      videoTimestampMs: 12542,
      authorEmail: "author@example.com",
    }),
  ]);
});
