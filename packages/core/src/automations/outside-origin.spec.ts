import { describe, expect, it } from "vitest";

import {
  actionExecutionStorage,
  type ActionExecutionFrame,
} from "../action-frame.js";
import type { ActionCaller } from "../action.js";
import { isOutsideAutomationOrigin } from "./outside-origin.js";

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

describe("Outside automation origin", () => {
  it("classifies explicit callers and fails closed without an origin", () => {
    expect(isOutsideAutomationOrigin({ caller: "mcp" })).toBe(true);
    expect(isOutsideAutomationOrigin({ caller: "frontend" })).toBe(false);
    expect(
      isOutsideAutomationOrigin({ caller: "tool", networkProtocol: "mcp" }),
    ).toBe(true);
    expect(
      isOutsideAutomationOrigin({ caller: "tool", networkProtocol: "a2a" }),
    ).toBe(true);
    expect(isOutsideAutomationOrigin()).toBe(true);
  });

  it("retains MCP origin through nested tool and frontend frames", () => {
    expect(actionExecutionStorage).toBeDefined();
    const nested = frame("frontend", frame("tool", frame("mcp")));
    actionExecutionStorage?.run(
      { frame: nested, failures: new WeakMap() },
      () => {
        expect(isOutsideAutomationOrigin({ caller: "frontend" })).toBe(true);
        expect(isOutsideAutomationOrigin()).toBe(true);
      },
    );
    actionExecutionStorage?.run(
      { frame: frame("tool", frame("frontend")), failures: new WeakMap() },
      () => {
        expect(isOutsideAutomationOrigin({ caller: "tool" })).toBe(false);
        expect(isOutsideAutomationOrigin()).toBe(false);
      },
    );
    expect(isOutsideAutomationOrigin()).toBe(true);
  });
});
