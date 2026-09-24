import { describe, it, expect, vi, beforeEach } from "vitest";

const storeMod = vi.hoisted(() => ({
  getObservationLogTokens: vi.fn(),
  listObservationalMemory: vi.fn(),
  insertObservationalMemory: vi.fn(),
}));
vi.mock("./store.js", () => storeMod);

const { runReflector } = await import("./reflector.js");

beforeEach(() => {
  vi.clearAllMocks();
  storeMod.listObservationalMemory.mockResolvedValue([]);
  storeMod.insertObservationalMemory.mockImplementation(async (input: any) => ({
    id: "om-test",
    createdAt: 1,
    updatedAt: 1,
    orgId: null,
    visibility: "private",
    ...input,
  }));
});

describe("runReflector", () => {
  it("no-ops when the observation log is under the reflection threshold", async () => {
    storeMod.getObservationLogTokens.mockResolvedValue(1_000);
    const runInternal = vi.fn(async () => "should not be called");

    const result = await runReflector({
      threadId: "t1",
      ownerEmail: "alice@example.com",
      runInternal,
      config: { reflectionTokenThreshold: 40_000 },
    });

    expect(result.reflected).toBe(false);
    expect(runInternal).not.toHaveBeenCalled();
    expect(storeMod.insertObservationalMemory).not.toHaveBeenCalled();
  });

  it("condenses observations into a reflection once the log exceeds the threshold", async () => {
    storeMod.getObservationLogTokens.mockResolvedValue(50_000);
    storeMod.listObservationalMemory.mockImplementation(
      async (opts: { tier?: string }) => {
        if (opts.tier === "observation") {
          return [
            {
              id: "o1",
              text: "2026-06-10 started feature",
              sourceStartIndex: 0,
              sourceEndIndex: 9,
            },
            {
              id: "o2",
              text: "2026-06-12 shipped feature",
              sourceStartIndex: 10,
              sourceEndIndex: 19,
            },
          ];
        }
        return []; // no prior reflections
      },
    );
    const runInternal = vi.fn(
      async () => "Goal: ship feature. Status: done as of 2026-06-12.",
    );

    const result = await runReflector({
      threadId: "t1",
      ownerEmail: "alice@example.com",
      runInternal,
      config: { reflectionTokenThreshold: 40_000 },
    });

    expect(runInternal).toHaveBeenCalledTimes(1);
    expect(result.reflected).toBe(true);
    expect(storeMod.insertObservationalMemory).toHaveBeenCalledTimes(1);

    const insertArg = storeMod.insertObservationalMemory.mock.calls[0][0];
    expect(insertArg.tier).toBe("reflection");
    expect(insertArg.text).toContain("ship feature");
    expect(insertArg.ownerEmail).toBe("alice@example.com");
    // Spans the folded observation range.
    expect(insertArg.sourceStartIndex).toBe(0);
    expect(insertArg.sourceEndIndex).toBe(19);
    expect(insertArg.sourceMessageCount).toBe(2);
  });
});
