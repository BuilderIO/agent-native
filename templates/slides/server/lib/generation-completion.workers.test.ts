import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string>());
const tracked = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/tracking", () => ({ track: tracked }));
vi.mock("@agent-native/core/sharing", () => ({ resolveAccess: vi.fn() }));
vi.mock("@agent-native/core/settings", () => ({
  getSetting: async (key: string) => {
    await Promise.resolve();
    const raw = store.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  },
  // The compare-and-set the real store runs: a writer that lost retries on the
  // value the winner left.
  mutateSetting: async (
    key: string,
    updater: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>,
  ) => {
    for (;;) {
      const raw = store.get(key) ?? null;
      const next = updater(raw === null ? null : JSON.parse(raw));
      await Promise.resolve();
      if ((store.get(key) ?? null) === raw) {
        store.set(key, JSON.stringify(next));
        return next;
      }
    }
  },
  deleteSettingIfValue: async (
    key: string,
    expected: Record<string, unknown>,
  ) => {
    if (store.get(key) !== JSON.stringify(expected)) return false;
    return store.delete(key);
  },
  listSettingsByPrefix: async (prefix: string) =>
    [...store]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value: JSON.parse(value) })),
}));

const output = {
  deckId: "deck-1",
  generationAttemptId: "attempt-1",
  targetSlideCount: 5,
};
const finalRun = {
  runId: "run-2",
  turnId: "turn-1",
  threadId: "thread-1",
  status: "completed",
};
const finished = { turnContinues: false };

// A fresh copy of the module is a worker of its own: it shares the settings
// store and nothing else.
async function worker() {
  vi.resetModules();
  return import("./generation-completion");
}

async function handOffFromFirstChunk() {
  const first = await worker();
  first.noteGenerationFirstOutput("turn-1", output);
  await first.trackGenerationCompletedForRun(
    { ...finalRun, runId: "run-1" },
    { turnContinues: true },
    async () => 2,
  );
}

const reports = () =>
  tracked.mock.calls.filter(([name]) => name === "generation_completed");

beforeEach(() => {
  store.clear();
  tracked.mockClear();
});

describe("finishing a turn on several workers", () => {
  it("reports once when two workers finish the same turn at the same time", async () => {
    await handOffFromFirstChunk();
    const [a, b] = [await worker(), await worker()];

    await Promise.all([
      a.trackGenerationCompletedForRun(finalRun, finished, async () => 5),
      b.trackGenerationCompletedForRun(finalRun, finished, async () => 5),
    ]);

    expect(reports()).toHaveLength(1);
    expect(store.size).toBe(0);
  });

  it("leaves a turn another worker is reporting to that worker", async () => {
    await handOffFromFirstChunk();
    const key = "slides-generation-pending:turn-1";
    const row = JSON.parse(store.get(key)!);
    store.set(
      key,
      JSON.stringify({
        ...row,
        finalizing: { owner: "other-worker", until: Date.now() + 60_000 },
      }),
    );

    await (
      await worker()
    ).trackGenerationCompletedForRun(finalRun, finished, async () => 5);

    expect(reports()).toHaveLength(0);
    expect(store.has(key)).toBe(true);
  });

  it("reports a turn whose worker died mid-report once its lease has lapsed", async () => {
    await handOffFromFirstChunk();
    const key = "slides-generation-pending:turn-1";
    const row = JSON.parse(store.get(key)!);
    store.set(
      key,
      JSON.stringify({
        ...row,
        finalizing: { owner: "dead-worker", until: Date.now() - 1 },
      }),
    );

    await (
      await worker()
    ).trackGenerationCompletedForRun(finalRun, finished, async () => 5);

    expect(reports()).toHaveLength(1);
    expect(store.size).toBe(0);
  });

  it("keeps the markers, with no lease, when the slide count cannot be read", async () => {
    await handOffFromFirstChunk();

    await expect(
      (await worker()).trackGenerationCompletedForRun(
        finalRun,
        finished,
        async () => {
          throw new Error("database unavailable");
        },
      ),
    ).rejects.toThrow("database unavailable");

    const row = JSON.parse(store.get("slides-generation-pending:turn-1")!);
    expect(row.outputs).toHaveLength(1);
    expect(row).not.toHaveProperty("finalizing");
    await (
      await worker()
    ).trackGenerationCompletedForRun(finalRun, finished, async () => 5);
    expect(reports()).toHaveLength(1);
  });
});
