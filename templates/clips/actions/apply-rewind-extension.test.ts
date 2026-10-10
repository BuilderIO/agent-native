import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, schema, stored, written } = vi.hoisted(() => {
  const schema = {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      chaptersJson: "recordings.chaptersJson",
      editsJson: "recordings.editsJson",
    },
    recordingTranscripts: { recordingId: "recordingTranscripts.recordingId" },
    recordingComments: {
      recordingId: "recordingComments.recordingId",
      videoTimestampMs: "recordingComments.videoTimestampMs",
    },
    recordingReactions: {
      recordingId: "recordingReactions.recordingId",
      videoTimestampMs: "recordingReactions.videoTimestampMs",
    },
  };
  const stored = {
    chaptersJson: "[]",
    editsJson: "{}",
    // Racing saves, one landing just before each guarded update in turn.
    changedBeforeWrite: [] as { chaptersJson?: string; editsJson?: string }[],
  };
  const written: { table: unknown; patch: Record<string, unknown> }[] = [];

  const recordingRow = (id: string) => ({
    id,
    visibility: "private",
    durationMs: 60_000,
    chaptersJson: stored.chaptersJson,
    editsJson: stored.editsJson,
  });
  const matches = (where: any) =>
    (where.and ?? [where]).every((c: { column: string; value: unknown }) =>
      c.column === "recordings.chaptersJson"
        ? c.value === stored.chaptersJson
        : c.column === "recordings.editsJson"
          ? c.value === stored.editsJson
          : true,
    );
  const update = (table: unknown) => ({
    set: (patch: Record<string, unknown>) => {
      const apply = (where: any) => {
        if (table === schema.recordings && "chaptersJson" in patch) {
          Object.assign(stored, stored.changedBeforeWrite.shift() ?? {});
          if (!matches(where)) return [];
          stored.chaptersJson = patch.chaptersJson as string;
          stored.editsJson = patch.editsJson as string;
        }
        written.push({ table, patch });
        return [{ id: "rec_1" }];
      };
      return {
        where: (where: any) => {
          const rows = apply(where);
          return Object.assign(Promise.resolve(undefined), {
            returning: async () => rows,
          });
        },
      };
    },
  });
  const mockDb = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: async (where: any) => {
          if (table === schema.recordingTranscripts) return [];
          if (fields) {
            return [
              {
                chaptersJson: stored.chaptersJson,
                editsJson: stored.editsJson,
              },
            ];
          }
          const id = (where.and ?? [where]).find(
            (c: any) => c.column === "recordings.id",
          )?.value;
          return [recordingRow(id)];
        },
      }),
    }),
    update,
    transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({ update }),
  };
  return { mockDb, schema, stored, written };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (message: string, options: { errorCode?: string }) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(async () => ({
    requestId: "req_1",
    status: "ready",
    preRollRecordingId: "pre_1",
  })),
  writeAppState: vi.fn(),
}));
vi.mock("drizzle-orm", () => ({
  eq: (column: string, value: unknown) => ({ column, value }),
  and: (...conditions: unknown[]) => ({ and: conditions.filter(Boolean) }),
  sql: () => ({ sql: true }),
}));
vi.mock("../server/db/index.js", () => ({ getDb: () => mockDb, schema }));
vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: vi.fn(),
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
  ownerEmailMatches: () => undefined,
}));
vi.mock("../server/lib/s3-upload-provider.js", () => ({
  isS3ObjectUrlBoundToRecording: vi.fn(async () => true),
}));
vi.mock("./make-recording-private-for-rewind.js", () => ({
  assertNoDirectRecordingShares: vi.fn(),
}));

import action from "./apply-rewind-extension";

const args = {
  recordingId: "rec_1",
  requestId: "req_1",
  preRollRecordingId: "pre_1",
  videoUrl: "https://storage.example.com/rec_1.mp4",
  durationMs: 90_000,
  addedMs: 30_000,
};

const intro = { startMs: 0, title: "Intro" };
const demo = { startMs: 48_000, title: "Demo" };

beforeEach(() => {
  stored.chaptersJson = JSON.stringify([intro]);
  stored.editsJson = "{}";
  stored.changedBeforeWrite = [];
  written.length = 0;
});

describe("apply-rewind-extension", () => {
  it("shifts the chapters it read", async () => {
    await action.run(args);
    expect(JSON.parse(stored.chaptersJson)).toEqual([
      { startMs: 30_000, title: "Intro" },
    ]);
  });

  it("shifts a chapter save that landed after it read, not the list it read", async () => {
    stored.changedBeforeWrite = [
      { chaptersJson: JSON.stringify([intro, demo]) },
    ];
    await action.run(args);
    expect(JSON.parse(stored.chaptersJson)).toEqual([
      { startMs: 30_000, title: "Intro" },
      { startMs: 78_000, title: "Demo" },
    ]);
    // Comments and the pre-roll are moved once, not once per attempt.
    expect(
      written.filter((w) => w.table === schema.recordingComments),
    ).toHaveLength(1);
  });

  it("shifts cuts saved after it read", async () => {
    stored.changedBeforeWrite = [
      {
        editsJson: JSON.stringify({
          trims: [{ id: "t1", startMs: 1_000, endMs: 2_000 }],
        }),
      },
    ];
    await action.run(args);
    expect(JSON.parse(stored.editsJson).trims).toMatchObject([
      { startMs: 31_000, endMs: 32_000 },
    ]);
  });

  it("writes nothing when the chapters keep changing", async () => {
    stored.changedBeforeWrite = Array.from({ length: 4 }, (_, i) => ({
      chaptersJson: JSON.stringify([{ startMs: i, title: `Edit ${i}` }]),
    }));
    await expect(action.run(args)).rejects.toMatchObject({
      errorCode: "chapters_busy",
    });
    expect(written).toEqual([]);
    expect(JSON.parse(stored.chaptersJson)).toEqual([
      { startMs: 3, title: "Edit 3" },
    ]);
  });
});
