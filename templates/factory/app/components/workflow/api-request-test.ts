import {
  canTestWithoutItems,
  type WorkflowCatalog,
  type WorkflowNode,
} from "@/lib/workflow-editor";
import { requestPathOf } from "@/lib/workflow-editor/api-request";

import type { LiveAnswer } from "./node-details/api-request-output";

/**
 * Whether Test step sends this step's request in the window and shows its whole
 * answer: an API request that reads nothing about an item. Every other step is
 * tested in a run, which keeps only a short record of what it did.
 */
export function canTestRequestOnItsOwn(
  node: WorkflowNode,
  catalog: WorkflowCatalog,
): boolean {
  return (
    requestPathOf(node, catalog) !== undefined && canTestWithoutItems(node)
  );
}

/**
 * The test in this window. The answer is customer data held in memory only: it
 * belongs to one step and goes with the window, so a state names its node and
 * every way of leaving it (another step, a closed window) clears it.
 */
export type LiveTest =
  | { phase: "idle" }
  | { phase: "running"; nodeId: string; token: number }
  | { phase: "done"; nodeId: string; token: number; answer: LiveAnswer };

export type LiveTestEvent =
  | { type: "start"; nodeId: string; token: number }
  | { type: "finish"; nodeId: string; token: number; answer: LiveAnswer }
  /** The save before the test was refused, so nothing was sent. */
  | { type: "abandon"; nodeId: string; token: number }
  | { type: "clear" };

export const IDLE: LiveTest = { phase: "idle" };

export function liveTestReducer(
  state: LiveTest,
  event: LiveTestEvent,
): LiveTest {
  switch (event.type) {
    case "start":
      // A new test replaces whatever was shown, at once.
      return { phase: "running", nodeId: event.nodeId, token: event.token };
    case "finish":
      // An answer that comes back after the window moved on is dropped, not shown on another step.
      return state.phase === "running" &&
        state.nodeId === event.nodeId &&
        state.token === event.token
        ? {
            phase: "done",
            nodeId: event.nodeId,
            token: event.token,
            answer: event.answer,
          }
        : state;
    case "abandon":
      return state.phase === "running" &&
        state.nodeId === event.nodeId &&
        state.token === event.token
        ? IDLE
        : state;
    case "clear":
      return state.phase === "idle" ? state : IDLE;
  }
}

/** The test as the step open now sees it: nothing, unless it is this step's. */
export function liveTestFor(
  state: LiveTest,
  nodeId: string | undefined,
): LiveTest {
  return state.phase !== "idle" && state.nodeId === nodeId ? state : IDLE;
}

/** The longest request a step may make is 60 seconds; the rest is room for the answer to come back. */
export const REQUEST_TIMEOUT_MS = 75_000;

/** What the Output column draws for a test: the skeleton while the request is in flight, then its answer or its failure. */
export type LiveOutput =
  | { kind: "skeleton" }
  | { kind: "answer"; answer: Extract<LiveAnswer, { kind: "answer" }> }
  | { kind: "failure"; answer: Extract<LiveAnswer, { kind: "failed" }> };

export function liveOutputOf(
  test: Exclude<LiveTest, { phase: "idle" }>,
): LiveOutput {
  if (test.phase === "running") return { kind: "skeleton" };
  return test.answer.kind === "answer"
    ? { kind: "answer", answer: test.answer }
    : { kind: "failure", answer: test.answer };
}
