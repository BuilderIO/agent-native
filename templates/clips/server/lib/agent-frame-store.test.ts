import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRows = vi.hoisted(() => ({ value: [] as Array<unknown> }));
const mockDeleted = vi.hoisted(() => [] as unknown[]);
const mockFetchMedia = vi.hoisted(() => vi.fn());
const mockDeleteStoredMediaUrl = vi.hoisted(() => vi.fn());
const mockUploadRecordingMedia = vi.hoisted(() => vi.fn());

const mockRunWithRequestContext = vi.hoisted(() =>
  vi.fn((_context: unknown, callback: () => unknown) => callback()),
);

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (context: unknown, callback: () => unknown) =>
    mockRunWithRequestContext(context, callback),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("../db/index.js", () => {
  const select = () => ({
    from: () => ({
      where: () => {
        const result = Promise.resolve(mockRows.value) as Promise<unknown[]> & {
          limit: () => Promise<unknown[]>;
        };
        result.limit = () => Promise.resolve(mockRows.value);
        return result;
      },
    }),
  });
  return {
    getDb: () => ({
      select,
      delete: () => ({
        where: (condition: unknown) => {
          mockDeleted.push(condition);
          return Promise.resolve();
        },
      }),
    }),
    schema: {
      recordingAgentFrames: {
        id: "id",
        recordingId: "recordingId",
        atMs: "atMs",
        storageUrl: "storageUrl",
      },
    },
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
  fillRecommendedAgentFrames,
  loadStoredAgentFrame,
  recommendedAgentFrameTimes,
} from "./agent-frame-store.js";

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
      },
    ];
    mockFetchMedia.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));

    expect(await loadStoredAgentFrame(recording, 1000)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
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
      },
    ];

    expect(await loadStoredAgentFrame(recording, 1000)).toBeNull();
    expect(mockFetchMedia).not.toHaveBeenCalled();
  });

  it("returns null, not an empty frame, when storage is unreadable", async () => {
    mockRows.value = [
      {
        atMs: 1000,
        mediaKey: agentFrameMediaKey(recording),
        storageUrl: "https://cdn.example.com/frame.jpg",
      },
    ];
    mockFetchMedia.mockRejectedValue(new Error("boom"));
    expect(await loadStoredAgentFrame(recording, 1000)).toBeNull();

    mockFetchMedia.mockResolvedValue(new Response(new Uint8Array()));
    expect(await loadStoredAgentFrame(recording, 1000)).toBeNull();
  });

  it("deletes objects then rows, and keeps a row whose object is not gone", async () => {
    mockRows.value = [
      { id: "a", storageUrl: "https://cdn.example.com/a.jpg" },
      { id: "b", storageUrl: "https://cdn.example.com/b.jpg" },
    ];
    mockDeleteStoredMediaUrl.mockImplementation(async (url: string) =>
      url.endsWith("a.jpg"),
    );

    await expect(deleteStoredAgentFrames(recording)).rejects.toThrow(
      "1 stored agent frame(s)",
    );
    expect(mockDeleteStoredMediaUrl).toHaveBeenCalledTimes(2);
    expect(mockDeleted).toHaveLength(1);
  });

  describe("recommended frames", () => {
    const clip = {
      ...recording,
      durationMs: 100_000,
      chaptersJson: "[]",
    } as never;

    it("clamps recommended times to the last frame like the route", async () => {
      const times = await recommendedAgentFrameTimes(clip);
      expect(times).toEqual(expect.arrayContaining([0, 25_000, 50_000]));
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
        atMs: 0,
        frame: new Uint8Array([1]),
      });

      const cut = extract.mock.calls.map(([atMs]) => atMs);
      expect(cut).not.toContain(0);
      expect(cut).not.toContain(50_000);
      expect(cut).toEqual(expected.filter((t) => t !== 0 && t !== 50_000));
      expect(mockUploadRecordingMedia).toHaveBeenCalledTimes(
        expected.length - 1,
      );
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

    it("makes a concurrent reader wait for the fill, then read the store", async () => {
      mockUploadRecordingMedia.mockResolvedValue(null);
      mockRows.value = [];
      const fill = fillRecommendedAgentFrames(
        clip,
        async () => new Uint8Array([4]),
      );
      mockRows.value = [
        {
          atMs: 0,
          mediaKey: agentFrameMediaKey(recording),
          storageUrl: "https://cdn.example.com/f.jpg",
        },
      ];
      mockFetchMedia.mockResolvedValue(new Response(new Uint8Array([7])));

      expect(await loadStoredAgentFrame(clip, 0)).toEqual(new Uint8Array([7]));
      await fill;
    });

    it("runs one fill per clip at a time", async () => {
      mockUploadRecordingMedia.mockResolvedValue(null);
      const extract = vi.fn(async () => new Uint8Array([4]));

      const first = fillRecommendedAgentFrames(clip, extract);
      expect(fillRecommendedAgentFrames(clip, extract)).toBe(first);
      await first;
    });
  });
});
