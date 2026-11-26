import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockGetRequestUserEmail = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));
const mockCreate = vi.hoisted(() =>
  vi.fn(async (_args: unknown, _ctx: unknown) => ({
    id: "comment-1",
    threadId: "comment-1",
    parentCommentId: null,
    replayed: false,
    notified: null,
  })),
);
const mockReply = vi.hoisted(() => vi.fn());
const mockFindComment = vi.hoisted(() => vi.fn(async () => null));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetRequestUserEmail(),
  getRequestUserName: () => undefined,
  getRequestOrgId: () => null,
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("@agent-native/core/review/actions/create-review-comment", () => ({
  default: { run: mockCreate },
}));

vi.mock("@agent-native/core/review/actions/reply-review-comment", () => ({
  default: { run: mockReply },
}));

vi.mock("../server/lib/recording-comments.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/recording-comments.js")
  >()),
  findRecordingComment: mockFindComment,
}));

import addComment from "./add-comment";

describe("add-comment access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestUserEmail.mockReturnValue("viewer@example.com");
    mockAssertAccess.mockResolvedValue({
      role: "commenter",
      resource: { enableComments: true, organizationId: "org-1" },
    });
  });

  it("allows a signed-in commenter to start a comment thread", async () => {
    await expect(
      addComment.run({
        recordingId: "recording-1",
        content: "A note from a viewer",
        videoTimestampMs: 12_000,
      }),
    ).resolves.toMatchObject({ id: "comment-1", threadId: "comment-1" });

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "recording",
      "recording-1",
      "viewer",
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "recording",
        resourceId: "recording-1",
        body: "A note from a viewer",
        anchor: { videoTimestampMs: 12_000 },
        anchorKind: "video-time",
      }),
      expect.objectContaining({ userEmail: "viewer@example.com" }),
    );
  });

  it("stores the exact frame time it is given", async () => {
    await addComment.run({
      recordingId: "recording-1",
      content: "This frame",
      videoTimestampMs: 12_542,
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ anchor: { videoTimestampMs: 12_542 } }),
      expect.any(Object),
    );
  });

  it("rejects replies whose parent is outside the recording thread", async () => {
    await expect(
      addComment.run({
        recordingId: "recording-1",
        content: "A reply",
        videoTimestampMs: 12_000,
        threadId: "thread-1",
        parentId: "comment-from-another-recording",
      }),
    ).rejects.toThrow("Parent comment does not belong to this recording.");
    expect(mockFindComment).toHaveBeenCalledWith(
      "comment-from-another-recording",
    );
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
  });

  it("rejects empty reply IDs before looking up a parent", async () => {
    await expect(
      addComment.run({
        recordingId: "recording-1",
        content: "An orphan reply",
        videoTimestampMs: 12_000,
        threadId: "thread-1",
        parentId: "",
      }),
    ).rejects.toThrow("Invalid action parameters");
    expect(mockAssertAccess).not.toHaveBeenCalled();
    expect(mockFindComment).not.toHaveBeenCalled();
  });
});
