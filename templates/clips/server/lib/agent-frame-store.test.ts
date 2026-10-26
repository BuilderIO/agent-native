import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRows = vi.hoisted(() => ({ value: [] as Array<unknown> }));
const mockDeleted = vi.hoisted(() => [] as unknown[]);
const mockFetchMedia = vi.hoisted(() => vi.fn());
const mockDeleteStoredMediaUrl = vi.hoisted(() => vi.fn());
const mockUploadRecordingMedia = vi.hoisted(() => vi.fn());

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
  loadAgentTranscript: vi.fn(),
  parseAgentChapters: vi.fn(),
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
      { mediaKey: "stale", storageUrl: "https://cdn.example.com/frame.jpg" },
    ];

    expect(await loadStoredAgentFrame(recording, 1000)).toBeNull();
    expect(mockFetchMedia).not.toHaveBeenCalled();
  });

  it("returns null, not an empty frame, when storage is unreadable", async () => {
    mockRows.value = [
      {
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
});
