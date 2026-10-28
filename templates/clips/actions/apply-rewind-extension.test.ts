import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, schema, stored, written } = vi.hoisted(() => {
  const schema = {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      chaptersJson: "recordings.chaptersJson",
      editsJson: "recordings.editsJson",
      mediaUpdatedAt: "recordings.mediaUpdatedAt",
      videoUrl: "recordings.videoUrl",
      updatedAt: "recordings.updatedAt",
      trashedAt: "recordings.trashedAt",
    },
    recordingTranscripts: {
      recordingId: "recordingTranscripts.recordingId",
      segmentsJson: "recordingTranscripts.segmentsJson",
    },
    recordingTranscriptVersions: {
      id: "versions.id",
      recordingId: "versions.recordingId",
      segmentsJson: "versions.segmentsJson",
    },
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
    storageMode: "own" as "own" | "hosted",
    versions: [] as { id: string; segmentsJson: string }[],
    transcriptLocks: [] as string[],
    chaptersJson: "[]",
    editsJson: "{}",
    mediaUpdatedAt: "media-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    videoUrl: "https://storage.example.com/rec_1.mp4",
    transcriptSegmentsJson: null as string | null,
    changeTranscriptBeforeWrite: null as string | null,
    recordingWrittenInTransaction: false,
    request: {
      requestId: "req_1",
      status: "ready",
      preRollRecordingId: "pre_1",
    } as Record<string, unknown> | null,
    preRollTrashed: false,
    recordingExists: true,
    preRollExists: true,
    recordingOwner: "owner@example.com",
    preRollOwner: "owner@example.com",
    recordingVisibility: "private",
    preRollVisibility: "private",
    // Racing saves, one landing just before each guarded update in turn.
    changedBeforeWrite: [] as {
      chaptersJson?: string;
      editsJson?: string;
      mediaUpdatedAt?: string;
    }[],
  };
  const written: { table: unknown; patch: Record<string, unknown> }[] = [];

  const recordingRow = (id: string) => ({
    id,
    storageMode: stored.storageMode,
    ownerEmail: id === "pre_1" ? stored.preRollOwner : stored.recordingOwner,
    visibility:
      id === "pre_1" ? stored.preRollVisibility : stored.recordingVisibility,
    durationMs: 60_000,
    trashedAt: id === "pre_1" && stored.preRollTrashed ? "earlier" : null,
    chaptersJson: stored.chaptersJson,
    editsJson: stored.editsJson,
    mediaUpdatedAt: stored.mediaUpdatedAt,
    videoUrl: stored.videoUrl,
    updatedAt: stored.updatedAt,
  });
  const matches = (where: any) =>
    (where.and ?? [where]).every((c: any) =>
      c.isNull === "recordings.trashedAt"
        ? !stored.preRollTrashed
        : c.column === "recordings.chaptersJson"
          ? c.value === stored.chaptersJson
          : c.column === "recordings.editsJson"
            ? c.value === stored.editsJson
            : c.column === "recordings.mediaUpdatedAt"
              ? c.value === stored.mediaUpdatedAt
              : c.column === "recordings.videoUrl"
                ? c.value === stored.videoUrl
                : c.column === "recordings.updatedAt"
                  ? c.value === stored.updatedAt
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
          stored.mediaUpdatedAt = patch.mediaUpdatedAt as string;
          stored.videoUrl = patch.videoUrl as string;
          stored.updatedAt = patch.updatedAt as string;
          stored.recordingWrittenInTransaction = true;
        }
        if (table === schema.recordingTranscripts && "segmentsJson" in patch) {
          if (stored.changeTranscriptBeforeWrite) {
            stored.transcriptSegmentsJson = stored.changeTranscriptBeforeWrite;
            stored.changeTranscriptBeforeWrite = null;
          }
          const transcriptMatches = (where.and ?? [where]).every(
            (c: any) =>
              c.column !== "recordingTranscripts.segmentsJson" ||
              c.value === stored.transcriptSegmentsJson,
          );
          if (!transcriptMatches) return [];
          stored.transcriptSegmentsJson = patch.segmentsJson as string;
        }
        if (table === schema.recordingTranscriptVersions) {
          const version = stored.versions.find((v) => v.id === where.value);
          if (version) Object.assign(version, patch);
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
                mediaUpdatedAt: stored.mediaUpdatedAt,
                videoUrl: stored.videoUrl,
                updatedAt: stored.updatedAt,
              },
            ];
          }
          const id = (where.and ?? [where]).find(
            (c: any) => c.column === "recordings.id",
          )?.value;
          if (
            id === "pre_1" ? !stored.preRollExists : !stored.recordingExists
          ) {
            return [];
          }
          const row = recordingRow(id);
          const owner = (where.and ?? [where]).find(
            (c: any) => c.column === "recordings.ownerEmail",
          );
          return owner && owner.value !== row.ownerEmail ? [] : [row];
        },
      }),
    }),
    update,
    // Rolls back this transaction's writes on a throw, as Postgres does.
    // Its recording update missed by then, so only the claim is undone.
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const before = {
        trashed: stored.preRollTrashed,
        chaptersJson: stored.chaptersJson,
        editsJson: stored.editsJson,
        mediaUpdatedAt: stored.mediaUpdatedAt,
        videoUrl: stored.videoUrl,
        updatedAt: stored.updatedAt,
        transcriptSegmentsJson: stored.transcriptSegmentsJson,
        versions: structuredClone(stored.versions),
        written: [...written],
      };
      stored.recordingWrittenInTransaction = false;
      try {
        return await run({
          update,
          select: (fields?: unknown) => ({
            from: (table: unknown) => ({
              where: () => ({
                for: async (mode: string) => {
                  stored.transcriptLocks.push(mode);
                  return stored.transcriptSegmentsJson === null
                    ? []
                    : [{ segmentsJson: stored.transcriptSegmentsJson }];
                },
                limit: async () => stored.versions.map((v) => ({ ...v })),
              }),
            }),
          }),
        });
      } catch (err) {
        stored.preRollTrashed = before.trashed;
        if (stored.recordingWrittenInTransaction) {
          stored.chaptersJson = before.chaptersJson;
          stored.editsJson = before.editsJson;
          stored.mediaUpdatedAt = before.mediaUpdatedAt;
          stored.videoUrl = before.videoUrl;
          stored.updatedAt = before.updatedAt;
        }
        if (written.some((w) => w.table === schema.recordingTranscripts)) {
          stored.transcriptSegmentsJson = before.transcriptSegmentsJson;
        }
        stored.versions = before.versions;
        written.splice(0, written.length, ...before.written);
        throw err;
      } finally {
        stored.recordingWrittenInTransaction = false;
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
  readAppState: vi.fn(async () => stored.request),
  writeAppState: vi.fn(async (key: string, value: Record<string, unknown>) => {
    if (key !== "refresh-signal") stored.request = value;
  }),
  compareAndSetAppState: vi.fn(
    async (
      _key: string,
      expected: Record<string, unknown> | null,
      next: Record<string, unknown> | null,
    ) => {
      if (JSON.stringify(stored.request) !== JSON.stringify(expected)) {
        return false;
      }
      stored.request = next;
      return true;
    },
  ),
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
  ownerEmailMatches: (column: string, value: string) => ({ column, value }),
}));
vi.mock("../server/lib/s3-upload-provider.js", () => ({
  isS3ObjectUrlBoundToRecording: vi.fn(async () => true),
}));
vi.mock("./make-recording-private-for-rewind.js", () => ({
  assertNoDirectRecordingShares: vi.fn(),
}));

import action from "./apply-rewind-extension";
import { assertNoDirectRecordingShares } from "./make-recording-private-for-rewind";

const args = {
  recordingId: "rec_1",
  requestId: "req_1",
  preRollRecordingId: "pre_1",
  videoUrl: "https://storage.example.com/rec_1.mp4",
  durationMs: 90_000,
  addedMs: 30_000,
  expectedMediaUpdatedAt: "media-1",
};

const intro = { startMs: 0, title: "Intro" };
const demo = { startMs: 48_000, title: "Demo" };

beforeEach(() => {
  stored.storageMode = "own";
  stored.versions = [];
  stored.transcriptLocks = [];
  stored.chaptersJson = JSON.stringify([intro]);
  stored.editsJson = "{}";
  stored.mediaUpdatedAt = "media-1";
  stored.updatedAt = "2026-01-01T00:00:00.000Z";
  stored.videoUrl = "https://storage.example.com/rec_1.mp4";
  stored.transcriptSegmentsJson = null;
  stored.changeTranscriptBeforeWrite = null;
  stored.request = {
    requestId: "req_1",
    status: "ready",
    preRollRecordingId: "pre_1",
  };
  stored.preRollTrashed = false;
  stored.recordingExists = true;
  stored.preRollExists = true;
  stored.recordingOwner = "owner@example.com";
  stored.preRollOwner = "owner@example.com";
  stored.recordingVisibility = "private";
  stored.preRollVisibility = "private";
  vi.mocked(assertNoDirectRecordingShares).mockReset();
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

  it("re-reads and shifts a transcript that changes during the transaction", async () => {
    const before = [{ startMs: 1_000, endMs: 1_200, text: "old" }];
    const concurrent = [{ startMs: 2_000, endMs: 2_300, text: "new" }];
    stored.transcriptSegmentsJson = JSON.stringify(before);
    stored.changeTranscriptBeforeWrite = JSON.stringify(concurrent);

    await action.run(args);

    expect(JSON.parse(stored.transcriptSegmentsJson!)).toEqual([
      { ...concurrent[0], startMs: 32_000, endMs: 32_300 },
    ]);
    expect(JSON.parse(stored.chaptersJson)).toEqual([
      { startMs: 30_000, title: "Intro" },
    ]);
  });

  it("refuses a Rewind upload if redaction replaces the source during apply", async () => {
    stored.changedBeforeWrite = [{ mediaUpdatedAt: "media-redacted" }];

    await expect(action.run(args)).rejects.toMatchObject({
      errorCode: "recording_media_changed",
    });

    expect(stored.mediaUpdatedAt).toBe("media-redacted");
    expect(stored.preRollTrashed).toBe(false);
    expect(JSON.parse(stored.chaptersJson)).toEqual([intro]);
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
      stored.editsJson = JSON.stringify({
        rewindOriginalStartMs: 30_000,
        rewindPreRollId: "pre_1",
      });
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

  it("marks a failed transaction so the request can be retried", async () => {
    const transaction = mockDb.transaction;
    mockDb.transaction = async () => {
      throw new Error("database unavailable");
    };
    try {
      await expect(action.run(args)).rejects.toThrow("database unavailable");
    } finally {
      mockDb.transaction = transaction;
    }

    expect(stored.request).toMatchObject({
      status: "failed",
      error: "database unavailable",
    });
    expect(stored.preRollTrashed).toBe(false);
    expect(JSON.parse(stored.chaptersJson)).toEqual([intro]);

    await expect(action.run(args)).resolves.toMatchObject({
      request: { status: "applied" },
    });
    expect(JSON.parse(stored.chaptersJson)).toEqual([
      { ...intro, startMs: 30_000 },
    ]);
  });

  it("clears an applying request when its media revision is stale", async () => {
    stored.request = { ...stored.request!, status: "applying" };
    stored.mediaUpdatedAt = "media-2";

    await expect(action.run(args)).rejects.toMatchObject({
      errorCode: "recording_media_changed",
    });

    expect(stored.request).toMatchObject({
      status: "failed",
      error: expect.stringContaining("media changed"),
    });
    expect(stored.preRollTrashed).toBe(false);
    expect(JSON.parse(stored.chaptersJson)).toEqual([intro]);
  });

  it("continues an apply after the request was left applying", async () => {
    stored.request = {
      ...stored.request!,
      status: "applying",
    };

    await expect(action.run(args)).resolves.toMatchObject({
      request: { status: "applied" },
    });
    expect(JSON.parse(stored.chaptersJson)).toEqual([
      { ...intro, startMs: 30_000 },
    ]);
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

  it("finishes a committed apply after the consumed pre-roll is deleted", async () => {
    mockDispatch.mockRejectedValueOnce(new Error("queue down"));
    await expect(action.run(args)).rejects.toThrow("queue down");
    expect(stored.request).toMatchObject({ status: "ready" });
    expect(stored.preRollTrashed).toBe(true);
    const committed = {
      chaptersJson: stored.chaptersJson,
      editsJson: stored.editsJson,
      mediaUpdatedAt: stored.mediaUpdatedAt,
      videoUrl: stored.videoUrl,
      updatedAt: stored.updatedAt,
    };
    expect(committed.mediaUpdatedAt).not.toBe(args.expectedMediaUpdatedAt);
    stored.preRollExists = false;
    written.length = 0;

    await expect(action.run(args)).resolves.toMatchObject({
      request: { requestId: "req_1", status: "applied" },
    });

    expect(stored).toMatchObject(committed);
    expect(written).toEqual([]);
    expect(mockDispatch).toHaveBeenCalledTimes(2);
    expect(mockDispatch).toHaveBeenLastCalledWith({
      recordingId: "rec_1",
      kind: "thumbnail",
      requireAccepted: true,
    });
  });

  it("returns an applied request after the consumed pre-roll is deleted", async () => {
    await action.run(args);
    const committed = {
      chaptersJson: stored.chaptersJson,
      editsJson: stored.editsJson,
    };
    stored.preRollExists = false;
    written.length = 0;

    await expect(action.run(args)).resolves.toMatchObject({
      request: { requestId: "req_1", status: "applied" },
    });

    expect(stored).toMatchObject(committed);
    expect(written).toEqual([]);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it.each(["requestId", "preRollRecordingId"])(
    "refuses committed recovery when the current request has a different %s",
    async (field) => {
      stored.editsJson = JSON.stringify({ rewindPreRollId: "pre_1" });
      stored.request = { ...stored.request!, [field]: "other" };

      await expect(action.run(args)).rejects.toThrow(
        "request is not ready to apply",
      );

      expect(written).toEqual([]);
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(stored.request).toMatchObject({
        [field]: "other",
        status: "ready",
      });
    },
  );

  it.each(["missing", "another owner"])(
    "refuses committed recovery when the main Clip is %s",
    async (condition) => {
      stored.editsJson = JSON.stringify({ rewindPreRollId: "pre_1" });
      stored.preRollExists = false;
      if (condition === "missing") stored.recordingExists = false;
      else stored.recordingOwner = "other@example.com";

      await expect(action.run(args)).rejects.toThrow("unavailable");

      expect(written).toEqual([]);
      expect(mockDispatch).not.toHaveBeenCalled();
    },
  );

  it.each(["recordingVisibility", "preRollVisibility"] as const)(
    "refuses a new apply when %s is not private",
    async (field) => {
      stored[field] = "public";

      await expect(action.run(args)).rejects.toThrow(
        "private Clip from a private pre-roll",
      );

      expect(written).toEqual([]);
      expect(mockDispatch).not.toHaveBeenCalled();
    },
  );

  it("refuses a new apply when the pre-roll row is missing", async () => {
    stored.preRollExists = false;

    await expect(action.run(args)).rejects.toThrow("unavailable");

    expect(written).toEqual([]);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("refuses a new apply when the pre-roll belongs to another owner", async () => {
    stored.preRollOwner = "other@example.com";

    await expect(action.run(args)).rejects.toThrow("unavailable");

    expect(written).toEqual([]);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("refuses a new apply when the Clip has direct shares", async () => {
    vi.mocked(assertNoDirectRecordingShares).mockRejectedValueOnce(
      new Error("direct shares"),
    );

    await expect(action.run(args)).rejects.toThrow("direct shares");

    expect(written).toEqual([]);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("doesn't take an earlier Rewind of the same length for this one", async () => {
    stored.editsJson = JSON.stringify({
      rewindOriginalStartMs: 30_000,
      rewindPreRollId: "pre_0",
    });
    stored.preRollTrashed = true;
    await expect(action.run(args)).rejects.toMatchObject({
      errorCode: "rewind_preroll_unavailable",
    });
    expect(written).toEqual([]);
  });
});

describe("apply-rewind-extension hosted media binding", () => {
  it.each([false, null])(
    "rejects a hosted URL with a different recording binding (%s)",
    async (binding) => {
      stored.storageMode = "hosted";
      const { isS3ObjectUrlBoundToRecording } =
        await import("../server/lib/s3-upload-provider.js");
      vi.mocked(isS3ObjectUrlBoundToRecording).mockResolvedValueOnce(binding);

      await expect(action.run(args)).rejects.toThrow(
        "The Rewind upload is not bound to its recording.",
      );

      expect(isS3ObjectUrlBoundToRecording).toHaveBeenCalledWith(
        args.videoUrl,
        args.recordingId,
        { storageMode: "hosted" },
      );
      expect(written).toEqual([]);
      expect(stored.request?.status).toBe("ready");
    },
  );
});

describe("apply-rewind-extension transcript timeline", () => {
  it("shifts the locked transcript and its saved versions by the prepended range", async () => {
    stored.transcriptSegmentsJson = JSON.stringify([
      { startMs: 0, endMs: 4000, text: "Current words." },
      // Browser transcription stores entries like this one as written.
      { startMs: 4000, endMs: 4000, text: "", source: "mic" },
    ]);
    stored.versions = [
      {
        id: "version-1",
        segmentsJson: JSON.stringify([
          {
            startMs: 1000,
            endMs: 5000,
            text: "Earlier words.",
            speaker: "Sample Speaker",
          },
        ]),
      },
      // The player reads numeric strings as times, so they move too.
      {
        id: "version-2",
        segmentsJson: JSON.stringify([
          { startMs: "2000", endMs: "6000", text: "Times as text." },
        ]),
      },
    ];

    await action.run(args);

    expect(stored.transcriptLocks).toEqual(["update"]);
    expect(JSON.parse(stored.transcriptSegmentsJson!)).toEqual([
      { startMs: 30_000, endMs: 34_000, text: "Current words." },
      { startMs: 34_000, endMs: 34_000, text: "", source: "mic" },
    ]);
    expect(
      stored.versions.map((v) => [v.id, JSON.parse(v.segmentsJson)]),
    ).toEqual([
      [
        "version-1",
        [
          {
            startMs: 31_000,
            endMs: 35_000,
            text: "Earlier words.",
            speaker: "Sample Speaker",
          },
        ],
      ],
      [
        "version-2",
        [{ startMs: 32_000, endMs: 36_000, text: "Times as text." }],
      ],
    ]);
  });

  it("extends past a saved transcript restore would refuse, leaving it as stored", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stored.transcriptSegmentsJson = JSON.stringify([
      { startMs: 0, endMs: 4000, text: "Current words." },
    ]);
    const unreadable = JSON.stringify([{ text: "No times." }]);
    stored.versions = [
      { id: "version-1", segmentsJson: unreadable },
      {
        id: "version-2",
        segmentsJson: JSON.stringify([
          { startMs: 1000, endMs: 5000, text: "Earlier words." },
        ]),
      },
    ];
    try {
      await action.run(args);
      expect(stored.versions[0].segmentsJson).toBe(unreadable);
      expect(JSON.parse(stored.versions[1].segmentsJson)).toEqual([
        { startMs: 31_000, endMs: 35_000, text: "Earlier words." },
      ]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("version-1"));
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    ["the transcript", "{not json"],
    [
      "one cue's times",
      JSON.stringify([
        { startMs: 0, endMs: 4000, text: "Readable words." },
        { text: "No times." },
      ]),
    ],
  ])(
    "fails without writing anything when %s can't be read",
    async (_, segmentsJson) => {
      stored.transcriptSegmentsJson = segmentsJson;
      stored.versions = [{ id: "version-1", segmentsJson: "[]" }];

      await expect(action.run(args)).rejects.toMatchObject({
        errorCode: "transcript_segments_unreadable",
      });

      expect(written).toEqual([]);
      expect(stored.transcriptSegmentsJson).toBe(segmentsJson);
      expect(stored.versions).toEqual([
        { id: "version-1", segmentsJson: "[]" },
      ]);
      expect(stored.preRollTrashed).toBe(false);
      expect(JSON.parse(stored.chaptersJson)).toEqual([intro]);
      expect(stored.request?.status).toBe("failed");
    },
  );
});
