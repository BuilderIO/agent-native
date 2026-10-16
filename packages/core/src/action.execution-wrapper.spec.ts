import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineAction, runActionWithExecutionOutcome } from "./action.js";
import { loadActionsFromStaticRegistry } from "./server/action-discovery.js";

// An app may wrap `run` with `{ ...entry, run }` (design's reprompt guard does).
// The wrapper must not turn a pre-handler refusal into an "unknown" write.
function wrapRun<T extends { run: (args: any, ctx?: any) => Promise<any> }>(
  entry: T,
  before?: () => void,
): T {
  return {
    ...entry,
    run: async (args: any, ctx?: any) => {
      before?.();
      return entry.run(args, ctx);
    },
  };
}

describe("action execution through a wrapped run", () => {
  const make = (effects: string[]) =>
    defineAction({
      description: "Write",
      schema: z.object({ id: z.string() }),
      run: async ({ id }) => {
        effects.push(id);
        throw new Error("connection reset after write");
      },
    });

  it("refuses invalid input of an unwrapped action", async () => {
    const effects: string[] = [];
    const outcome = { refused: false };
    await expect(
      runActionWithExecutionOutcome(
        make(effects).run,
        { id: 5 },
        { caller: "tool" },
        outcome,
      ),
    ).rejects.toThrow();
    expect(effects).toEqual([]);
    expect(outcome.refused).toBe(true);
  });

  it("refuses invalid input of a wrapped action", async () => {
    const effects: string[] = [];
    const entry = wrapRun(make(effects));
    const outcome = { refused: false };
    await expect(
      runActionWithExecutionOutcome(
        entry.run,
        { id: 5 },
        { caller: "tool" },
        outcome,
        entry,
      ),
    ).rejects.toThrow();
    expect(effects).toEqual([]);
    expect(outcome.refused).toBe(true);
  });

  it("refuses a wrapper that throws before the handler can start", async () => {
    const effects: string[] = [];
    const entry = wrapRun(make(effects), () => {
      throw new Error("preview-only turn");
    });
    const outcome = { refused: false };
    await expect(
      runActionWithExecutionOutcome(
        entry.run,
        { id: "a" },
        { caller: "tool" },
        outcome,
        entry,
      ),
    ).rejects.toThrow("preview-only turn");
    expect(effects).toEqual([]);
    expect(outcome.refused).toBe(true);
  });

  it("keeps a handler failure after a write unknown when wrapped", async () => {
    const effects: string[] = [];
    const entry = wrapRun(make(effects));
    const outcome = { refused: true };
    await expect(
      runActionWithExecutionOutcome(
        entry.run,
        { id: "a" },
        { caller: "tool" },
        outcome,
        entry,
      ),
    ).rejects.toThrow("connection reset after write");
    expect(effects).toEqual(["a"]);
    expect(outcome.refused).toBe(false);
  });

  it("does not certify a hand-built entry with no execution key", async () => {
    const outcome = { refused: true };
    await expect(
      runActionWithExecutionOutcome(
        async () => {
          throw new Error("boom");
        },
        {},
        { caller: "tool" },
        outcome,
        { run: async () => undefined },
      ),
    ).rejects.toThrow("boom");
    expect(outcome.refused).toBe(false);
  });

  it("keeps the key through the production registry rebuild", async () => {
    const effects: string[] = [];
    const registry = loadActionsFromStaticRegistry({
      "rename-screen": { default: make(effects) },
    });
    const entry = wrapRun(registry["rename-screen"]!);
    const outcome = { refused: false };
    await expect(
      runActionWithExecutionOutcome(
        entry.run,
        { id: 5 },
        { caller: "tool" },
        outcome,
        entry,
      ),
    ).rejects.toThrow();
    expect(effects).toEqual([]);
    expect(outcome.refused).toBe(true);
  });
});
