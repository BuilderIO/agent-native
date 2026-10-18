import { describe, expect, it, vi } from "vitest";

import { AgentActionStopError } from "../action.js";
import type { AuditEvent } from "../audit/types.js";
import { runWithRequestContext } from "../server/request-context.js";
import type { AgentEngine } from "./engine/types.js";
import {
  actionsToEngineTools,
  executeAgentToolCall,
  runAgentLoop,
  type ActionEntry,
} from "./production-agent.js";

const auditRows = vi.hoisted(() => [] as AuditEvent[]);

vi.mock("../audit/store.js", () => ({
  insertAuditEvent: async (event: AuditEvent) => {
    auditRows.push(event);
  },
}));

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
    const send = vi.fn();

    const result = await executeAgentToolCall({
      actions: { inspect: action(run) },
      name: "inspect",
      input: { value: "ready" },
      callId: "call-1",
      send,
    });

    expect(run).toHaveBeenCalledOnce();
    expect(result.status).toBe("completed");
    expect(JSON.parse(result.output)).toEqual({ value: "ready" });
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "text",
        text: "Tool execution complete.",
      }),
    );
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "loop_limit" }),
    );
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

  it("returns terminal action errors from the nested tool run", async () => {
    const run = vi.fn(async () => {
      throw new AgentActionStopError("This action cannot proceed", {
        errorCode: "permanent_precondition",
      });
    });
    const send = vi.fn();

    const result = await executeAgentToolCall({
      actions: { publish: action(run, { readOnly: false }) },
      name: "publish",
      input: { value: "public" },
      callId: "call-terminal-stop",
      send,
    });

    expect(run).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "failed",
      terminalError: {
        type: "error",
        errorCode: "permanent_precondition",
        recoverable: false,
      },
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        errorCode: "permanent_precondition",
        recoverable: false,
      }),
    );
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
    const run = vi.fn(async (_args, context) =>
      JSON.stringify({ appId: context?.appId, caller: context?.caller }),
    );

    const result = await executeAgentToolCall({
      actions: { inspect: action(run) },
      name: "inspect",
      input: { value: "ready" },
      callId: "call-a2a",
      caller: "a2a",
      appId: "mail",
    });

    expect(run).toHaveBeenCalledWith(
      { value: "ready" },
      expect.objectContaining({ appId: "mail", caller: "a2a" }),
    );
    expect(result).toMatchObject({
      status: "completed",
      output: JSON.stringify({ appId: "mail", caller: "a2a" }),
    });
  });

  it("records an approval pause with the loop's run and network ids", async () => {
    auditRows.length = 0;
    const run = vi.fn(async () => "should not run");
    const actions = {
      publish: action(run, { readOnly: false, needsApproval: true }),
    };
    let calls = 0;
    const engine = {
      name: "test",
      label: "Test",
      defaultModel: "test",
      supportedModels: ["test"],
      capabilities: {},
      async *stream() {
        calls += 1;
        if (calls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "call-pause",
                name: "publish",
                input: { value: "public" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield { type: "stop", reason: "end_turn" };
      },
    } as unknown as AgentEngine;
    const tools = actionsToEngineTools(actions);

    await runWithRequestContext({ userEmail: "owner@example.test" }, () =>
      runAgentLoop({
        engine,
        model: "test",
        systemPrompt: "Run the tool.",
        tools,
        availableTools: tools,
        messages: [{ role: "user", content: [{ type: "text", text: "Go" }] }],
        actions,
        send: () => {},
        signal: new AbortController().signal,
        // An A2A task's loop sets no caller, so its rows record `tool`.
        networkProtocol: "a2a",
        networkId: "task-9",
        runId: "task-9",
        executionMode: "act",
        maxIterations: 2,
      }),
    );

    expect(run).not.toHaveBeenCalled();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "publish",
      status: "denied",
      caller: "tool",
      actorEmail: "owner@example.test",
      runId: "task-9",
      networkProtocol: "a2a",
      networkId: "task-9",
    });
  });
});
