import { describe, expect, it, vi } from "vitest";

import { executeAgentToolCall, type ActionEntry } from "./production-agent.js";

function action(
  run: ActionEntry["run"],
  options: Partial<ActionEntry> = {},
): ActionEntry {
  return {
    tool: {
      description: "Test action",
      parameters: {
        type: "object",
        properties: {
          value: { type: "string" },
        },
        required: ["value"],
      },
    },
    readOnly: true,
    run,
    ...options,
  };
}

describe("executeAgentToolCall", () => {
  it("uses the guarded agent loop to execute one action", async () => {
    const run = vi.fn(async ({ value }: { value: string }) => ({ value }));

    const result = await executeAgentToolCall({
      actions: { inspect: action(run) },
      name: "inspect",
      input: { value: "ready" },
      callId: "call-1",
    });

    expect(run).toHaveBeenCalledOnce();
    expect(result.status).toBe("completed");
    expect(JSON.parse(result.output)).toEqual({ value: "ready" });
  });

  it("keeps approval-gated actions paused", async () => {
    const run = vi.fn(async () => "should not run");

    const result = await executeAgentToolCall({
      actions: {
        publish: action(run, { readOnly: false, needsApproval: true }),
      },
      name: "publish",
      input: { value: "public" },
      callId: "call-2",
    });

    expect(run).not.toHaveBeenCalled();
    expect(result.status).toBe("approval_required");
    expect(result.output).toContain("Awaiting human approval");
    if (result.status === "approval_required") {
      expect(result.approvalKey).toBeTruthy();
    }
  });

  it("rejects invalid input before the action runs", async () => {
    const run = vi.fn(async () => "should not run");

    const result = await executeAgentToolCall({
      actions: { inspect: action(run) },
      name: "inspect",
      input: {},
      callId: "call-3",
    });

    expect(run).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.output).toContain("Invalid action parameters for inspect");
  });

  it("does not expose actions hidden from the agent", async () => {
    const run = vi.fn(async () => "hidden");

    const result = await executeAgentToolCall({
      actions: { hidden: action(run, { agentTool: false }) },
      name: "hidden",
      input: { value: "x" },
      callId: "call-4",
    });

    expect(run).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "failed",
      output: "Unknown or unavailable tool: hidden",
    });
  });

  it("attributes direct cross-app execution to the a2a caller", async () => {
    const run = vi.fn(async (_args, context) => context?.caller);

    const result = await executeAgentToolCall({
      actions: { inspect: action(run) },
      name: "inspect",
      input: { value: "ready" },
      callId: "call-a2a",
      caller: "a2a",
    });

    expect(run).toHaveBeenCalledWith(
      { value: "ready" },
      expect.objectContaining({ caller: "a2a" }),
    );
    expect(result).toMatchObject({ status: "completed", output: "a2a" });
  });
});
