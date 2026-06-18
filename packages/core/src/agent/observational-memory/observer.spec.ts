import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EngineMessage } from "../engine/types.js";

const storeMod = vi.hoisted(() => ({
  getObservedThroughIndex: vi.fn(),
  listObservationalMemory: vi.fn(),
  insertObservationalMemory: vi.fn(),
}));
vi.mock("./store.js", () => storeMod);

const { runObserver } = await import("./observer.js");

/** Build N user messages each carrying ~`charsPer` chars (≈ charsPer/4 tokens). */
function buildMessages(n: number, charsPer: number): EngineMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: [{ type: "text" as const, text: "x".repeat(charsPer) }],
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  storeMod.getObservedThroughIndex.mockResolvedValue(-1);
  storeMod.listObservationalMemory.mockResolvedValue([]);
  storeMod.insertObservationalMemory.mockImplementation(async (input: any) => ({
    id: "om-test",
    createdAt: 1,
    updatedAt: 1,
    orgId: null,
    visibility: "private",
    sourceStartIndex: input.sourceStartIndex ?? null,
    sourceEndIndex: input.sourceEndIndex ?? null,
    sourceMessageCount: input.sourceMessageCount ?? 0,
    ...input,
  }));
});

describe("runObserver", () => {
  it("no-ops when the unobserved window is under the token threshold", async () => {
    // 4 short messages → well under 30k tokens.
    const messages = buildMessages(4, 40);
    const runInternal = vi.fn(async () => "should not be called");

    const result = await runObserver({
      threadId: "t1",
      ownerEmail: "alice@example.com",
      messages,
      runInternal,
    });

    expect(result.observed).toBe(false);
    expect(runInternal).not.toHaveBeenCalled();
    expect(storeMod.insertObservationalMemory).not.toHaveBeenCalled();
  });

  it("compacts and persists an observation once the window exceeds the threshold", async () => {
    // 8 medium messages clear a tiny threshold without building a huge fixture
    // that stresses full-suite prep memory.
    const messages = buildMessages(8, 300);
    const runInternal = vi.fn(
      async () => "2026-06-17 observed: task in progress; decided to ship",
    );

    const result = await runObserver({
      threadId: "t1",
      ownerEmail: "alice@example.com",
      messages,
      runInternal,
      config: { observationTokenThreshold: 10 },
    });

    expect(runInternal).toHaveBeenCalledTimes(1);
    expect(result.observed).toBe(true);
    expect(storeMod.insertObservationalMemory).toHaveBeenCalledTimes(1);

    const insertArg = storeMod.insertObservationalMemory.mock.calls[0][0];
    expect(insertArg.tier).toBe("observation");
    expect(insertArg.text).toContain("2026-06-17");
    expect(insertArg.ownerEmail).toBe("alice@example.com");
    // Covers the whole unobserved window (none observed yet).
    expect(insertArg.sourceStartIndex).toBe(0);
    expect(insertArg.sourceEndIndex).toBe(messages.length - 1);
    expect(insertArg.tokenEstimate).toBeGreaterThan(0);
  });

  it("only considers messages after the already-observed index", async () => {
    storeMod.getObservedThroughIndex.mockResolvedValue(3);
    const messages = buildMessages(10, 1000);
    const runInternal = vi.fn(async () => "dated observation log");

    const result = await runObserver({
      threadId: "t1",
      ownerEmail: "alice@example.com",
      messages,
      runInternal,
      config: { observationTokenThreshold: 100 },
    });

    expect(result.observed).toBe(true);
    const insertArg = storeMod.insertObservationalMemory.mock.calls[0][0];
    expect(insertArg.sourceStartIndex).toBe(4);
    expect(insertArg.sourceEndIndex).toBe(9);
    expect(insertArg.sourceMessageCount).toBe(6);
  });
});
