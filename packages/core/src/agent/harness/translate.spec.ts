import { describe, expect, it } from "vitest";

import {
  agentHarnessEventToAgentChatEvents,
  stringifyResult,
} from "./translate.js";

describe("agentHarnessEventToAgentChatEvents", () => {
  it("maps text, thinking, and activity events", () => {
    expect(
      agentHarnessEventToAgentChatEvents({ type: "text-delta", text: "hello" }),
    ).toEqual([{ type: "text", text: "hello" }]);
    expect(
      agentHarnessEventToAgentChatEvents({
        type: "thinking-delta",
        text: "considering",
      }),
    ).toEqual([{ type: "thinking", text: "considering" }]);
    expect(
      agentHarnessEventToAgentChatEvents({
        type: "activity",
        label: "Starting",
        tool: "harness",
      }),
    ).toEqual([{ type: "activity", label: "Starting", tool: "harness" }]);
  });

  it("normalizes tool input and preserves tool ids", () => {
    expect(
      agentHarnessEventToAgentChatEvents({
        type: "tool-start",
        id: "tool-1",
        name: "read_file",
        input: { path: "app.tsx", options: { lines: 20 } },
      }),
    ).toEqual([
      {
        type: "tool_start",
        id: "tool-1",
        tool: "read_file",
        input: { path: "app.tsx", options: '{\n  "lines": 20\n}' },
      },
    ]);

    expect(
      agentHarnessEventToAgentChatEvents({
        type: "tool-done",
        id: "tool-1",
        name: "read_file",
        input: { path: "app.tsx", options: { lines: 20 } },
        result: { ok: true },
      }),
    ).toEqual([
      {
        type: "tool_done",
        id: "tool-1",
        tool: "read_file",
        input: { path: "app.tsx", options: '{\n  "lines": 20\n}' },
        result: '{\n  "ok": true\n}',
      },
    ]);
  });

  it("maps harness approvals to the native approval contract", () => {
    expect(
      agentHarnessEventToAgentChatEvents({
        type: "approval-request",
        id: "approval-1",
        tool: "write_file",
        message: "Allow this write?",
        input: { path: "app.tsx" },
      }),
    ).toEqual([
      {
        type: "approval_required",
        tool: "write_file",
        input: { path: "app.tsx" },
        approvalKey: "approval-1",
        toolCallId: "approval-1",
      },
    ]);
  });

  it("projects harness lifecycle events into activities", () => {
    expect(
      agentHarnessEventToAgentChatEvents({
        type: "file-change",
        path: "src/app.tsx",
        operation: "update",
      }),
    ).toEqual([
      {
        type: "activity",
        label: "Updated src/app.tsx",
        tool: "harness:file",
      },
    ]);
    expect(
      agentHarnessEventToAgentChatEvents({
        type: "compaction",
        summary: "kept active plan",
      }),
    ).toEqual([
      {
        type: "activity",
        label: "Harness compacted context: kept active plan",
        tool: "harness:compaction",
      },
    ]);
  });

  it("drops non-rendered usage and done events", () => {
    expect(
      agentHarnessEventToAgentChatEvents({ type: "usage", totalTokens: 10 }),
    ).toEqual([]);
    expect(agentHarnessEventToAgentChatEvents({ type: "done" })).toEqual([]);
  });

  it("caps long stringified results", () => {
    const value = stringifyResult("x".repeat(13_000));
    expect(value).toContain("...[truncated at 12000 chars]");
    expect(value.length).toBeLessThan(12_100);
  });
});
