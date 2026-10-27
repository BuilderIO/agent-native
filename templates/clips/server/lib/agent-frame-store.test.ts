import { RECORDING_THUMBNAIL_AT_MS as OPENING_MS } from "@shared/agent-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRows = vi.hoisted(() => ({ value: [] as Array<unknown> }));
const mockDeleted = vi.hoisted(() => [] as unknown[]);
const mockLockedRecording = vi.hoisted(() => ({
  value: [] as Array<unknown>,
}));
const mockInserted = vi.hoisted(() => [] as unknown[]);
const mockCurrentRecording = vi.hoisted(() => ({
  value: [] as Array<unknown>,
}));
const mockTables = vi.hoisted(() => ({
  recordings: {
    id: "id",
    ownerEmail: "ownerEmail",
    videoUrl: "videoUrl",
    editsJson: "editsJson",
  },
  recordingAgentFrames: {
    id: "id",
    recordingId: "recordingId",
    atMs: "atMs",
    storageUrl: "storageUrl",
  },
}));
const mockFetchMedia = vi.hoisted(() => vi.fn());
const mockDeleteStoredMediaUrl = vi.hoisted(() => vi.fn());
const mockDeleteUploadedFile = vi.hoisted(() => vi.fn());
const mockTxFrameRows = vi.hoisted(() => ({ value: [] as Array<unknown> }));
const mockUploadRecordingMedia = vi.hoisted(() => vi.fn());

const mockRunWithRequestContext = vi.hoisted(() =>
  vi.fn((_context: unknown, callback: () => unknown) => callback()),
);

vi.mock("@agent-native/core/file-upload", () => ({
  deleteUploadedFile: (...args: unknown[]) => mockDeleteUploadedFile(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (context: unknown, callback: () => unknown) =>
    mockRunWithRequestContext(context, callback),
}));

vi.mock("./recordings.js", () => ({
  ownerEmailMatches: (column: unknown, email: string) => ({ column, email }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("../db/index.js", () => {
  const select = () => ({
    from: (table: unknown) => ({
      where: () => {
        const rows =
          table === mockTables.recordings
            ? mockCurrentRecording.value
            : mockRows.value;
        const result = Promise.resolve(rows) as Promise<unknown[]> & {
          limit: () => Promise<unknown[]>;
        };
        result.limit = () => Promise.resolve(rows);
        return result;
      },
    }),
  });
  const tx = {
    select: () => ({
      from: () => ({
        where: () =>
          Object.assign(Promise.resolve(mockTxFrameRows.value), {
            for: () => Promise.resolve(mockLockedRecording.value),
          }),
      }),
    }),
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: () => {
          mockInserted.push(values);
          return Promise.resolve();
        },
      }),
    }),
  };
  return {
    getDb: () => ({
      select,
      transaction: (callback: (tx: unknown) => unknown) => callback(tx),
      delete: () => ({
        where: (condition: unknown) => {
          mockDeleted.push(condition);
          return Promise.resolve();
        },
      }),
    }),
    schema: mockTables,
  };
});

vi.mock("./public-agent-context.js", () => ({
  fetchRecordingMediaResponse: (...args: unknown[]) => mockFetchMedia(...args),
  loadAgentTranscript: async () => ({ agentSegments: [] }),
  parseAgentChapters: () => [],
}));
vi.mock("./recording-media-cleanup.js", () => ({
  deleteStoredMediaUrl: (...args: unknown[]) =>
    mockDeleteStoredMediaUrl(...args),
}));
vi.mock("./upload-recording-media.js", () => ({
  uploadRecordingMedia: (...args: unknown[]) =>
    mockUploadRecordingMedia(...args),
}));

import {
  agentFrameMediaKey,
  deleteStoredAgentFrames,
  loadStoredAgentFrame,
  recommendedAgentFrameTimes,
} from "./agent-frame-store.js";

type TestClip = Parameters<typeof loadStoredAgentFrame>[0];

/** Releases a claim a test took only to see that one was offered. */
function releaseIfClaim(
  lookup: Awaited<ReturnType<typeof loadStoredAgentFrame>>,
) {
  if ("claim" in lookup) lookup.claim?.release();
}

/** Claims the clip's fill the way the route does, then runs it. */
async function fillRecommendedAgentFrames(
  clip: TestClip,
  extract: (atMs: number) => Promise<Uint8Array>,
  known?: { atMs: number; frame: Uint8Array },
): Promise<void> {
  const lookup = await loadStoredAgentFrame(clip, known?.atMs ?? OPENING_MS);
  if (!("claim" in lookup) || !lookup.claim) {
    throw new Error("expected a claim");
  }
  await lookup.claim.fill(extract, known);
}

const recording = {
  id: "rec-1",
  ownerEmail: "owner@example.com",
  storageMode: "own" as const,
  videoUrl: "https://cdn.example.com/video.webm",
  editsJson: "{}",
};

describe("agent frame store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRows.value = [];
    mockDeleted.length = 0;
    mockInserted.length = 0;
    mockLockedRecording.value = [
      { videoUrl: recording.videoUrl, editsJson: recording.editsJson },
    ];
    mockCurrentRecording.value = mockLockedRecording.value;
    mockDeleteStoredMediaUrl.mockResolvedValue(true);
    mockDeleteUploadedFile.mockResolvedValue(true);
    mockTxFrameRows.value = [];
  });

  it("keys frames to the video and edits, not to updatedAt", () => {
    const key = agentFrameMediaKey(recording);
    expect(agentFrameMediaKey({ ...recording })).toBe(key);
    expect(
      agentFrameMediaKey({ ...recording, videoUrl: "https://cdn/other.mp4" }),
    ).not.toBe(key);
    expect(
      agentFrameMediaKey({ ...recording, editsJson: '{"trims":[]}' }),
    ).not.toBe(key);
  });

  it("serves the stored bytes when the media key matches", async () => {
    mockRows.value = [
      {
        atMs: 1000,
        mediaKey: agentFrameMediaKey(recording),
        storageUrl: "https://cdn.example.com/frame.jpg",
        storageProvider: "s3",
        storageId: null,
      },
    ];
    mockFetchMedia.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));

    expect(await loadStoredAgentFrame(recording as never, 1000)).toEqual({
      frame: new Uint8Array([1, 2, 3]),
    });
    expect(mockFetchMedia).toHaveBeenCalledWith(
      "https://cdn.example.com/frame.jpg",
      { recordingId: "rec-1", storageMode: "own" },
    );
  });

  it("ignores a frame cut from different media", async () => {
    mockRows.value = [
      {
        atMs: 1000,
        mediaKey: "stale",
        storageUrl: "https://cdn.example.com/frame.jpg",
        storageProvider: "s3",
        storageId: null,
      },
    ];

    const lookup = await loadStoredAgentFrame(recording as never, 1000);
    expect(lookup).toHaveProperty("claim");
    releaseIfClaim(lookup);
    expect(mockFetchMedia).not.toHaveBeenCalled();
  });

  it("offers a claim, not an empty frame, when storage is unreadable", async () => {
    mockRows.value = [
      {
        atMs: 1000,
        mediaKey: agentFrameMediaKey(recording),
        storageUrl: "https://cdn.example.com/frame.jpg",
        storageProvider: "s3",
        storageId: null,
      },
    ];
    mockFetchMedia.mockRejectedValue(new Error("boom"));
    const unreadable = await loadStoredAgentFrame(recording as never, 1000);
    expect(unreadable).toHaveProperty("claim");
    releaseIfClaim(unreadable);

    mockFetchMedia.mockResolvedValue(new Response(new Uint8Array()));
    const empty = await loadStoredAgentFrame(recording as never, 1000);
    expect(empty).toHaveProperty("claim");
    releaseIfClaim(empty);
  });

  it("reports an unreadable store as no claim, not as a miss that downloads the video", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockRows.value = new Proxy([], {
      get() {
        throw new Error("db down");
      },
    }) as never;

    expect(await loadStoredAgentFrame(recording as never, 1000)).toEqual({
      claim: null,
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("stored frames unavailable"),
      expect.objectContaining({ error: "db down" }),
    );
    consoleError.mockRestore();
  });

  it("deletes objects then rows, and keeps a row whose object is not gone", async () => {
    mockRows.value = [
      {
        id: "a",
        storageUrl: "https://cdn.example.com/a.jpg",
        storageProvider: "gcs",
        storageId: null,
      },
      {
        id: "b",
        storageUrl: "https://cdn.example.com/b.jpg",
        storageProvider: "gcs",
        storageId: null,
      },
    ];
    mockDeleteUploadedFile.mockImplementation(
      async (_provider: string, { url }: { url: string }) =>
        url.endsWith("a.jpg"),
    );

    expect(await deleteStoredAgentFrames(recording)).toBe(1);
    expect(mockDeleteUploadedFile).toHaveBeenCalledTimes(2);
    expect(mockDeleted).toHaveLength(1);
  });

  it("deletes a row only while it still points at the object just deleted", async () => {
    mockRows.value = [
      {
        id: "a",
        storageUrl: "https://cdn.example.com/a.jpg",
        storageProvider: "gcs",
        storageId: null,
      },
    ];

    await deleteStoredAgentFrames(recording);

    expect(mockDeleted[0]).toEqual([
      { column: "id", value: "a" },
      { column: "storageUrl", value: "https://cdn.example.com/a.jpg" },
    ]);
  });

  it("deletes an own-S3 frame through the Clips storage path", async () => {
    mockRows.value = [
      {
        id: "s",
        storageUrl: "https://s3.example.com/s.jpg",
        storageProvider: "s3",
        storageId: null,
      },
    ];

    expect(await deleteStoredAgentFrames(recording)).toBe(0);

    expect(mockDeleteStoredMediaUrl).toHaveBeenCalledWith(
      "https://s3.example.com/s.jpg",
      { storageMode: "own", recordingId: "rec-1" },
    );
    expect(mockDeleteUploadedFile).not.toHaveBeenCalled();
  });

  describe("recommended frames", () => {
    const clip = {
      ...recording,
      durationMs: 100_000,
      chaptersJson: "[]",
    } as never;

    it("clamps recommended times to the last frame like the route", async () => {
      const times = await recommendedAgentFrameTimes(clip);
      expect(times).toEqual(
        expect.arrayContaining([OPENING_MS, 25_000, 50_000]),
      );
      expect(Math.max(...times)).toBeLessThan(100_000);
    });

    it("cuts only the frames not stored, reusing the known one", async () => {
      mockUploadRecordingMedia.mockResolvedValue({
        url: "https://cdn.example.com/f.jpg",
        provider: "s3",
      });
      const expected = await recommendedAgentFrameTimes(clip);
      mockRows.value = [
        { atMs: 50_000, mediaKey: agentFrameMediaKey(recording) },
      ];
      const extract = vi.fn(async (_atMs: number) => new Uint8Array([4]));

      await fillRecommendedAgentFrames(clip, extract, {
        atMs: OPENING_MS,
        frame: new Uint8Array([1]),
      });

      const cut = extract.mock.calls.map(([atMs]) => atMs);
      expect(cut).not.toContain(OPENING_MS);
      expect(cut).not.toContain(50_000);
      expect(cut).toEqual(
        expected.filter((t) => t !== OPENING_MS && t !== 50_000),
      );
      expect(mockUploadRecordingMedia).toHaveBeenCalledTimes(
        expected.length - 1,
      );
    });

    it("repairs the requested frame when its current row is unreadable", async () => {
      mockUploadRecordingMedia.mockResolvedValue({
        url: "https://cdn.example.com/new.jpg",
        provider: "s3",
      });
      mockRows.value = [
        {
          atMs: OPENING_MS,
          mediaKey: agentFrameMediaKey(recording),
          storageUrl: "https://cdn.example.com/old.jpg",
          storageProvider: "s3",
          storageId: null,
        },
      ];

      mockTxFrameRows.value = [
        { storageUrl: "https://cdn.example.com/old.jpg" },
      ];

      await fillRecommendedAgentFrames(clip, async () => new Uint8Array([4]), {
        atMs: OPENING_MS,
        frame: new Uint8Array([1]),
      });

      expect(mockDeleteStoredMediaUrl).toHaveBeenCalledWith(
        "https://cdn.example.com/old.jpg",
        {
          storageMode: "own",
          recordingId: "rec-1",
        },
      );
      expect(mockInserted).toContainEqual(
        expect.objectContaining({
          atMs: OPENING_MS,
          storageUrl: "https://cdn.example.com/new.jpg",
        }),
      );
    });

    it("keeps the old row, and uploads nothing, when the replaced object will not delete", async () => {
      mockRows.value = [
        {
          atMs: OPENING_MS,
          mediaKey: "stale",
          storageUrl: "https://cdn.example.com/old.jpg",
          storageProvider: "s3",
          storageId: null,
        },
      ];
      mockDeleteStoredMediaUrl.mockResolvedValue(false);

      await fillRecommendedAgentFrames(clip, async () => new Uint8Array([4]), {
        atMs: OPENING_MS,
        frame: new Uint8Array([1]),
      });

      expect(mockUploadRecordingMedia).not.toHaveBeenCalledWith(
        expect.objectContaining({ filename: `agent-frame-${OPENING_MS}.jpg` }),
      );
      expect(mockInserted).not.toContainEqual(
        expect.objectContaining({ atMs: OPENING_MS }),
      );
    });

    it("deletes the replaced object before it uploads the new one", async () => {
      mockUploadRecordingMedia.mockResolvedValue({
        url: "https://cdn.example.com/new.jpg",
        provider: "s3",
      });
      mockRows.value = [
        {
          atMs: OPENING_MS,
          mediaKey: "stale",
          storageUrl: "https://cdn.example.com/old.jpg",
          storageProvider: "s3",
          storageId: null,
        },
      ];
      mockTxFrameRows.value = [
        { storageUrl: "https://cdn.example.com/old.jpg" },
      ];

      await fillRecommendedAgentFrames(clip, async () => new Uint8Array([4]), {
        atMs: OPENING_MS,
        frame: new Uint8Array([1]),
      });

      const deleteOrder =
        mockDeleteStoredMediaUrl.mock.invocationCallOrder[0] ?? Infinity;
      const uploadOrder =
        mockUploadRecordingMedia.mock.invocationCallOrder[0] ?? 0;
      expect(deleteOrder).toBeLessThan(uploadOrder);
      expect(mockInserted).toContainEqual(
        expect.objectContaining({
          storageUrl: "https://cdn.example.com/new.jpg",
        }),
      );
    });

    it("does nothing for a fill whose media was already replaced, current frames included", async () => {
      mockCurrentRecording.value = [
        { videoUrl: "https://cdn.example.com/burned.mp4", editsJson: "{}" },
      ];
      mockRows.value = [
        {
          atMs: OPENING_MS,
          mediaKey: "newer",
          storageUrl: "https://cdn.example.com/current.jpg",
          storageProvider: "s3",
          storageId: null,
        },
      ];

      await fillRecommendedAgentFrames(clip, async () => new Uint8Array([4]), {
        atMs: OPENING_MS,
        frame: new Uint8Array([1]),
      });

      expect(mockUploadRecordingMedia).not.toHaveBeenCalled();
      expect(mockDeleteStoredMediaUrl).not.toHaveBeenCalled();
    });

    it("drops a frame whose media was replaced while it was being cut", async () => {
      mockUploadRecordingMedia.mockResolvedValue({
        url: "https://cdn.example.com/late.jpg",
        provider: "s3",
      });
      mockLockedRecording.value = [
        { videoUrl: "https://cdn.example.com/burned.mp4", editsJson: "{}" },
      ];

      await fillRecommendedAgentFrames(clip, async () => new Uint8Array([4]));

      expect(mockInserted).toHaveLength(0);
      expect(mockDeleteStoredMediaUrl).toHaveBeenCalledWith(
        "https://cdn.example.com/late.jpg",
        { storageMode: "own", recordingId: "rec-1" },
      );
    });

    it("drops a frame whose recording was deleted while it was being cut", async () => {
      mockUploadRecordingMedia.mockResolvedValue({
        url: "https://cdn.example.com/late.jpg",
        provider: "s3",
      });
      mockLockedRecording.value = [];

      await fillRecommendedAgentFrames(clip, async () => new Uint8Array([4]));

      expect(mockInserted).toHaveLength(0);
      expect(mockDeleteStoredMediaUrl).toHaveBeenCalled();
    });

    it("logs where a rejected upload is when it cannot be deleted", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockUploadRecordingMedia.mockResolvedValue({
        url: "https://cdn.example.com/late.jpg",
        provider: "s3",
        id: "late-1",
      });
      mockLockedRecording.value = [];
      mockDeleteStoredMediaUrl.mockResolvedValue(false);

      await fillRecommendedAgentFrames(clip, async () => new Uint8Array([4]));

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("rejected frame upload left in storage"),
        expect.objectContaining({
          storageUrl: "https://cdn.example.com/late.jpg",
          storageProvider: "s3",
          storageId: "late-1",
        }),
      );
      consoleError.mockRestore();
    });

    it("does not overwrite a frame another fill recorded first", async () => {
      mockUploadRecordingMedia.mockResolvedValue({
        url: "https://cdn.example.com/mine.jpg",
        provider: "s3",
      });
      mockRows.value = [];
      mockTxFrameRows.value = [
        { storageUrl: "https://cdn.example.com/theirs.jpg" },
      ];

      await fillRecommendedAgentFrames(clip, async () => new Uint8Array([4]));

      expect(mockInserted).toHaveLength(0);
      expect(mockDeleteStoredMediaUrl).toHaveBeenCalledWith(
        "https://cdn.example.com/mine.jpg",
        { storageMode: "own", recordingId: "rec-1" },
      );
    });

    it("deletes a hosted frame through the hosted storage path", async () => {
      mockRows.value = [
        {
          id: "h",
          storageUrl: "https://bucket.example.com/h.jpg",
          storageProvider: "clips-hosted",
          storageId: null,
        },
      ];

      await deleteStoredAgentFrames(recording);

      expect(mockDeleteStoredMediaUrl).toHaveBeenCalledWith(
        "https://bucket.example.com/h.jpg",
        { storageMode: "hosted", recordingId: "rec-1" },
      );
      expect(mockDeleteUploadedFile).not.toHaveBeenCalled();
    });

    it("passes the recorded provider id to its delete", async () => {
      mockRows.value = [
        {
          id: "g",
          storageUrl: "https://gcs.example.com/g.jpg",
          storageProvider: "gcs",
          storageId: "obj-1",
        },
      ];

      await deleteStoredAgentFrames(recording);

      expect(mockDeleteUploadedFile).toHaveBeenCalledWith("gcs", {
        url: "https://gcs.example.com/g.jpg",
        id: "obj-1",
      });
    });

    it("prunes frames at timestamps that are no longer recommended", async () => {
      mockUploadRecordingMedia.mockResolvedValue(null);
      mockRows.value = [
        {
          id: "old",
          atMs: 12_345,
          mediaKey: "stale",
          storageUrl: "https://cdn.example.com/old.jpg",
          storageProvider: "s3",
          storageId: null,
        },
      ];

      await fillRecommendedAgentFrames(clip, async () => new Uint8Array([4]));

      expect(mockDeleteStoredMediaUrl).toHaveBeenCalledWith(
        "https://cdn.example.com/old.jpg",
        { storageMode: "own", recordingId: "rec-1" },
      );
      expect(mockDeleted).toHaveLength(1);
    });

    it("keeps a pruned frame's row when its object is not confirmed gone", async () => {
      mockUploadRecordingMedia.mockResolvedValue(null);
      mockRows.value = [
        {
          id: "old",
          atMs: 12_345,
          mediaKey: "stale",
          storageUrl: "https://cdn.example.com/old.jpg",
          storageProvider: "s3",
          storageId: null,
        },
      ];
      mockDeleteStoredMediaUrl.mockResolvedValue(false);

      await fillRecommendedAgentFrames(clip, async () => new Uint8Array([4]));

      expect(mockDeleted).toHaveLength(0);
    });

    it("skips a frame that cannot be cut and keeps going", async () => {
      mockUploadRecordingMedia.mockResolvedValue({
        url: "https://cdn.example.com/f.jpg",
        provider: "s3",
      });
      const extract = vi
        .fn()
        .mockRejectedValueOnce(new Error("no frame"))
        .mockResolvedValue(new Uint8Array([4]));

      await fillRecommendedAgentFrames(clip, extract);

      expect(mockUploadRecordingMedia.mock.calls.length).toBe(
        extract.mock.calls.length - 1,
      );
    });

    it("runs the fill as the clip owner", async () => {
      mockUploadRecordingMedia.mockResolvedValue(null);

      await fillRecommendedAgentFrames(
        {
          ...recording,
          durationMs: 100_000,
          chaptersJson: "[]",
          orgId: "org-1",
        } as never,
        async () => new Uint8Array([4]),
      );

      expect(mockRunWithRequestContext).toHaveBeenCalledWith(
        { userEmail: "owner@example.com", orgId: "org-1" },
        expect.any(Function),
      );
    });

    it("never rejects when the fill itself fails", async () => {
      mockRows.value = [];
      mockRunWithRequestContext.mockImplementationOnce(() => {
        throw new Error("no context");
      });

      await expect(
        fillRecommendedAgentFrames(clip, async () => new Uint8Array([4])),
      ).resolves.toBeUndefined();
    });

    it("makes a concurrent miss wait for the claim, then read the store", async () => {
      mockUploadRecordingMedia.mockResolvedValue(null);
      mockRows.value = [];
      const first = await loadStoredAgentFrame(clip, OPENING_MS);
      if (!("claim" in first) || !first.claim)
        throw new Error("expected a claim");

      const second = loadStoredAgentFrame(clip, OPENING_MS);
      mockRows.value = [
        {
          atMs: OPENING_MS,
          mediaKey: agentFrameMediaKey(recording),
          storageUrl: "https://cdn.example.com/f.jpg",
          storageProvider: "s3",
          storageId: null,
        },
      ];
      mockFetchMedia.mockResolvedValue(new Response(new Uint8Array([7])));
      await first.claim.fill(async () => new Uint8Array([4]));

      expect(await second).toEqual({ frame: new Uint8Array([7]) });
    });

    it("lets a timestamp no fill stores go on demand instead of queueing behind the fill", async () => {
      mockRows.value = [];
      const first = await loadStoredAgentFrame(clip, OPENING_MS);
      if (!("claim" in first) || !first.claim)
        throw new Error("expected a claim");

      expect(await loadStoredAgentFrame(clip, 12_345)).toEqual({ claim: null });

      first.claim.release();
    });

    it("gives a cold burst one claim, and the next waiter takes it over on release", async () => {
      mockRows.value = [];
      const [first, second] = [
        loadStoredAgentFrame(clip, 25_000),
        loadStoredAgentFrame(clip, 50_000),
      ];
      const firstResult = await first;
      if (!("claim" in firstResult) || !firstResult.claim) {
        throw new Error("expected a claim");
      }

      let secondSettled = false;
      void second.then(() => {
        secondSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(secondSettled).toBe(false);

      firstResult.claim.release();
      const secondResult = await second;
      expect(secondResult).toHaveProperty("claim");
      if ("claim" in secondResult) secondResult.claim?.release();
    });
  });
});
