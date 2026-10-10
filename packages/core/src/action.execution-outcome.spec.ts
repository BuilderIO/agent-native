import { describe, expect, it, vi } from "vitest";

vi.mock("./shared/optional-node-builtins.js", () => ({
  getAsyncLocalStorageCtor: () => undefined,
}));

import {
  AgentConnectionRequiredError,
  defineAction,
  runActionWithExecutionOutcome,
} from "./action.js";

describe("action execution without async ancestry", () => {
  it("keeps a nested refusal unknown when the parent write already started", async () => {
    const failure = new AgentConnectionRequiredError("Connect provider", {
      provider: "test-child",
    });
    const child = defineAction({
      description: "Child",
      run: async () => {
        throw failure;
      },
    });
    const effects: string[] = [];
    const parent = defineAction({
      description: "Parent write",
      run: async () => {
        effects.push("sent");
        return child.run({});
      },
    });
    const outcome = { refused: true };
    await expect(
      runActionWithExecutionOutcome(
        parent.run,
        {},
        { caller: "tool" },
        outcome,
      ),
    ).rejects.toBe(failure);
    expect(effects).toEqual(["sent"]);
    expect(outcome.refused).toBe(false);
  });
});
