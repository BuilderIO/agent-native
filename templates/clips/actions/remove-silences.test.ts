import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  recording: null as {
    id: string;
    durationMs: number;
    editsJson: string | null;
  } | null,
  transcript: null as { status: string; segmentsJson: string } | null,
  writes: [] as Array<Record<string, unknown>>,
  refresh: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (message: string) => {
    throw new Error(message);
  },
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: state.refresh,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => undefined),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (column: unknown, value: unknown) => ({ column, value }),
  isNull: (column: unknown) => ({ column, isNull: true }),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: { recordingId?: string; id?: string }) => ({
        where: () => ({
          limit: async () =>
            table.recordingId === "transcripts.recordingId"
              ? state.transcript
                ? [{ ...state.transcript }]
                : []
              : state.recording
                ? [{ ...state.recording }]
                : [],
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.writes.push(values);
        return {
          where: () => ({
            returning: async () => {
              if (state.recording) {
                state.recording.editsJson = String(values.editsJson);
                return [{ id: state.recording.id }];
              }
              return [];
            },
          }),
        };
      },
    }),
  }),
  schema: {
    recordingTranscripts: { recordingId: "transcripts.recordingId" },
    recordings: { id: "recordings.id", editsJson: "recordings.editsJson" },
  },
}));
vi.mock("./lib/native-media.js", () => ({
  assertNativeRecordingMedia: () => undefined,
}));

import { findSilenceTrimRanges } from "./lib/silence-trim-ranges.js";
import removeSilences from "./remove-silences.js";

const segments = [
  { startMs: 0, endMs: 1_000, text: "First." },
  { startMs: 3_000, endMs: 4_000, text: "Second." },
  { startMs: 6_000, endMs: 6_500, text: "Third." },
];

beforeEach(() => {
  state.recording = {
    id: "rec_1",
    durationMs: 10_000,
    editsJson: JSON.stringify({
      version: 1,
      trims: [{ startMs: 7_500, endMs: 7_500, excluded: false }],
      blurs: [],
    }),
  };
  state.transcript = {
    status: "ready",
    segmentsJson: JSON.stringify(segments),
  };
  state.writes = [];
  state.refresh.mockClear();
});

describe("remove-silences", () => {
  it("derives buffered cuts from ordered transcript gaps", () => {
    expect(
      findSilenceTrimRanges(JSON.stringify(segments), 1_200, 10_000),
    ).toEqual([
      { startMs: 1_200, endMs: 2_800 },
      { startMs: 4_200, endMs: 5_800 },
    ]);
  });

  it("ignores gaps at the threshold and speech overlaps", () => {
    const mixed = [
      { startMs: 2_000, endMs: 3_000, text: "Later." },
      { startMs: 0, endMs: 1_000, text: "First." },
      { startMs: 2_200, endMs: 2_500, text: "Overlap." },
    ];
    expect(findSilenceTrimRanges(JSON.stringify(mixed), 1_000)).toEqual([]);
  });

  it("fails on unreadable or untimed transcript data instead of reporting success", () => {
    expect(() => findSilenceTrimRanges("not-json", 1_200)).toThrow(
      "Transcript segments are unreadable",
    );
    expect(() => findSilenceTrimRanges("[]", 1_200)).toThrow(
      "Timestamped transcript segments are required",
    );
  });

  it("applies every detected trim in one recording update and preserves split markers", async () => {
    const args = removeSilences.schema.parse({
      recordingId: "rec_1",
      thresholdMs: 1_200,
    });

    await expect(removeSilences.run(args)).resolves.toMatchObject({
      status: "completed",
      removedRangeCount: 2,
      trimCount: 2,
    });

    const saved = JSON.parse(String(state.recording?.editsJson));
    expect(
      saved.trims.map(({ id: _id, ...trim }: Record<string, unknown>) => trim),
    ).toEqual([
      { startMs: 1_200, endMs: 2_800, excluded: true },
      { startMs: 4_200, endMs: 5_800, excluded: true },
      { startMs: 7_500, endMs: 7_500, excluded: false },
    ]);
    expect(state.writes).toHaveLength(1);
    expect(state.refresh).toHaveBeenCalledWith("refresh-signal", {
      ts: expect.any(Number),
    });
  });
});
