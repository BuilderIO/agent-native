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

import trimRecording from "./trim-recording.js";

beforeEach(() => {
  state.recording = {
    id: "rec_1",
    editsJson: JSON.stringify({
      version: 1,
      trims: [{ startMs: 4_000, endMs: 4_000, excluded: false }],
      blurs: [],
    }),
  };
  state.writes = [];
});

describe("trim-recording action contract", () => {
  it("persists an excluded range using original-timeline millisecond arguments", async () => {
    const args = trimRecording.schema.parse({
      recordingId: "rec_1",
      startMs: 15_000,
      endMs: 20_000,
    });

    await trimRecording.run(args);

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
      { startMs: 15_000, endMs: 20_000, excluded: true },
      { startMs: 4_000, endMs: 4_000, excluded: false },
    ]);
    expect(state.writes).toHaveLength(1);
  });
});
