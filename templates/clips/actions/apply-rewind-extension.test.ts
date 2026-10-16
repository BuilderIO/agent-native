import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
  isBound: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
  fail: (message: string, options: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mocks.readAppState(...args),
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  sql: (...args: unknown[]) => args,
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => mocks.selectRows.shift() ?? [],
      }),
    }),
    transaction: (...args: unknown[]) => mocks.transaction(...args),
  }),
  schema: {
    recordings: { id: "recordings.id", visibility: "recordings.visibility" },
    recordingTranscripts: { recordingId: "transcripts.recordingId" },
    recordingTranscriptVersions: {
      id: "versions.id",
      recordingId: "versions.recordingId",
      segmentsJson: "versions.segmentsJson",
    },
    recordingComments: { recordingId: "comments.recordingId" },
    recordingReactions: { recordingId: "reactions.recordingId" },
  },
}));
vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: vi.fn(),
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
  ownerEmailMatches: (...args: unknown[]) => args,
}));
vi.mock("../server/lib/s3-upload-provider.js", () => ({
  isS3ObjectUrlBoundToRecording: (...args: unknown[]) => mocks.isBound(...args),
}));
vi.mock("./make-recording-private-for-rewind.js", () => ({
  assertNoDirectRecordingShares: vi.fn(),
}));

import action from "./apply-rewind-extension.js";

const request = {
  requestId: "request-1",
  recordingId: "recording-1",
  preRollRecordingId: "pre-roll-1",
  seconds: 30,
  status: "ready",
  requestedAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

function recording(id: string, storageMode: "own" | "hosted" | null) {
  return {
    id,
    visibility: "private",
    storageMode,
    durationMs: 10_000,
    editsJson: "{}",
    chaptersJson: "[]",
  };
}

async function run() {
  return action.run({
    recordingId: "recording-1",
    requestId: "request-1",
    preRollRecordingId: "pre-roll-1",
    videoUrl: "https://storage.example/clips/victim-1/clip.mp4",
    durationMs: 40_000,
    addedMs: 30_000,
  });
}

describe("apply-rewind-extension hosted media binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows = [
      [recording("recording-1", "hosted")],
      [recording("pre-roll-1", null)],
    ];
    mocks.readAppState.mockResolvedValue(request);
    mocks.writeAppState.mockResolvedValue(undefined);
    mocks.isBound.mockResolvedValue(false);
  });

  it.each([false, null])(
    "rejects a hosted URL with a different recording binding (%s)",
    async (binding) => {
      mocks.isBound.mockResolvedValue(binding);

      await expect(run()).rejects.toThrow(
        "The Rewind upload is not bound to its recording.",
      );

      expect(mocks.isBound).toHaveBeenCalledWith(
        "https://storage.example/clips/victim-1/clip.mp4",
        "recording-1",
        { storageMode: "hosted" },
      );
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.writeAppState).not.toHaveBeenCalled();
    },
  );
});

describe("apply-rewind-extension transcript timeline", () => {
  function fakeTx(rows: { transcript: unknown[]; versions: unknown[] }) {
    const updates: Array<{
      table: unknown;
      values: Record<string, unknown>;
      where: unknown;
    }> = [];
    const locks: unknown[] = [];
    const tx = {
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async (where: unknown) => {
            updates.push({ table, values, where });
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            for: async (mode: unknown) => {
              locks.push(mode);
              return rows.transcript;
            },
            limit: async () => rows.versions,
          }),
        }),
      }),
    };
    return { tx, updates, locks };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows = [
      [recording("recording-1", "own")],
      [recording("pre-roll-1", null)],
    ];
    mocks.readAppState.mockResolvedValue(request);
    mocks.writeAppState.mockResolvedValue(undefined);
    mocks.isBound.mockResolvedValue(true);
  });

  it("shifts the locked transcript and its saved versions by the prepended range", async () => {
    const { tx, updates, locks } = fakeTx({
      transcript: [
        {
          segmentsJson: JSON.stringify([
            { startMs: 0, endMs: 4000, text: "Current words." },
            // Browser transcription stores entries like this one as written;
            // the extension moves them, it doesn't clean them up.
            { startMs: 4000, endMs: 4000, text: "", source: "mic" },
          ]),
        },
      ],
      versions: [
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
        {
          id: "version-2",
          // The player reads numeric strings as times, so they move too.
          segmentsJson: JSON.stringify([
            { startMs: "2000", endMs: "6000", text: "Times as text." },
          ]),
        },
      ],
    });
    mocks.transaction.mockImplementation(
      async (runTx: (t: unknown) => unknown) => runTx(tx),
    );

    await run();

    expect(locks).toEqual(["update"]);
    const transcriptWrite = updates.find(
      (u) => Array.isArray(u.where) && u.where[0] === "transcripts.recordingId",
    );
    expect(JSON.parse(String(transcriptWrite?.values.segmentsJson))).toEqual([
      { startMs: 30_000, endMs: 34_000, text: "Current words." },
      { startMs: 34_000, endMs: 34_000, text: "", source: "mic" },
    ]);
    const versionWrites = updates
      .filter((u) => Array.isArray(u.where) && u.where[0] === "versions.id")
      .map((u) => [
        (u.where as unknown[])[1],
        JSON.parse(String(u.values.segmentsJson)),
      ]);
    expect(versionWrites).toEqual([
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
    const { tx, updates } = fakeTx({
      transcript: [
        {
          segmentsJson: JSON.stringify([
            { startMs: 0, endMs: 4000, text: "Current words." },
          ]),
        },
      ],
      versions: [
        {
          id: "version-1",
          segmentsJson: JSON.stringify([{ text: "No times." }]),
        },
        {
          id: "version-2",
          segmentsJson: JSON.stringify([
            { startMs: 1000, endMs: 5000, text: "Earlier words." },
          ]),
        },
      ],
    });
    mocks.transaction.mockImplementation(
      async (runTx: (t: unknown) => unknown) => runTx(tx),
    );

    await run();

    const versionWrites = updates
      .filter((u) => Array.isArray(u.where) && u.where[0] === "versions.id")
      .map((u) => [
        (u.where as unknown[])[1],
        JSON.parse(String(u.values.segmentsJson)),
      ]);
    expect(versionWrites).toEqual([
      [
        "version-2",
        [{ startMs: 31_000, endMs: 35_000, text: "Earlier words." }],
      ],
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("version-1"));
    warn.mockRestore();
  });

  it.each([
    [
      "the transcript",
      { transcript: [{ segmentsJson: "{not json" }], versions: [] },
    ],
    [
      "one cue's times",
      {
        transcript: [
          {
            segmentsJson: JSON.stringify([
              { startMs: 0, endMs: 4000, text: "Readable words." },
              { text: "No times." },
            ]),
          },
        ],
        versions: [],
      },
    ],
  ])(
    "fails without writing anything when %s can't be read",
    async (_, rows) => {
      const { tx, updates } = fakeTx(rows);
      mocks.transaction.mockImplementation(
        async (runTx: (t: unknown) => unknown) => runTx(tx),
      );

      await expect(run()).rejects.toMatchObject({
        errorCode: "transcript_segments_unreadable",
      });

      expect(
        updates.filter(
          (u) =>
            Array.isArray(u.where) &&
            (u.where[0] === "versions.id" ||
              u.where[0] === "transcripts.recordingId"),
        ),
      ).toEqual([]);
      expect(mocks.writeAppState).not.toHaveBeenCalled();
    },
  );
});
