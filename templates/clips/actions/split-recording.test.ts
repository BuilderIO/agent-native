import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  recording: null as { id: string; editsJson: string | null } | null,
  writes: [] as Array<Record<string, unknown>>,
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(async () => undefined),
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
      from: () => ({
        where: async () => (state.recording ? [{ ...state.recording }] : []),
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
    recordings: { id: "recordings.id", editsJson: "recordings.editsJson" },
  },
}));
vi.mock("./lib/native-media.js", () => ({
  assertNativeRecordingMedia: () => undefined,
}));

import splitRecording from "./split-recording.js";

beforeEach(() => {
  state.recording = {
    id: "rec_1",
    editsJson: JSON.stringify({
      version: 1,
      trims: [{ startMs: 1_000, endMs: 2_000, excluded: true }],
      blurs: [],
    }),
  };
  state.writes = [];
});

describe("split-recording action contract", () => {
  it("persists a zero-width original-timeline marker without excluding playback", async () => {
    const args = splitRecording.schema.parse({
      recordingId: "rec_1",
      atMs: 4_500,
    });

    await splitRecording.run(args);

    const saved = JSON.parse(String(state.recording?.editsJson));
    expect(
      saved.trims.map(
        ({ startMs, endMs, excluded }: Record<string, unknown>) => ({
          startMs,
          endMs,
          excluded,
        }),
      ),
    ).toEqual([
      { startMs: 1_000, endMs: 2_000, excluded: true },
      { startMs: 4_500, endMs: 4_500, excluded: false },
    ]);
    expect(state.writes).toHaveLength(1);
  });
});
