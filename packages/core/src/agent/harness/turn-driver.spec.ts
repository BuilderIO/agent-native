import { describe, expect, it, vi } from "vitest";

import { driveAgentHarnessTurnChunks } from "./turn-driver.js";
import type { DriveAgentHarnessTurnChunksOptions } from "./turn-driver.js";
import type { AgentHarnessSession } from "./types.js";

function stream(...events: Array<{ type: "done" }>) {
  return (async function* () {
    yield* events;
  })();
}

function control(
  overrides: Partial<DriveAgentHarnessTurnChunksOptions["control"]> = {},
): DriveAgentHarnessTurnChunksOptions["control"] {
  return {
    turnSignal: new AbortController().signal,
    chunkSignal: new AbortController().signal,
    chunkBoundaryReason: () => undefined,
    beginChunk: () => new AbortController().signal,
    ...overrides,
  };
}

describe("driveAgentHarnessTurnChunks", () => {
  it("starts with input and continues only after a chunk boundary", async () => {
    const boundaryReason = vi.fn().mockReturnValueOnce("soft-timeout");
    const chunkSignal = new AbortController().signal;
    const nextChunkSignal = new AbortController().signal;
    const beginChunk = vi.fn(() => nextChunkSignal);
    const session = {
      streamTurn: vi.fn(() => stream({ type: "done" })),
      continueTurn: vi.fn(() => stream({ type: "done" })),
    } as unknown as AgentHarnessSession;
    const consume = vi.fn(async (events: AsyncIterable<{ type: "done" }>) => {
      for await (const _event of events) {
        // Consume the stream before deciding whether the next chunk is due.
      }
    });

    await driveAgentHarnessTurnChunks({
      session,
      input: { prompt: "hello" },
      control: control({
        chunkSignal,
        chunkBoundaryReason: boundaryReason,
        beginChunk,
      }),
      consume,
    });

    expect(session.streamTurn).toHaveBeenCalledWith({
      prompt: "hello",
      abortSignal: chunkSignal,
    });
    expect(session.continueTurn).toHaveBeenCalledWith({
      abortSignal: chunkSignal,
    });
    expect(boundaryReason).toHaveBeenCalledTimes(2);
    expect(beginChunk).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it("uses continueTurn when the driver starts without a new input", async () => {
    const session = {
      streamTurn: vi.fn(),
      continueTurn: vi.fn(() => stream({ type: "done" })),
    } as unknown as AgentHarnessSession;
    const consume = vi.fn(async () => undefined);

    await driveAgentHarnessTurnChunks({
      session,
      control: control(),
      consume,
    });

    expect(session.streamTurn).not.toHaveBeenCalled();
    expect(session.continueTurn).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it("stops after consume or afterStream asks it to stop", async () => {
    const session = {
      streamTurn: vi.fn(() => stream({ type: "done" })),
      continueTurn: vi.fn(() => stream({ type: "done" })),
    } as unknown as AgentHarnessSession;
    const afterStream = vi.fn(async () => "stop" as const);

    await driveAgentHarnessTurnChunks({
      session,
      input: { prompt: "hello" },
      control: control({ chunkBoundaryReason: () => "soft-timeout" }),
      consume: vi.fn(async () => undefined),
      afterStream,
    });
    expect(afterStream).toHaveBeenCalledTimes(1);
    expect(session.continueTurn).not.toHaveBeenCalled();

    await driveAgentHarnessTurnChunks({
      session,
      input: { prompt: "hello" },
      control: control(),
      consume: vi.fn(async () => "stop"),
      afterStream,
    });
    expect(afterStream).toHaveBeenCalledTimes(1);
    expect(session.streamTurn).toHaveBeenCalledTimes(2);
  });

  it("does not continue without a boundary or continuation method", async () => {
    const session = {
      streamTurn: vi.fn(() => stream({ type: "done" })),
    } as unknown as AgentHarnessSession;
    const beginChunk = vi.fn(() => new AbortController().signal);
    const consume = vi.fn(async () => undefined);

    await driveAgentHarnessTurnChunks({
      session,
      input: { prompt: "hello" },
      control: control({ chunkBoundaryReason: () => undefined, beginChunk }),
      consume,
    });
    await driveAgentHarnessTurnChunks({
      session,
      input: { prompt: "hello" },
      control: control({
        chunkBoundaryReason: () => "soft-timeout",
        beginChunk,
      }),
      consume,
    });

    expect(session.streamTurn).toHaveBeenCalledTimes(2);
    expect(beginChunk).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it("stops when the turn or next chunk is aborted", async () => {
    const turn = new AbortController();
    const nextChunk = new AbortController();
    nextChunk.abort();
    const session = {
      streamTurn: vi.fn(() => stream({ type: "done" })),
      continueTurn: vi.fn(() => stream({ type: "done" })),
    } as unknown as AgentHarnessSession;
    const beginChunk = vi.fn(() => nextChunk.signal);

    await driveAgentHarnessTurnChunks({
      session,
      input: { prompt: "hello" },
      control: control({
        turnSignal: turn.signal,
        chunkBoundaryReason: () => "soft-timeout",
        beginChunk,
      }),
      consume: vi.fn(async () => {
        turn.abort();
      }),
    });
    expect(beginChunk).not.toHaveBeenCalled();

    await driveAgentHarnessTurnChunks({
      session,
      input: { prompt: "hello" },
      control: control({
        chunkBoundaryReason: () => "soft-timeout",
        beginChunk,
      }),
      consume: vi.fn(async () => undefined),
    });
    expect(beginChunk).toHaveBeenCalledTimes(1);
    expect(session.continueTurn).not.toHaveBeenCalled();
  });
});
