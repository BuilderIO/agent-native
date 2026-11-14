import { describe, expect, it } from "vitest";

import { StateMachineError } from "../state-machine/index.js";
import { agentToolApprovalMachine } from "./tool-approval-lifecycle.js";

describe("one-time tool approval lifecycle", () => {
  it.each([
    ["consume", "consumed"],
    ["deny", "denied"],
  ] as const)("%s settles only an unresolved request", (event, outcome) => {
    expect(agentToolApprovalMachine.initial).toBe("pending");
    expect(agentToolApprovalMachine.isTerminal("pending")).toBe(false);
    expect(agentToolApprovalMachine.transition("pending", event)).toBe(outcome);
    expect(agentToolApprovalMachine.sqlIn(event)).toMatchObject({
      sql: "(?)",
      args: ["pending"],
    });

    for (const settled of ["consumed", "denied"] as const) {
      expect(agentToolApprovalMachine.isTerminal(settled)).toBe(true);
      expect(agentToolApprovalMachine.can(settled, event)).toBe(false);
      expect(() => agentToolApprovalMachine.transition(settled, event)).toThrow(
        StateMachineError,
      );
    }
  });
});
