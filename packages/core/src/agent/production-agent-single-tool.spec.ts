import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentActionStopError } from "../action.js";
import type { AuditEvent } from "../audit/types.js";
import * as resourceStore from "../resources/store.js";
import { createResourceScriptEntries } from "../server/agent-chat/script-entries.js";
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

describe("native resources range delivery", () => {
  let entries: Record<string, ActionEntry>;
  let fixture: resourceStore.Resource;
  beforeEach(async () => {
    fixture = {
      id: "native-range-fixture",
      owner: "reader@example.test",
      path: "notes/native.md",
      content: "😀".repeat(100),
      mimeType: "text/plain",
      size: 400,
      createdAt: 0,
      updatedAt: 0,
      createdBy: "user",
      visibility: "workspace",
      threadId: null,
      runId: null,
      expiresAt: null,
      metadata: null,
    };
    vi.spyOn(resourceStore, "ensurePersonalDefaults").mockResolvedValue();
    vi.spyOn(resourceStore, "resourceGetByPath").mockImplementation(
      async () => fixture,
    );
    entries = await createResourceScriptEntries();
    expect(entries.resources).toBeDefined();
    entries.resources.maxResultChars = 64;
  });
  afterEach(() => vi.restoreAllMocks());

  const execute = (args: Record<string, unknown>) =>
    executeAgentToolCall({
      actions: entries,
      name: "resources",
      input: { action: "read", path: "notes/native.md", ...args },
      callId: "native-resource-range",
      ownerEmail: "reader@example.test",
    });

  it("delivers fitted plain text and an intact continuation footer through the real executor", async () => {
    const first = await execute({ offset: 0, limit: Number.MAX_SAFE_INTEGER });
    expect(first.status).toBe("completed");
    expect(first.output).toBe(
      "😀".repeat(4) +
        "\n\n...[Returned 8 characters; 200 total; next offset 8]",
    );
    expect(first.output.length).toBe(62);
    expect(first.output).not.toContain("...[truncated");
    const last = await execute({ offset: 196, limit: Number.MAX_SAFE_INTEGER });
    expect(last).toMatchObject({
      status: "completed",
      output: "😀😀\n\n[Returned 4 characters; end of resource]",
    });
  });

  it.each([
    { offset: "196", limit: "4" },
    { offset: 196, limit: 4, scope: null },
  ])(
    "normalizes range arguments through native admission: %j",
    async (args) => {
      expect(await execute(args)).toMatchObject({
        status: "completed",
        output: "😀😀\n\n[Returned 4 characters; end of resource]",
      });
    },
  );

  it.each([
    { offset: null, limit: null },
    { offset: false, limit: false },
    { offset: {}, limit: [] },
    { offset: "", limit: "" },
    { format: "" },
    { content: null },
    { includeAgentScratch: "false" },
  ])(
    "preserves ordinary reads after native normalization: %j",
    async (args) => {
      fixture.content = "ordinary whole text";
      expect(await execute(args)).toMatchObject({
        status: "completed",
        output: "ordinary whole text",
      });
    },
  );

  it("preserves native scalar coercion for ordinary paths", async () => {
    fixture.path = "12";
    fixture.content = "numeric path text";
    expect(await execute({ path: 12 })).toMatchObject({
      status: "completed",
      output: "numeric path text",
    });
    expect(resourceStore.resourceGetByPath).toHaveBeenCalledWith(
      "reader@example.test",
      "12",
    );
  });

  it("normalizes ordinary personal writes before the existing CLI adapter", async () => {
    const put = vi
      .spyOn(resourceStore, "resourcePut")
      .mockResolvedValue(fixture);
    expect(
      await execute({
        action: "write",
        scope: "personal",
        content: 42,
        offset: null,
        limit: null,
      }),
    ).toMatchObject({
      status: "completed",
      output: "Wrote resource: notes/native.md (400 bytes)",
    });
    expect(put).toHaveBeenCalledWith(
      "reader@example.test",
      "notes/native.md",
      "42",
      "text/markdown",
      expect.objectContaining({
        createdBy: "agent",
        visibility: "agent_scratch",
      }),
    );
  });

  it.each([
    { offset: 0 },
    { limit: 1 },
    { offset: null, limit: 1 },
    { action: "list", offset: 0, limit: 1 },
    { action: "write", content: "x", offset: 0, limit: 1 },
  ])("rejects invalid normalized range semantics: %j", async (args) => {
    const result = await execute(args);
    expect(result.status).toBe("failed");
    expect(result.output).toContain("errorCode: invalid_resource_range");
    expect(resourceStore.resourceGetByPath).not.toHaveBeenCalled();
    expect(resourceStore.ensurePersonalDefaults).not.toHaveBeenCalled();
  });

  it.each([
    { offset: 0, limit: 0 },
    { offset: -1, limit: 1 },
    { offset: 0.5, limit: 1 },
    { offset: 0, limit: Number.MAX_SAFE_INTEGER + 1 },
    { offset: "not-a-number", limit: 1 },
    { scope: "invalid" },
    { action: "invalid" },
  ])(
    "rejects schema-invalid input after native normalization: %j",
    async (args) => {
      const result = await execute(args);
      expect(result.status).toBe("failed");
      expect(result.output).toContain(
        "Invalid action parameters for resources",
      );
      expect(resourceStore.resourceGetByPath).not.toHaveBeenCalled();
      expect(resourceStore.ensurePersonalDefaults).not.toHaveBeenCalled();
    },
  );

  it("delivers the whole image URL at the exact allowance without a footer or truncation", async () => {
    fixture.mimeType = "image/png";
    fixture.content = "https://example.test/" + "😀".repeat(19) + "a.png";
    expect(fixture.content.length).toBe(64);
    const result = await execute({ offset: Number.MAX_SAFE_INTEGER, limit: 1 });
    expect(result).toMatchObject({
      status: "completed",
      output: fixture.content,
    });
    expect(result.output.length).toBe(64);
    expect(result.output).not.toContain("...[Returned");
    expect(result.output).not.toContain("...[truncated");
  });

  it("fails with the typed budget code when the whole image URL exceeds the allowance", async () => {
    fixture.mimeType = "image/png";
    fixture.content = "https://example.test/" + "😀".repeat(19) + "ab.png";
    expect(fixture.content.length).toBe(65);
    const result = await execute({ offset: 1, limit: 1 });
    expect(result.status).toBe("failed");
    expect(result.output).toContain(
      "errorCode: resource_range_budget_too_small",
    );
    expect(result.output).not.toContain(fixture.content.slice(0, 64));
  });

  it("preserves ordinary native read output and empty capture semantics", async () => {
    fixture.content = "ordinary whole text";
    expect(await execute({})).toMatchObject({
      status: "completed",
      output: "ordinary whole text",
    });
    fixture.content = "";
    expect(await execute({})).toMatchObject({
      status: "completed",
      output: "(no output)",
    });
  });

  it("delivers a whole PDF reference and fails rather than truncating an oversized reference", async () => {
    fixture.mimeType = "application/pdf";
    fixture.content = "https://example.test/" + "a".repeat(39) + ".pdf";
    expect(
      await execute({ offset: Number.MAX_SAFE_INTEGER, limit: 1 }),
    ).toMatchObject({
      status: "completed",
      output: fixture.content,
    });
    fixture.content += "x";
    const result = await execute({ offset: 1, limit: 1 });
    expect(result.status).toBe("failed");
    expect(result.output).toContain(
      "errorCode: resource_range_budget_too_small",
    );
  });
});

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
