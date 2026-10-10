import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, schema, stored, written } = vi.hoisted(() => {
  const schema = {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      chaptersJson: "recordings.chaptersJson",
      editsJson: "recordings.editsJson",
      trashedAt: "recordings.trashedAt",
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
    preRollTrashed: false,
    // Racing saves, one landing just before each guarded update in turn.
    changedBeforeWrite: [] as { chaptersJson?: string; editsJson?: string }[],
  };
  const written: { table: unknown; patch: Record<string, unknown> }[] = [];

  const recordingRow = (id: string) => ({
    id,
    visibility: "private",
    durationMs: 60_000,
    trashedAt: id === "pre_1" && stored.preRollTrashed ? "earlier" : null,
    chaptersJson: stored.chaptersJson,
    editsJson: stored.editsJson,
  });
  const matches = (where: any) =>
    (where.and ?? [where]).every((c: any) =>
      c.isNull === "recordings.trashedAt"
        ? !stored.preRollTrashed
        : c.column === "recordings.chaptersJson"
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
        if (table === schema.recordings && "trashedAt" in patch) {
          if (!matches(where)) return [];
          stored.preRollTrashed = true;
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
    // Rolls back this transaction's writes on a throw, as Postgres does.
    // Its recording update missed by then, so only the claim is undone.
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const before = { trashed: stored.preRollTrashed, written: [...written] };
      try {
        return await run({ update });
      } catch (err) {
        stored.preRollTrashed = before.trashed;
        written.splice(0, written.length, ...before.written);
        throw err;
      }
    },
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
  isNull: (column: string) => ({ isNull: column }),
  sql: () => ({ sql: true }),
}));
vi.mock("../server/db/index.js", () => ({ getDb: () => mockDb, schema }));
const mockDispatch = vi.hoisted(() => vi.fn());
vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: mockDispatch,
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
  stored.preRollTrashed = false;
  mockDispatch.mockReset();
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
    expect(written.filter((w) => "trashedAt" in w.patch)).toHaveLength(1);
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

  it("doesn't shift again when the same Rewind is applied twice", async () => {
    await action.run(args);
    const once = { chapters: stored.chaptersJson, edits: stored.editsJson };
    written.length = 0;
    await expect(action.run(args)).resolves.toMatchObject({
      request: { status: "applied" },
    });
    expect(stored.chaptersJson).toBe(once.chapters);
    expect(stored.editsJson).toBe(once.edits);
    expect(written).toEqual([]);
  });

  it("doesn't shift again when another apply of the same Rewind commits after this one read", async () => {
    const transaction = mockDb.transaction;
    mockDb.transaction = (run) => {
      stored.preRollTrashed = true;
      stored.chaptersJson = JSON.stringify([{ ...intro, startMs: 30_000 }]);
      stored.editsJson = JSON.stringify({ rewindOriginalStartMs: 30_000 });
      return transaction(run);
    };
    try {
      await expect(action.run(args)).resolves.toMatchObject({
        request: { status: "applied" },
      });
    } finally {
      mockDb.transaction = transaction;
    }
    expect(written).toEqual([]);
    expect(JSON.parse(stored.chaptersJson)).toEqual([
      { ...intro, startMs: 30_000 },
    ]);
  });

  it("refuses, writing nothing, when the pre-roll was deleted before any apply", async () => {
    stored.preRollTrashed = true;
    await expect(action.run(args)).rejects.toMatchObject({
      errorCode: "rewind_preroll_unavailable",
    });
    expect(written).toEqual([]);
    expect(JSON.parse(stored.chaptersJson)).toEqual([intro]);
  });

  it("asks for the thumbnail again when a retry finds the shift already made", async () => {
    mockDispatch.mockRejectedValueOnce(new Error("queue down"));
    await expect(action.run(args)).rejects.toThrow("queue down");
    await expect(action.run(args)).resolves.toMatchObject({
      request: { status: "applied" },
    });
    expect(mockDispatch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(stored.chaptersJson)).toEqual([
      { ...intro, startMs: 30_000 },
    ]);
  });
});
