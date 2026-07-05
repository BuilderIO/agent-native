import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExistingRecording = vi.hoisted(() => ({
  id: "rec_1",
  title: "Test recording",
  ownerEmail: "owner@example.com",
  videoUrl: "https://cdn.example.com/media/clips/rec_1.mp4",
  thumbnailUrl: "https://cdn.example.com/media/clips/rec_1.jpg",
  animatedThumbnailUrl: null as string | null,
}));

const mockDeleteRecordingMediaObjects = vi.hoisted(() =>
  vi.fn(async () => ({
    attempted: 2,
    deleted: 2,
    skipped: 0,
    errors: [],
  })),
);
const mockDeleteWhere = vi.hoisted(() => vi.fn(async () => undefined));
const mockDbDelete = vi.hoisted(() =>
  vi.fn(() => ({ where: mockDeleteWhere })),
);
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => [mockExistingRecording]),
    })),
  })),
  delete: mockDbDelete,
}));
const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));
const mockDeleteAppState = vi.hoisted(() => vi.fn(async () => undefined));
const mockDeleteAppStateByPrefix = vi.hoisted(() =>
  vi.fn(async () => undefined),
);

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
  deleteAppState: (...args: unknown[]) => mockDeleteAppState(...args),
  deleteAppStateByPrefix: (...args: unknown[]) =>
    mockDeleteAppStateByPrefix(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
    },
    recordingComments: { recordingId: "recordingComments.recordingId" },
    recordingReactions: { recordingId: "recordingReactions.recordingId" },
    recordingViewers: { recordingId: "recordingViewers.recordingId" },
    recordingEvents: { recordingId: "recordingEvents.recordingId" },
    recordingTranscripts: {
      recordingId: "recordingTranscripts.recordingId",
    },
    recordingBrowserDiagnostics: {
      recordingId: "recordingBrowserDiagnostics.recordingId",
    },
    recordingBugReports: { recordingId: "recordingBugReports.recordingId" },
    recordingTags: { recordingId: "recordingTags.recordingId" },
    recordingCtas: { recordingId: "recordingCtas.recordingId" },
    recordingShares: { resourceId: "recordingShares.resourceId" },
  },
}));

vi.mock("../server/lib/recording-media-cleanup.js", () => ({
  deleteRecordingMediaObjects: (...args: unknown[]) =>
    mockDeleteRecordingMediaObjects(...args),
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: vi.fn(() => "owner@example.com"),
  ownerEmailMatches: (column: unknown, email: string) => ({
    column,
    email,
    kind: "ownerEmailMatches",
  }),
}));

import deleteRecordingPermanent from "./delete-recording-permanent";

describe("delete-recording-permanent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes provider media before permanently deleting recording rows", async () => {
    const result = await deleteRecordingPermanent.run({ id: "rec_1" });

    expect(mockDeleteRecordingMediaObjects).toHaveBeenCalledWith(
      mockExistingRecording,
    );
    expect(
      mockDeleteRecordingMediaObjects.mock.invocationCallOrder[0],
    ).toBeLessThan(mockDbDelete.mock.invocationCallOrder[0]);
    expect(mockDeleteAppStateByPrefix).toHaveBeenCalledWith(
      "recording-chunks-rec_1-",
    );
    expect(result).toEqual({
      success: true,
      id: "rec_1",
      mediaCleanup: {
        attempted: 2,
        deleted: 2,
        skipped: 0,
        errors: [],
      },
    });
  });
});
