import { defineMachine } from "@agent-native/core/state-machine";

/**
 * Lifecycle of one agent request on a review thread. Every transition is a
 * compare-and-set in `review-agent.ts`; a request that already finished never
 * moves again, and the next human action starts a new request.
 */
export const reviewAgentMachine = defineMachine({
  id: "design-review-agent-request",
  states: [
    "classifying",
    "queued",
    "running",
    "replied",
    "suggested",
    "applied",
    "needs-input",
    "failed",
    "cancelled",
  ],
  initial: "classifying",
  terminal: [
    "replied",
    "suggested",
    "applied",
    "needs-input",
    "failed",
    "cancelled",
  ],
  transitions: {
    classified: { from: ["classifying"], to: "queued" },
    begin: { from: ["queued"], to: "running" },
    reply: { from: ["running"], to: "replied" },
    suggest: { from: ["running"], to: "suggested" },
    apply: { from: ["running"], to: "applied" },
    needInput: {
      from: ["classifying", "queued", "running"],
      to: "needs-input",
    },
    fail: { from: ["classifying", "queued", "running"], to: "failed" },
    cancel: { from: ["classifying", "queued", "running"], to: "cancelled" },
  },
});

export type ReviewAgentEvent = Parameters<
  typeof reviewAgentMachine.fromStates
>[0];
