import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: async (key: string, value: unknown) => {
    store.set(key, value);
  },
  deleteAppState: async (key: string) => {
    store.delete(key);
  },
  listAppState: async (prefix: string) =>
    [...store.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value })),
}));

const {
  clearAudioLevelRepairPending,
  listAudioLevelRepairIds,
  markAudioLevelRepairPending,
  parseAudioLevelRepairMarker,
} = await import("./audio-level-repair-state.js");

describe("audio level repair markers", () => {
  beforeEach(() => store.clear());

  it("keeps a rejected dispatch findable until it is cleared", async () => {
    await markAudioLevelRepairPending({ recordingId: "a", reason: "503" });
    await markAudioLevelRepairPending({ recordingId: "b", reason: "503" });
    expect(await listAudioLevelRepairIds(10)).toEqual({
      ids: ["a", "b"],
      remaining: 0,
    });
    expect(await listAudioLevelRepairIds(1)).toEqual({
      ids: ["a"],
      remaining: 1,
    });
    await clearAudioLevelRepairPending("a");
    expect(await listAudioLevelRepairIds(10)).toEqual({
      ids: ["b"],
      remaining: 0,
    });
  });

  it("ignores malformed markers", () => {
    expect(parseAudioLevelRepairMarker({ recordingId: "a" })).toBeNull();
    expect(parseAudioLevelRepairMarker(null)).toBeNull();
  });
});
