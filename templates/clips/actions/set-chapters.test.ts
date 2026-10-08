import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, schema, stored, written } = vi.hoisted(() => ({
  mockDb: { select: vi.fn(), update: vi.fn() },
  schema: {
    recordings: {
      id: "recordings.id",
      chaptersJson: "recordings.chaptersJson",
    },
  },
  stored: {
    chaptersJson: "[]",
    changedBeforeWrite: null as string | null,
  },
  written: [] as unknown[],
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (message: string, options: { errorCode?: string }) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));
vi.mock("@agent-native/core/sharing", () => ({ assertAccess: vi.fn() }));
vi.mock("../server/db/index.js", () => ({ getDb: () => mockDb, schema }));
vi.mock("drizzle-orm", () => ({
  eq: (column: string, value: unknown) => ({ column, value }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
}));

import action from "./set-chapters";

const intro = { startMs: 0, title: "Intro" };
const demo = { startMs: 48_000, title: "Demo" };

beforeEach(() => {
  vi.clearAllMocks();
  written.length = 0;
  stored.chaptersJson = JSON.stringify([intro]);
  stored.changedBeforeWrite = null;
  mockDb.select.mockReturnValue({
    from: () => ({
      where: async () => [{ id: "rec_1", chaptersJson: stored.chaptersJson }],
    }),
  });
  mockDb.update.mockReturnValue({
    set: (values: unknown) => ({
      where: (condition: any) => ({
        returning: async () => {
          if (stored.changedBeforeWrite !== null) {
            stored.chaptersJson = stored.changedBeforeWrite;
            return [];
          }
          written.push({ values, condition });
          return [{ id: "rec_1" }];
        },
      }),
    }),
  });
});

describe("set-chapters", () => {
  it("writes when the stored chapters match the expected ones", async () => {
    await action.run({
      recordingId: "rec_1",
      chapters: [intro, demo],
      expectedChapters: [intro],
    } as any);
    expect(written).toEqual([
      expect.objectContaining({
        condition: {
          and: [
            { column: "recordings.id", value: "rec_1" },
            {
              column: "recordings.chaptersJson",
              value: JSON.stringify([intro]),
            },
          ],
        },
      }),
    ]);
  });

  it("refuses when the stored chapters differ from the expected ones", async () => {
    stored.chaptersJson = JSON.stringify([intro, demo]);
    await expect(
      action.run({
        recordingId: "rec_1",
        chapters: [demo],
        expectedChapters: [intro],
      } as any),
    ).rejects.toMatchObject({
      errorCode: "chapters_changed",
      details: { chapters: [intro, demo] },
    });
    expect(written).toHaveLength(0);
  });

  it("refuses when another write lands between the read and the update", async () => {
    stored.changedBeforeWrite = JSON.stringify([intro, demo]);
    await expect(
      action.run({
        recordingId: "rec_1",
        chapters: [demo],
        expectedChapters: [intro],
      } as any),
    ).rejects.toMatchObject({
      errorCode: "chapters_changed",
      details: { chapters: [intro, demo] },
    });
  });

  it("succeeds when a racing write stored exactly the requested list", async () => {
    stored.changedBeforeWrite = JSON.stringify([demo]);
    await expect(
      action.run({
        recordingId: "rec_1",
        chapters: [demo],
        expectedChapters: [intro],
      } as any),
    ).resolves.toEqual({ id: "rec_1", chapters: [demo] });
  });

  it("still overwrites when no expected chapters are given", async () => {
    stored.chaptersJson = JSON.stringify([intro, demo]);
    await action.run({ recordingId: "rec_1", chapters: [demo] } as any);
    expect(written).toEqual([
      expect.objectContaining({
        condition: { column: "recordings.id", value: "rec_1" },
      }),
    ]);
  });
});

describe("set-chapters expected list", () => {
  it("accepts an expected list with times and titles the player can show but set-chapters wouldn't write", async () => {
    const odd = [{ startMs: 12_500.5, title: "" }];
    stored.chaptersJson = JSON.stringify(odd);
    await action.run({
      recordingId: "rec_1",
      chapters: [demo],
      expectedChapters: odd,
    } as any);
    expect(written).toHaveLength(1);
  });
});
