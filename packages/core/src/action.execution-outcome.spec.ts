import { describe, expect, it, vi } from "vitest";

vi.mock("./shared/optional-node-builtins.js", () => ({
  getAsyncLocalStorageCtor: () => undefined,
}));

import { runActionInvocation } from "./action-invocation.js";
import {
  AgentConnectionRequiredError,
  defineAction,
  runActionWithExecutionOutcome,
} from "./action.js";
import { auditAttribution } from "./audit/attribution.js";

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

  it("records no approval or override it cannot tie to one invocation", async () => {
    const seen: unknown[] = [];
    const action = defineAction({
      description: "Approved write",
      audit: { enabled: false },
      run: async (_args, ctx) => {
        const { approval, approvedToolCallKey, mcpClientAccepted, threadId } =
          auditAttribution(ctx);
        seen.push({
          approval,
          approvedToolCallKey,
          mcpClientAccepted,
          threadId,
        });
        return ctx?.approvedToolCallKey;
      },
    });

    const result = await runActionInvocation(
      action,
      {},
      { caller: "tool", threadId: "run-thread", approvedToolCallKey: "key" },
      {
        approvedToolCallKey: "key",
        mcpClientAccepted: true,
        auditOverride: { threadId: "task", approval: "a2a-review" },
      },
    );

    // The approval gate still sees the key; the audit trail records none.
    expect(result).toBe("key");
    expect(seen).toEqual([
      {
        approval: undefined,
        approvedToolCallKey: undefined,
        mcpClientAccepted: undefined,
        threadId: "run-thread",
      },
    ]);
  });
});
