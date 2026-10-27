import { describe, expect, it } from "vitest";

import {
  actionExecutionStorage,
  type ActionExecutionFrame,
} from "../action-frame.js";
import type { ActionCaller } from "../action.js";
import { isMcpAutomationOrigin } from "./mcp-origin.js";

function frame(
  caller: ActionCaller,
  parent?: ActionExecutionFrame,
): ActionExecutionFrame {
  return {
    key: {},
    run: async () => undefined,
    handlerEntered: false,
    writeEntered: false,
    changeEntered: false,
    context: { caller },
    ...(parent ? { parent } : {}),
  };
}

describe("MCP automation origin", () => {
  it("requires MCP origin for a direct call", () => {
    expect(isMcpAutomationOrigin("mcp")).toBe(true);
    expect(isMcpAutomationOrigin("frontend")).toBe(false);
    expect(isMcpAutomationOrigin()).toBe(false);
  });

  it("retains MCP origin through nested tool and frontend frames", () => {
    expect(actionExecutionStorage).toBeDefined();
    const nested = frame("frontend", frame("tool", frame("mcp")));
    actionExecutionStorage?.run(
      { frame: nested, failures: new WeakMap() },
      () => {
        expect(isMcpAutomationOrigin("frontend")).toBe(true);
        expect(isMcpAutomationOrigin()).toBe(true);
      },
    );
    actionExecutionStorage?.run(
      { frame: frame("tool", frame("frontend")), failures: new WeakMap() },
      () => {
        expect(isMcpAutomationOrigin("tool")).toBe(false);
        expect(isMcpAutomationOrigin()).toBe(false);
      },
    );
    expect(isMcpAutomationOrigin()).toBe(false);
  });
});
