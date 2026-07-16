import { describe, expect, it, vi } from "vitest";

import { createActionInvocationDescriptor } from "../action-execution.js";
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
    const run = vi.fn(
      async (
        { value }: { value: string },
        ctx?: import("../action.js").ActionRunContext,
      ) => ({
        value,
        invocation: ctx?.invocation,
      }),
    );

    const result = await executeAgentToolCall({
      actions: { inspect: action(run) },
      name: "inspect",
      input: { value: "ready" },
      callId: "call-1",
    });

    expect(run).toHaveBeenCalledOnce();
    expect(result.status).toBe("completed");
    expect(JSON.parse(result.output)).toEqual({
      value: "ready",
      invocation: { version: 1, origin: "voice", capabilities: [] },
    });
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

  it("fails protected voice actions closed without a resolver", async () => {
    const run = vi.fn(async () => "must not run hosted");
    const result = await executeAgentToolCall({
      actions: {
        private: action(run, {
          resourcePrivacy: {
            mode: "protected",
            resourceType: "document",
            placement: "enrolled_broker",
          },
        }),
      },
      name: "private",
      input: { value: "secret" },
      callId: "call-private-denied",
    });

    expect(run).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.output).toContain(
      "requires an eligible enrolled_broker resolver",
    );
  });

  it("routes protected loop calls with their strict origin and capabilities", async () => {
    const run = vi.fn(async () => "must not run hosted");
    const resolve = vi.fn(async (request: any) => ({
      status: "executed" as const,
      placement: "enrolled_broker" as const,
      result: {
        brokered: true,
        invocation: request.invocation,
      },
    }));
    const result = await executeAgentToolCall({
      actions: {
        private: action(run, {
          resourcePrivacy: {
            mode: "protected",
            resourceType: "document",
            placement: "enrolled_broker",
          },
        }),
      },
      name: "private",
      input: { value: "ciphertext" },
      callId: "call-private-brokered",
      invocation: createActionInvocationDescriptor("job", [
        "documents:read",
        "documents:read",
      ]),
      actionExecutionResolver: {
        placements: ["enrolled_broker"],
        resolve,
      },
    });

    expect(run).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledOnce();
    expect(result.status).toBe("completed");
    expect(JSON.parse(result.output)).toEqual({
      brokered: true,
      invocation: {
        version: 1,
        origin: "job",
        capabilities: ["documents:read"],
      },
    });
  });

  it.each([
    "mcp",
    "a2a",
    "agent-chat",
    "agent-team",
    "job",
    "trigger",
    "integration",
    "voice",
  ] as const)("preserves the %s loop invocation origin", async (origin) => {
    const run = vi.fn(
      async (_args, ctx?: import("../action.js").ActionRunContext) =>
        ctx?.invocation,
    );
    const result = await executeAgentToolCall({
      actions: { inspect: action(run) },
      name: "inspect",
      input: { value: "ready" },
      callId: `call-${origin}`,
      invocation: createActionInvocationDescriptor(origin, ["fixture:read"]),
    });

    expect(result.status).toBe("completed");
    expect(JSON.parse(result.output)).toEqual({
      version: 1,
      origin,
      capabilities: ["fixture:read"],
    });
  });
});
