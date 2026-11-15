import { defineMachine } from "../state-machine/index.js";

// Expiry and execution fencing remain SQL guards: an expired pending request
// may still be denied, but it can never authorize an action.
export const agentToolApprovalMachine = defineMachine({
  id: "agent-tool-approval",
  states: ["pending", "consumed", "denied"],
  initial: "pending",
  terminal: ["consumed", "denied"],
  transitions: {
    consume: { from: ["pending"], to: "consumed" },
    deny: { from: ["pending"], to: "denied" },
  },
});
