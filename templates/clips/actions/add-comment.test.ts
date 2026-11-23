import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockGetRequestUserEmail = vi.hoisted(() => vi.fn());
const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));
const mockInsertValues = vi.hoisted(() => vi.fn(async () => undefined));
const mockMirror = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}));
const mockDb = vi.hoisted(() => {
  const db = {
    select: vi.fn(),
    insert: vi.fn(() => ({ values: mockInsertValues })),
    transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(db)),
  };
  return db;
});

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetRequestUserEmail(),
  getRequestUserName: () => undefined,
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  sql: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: { id: "recordings.id", organizationId: "recordings.org" },
    recordingComments: {},
  },
}));

vi.mock("../server/lib/recordings.js", () => ({
  nanoid: () => "comment-1",
}));

vi.mock("../server/lib/recording-comment-mirror.js", () => ({
  prepareRecordingCommentMirror: async () => {},
  mirrorRecordingComments: mockMirror,
}));

import addComment from "./add-comment";

describe("add-comment access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestUserEmail.mockReturnValue("viewer@example.com");
    mockAssertAccess.mockResolvedValue({
      role: "commenter",
      resource: { enableComments: true },
    });
    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [{ organizationId: "org-1" }]),
          for: vi.fn(async () => [{ id: "recording-1" }]),
        })),
      })),
    });
  });

  it("allows a signed-in commenter to start a comment thread", async () => {
    await addComment.run({
      recordingId: "recording-1",
      content: "A note from a viewer",
      videoTimestampMs: 12_000,
    });

    expect(mockAssertAccess).toHaveBeenCalledWith(
      "recording",
      "recording-1",
      "viewer",
    );
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "recording-1",
        authorEmail: "viewer@example.com",
        content: "A note from a viewer",
        videoTimestampMs: 12_000,
      }),
    );
    expect(mockMirror).toHaveBeenCalledWith(mockDb, "recording-1", [
      "comment-1",
    ]);
    expect(mockMirror.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockInsertValues.mock.invocationCallOrder[0],
    );
  });

  it("stores the exact frame time it is given", async () => {
    await addComment.run({
      recordingId: "recording-1",
      content: "This frame",
      videoTimestampMs: 12_542,
    });

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ videoTimestampMs: 12_542 }),
    );
  });

  it("rejects replies whose parent is outside the recording thread", async () => {
    const recordingLookup = {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [{ organizationId: "org-1" }]),
        })),
      })),
    };
    const recordingLock = {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          for: vi.fn(async () => [{ id: "recording-1" }]),
        })),
      })),
    };
    const parentLookup = {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    };
    mockDb.select
      .mockReturnValueOnce(recordingLookup)
      .mockReturnValueOnce(recordingLock)
      .mockReturnValueOnce(parentLookup);

    await expect(
      addComment.run({
        recordingId: "recording-1",
        content: "A reply",
        videoTimestampMs: 12_000,
        threadId: "thread-1",
        parentId: "comment-from-another-recording",
      }),
    ).rejects.toThrow("Parent comment does not belong to this recording.");
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockMirror).not.toHaveBeenCalled();
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
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
