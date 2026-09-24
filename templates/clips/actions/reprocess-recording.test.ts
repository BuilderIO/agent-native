import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnsureRecordingSeekable = vi.hoisted(() => vi.fn());
const mockGetCurrentOwnerEmail = vi.hoisted(() => vi.fn());
const mockDb = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((column: unknown) => column),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  isNotNull: vi.fn((column: unknown) => ({ column })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      status: "recordings.status",
      videoUrl: "recordings.videoUrl",
      createdAt: "recordings.createdAt",
    },
  },
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => mockGetCurrentOwnerEmail(),
  ownerEmailMatches: (column: unknown, email: string) => ({ column, email }),
}));

vi.mock("./lib/ensure-seekable-video.js", () => ({
  ensureRecordingSeekable: (...args: unknown[]) =>
    mockEnsureRecordingSeekable(...args),
}));

import reprocessRecording from "./reprocess-recording";

describe("reprocess-recording timeline normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mockEnsureRecordingSeekable.mockImplementation(
      async ({ recordingId }: { recordingId: string }) => ({
        recordingId,
        status: "optimized",
        changed: true,
      }),
    );
  });

  it("forwards explicit normalization across de-duplicated ids", async () => {
    const args = reprocessRecording.schema.parse({
      id: "first",
      ids: '["first","second"]',
      normalizeTimeline: "true",
      force: "false",
    });
    const result = await reprocessRecording.run(args);

    expect(mockEnsureRecordingSeekable).toHaveBeenNthCalledWith(1, {
      recordingId: "first",
      ownerEmail: "owner@example.com",
      force: false,
      normalizeTimeline: true,
    });
    expect(mockEnsureRecordingSeekable).toHaveBeenNthCalledWith(2, {
      recordingId: "second",
      ownerEmail: "owner@example.com",
      force: false,
      normalizeTimeline: true,
    });
    expect(result).toEqual(
      expect.objectContaining({ processed: 2, changed: 2 }),
    );
  });
});
