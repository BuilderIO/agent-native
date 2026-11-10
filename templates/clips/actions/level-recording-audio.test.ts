import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnsure = vi.hoisted(() => vi.fn());
const mockRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockLimit = vi.hoisted(() => vi.fn());
const mockLt = vi.hoisted(() => vi.fn(() => "lt"));
const mockOr = vi.hoisted(() => vi.fn(() => "or"));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...parts: unknown[]) => parts),
  desc: vi.fn(() => "desc"),
  eq: vi.fn(() => "eq"),
  isNotNull: vi.fn(() => "isNotNull"),
  lt: mockLt,
  or: mockOr,
}));

vi.mock("../server/db/index.js", () => {
  const builder = {
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: (n: number) => {
      mockLimit(n);
      return Promise.resolve(mockRows.value);
    },
  };
  return {
    getDb: () => ({ select: () => builder }),
    schema: {
      recordings: {
        id: "id",
        createdAt: "createdAt",
        ownerEmail: "ownerEmail",
        status: "status",
        hasAudio: "hasAudio",
        videoUrl: "videoUrl",
      },
    },
  };
});

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.test",
  ownerEmailMatches: () => "owner",
}));

vi.mock("../server/lib/audio-level.js", () => ({
  AUDIO_LEVEL_QUIET_THRESHOLD_LUFS: -24,
  AUDIO_LEVEL_TARGET_LUFS: -16,
  ensureRecordingAudioLevel: (...args: unknown[]) => mockEnsure(...args),
}));

import levelRecordingAudio, {
  decodeSweepCursor,
  encodeSweepCursor,
} from "./level-recording-audio.js";

describe("level-recording-audio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRows.value = [];
    mockEnsure.mockImplementation(async ({ recordingId }) => ({
      recordingId,
      status: "already-normal",
      changed: false,
    }));
  });

  it("refuses more explicit ids than one call processes", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `rec-${i}`).join(",");
    await expect(levelRecordingAudio.run({ ids })).rejects.toThrow(
      /at most 50/,
    );
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it("returns a cursor when an all-sweep fills its batch", async () => {
    mockRows.value = [
      { id: "rec-a", createdAt: "2026-11-10T10:00:00.000Z" },
      { id: "rec-b", createdAt: "2026-11-09T10:00:00.000Z" },
    ];
    const result = await levelRecordingAudio.run({ all: true, limit: 2 });
    expect(result).toMatchObject({
      processed: 2,
      nextBefore: "2026-11-09T10:00:00.000Z|rec-b",
    });

    mockRows.value = [{ id: "rec-c", createdAt: "2026-11-08T10:00:00.000Z" }];
    const next = await levelRecordingAudio.run({
      all: true,
      limit: 2,
      before: "2026-11-09T10:00:00.000Z|rec-b",
    });
    // Continue after (createdAt, id), so clips sharing the time are kept.
    expect(mockOr).toHaveBeenCalled();
    expect(mockLt).toHaveBeenCalledWith(
      "createdAt",
      "2026-11-09T10:00:00.000Z",
    );
    expect(mockLt).toHaveBeenCalledWith("id", "rec-b");
    expect(next).toMatchObject({ processed: 1 });
    expect(next).not.toHaveProperty("nextBefore");
  });

  it("shares the 50-clip budget between explicit ids and a sweep", async () => {
    const ids = Array.from({ length: 48 }, (_, i) => `rec-${i}`);
    await levelRecordingAudio.run({ ids, all: true, limit: 20 });
    expect(mockLimit).toHaveBeenCalledWith(2);
  });

  it("round-trips the sweep cursor", () => {
    const cursor = encodeSweepCursor("2026-11-09T10:00:00.000Z", "rec-b");
    expect(decodeSweepCursor(cursor)).toEqual({
      createdAt: "2026-11-09T10:00:00.000Z",
      id: "rec-b",
    });
    expect(decodeSweepCursor("2026-11-09T10:00:00.000Z")).toEqual({
      createdAt: "2026-11-09T10:00:00.000Z",
      id: null,
    });
  });
});
