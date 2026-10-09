import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, schema, stored, written } = vi.hoisted(() => ({
  mockDb: { select: vi.fn(), update: vi.fn() },
  schema: {
    recordings: {
      id: "recordings.id",
      chaptersJson: "recordings.chaptersJson",
      editsJson: "recordings.editsJson",
    },
  },
  stored: {
    chaptersJson: "[]",
    editsJson: "{}",
    // Racing writes, one landing just before each update in turn.
    changedBeforeWrite: [] as { chaptersJson?: string; editsJson?: string }[],
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
  and: (...conditions: unknown[]) => ({ and: conditions.filter(Boolean) }),
}));

import { chaptersVersionOf } from "./lib/chapters-version";
import action from "./set-chapters";

const intro = { startMs: 0, title: "Intro" };
const demo = { startMs: 48_000, title: "Demo" };

beforeEach(() => {
  vi.clearAllMocks();
  written.length = 0;
  stored.chaptersJson = JSON.stringify([intro]);
  stored.editsJson = "{}";
  stored.changedBeforeWrite = [];
  mockDb.select.mockReturnValue({
    from: () => ({
      where: async () => [
        {
          id: "rec_1",
          chaptersJson: stored.chaptersJson,
          editsJson: stored.editsJson,
        },
      ],
    }),
  });
  mockDb.update.mockReturnValue({
    set: (values: unknown) => ({
      where: (condition: any) => ({
        returning: async () => {
          const racing = stored.changedBeforeWrite.shift();
          if (racing) Object.assign(stored, racing);
          const terms = condition.and ?? [condition];
          const current: Record<string, unknown> = {
            "recordings.id": "rec_1",
            "recordings.chaptersJson": stored.chaptersJson,
            "recordings.editsJson": stored.editsJson,
          };
          if (terms.some((t: any) => current[t.column] !== t.value)) return [];
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
    stored.changedBeforeWrite = [
      { chaptersJson: JSON.stringify([intro, demo]) },
    ];
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
    stored.changedBeforeWrite = [{ chaptersJson: JSON.stringify([demo]) }];
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
        condition: { and: [{ column: "recordings.id", value: "rec_1" }] },
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

describe("set-chapters expected cuts", () => {
  const cutEdits = JSON.stringify({
    trims: [{ id: "t1", startMs: 10_000, endMs: 40_000, excluded: true }],
  });

  it("refuses when the cuts differ from the ones the times were mapped through", async () => {
    stored.editsJson = cutEdits;
    await expect(
      action.run({
        recordingId: "rec_1",
        chapters: [intro, demo],
        expectedChapters: [intro],
        expectedCuts: [],
      } as any),
    ).rejects.toMatchObject({
      errorCode: "chapters_changed",
      details: {
        chapters: [intro],
        cuts: [{ startMs: 10_000, endMs: 40_000 }],
      },
    });
    expect(written).toHaveLength(0);
  });

  it("writes when the cuts match", async () => {
    stored.editsJson = cutEdits;
    await action.run({
      recordingId: "rec_1",
      chapters: [intro, demo],
      expectedChapters: [intro],
      expectedCuts: [{ startMs: 10_000, endMs: 40_000 }],
    } as any);
    expect(written).toHaveLength(1);
  });

  it("writes after a racing write that left the same list in a different form", async () => {
    stored.changedBeforeWrite = [
      {
        chaptersJson: JSON.stringify([{ ...intro, extra: true }]),
      },
    ];
    await action.run({
      recordingId: "rec_1",
      chapters: [demo],
      expectedChapters: [intro],
    } as any);
    expect(written).toHaveLength(1);
  });

  it("writes after a racing edit that didn't touch the cuts", async () => {
    stored.changedBeforeWrite = [
      {
        editsJson: JSON.stringify({ thumbnail: { atMs: 1000 } }),
      },
    ];
    await action.run({
      recordingId: "rec_1",
      chapters: [demo],
      expectedChapters: [intro],
      expectedCuts: [],
    } as any);
    expect(written).toHaveLength(1);
  });

  it("refuses after a racing edit that added a cut", async () => {
    stored.changedBeforeWrite = [{ editsJson: cutEdits }];
    await expect(
      action.run({
        recordingId: "rec_1",
        chapters: [demo],
        expectedChapters: [intro],
        expectedCuts: [],
      } as any),
    ).rejects.toMatchObject({
      errorCode: "chapters_changed",
      details: { cuts: [{ startMs: 10_000, endMs: 40_000 }] },
    });
    expect(written).toHaveLength(0);
  });

  it("refuses with the latest list when writes race both updates", async () => {
    stored.changedBeforeWrite = [
      { editsJson: JSON.stringify({ thumbnail: { atMs: 1000 } }) },
      { chaptersJson: JSON.stringify([intro, demo]) },
    ];
    await expect(
      action.run({
        recordingId: "rec_1",
        chapters: [demo],
        expectedChapters: [intro],
        expectedCuts: [],
      } as any),
    ).rejects.toMatchObject({
      errorCode: "chapters_changed",
      details: { chapters: [intro, demo] },
    });
    expect(written).toHaveLength(0);
  });

  it("writes through edits to the cuts when only the chapters are guarded", async () => {
    stored.changedBeforeWrite = [{ editsJson: cutEdits }];
    await action.run({
      recordingId: "rec_1",
      chapters: [demo],
      expectedChapters: [intro],
    } as any);
    expect(written).toHaveLength(1);
  });

  it("writes when the version token matches the stored chapters", async () => {
    await action.run({
      recordingId: "rec_1",
      chapters: [demo],
      expectedVersion: chaptersVersionOf(JSON.stringify([intro])),
    } as any);
    expect(written).toHaveLength(1);
  });

  it("refuses when the version token is for other chapters", async () => {
    await expect(
      action.run({
        recordingId: "rec_1",
        chapters: [demo],
        expectedVersion: chaptersVersionOf("[]"),
      } as any),
    ).rejects.toMatchObject({ errorCode: "chapters_changed" });
    expect(written).toHaveLength(0);
  });

  it("writes after racing edits that left the chapters and cuts alone", async () => {
    stored.changedBeforeWrite = [1000, 2000, 3000].map((atMs) => ({
      editsJson: JSON.stringify({ thumbnail: { atMs } }),
    }));
    await action.run({
      recordingId: "rec_1",
      chapters: [demo],
      expectedChapters: [intro],
      expectedCuts: [],
    } as any);
    expect(written).toHaveLength(1);
  });

  it("succeeds when the last racing write stored exactly the requested list", async () => {
    stored.changedBeforeWrite = [
      ...[1000, 2000, 3000].map((atMs) => ({
        editsJson: JSON.stringify({ thumbnail: { atMs } }),
      })),
      { chaptersJson: JSON.stringify([demo]) },
    ];
    await expect(
      action.run({
        recordingId: "rec_1",
        chapters: [demo],
        expectedChapters: [intro],
        expectedCuts: [],
      } as any),
    ).resolves.toEqual({ id: "rec_1", chapters: [demo] });
  });

  it("gives up without writing when every guarded update misses", async () => {
    stored.changedBeforeWrite = [1000, 2000, 3000, 4000].map((atMs) => ({
      editsJson: JSON.stringify({ thumbnail: { atMs } }),
    }));
    await expect(
      action.run({
        recordingId: "rec_1",
        chapters: [demo],
        expectedChapters: [intro],
        expectedCuts: [],
      } as any),
    ).rejects.toMatchObject({ errorCode: "chapters_busy" });
    expect(written).toHaveLength(0);
  });

  it("fails rather than reporting a save when the recording is gone", async () => {
    mockDb.update.mockReturnValue({
      set: () => ({ where: () => ({ returning: async () => [] }) }),
    });
    let reads = 0;
    mockDb.select.mockImplementation(() => ({
      from: () => ({
        where: async () =>
          reads++ === 0
            ? [{ id: "rec_1", chaptersJson: "[]", editsJson: "{}" }]
            : [],
      }),
    }));
    await expect(
      action.run({ recordingId: "rec_1", chapters: [demo] } as any),
    ).rejects.toMatchObject({ errorCode: "recording_not_found" });
    expect(written).toHaveLength(0);
  });

  it("takes expectedCuts as a JSON string from the CLI", async () => {
    stored.editsJson = cutEdits;
    await action.run({
      recordingId: "rec_1",
      chapters: [demo],
      expectedChapters: [intro],
      expectedCuts: JSON.stringify([{ startMs: 10_000, endMs: 40_000 }]),
    } as any);
    expect(written).toHaveLength(1);
  });
});
