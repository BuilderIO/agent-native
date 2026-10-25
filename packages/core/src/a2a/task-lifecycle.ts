import { defineMachine, type Machine } from "../state-machine/index.js";
import type { TaskState } from "./types.js";

/**
 * Lifecycles of `a2a_tasks.status_state` and `a2a_approvals.status`.
 *
 * Each event is one UPDATE in task-store.ts, named on its line. Status lists
 * and targets in that SQL come from these machines (`taskIn`, `taskTarget`,
 * and their approval twins), so the event tables are the only place they live.
 */

const TASK_STATES = [
  "submitted",
  "working",
  "processing",
  "completed",
  "failed",
  "canceled",
  "input-required",
] as const;

export const a2aTaskMachine = defineMachine({
  id: "a2a-task",
  states: TASK_STATES,
  initial: "submitted",
  // Empty on purpose: updateTask has no status guard, so the SQL moves
  // completed and failed rows out of their state too.
  terminal: [],
  transitions: {
    // claimA2ATaskForProcessing
    claimForProcessing: { from: ["submitted", "working"], to: "processing" },
    // claimA2AApproval
    resumeAfterApproval: {
      from: ["input-required", "working"],
      to: "working",
    },
    // pauseProcessingA2ATask
    requireInput: { from: ["processing"], to: "input-required" },
    // resetStuckA2ATaskForRetry
    retryStuck: { from: ["processing"], to: "working" },
    // settleA2AApproval, with the settled approval status
    completeApproval: { from: ["working"], to: "completed" },
    failApproval: { from: ["working"], to: "failed" },
    // settleProcessingA2ATask, with update.state
    completeProcessing: { from: ["processing"], to: "completed" },
    failProcessing: { from: ["processing"], to: "failed" },
    // failStuckA2ATask
    failStuckProcessing: { from: ["processing"], to: "failed" },
    // failStuckQueuedA2ATask
    failStuckQueued: { from: ["submitted", "working"], to: "failed" },
    // failStaleA2ATask
    failStale: { from: ["submitted", "working", "processing"], to: "failed" },
    // cancelA2ATask: final states are not cancelable
    cancel: {
      from: ["submitted", "working", "processing", "input-required"],
      to: "canceled",
    },
    // updateTask, with update.state: no status guard in the SQL
    overwriteAsSubmitted: { from: TASK_STATES, to: "submitted" },
    overwriteAsWorking: { from: TASK_STATES, to: "working" },
    overwriteAsProcessing: { from: TASK_STATES, to: "processing" },
    overwriteAsCompleted: { from: TASK_STATES, to: "completed" },
    overwriteAsFailed: { from: TASK_STATES, to: "failed" },
    overwriteAsCanceled: { from: TASK_STATES, to: "canceled" },
    overwriteAsInputRequired: { from: TASK_STATES, to: "input-required" },
  },
});

export const a2aApprovalMachine = defineMachine({
  id: "a2a-approval",
  states: ["pending", "processing", "completed", "failed"],
  initial: "pending",
  terminal: ["completed", "failed"],
  transitions: {
    // claimA2AApproval, pending row that has not expired
    claim: { from: ["pending"], to: "processing" },
    // claimA2AApproval, row already processing
    reclaim: { from: ["processing"], to: "processing" },
    // settleA2AApproval, with the settled status
    complete: { from: ["processing"], to: "completed" },
    fail: { from: ["processing"], to: "failed" },
  },
});

export type A2ATaskStatus = (typeof a2aTaskMachine.states)[number];
export type A2ATaskEvent = (typeof a2aTaskMachine.events)[number];
export type A2AApprovalStatus = (typeof a2aApprovalMachine.states)[number];
export type A2AApprovalEvent = (typeof a2aApprovalMachine.events)[number];

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// A TaskState member added or removed without a matching machine state fails
// the build here.
export const taskStatesMatchTaskState: Mutual<A2ATaskStatus, TaskState> = true;

function targetOf<S extends string, E extends string>(
  machine: Machine<S, E>,
  event: E,
): S {
  return machine.transition(machine.fromStates(event)[0], event);
}

/** `'a', 'b'` for an event's source states, in the order the SQL lists them. */
export function taskIn(event: A2ATaskEvent): string {
  return a2aTaskMachine.sqlStateList(event);
}

/** `'x'` for the state an event lands in. */
export function taskTarget(event: A2ATaskEvent): string {
  return sqlLiteral(a2aTaskMachine, targetOf(a2aTaskMachine, event));
}

/** `'x'` for one state, for single-state WHERE and SELECT predicates. */
export function taskSql(state: A2ATaskStatus): string {
  return sqlLiteral(a2aTaskMachine, state);
}

export function approvalIn(event: A2AApprovalEvent): string {
  return a2aApprovalMachine.sqlStateList(event);
}

export function approvalTarget(event: A2AApprovalEvent): string {
  return sqlLiteral(a2aApprovalMachine, targetOf(a2aApprovalMachine, event));
}

export function approvalSql(state: A2AApprovalStatus): string {
  return sqlLiteral(a2aApprovalMachine, state);
}

function sqlLiteral<S extends string>(
  machine: Machine<S, string>,
  state: S,
): string {
  return `'${machine.parseState(state)}'`;
}
