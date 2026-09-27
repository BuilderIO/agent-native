import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  reads: [] as Array<{ id: string; editsJson: string | null }>,
  writeWins: [] as boolean[],
  written: [] as Array<Record<string, unknown>>,
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
        where: async () => [state.reads.shift() ?? state.reads[0]],
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.written.push(values);
        const wins = state.writeWins.shift() ?? true;
        return {
          where: () => ({
            returning: async () => (wins ? [{ id: "rec_1" }] : []),
          }),
        };
      },
    }),
  }),
  schema: { recordings: { id: "id", editsJson: "editsJson" } },
}));
vi.mock("./lib/native-media.js", () => ({
  assertNativeRecordingMedia: () => undefined,
}));

const action = (await import("./set-recording-overlays.js")) as any;

function box(id: string, startMs: number) {
  return {
    id,
    kind: "redact",
    style: "solid",
    startMs,
    endMs: startMs + 2_000,
    keys: [{ atMs: startMs, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
  };
}

function editsWith(overlays: unknown[], trims: unknown[] = []) {
  return JSON.stringify({ version: 1, trims, blurs: [], overlays });
}

function run(overlays: unknown[]) {
  return action.default.run({ recordingId: "rec_1", overlays });
}

describe("set-recording-overlays under contention", () => {
  beforeEach(() => {
    state.reads = [];
    state.writeWins = [];
    state.written = [];
  });

  it("retries when something else changed the trims", async () => {
    const overlays = [box("r1", 1_000)];
    state.reads = [
      { id: "rec_1", editsJson: editsWith(overlays) },
      {
        id: "rec_1",
        editsJson: editsWith(overlays, [
          { id: "cut-1", startMs: 1_000, endMs: 2_000, excluded: true },
        ]),
      },
    ];
    state.writeWins = [false, true];

    const result = await run([box("r1", 1_000), box("r2", 5_000)]);

    expect(result.redactions).toBe(2);
    expect(state.written).toHaveLength(2);
    const saved = JSON.parse(String(state.written[1].editsJson));
    expect(saved.overlays.map((o: any) => o.id)).toEqual(["r1", "r2"]);
    expect(saved.trims).toEqual([
      { id: "cut-1", startMs: 1_000, endMs: 2_000, excluded: true },
    ]);
  });

  it("refuses to retry over a box someone else drew", async () => {
    state.reads = [
      { id: "rec_1", editsJson: editsWith([box("r1", 1_000)]) },
      {
        id: "rec_1",
        editsJson: editsWith([box("r1", 1_000), box("r2", 5_000)]),
      },
    ];
    state.writeWins = [false, true];

    await expect(run([box("r1", 2_500)])).rejects.toThrow(/reload the editor/i);

    expect(state.written).toHaveLength(1);
  });
});
