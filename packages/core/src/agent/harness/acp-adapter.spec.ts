import { describe, expect, it } from "vitest";

import {
  acpSessionUpdateToEvents,
  chooseAcpPermissionOption,
  createAcpStdioHarnessAdapter,
} from "./acp-adapter.js";

describe("createAcpStdioHarnessAdapter", () => {
  it("returns an adapter with default name and capabilities", () => {
    const adapter = createAcpStdioHarnessAdapter();
    expect(adapter.name).toBe("acp:stdio");
    expect(adapter.label).toBe("ACP stdio");
    expect(adapter.capabilities.resumable).toBe(true);
    expect(adapter.capabilities.sandbox).toBe(true);
    expect(adapter.capabilities.approvals).toBe(true);
    expect(adapter.capabilities.fileEvents).toBe(true);
  });

  it("accepts name/label/description overrides", () => {
    const adapter = createAcpStdioHarnessAdapter({
      name: "acp:my-agent",
      label: "My Agent",
      description: "Custom ACP agent",
    });
    expect(adapter.name).toBe("acp:my-agent");
    expect(adapter.label).toBe("My Agent");
    expect(adapter.description).toBe("Custom ACP agent");
  });
});

describe("acpSessionUpdateToEvents", () => {
  it("maps agent_message_chunk text to text-delta", () => {
    const events = acpSessionUpdateToEvents({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello!" },
    } as any);
    expect(events).toEqual([{ type: "text-delta", text: "Hello!" }]);
  });

  it("maps agent_message_chunk with image content to text-delta with placeholder", () => {
    const events = acpSessionUpdateToEvents({
      sessionUpdate: "agent_message_chunk",
      content: { type: "image", uri: "https://example.com/img.png" },
    } as any);
    expect(events).toEqual([
      { type: "text-delta", text: "[image: https://example.com/img.png]" },
    ]);
  });

  it("maps agent_thought_chunk text to thinking-delta", () => {
    const events = acpSessionUpdateToEvents({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Let me think..." },
    } as any);
    expect(events).toEqual([
      { type: "thinking-delta", text: "Let me think..." },
    ]);
  });

  it("maps tool_call to tool-start", () => {
    const events = acpSessionUpdateToEvents({
      sessionUpdate: "tool_call",
      toolCallId: "call_1",
      title: "Read file",
      kind: "read",
      status: "pending",
      locations: [{ path: "/src/index.ts" }],
      rawInput: { path: "/src/index.ts" },
    } as any);
    expect(events).toEqual([
      {
        type: "tool-start",
        id: "call_1",
        name: "Read file",
        input: { path: "/src/index.ts" },
      },
    ]);
  });

  it("maps tool_call_update completed to tool-done + file-change", () => {
    const events = acpSessionUpdateToEvents({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_2",
      title: "Edit file",
      kind: "edit",
      status: "completed",
      locations: [{ path: "/src/foo.ts" }],
      rawOutput: { written: true },
    } as any);
    expect(events).toEqual([
      {
        type: "tool-done",
        id: "call_2",
        name: "Edit file",
        result: { written: true },
      },
      {
        type: "file-change",
        path: "/src/foo.ts",
        operation: "update",
      },
    ]);
  });

  it("maps tool_call_update failed to tool-done without file-change", () => {
    const events = acpSessionUpdateToEvents({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_3",
      title: "shell",
      kind: "shell",
      status: "failed",
      rawOutput: { error: "ENOENT" },
    } as any);
    expect(events).toEqual([
      {
        type: "tool-done",
        id: "call_3",
        name: "shell",
        result: { error: "ENOENT" },
      },
    ]);
  });

  it("maps plan update to activity", () => {
    const events = acpSessionUpdateToEvents({
      sessionUpdate: "plan",
      entries: [
        { content: "Step 1", priority: "high", status: "pending" },
        { content: "Step 2", priority: "low", status: "pending" },
      ],
    } as any);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("activity");
    expect((events[0] as any).label).toContain("Step 1");
  });

  it("maps plan_removed to activity", () => {
    const events = acpSessionUpdateToEvents({
      sessionUpdate: "plan_removed",
      id: "plan-abc",
    } as any);
    expect(events).toEqual([
      {
        type: "activity",
        tool: "harness:plan",
        label: "Removed plan plan-abc",
      },
    ]);
  });

  it("maps usage_update to usage event", () => {
    const events = acpSessionUpdateToEvents({
      sessionUpdate: "usage_update",
      used: 1500,
      size: 8000,
      cost: { amount: 0.05, currency: "USD" },
    } as any);
    expect(events).toEqual([
      { type: "usage", totalTokens: 1500, costCents: 5 },
    ]);
  });

  it("returns empty array for non-content update types", () => {
    for (const sessionUpdate of [
      "available_commands_update",
      "config_option_update",
      "current_mode_update",
      "session_info_update",
      "user_message_chunk",
    ]) {
      const events = acpSessionUpdateToEvents({
        sessionUpdate,
        content: { type: "text", text: "ignored" },
      } as any);
      expect(events).toEqual([]);
    }
  });
});

describe("chooseAcpPermissionOption", () => {
  function makeRequest(kind: string) {
    return {
      sessionId: "s1",
      toolCall: { toolCallId: "t1", kind, status: "pending" as const },
      options: [
        { kind: "allow_once", name: "Allow once", optionId: "allow_once" },
        {
          kind: "allow_always",
          name: "Always allow",
          optionId: "allow_always",
        },
        { kind: "reject_once", name: "Reject", optionId: "reject_once" },
      ],
    };
  }

  it("allow-reads: allows read tools", () => {
    const result = chooseAcpPermissionOption(
      makeRequest("read"),
      "allow-reads",
    );
    expect(result.outcome.outcome).toBe("selected");
    expect((result.outcome as any).optionId).toMatch(/allow/);
  });

  it("allow-reads: rejects edit tools", () => {
    const result = chooseAcpPermissionOption(
      makeRequest("edit"),
      "allow-reads",
    );
    expect(result.outcome.outcome).toBe("selected");
    expect((result.outcome as any).optionId).toBe("reject_once");
  });

  it("allow-edits: allows read and edit tools", () => {
    for (const kind of ["read", "edit"]) {
      const result = chooseAcpPermissionOption(
        makeRequest(kind),
        "allow-edits",
      );
      expect(result.outcome.outcome).toBe("selected");
      expect((result.outcome as any).optionId).toMatch(/allow/);
    }
  });

  it("allow-edits: rejects shell tools", () => {
    const result = chooseAcpPermissionOption(
      makeRequest("shell"),
      "allow-edits",
    );
    expect(result.outcome.outcome).toBe("selected");
    expect((result.outcome as any).optionId).toBe("reject_once");
  });

  it("allow-all: allows everything", () => {
    for (const kind of ["read", "edit", "shell", "unknown"]) {
      const result = chooseAcpPermissionOption(makeRequest(kind), "allow-all");
      expect(result.outcome.outcome).toBe("selected");
      expect((result.outcome as any).optionId).toMatch(/allow/);
    }
  });

  it("returns cancelled when no options available", () => {
    const request = {
      sessionId: "s1",
      toolCall: { toolCallId: "t1", kind: "read", status: "pending" as const },
      options: [],
    };
    const result = chooseAcpPermissionOption(request, "allow-reads");
    expect(result.outcome.outcome).toBe("cancelled");
  });
});
