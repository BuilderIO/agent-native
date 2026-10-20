import { beforeEach, describe, expect, it, vi } from "vitest";

const { stored, mockDb } = vi.hoisted(() => {
  const stored = {
    editsJson: "{}" as string | null,
    changedBeforeWrite: null as string | null,
    writes: 0,
  };
  const mockDb = {
    select: () => ({
      from: () => ({
        where: async () => [{ id: "rec_1", editsJson: stored.editsJson }],
      }),
    }),
    update: () => ({
      set: (patch: { editsJson: string }) => ({
        where: (where: any) => ({
          returning: async () => {
            if (stored.changedBeforeWrite !== null) {
              stored.editsJson = stored.changedBeforeWrite;
              stored.changedBeforeWrite = null;
            }
            const matches = where.and.every((condition: any) =>
              condition.isNull === "recordings.editsJson"
                ? stored.editsJson === null
                : condition.column !== "recordings.editsJson" ||
                  condition.value === stored.editsJson,
            );
            if (!matches) return [];
            stored.editsJson = patch.editsJson;
            stored.writes++;
            return [{ id: "rec_1" }];
          },
        }),
      }),
    }),
  };
  return { stored, mockDb };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(),
}));
vi.mock("drizzle-orm", () => ({
  eq: (column: string, value: unknown) => ({ column, value }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  isNull: (column: string) => ({ isNull: column }),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: { id: "recordings.id", editsJson: "recordings.editsJson" },
  },
}));

import action from "./clear-edits";

const cleared = {
  version: 1,
  trims: [],
  blurs: [],
  thumbnail: null,
  stitchedFrom: ["source_1", "source_2"],
  mediaStorageLayout: "external",
  rewindPreRollId: "pre_1",
};

beforeEach(() => {
  stored.editsJson = JSON.stringify({
    ...cleared,
    trims: [{ startMs: 1_000, endMs: 2_000, excluded: true }],
    blurs: [
      { startMs: 1_000, endMs: 2_000, x: 0, y: 0, w: 1, h: 1, intensity: 1 },
    ],
    thumbnail: { kind: "frame", value: "1000" },
    rewindOriginalStartMs: 30_000,
  });
  stored.changedBeforeWrite = null;
  stored.writes = 0;
});

describe("clear-edits", () => {
  it("keeps the committed Rewind marker and provenance while clearing editor edits", async () => {
    const result = await action.run({ recordingId: "rec_1" });

    expect(JSON.parse(stored.editsJson!)).toEqual(cleared);
    expect(result).toEqual({ id: "rec_1", editsJson: cleared });
    expect(stored.writes).toBe(1);
  });

  it("keeps the current Rewind marker when a concurrent edit forces a retry", async () => {
    stored.changedBeforeWrite = JSON.stringify({
      ...JSON.parse(stored.editsJson!),
      rewindPreRollId: "pre_2",
    });
    const expected = { ...cleared, rewindPreRollId: "pre_2" };

    const result = await action.run({ recordingId: "rec_1" });

    expect(JSON.parse(stored.editsJson!)).toEqual(expected);
    expect(result).toEqual({ id: "rec_1", editsJson: expected });
    expect(stored.writes).toBe(1);
  });
});
