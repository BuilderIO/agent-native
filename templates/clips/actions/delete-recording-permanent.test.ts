import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExistingRecording = vi.hoisted(() => ({
  id: "rec_1",
  title: "Test recording",
  ownerEmail: "owner@example.com",
  videoUrl: "https://cdn.example.com/media/clips/rec_1.mp4",
  thumbnailUrl: "https://cdn.example.com/media/clips/rec_1.jpg",
  animatedThumbnailUrl: null as string | null,
}));

const mockDeleteStoredMediaUrl = vi.hoisted(() =>
  vi.fn(async (_url: string) => true),
);
const mockDeleteRecordingMediaObjects = vi.hoisted(() =>
  vi.fn(async () => ({
    attempted: 2,
    deleted: 2,
    skipped: 0,
    errors: [],
  })),
);
const mockRecordingMediaUrls = vi.hoisted(() =>
  vi.fn(
    (recording: {
      videoUrl?: string | null;
      thumbnailUrl?: string | null;
      animatedThumbnailUrl?: string | null;
    }) =>
      [
        recording.videoUrl,
        recording.thumbnailUrl,
        recording.animatedThumbnailUrl,
      ].filter((url): url is string => Boolean(url)),
  ),
);
const mockSelectWhere = vi.hoisted(() => vi.fn());
const mockDeleteWhere = vi.hoisted(() => vi.fn(async () => undefined));
const mockDbDelete = vi.hoisted(() =>
  vi.fn(() => ({ where: mockDeleteWhere })),
);
const mockUpdates = vi.hoisted(() => [] as Record<string, unknown>[]);
const mockClaimMatches = vi.hoisted(() => ({ value: true }));
const mockDbUpdate = vi.hoisted(() =>
  vi.fn(() => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        const write = async () => {
          mockUpdates.push(values);
          return mockClaimMatches.value ? [{ id: "rec_1" }] : [];
        };
        return {
          returning: write,
          then: (resolve: (rows: unknown) => void, reject: () => void) =>
            write().then(resolve, reject),
        };
      },
    }),
  })),
);
const mockDb = vi.hoisted(() => ({
  update: mockDbUpdate,
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: mockSelectWhere,
    })),
  })),
  delete: mockDbDelete,
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockDb),
  ),
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
  inArray: vi.fn((column: unknown, values: unknown[]) => ({ column, values })),
  ne: vi.fn((column: unknown, value: unknown) => ({
    column,
    value,
    not: true,
  })),
  or: vi.fn((...args: unknown[]) => args),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      videoUrl: "recordings.videoUrl",
      thumbnailUrl: "recordings.thumbnailUrl",
      animatedThumbnailUrl: "recordings.animatedThumbnailUrl",
    },
    recordingComments: { recordingId: "recordingComments.recordingId" },
    recordingReactions: { recordingId: "recordingReactions.recordingId" },
    recordingViews: { recordingId: "recordingViews.recordingId" },
    recordingPlaybackPositions: {
      recordingId: "recordingPlaybackPositions.recordingId",
    },
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
  deleteStoredMediaUrl: (url: string) => mockDeleteStoredMediaUrl(url),
  recordingMediaUrls: (...args: Parameters<typeof mockRecordingMediaUrls>) =>
    mockRecordingMediaUrls(...args),
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
    mockSelectWhere
      .mockResolvedValueOnce([mockExistingRecording])
      .mockResolvedValueOnce([]);
  });

  it("deletes provider media after permanently deleting recording rows", async () => {
    const result = await deleteRecordingPermanent.run({ id: "rec_1" });

    expect(mockDeleteRecordingMediaObjects).toHaveBeenCalledWith(
      mockExistingRecording,
      { protectedUrls: new Set() },
    );
    expect(mockDb.transaction).toHaveBeenCalled();
    expect(mockDbDelete.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteRecordingMediaObjects.mock.invocationCallOrder[0],
    );
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

  it("deletes granular view rows during permanent cleanup", async () => {
    await deleteRecordingPermanent.run({ id: "rec_1" });

    expect(mockDbDelete).toHaveBeenCalledWith({
      recordingId: "recordingViews.recordingId",
    });
  });

  it("skips provider deletion for media still referenced by another recording", async () => {
    mockSelectWhere
      .mockReset()
      .mockResolvedValueOnce([mockExistingRecording])
      .mockResolvedValueOnce([
        {
          videoUrl: null,
          thumbnailUrl: mockExistingRecording.thumbnailUrl,
          animatedThumbnailUrl: null,
        },
      ]);

    await deleteRecordingPermanent.run({ id: "rec_1" });

    const cleanupOptions = mockDeleteRecordingMediaObjects.mock
      .calls[0]?.[1] as { protectedUrls?: Set<string> } | undefined;
    expect([...(cleanupOptions?.protectedUrls ?? [])]).toEqual([
      mockExistingRecording.thumbnailUrl,
    ]);
  });

  it("does not delete provider media when the database delete fails", async () => {
    mockDeleteWhere.mockRejectedValueOnce(new Error("delete failed"));

    await expect(deleteRecordingPermanent.run({ id: "rec_1" })).rejects.toThrow(
      "delete failed",
    );

    expect(mockDeleteRecordingMediaObjects).not.toHaveBeenCalled();
  });

  describe("a screenshot with leftover files", () => {
    const shot = {
      ...mockExistingRecording,
      kind: "image",
      videoUrl: null,
      editsJson: JSON.stringify({
        unreclaimedUrls: ["https://cdn.example.com/media/clips/copy.png"],
      }),
    };

    /** The transaction's re-read: the row as the claim left it. */
    const claimedRow = async () => [
      {
        editsJson: mockUpdates[0]?.editsJson,
        mediaUpdatedAt: mockUpdates[0]?.mediaUpdatedAt,
      },
    ];

    beforeEach(async () => {
      mockUpdates.length = 0;
      mockClaimMatches.value = true;
      mockSelectWhere.mockReset();
      // The row, the references to its media, then the re-read in the
      // transaction.
      mockSelectWhere
        .mockResolvedValueOnce([shot])
        .mockResolvedValueOnce([])
        .mockImplementationOnce(claimedRow);
      // What the real list adds for a screenshot: its leftovers, and a
      // refusal when the edits cannot be read.
      const { screenshotLeftoverUrls } =
        await import("../server/lib/screenshot-edits");
      mockRecordingMediaUrls.mockImplementation(((recording: {
        thumbnailUrl?: string | null;
        editsJson?: string | null;
      }) => {
        const leftovers = screenshotLeftoverUrls(recording.editsJson);
        if (!leftovers) throw new Error("edits could not be read");
        return [recording.thumbnailUrl, ...leftovers].filter(Boolean);
      }) as never);
    });

    it("deletes the unredacted leftovers before the row", async () => {
      await deleteRecordingPermanent.run({ id: "rec_1" });
      expect(mockDeleteStoredMediaUrl).toHaveBeenCalledWith(
        "https://cdn.example.com/media/clips/copy.png",
      );
      // The redacted picture goes the ordinary, best-effort way.
      expect(mockDeleteStoredMediaUrl).not.toHaveBeenCalledWith(
        "https://cdn.example.com/media/clips/rec_1.jpg",
      );
      expect(mockDeleteStoredMediaUrl.mock.invocationCallOrder[0]).toBeLessThan(
        mockDbDelete.mock.invocationCallOrder[0],
      );
      // Claimed first, so no save can land between the deletes and the row.
      expect(mockDbUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        mockDeleteStoredMediaUrl.mock.invocationCallOrder[0],
      );
      expect(
        JSON.parse(String(mockUpdates[0].editsJson)).permanentDeleteClaim,
      ).toBeTruthy();
    });

    it("deletes nothing when a save changed the row before the claim", async () => {
      mockClaimMatches.value = false;
      await expect(
        deleteRecordingPermanent.run({ id: "rec_1" }),
      ).rejects.toThrow(/Nothing was deleted/);
      expect(mockDeleteStoredMediaUrl).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it("treats the base as unredacted while boxes are pending", async () => {
      mockSelectWhere.mockReset();
      mockSelectWhere
        .mockResolvedValueOnce([
          {
            ...shot,
            baseImageUrl: "https://cdn.example.com/media/clips/base.png",
            editsJson: JSON.stringify({
              overlays: [
                {
                  kind: "redact",
                  id: "r1",
                  startMs: 0,
                  endMs: 1,
                  keys: [{ atMs: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
                },
              ],
            }),
          },
        ])
        .mockResolvedValueOnce([]);
      mockDeleteStoredMediaUrl.mockResolvedValueOnce(false);
      await expect(
        deleteRecordingPermanent.run({ id: "rec_1" }),
      ).rejects.toThrow(/unredacted copy/);
      expect(mockDeleteStoredMediaUrl).toHaveBeenCalledWith(
        "https://cdn.example.com/media/clips/base.png",
      );
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it("keeps the row when something past the claim changed it", async () => {
      // A writer that does not honour the claim may have listed new
      // leftovers; deleting the row now would lose the only record of them.
      mockSelectWhere.mockReset();
      mockSelectWhere
        .mockResolvedValueOnce([shot])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ editsJson: "{}" }]);
      await expect(
        deleteRecordingPermanent.run({ id: "rec_1" }),
      ).rejects.toThrow(/changed while it was being deleted/);
      expect(mockDbDelete).not.toHaveBeenCalled();
    });

    it("keeps the row when one is still in storage", async () => {
      // The row is the only record of that unredacted copy; without it no
      // retry could ever find it.
      mockDeleteStoredMediaUrl.mockResolvedValueOnce(false);
      await expect(
        deleteRecordingPermanent.run({ id: "rec_1" }),
      ).rejects.toThrow(
        /unredacted copy of this screenshot could not be deleted/,
      );
      expect(mockDb.transaction).not.toHaveBeenCalled();
      // And gives the row back, unclaimed, for an edit or a retry.
      expect(mockUpdates.at(-1)).toEqual({ editsJson: shot.editsJson });
    });

    it("keeps a claim an earlier, part-way delete left", async () => {
      // That delete may already have removed the base under pending boxes;
      // releasing its claim would let the screenshot be restored or saved
      // over with its base gone.
      const leftClaimed = {
        ...shot,
        editsJson: JSON.stringify({
          ...JSON.parse(shot.editsJson),
          permanentDeleteClaim: { at: "2026-09-26T00:00:00Z" },
        }),
      };
      mockSelectWhere.mockReset();
      mockSelectWhere
        .mockResolvedValueOnce([leftClaimed])
        .mockResolvedValueOnce([]);
      mockDeleteStoredMediaUrl.mockResolvedValueOnce(false);
      await expect(
        deleteRecordingPermanent.run({ id: "rec_1" }),
      ).rejects.toThrow(/unredacted copy/);
      expect(mockUpdates.at(-1)).toEqual({ editsJson: leftClaimed.editsJson });
    });

    it("keeps the row when its edits cannot be read", async () => {
      mockSelectWhere.mockReset();
      mockSelectWhere
        .mockResolvedValueOnce([{ ...shot, editsJson: "{not json" }])
        .mockResolvedValueOnce([]);
      await expect(
        deleteRecordingPermanent.run({ id: "rec_1" }),
      ).rejects.toThrow(/could not be read/);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });
});
