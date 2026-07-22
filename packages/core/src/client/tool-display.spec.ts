import { describe, expect, it } from "vitest";

import {
  humanizeToolLabelText,
  humanizeToolName,
  isCallAgentToolCallShadowed,
  runningToolLabel,
  shadowedCallAgentToolCallIds,
} from "./tool-display.js";

describe("tool display labels", () => {
  it("humanizes dashed, underscored, and MCP tool names", () => {
    expect(humanizeToolName("generate-design")).toBe("generate design");
    expect(humanizeToolName("list_files")).toBe("list files");
    expect(humanizeToolName("mcp__codex_apps__figma___get_screenshot")).toBe(
      "get screenshot",
    );
  });

  it("uses user-facing labels for Design screen tools", () => {
    expect(humanizeToolName("delete-file")).toBe("remove screen");
    expect(humanizeToolName("get-design-snapshot")).toBe("get screen snapshot");
    expect(humanizeToolName("edit-design")).toBe("edit screen");
  });

  it("uses humanized names in running labels", () => {
    expect(runningToolLabel("generate-design")).toBe("Running generate design");
  });

  it("humanizes tool names inside activity labels without changing the verb", () => {
    expect(
      humanizeToolLabelText(
        "Preparing get-design-snapshot action",
        "get-design-snapshot",
      ),
    ).toBe("Preparing get screen snapshot action");
  });

  it("shadows the raw call-agent row when its richer agent row is present", () => {
    const parts = [
      {
        type: "tool-call",
        toolCallId: "call-analytics",
        toolName: "call-agent",
        args: { agent: "analytics", message: "Count signups" },
      },
      {
        type: "tool-call",
        toolCallId: "agent-analytics",
        toolName: "agent:Analytics",
        args: {},
      },
    ];

    expect(isCallAgentToolCallShadowed(parts, 0)).toBe(true);
    expect(shadowedCallAgentToolCallIds(parts)).toEqual(
      new Set(["call-analytics"]),
    );
  });

  it("shadows a streaming call-agent row whose arguments only exist as text", () => {
    const parts = [
      {
        type: "tool-call",
        toolCallId: "call-analytics",
        toolName: "call-agent",
        argsText: JSON.stringify({
          agent: "analytics",
          message: "Count signups",
        }),
        args: {},
      },
      {
        type: "tool-call",
        toolCallId: "agent-analytics",
        toolName: "agent:Analytics",
        argsText: "",
        args: {},
      },
    ];

    expect(isCallAgentToolCallShadowed(parts, 0)).toBe(true);
    expect(shadowedCallAgentToolCallIds(parts)).toEqual(
      new Set(["call-analytics"]),
    );
  });

  it("keeps unmatched and differently targeted call-agent rows visible", () => {
    const unmatched = [
      {
        type: "tool-call",
        toolCallId: "call-analytics",
        toolName: "call-agent",
        args: { agent: "analytics" },
      },
    ];
    const differentTarget = [
      ...unmatched,
      {
        type: "tool-call",
        toolCallId: "agent-slides",
        toolName: "agent:Slides",
        args: {},
      },
    ];

    expect(isCallAgentToolCallShadowed(unmatched, 0)).toBe(false);
    expect(isCallAgentToolCallShadowed(differentTarget, 0)).toBe(false);
    expect(shadowedCallAgentToolCallIds(differentTarget)).toEqual(new Set());
  });
});
