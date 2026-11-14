import { describe, expect, it } from "vitest";

import {
  renderMachineTrace,
  StateMachineError,
} from "../state-machine/index.js";
import {
  a2aApprovalMachine,
  a2aTaskMachine,
  approvalIn,
  approvalSql,
  approvalTarget,
  taskIn,
  taskSql,
  taskTarget,
  type A2AApprovalEvent,
  type A2AApprovalStatus,
  type A2ATaskEvent,
  type A2ATaskStatus,
} from "./task-lifecycle.js";

function thrownCode(call: () => unknown): string | undefined {
  try {
    call();
  } catch (error) {
    if (error instanceof StateMachineError) return error.code;
    throw error;
  }
  return undefined;
}

// Every expectation below is written out from the SQL that task-store.ts ran
// before the machines existed. Changing a machine event is a visible test diff.

const ALL_TASK_STATES: readonly A2ATaskStatus[] = [
  "submitted",
  "working",
  "processing",
  "completed",
  "failed",
  "canceled",
  "input-required",
] as const;

// Every state but canceled: updateTask's UPDATE refuses a canceled row.
const OVERWRITE_FROM: readonly A2ATaskStatus[] = [
  "submitted",
  "working",
  "processing",
  "completed",
  "failed",
  "input-required",
];

const TASK_EVENTS: Array<{
  event: A2ATaskEvent;
  from: readonly A2ATaskStatus[];
  sqlList: string;
  to: string;
  sqlTo: string;
}> = [
  // claimA2ATaskForProcessing
  {
    event: "claimForProcessing",
    from: ["submitted", "working"],
    sqlList: "'submitted', 'working'",
    to: "processing",
    sqlTo: "'processing'",
  },
  // claimA2AApproval
  {
    event: "resumeAfterApproval",
    from: ["input-required", "working"],
    sqlList: "'input-required', 'working'",
    to: "working",
    sqlTo: "'working'",
  },
  // pauseProcessingA2ATask
  {
    event: "requireInput",
    from: ["processing"],
    sqlList: "'processing'",
    to: "input-required",
    sqlTo: "'input-required'",
  },
  // resetStuckA2ATaskForRetry
  {
    event: "retryStuck",
    from: ["processing"],
    sqlList: "'processing'",
    to: "working",
    sqlTo: "'working'",
  },
  // settleA2AApproval, settled status "completed"
  {
    event: "completeApproval",
    from: ["working"],
    sqlList: "'working'",
    to: "completed",
    sqlTo: "'completed'",
  },
  // settleA2AApproval, settled status "failed"
  {
    event: "failApproval",
    from: ["working"],
    sqlList: "'working'",
    to: "failed",
    sqlTo: "'failed'",
  },
  // settleProcessingA2ATask, update.state "completed"
  {
    event: "completeProcessing",
    from: ["processing"],
    sqlList: "'processing'",
    to: "completed",
    sqlTo: "'completed'",
  },
  // settleProcessingA2ATask, update.state "failed"
  {
    event: "failProcessing",
    from: ["processing"],
    sqlList: "'processing'",
    to: "failed",
    sqlTo: "'failed'",
  },
  // failStuckA2ATask
  {
    event: "failStuckProcessing",
    from: ["processing"],
    sqlList: "'processing'",
    to: "failed",
    sqlTo: "'failed'",
  },
  // failStuckQueuedA2ATask
  {
    event: "failStuckQueued",
    from: ["submitted", "working"],
    sqlList: "'submitted', 'working'",
    to: "failed",
    sqlTo: "'failed'",
  },
  // failStaleA2ATask
  {
    event: "failStale",
    from: ["submitted", "working", "processing"],
    sqlList: "'submitted', 'working', 'processing'",
    to: "failed",
    sqlTo: "'failed'",
  },
  // cancelA2ATask: completed, failed, and canceled are not cancelable
  {
    event: "cancel",
    from: ["submitted", "working", "processing", "input-required"],
    sqlList: "'submitted', 'working', 'processing', 'input-required'",
    to: "canceled",
    sqlTo: "'canceled'",
  },
  // updateTask, update.state "submitted": the UPDATE refuses canceled rows
  {
    event: "overwriteAsSubmitted",
    from: OVERWRITE_FROM,
    sqlList:
      "'submitted', 'working', 'processing', 'completed', 'failed', 'input-required'",
    to: "submitted",
    sqlTo: "'submitted'",
  },
  {
    event: "overwriteAsWorking",
    from: OVERWRITE_FROM,
    sqlList:
      "'submitted', 'working', 'processing', 'completed', 'failed', 'input-required'",
    to: "working",
    sqlTo: "'working'",
  },
  {
    event: "overwriteAsProcessing",
    from: OVERWRITE_FROM,
    sqlList:
      "'submitted', 'working', 'processing', 'completed', 'failed', 'input-required'",
    to: "processing",
    sqlTo: "'processing'",
  },
  {
    event: "overwriteAsCompleted",
    from: OVERWRITE_FROM,
    sqlList:
      "'submitted', 'working', 'processing', 'completed', 'failed', 'input-required'",
    to: "completed",
    sqlTo: "'completed'",
  },
  {
    event: "overwriteAsFailed",
    from: OVERWRITE_FROM,
    sqlList:
      "'submitted', 'working', 'processing', 'completed', 'failed', 'input-required'",
    to: "failed",
    sqlTo: "'failed'",
  },
  {
    event: "overwriteAsCanceled",
    from: OVERWRITE_FROM,
    sqlList:
      "'submitted', 'working', 'processing', 'completed', 'failed', 'input-required'",
    to: "canceled",
    sqlTo: "'canceled'",
  },
  {
    event: "overwriteAsInputRequired",
    from: OVERWRITE_FROM,
    sqlList:
      "'submitted', 'working', 'processing', 'completed', 'failed', 'input-required'",
    to: "input-required",
    sqlTo: "'input-required'",
  },
];

const APPROVAL_EVENTS: Array<{
  event: A2AApprovalEvent;
  from: readonly A2AApprovalStatus[];
  to: string;
  sqlTo: string;
}> = [
  // claimA2AApproval, unexpired pending row
  {
    event: "claim",
    from: ["pending"],
    to: "processing",
    sqlTo: "'processing'",
  },
  // claimA2AApproval, row already processing
  {
    event: "reclaim",
    from: ["processing"],
    to: "processing",
    sqlTo: "'processing'",
  },
  // settleA2AApproval, settled status "completed"
  {
    event: "complete",
    from: ["processing"],
    to: "completed",
    sqlTo: "'completed'",
  },
  // settleA2AApproval, settled status "failed"
  { event: "fail", from: ["processing"], to: "failed", sqlTo: "'failed'" },
];

describe("a2aTaskMachine", () => {
  it("declares the TaskState members in the order they were listed", () => {
    expect(a2aTaskMachine.states).toEqual(ALL_TASK_STATES);
    expect(a2aTaskMachine.initial).toBe("submitted");
  });

  it("makes canceled the only terminal state", () => {
    for (const state of ALL_TASK_STATES) {
      expect(a2aTaskMachine.isTerminal(state)).toBe(state === "canceled");
    }
  });

  it("rejects overwriting a canceled task", () => {
    expect(() =>
      a2aTaskMachine.transition("canceled", "overwriteAsCompleted"),
    ).toThrow(StateMachineError);
  });

  it.each(TASK_EVENTS)(
    "$event: source states are bound in the SQL list",
    ({ event, from, sqlList }) => {
      expect(a2aTaskMachine.fromStates(event)).toEqual(from);
      expect(a2aTaskMachine.sqlStateList(event)).toBe(sqlList);
      const fragment = taskIn(event);
      expect(fragment.sql).toBe(`(${from.map(() => "?").join(", ")})`);
      expect(fragment.args).toEqual(from);
    },
  );

  it.each(TASK_EVENTS)(
    "$event: target is bound for the SET clause",
    ({ event, from, to, sqlTo }) => {
      expect(taskTarget(event)).toMatchObject({ sql: "?", args: [to] });
      expect(sqlTo).toBe(`'${to}'`);
      for (const state of from) {
        expect(a2aTaskMachine.transition(state, event)).toBe(to);
      }
    },
  );

  it("rejects a transition the SQL would not have matched", () => {
    expect(() =>
      a2aTaskMachine.transition("completed", "requireInput"),
    ).toThrow(StateMachineError);
  });

  it("rejects canceling a task that already reached a final state", () => {
    for (const state of ["completed", "failed", "canceled"] as const) {
      expect(() => a2aTaskMachine.transition(state, "cancel")).toThrow(
        StateMachineError,
      );
    }
  });

  it("binds single-state predicates", () => {
    expect(taskSql("processing")).toMatchObject({
      sql: "?",
      args: ["processing"],
    });
    expect(taskSql("working")).toMatchObject({ sql: "?", args: ["working"] });
    expect(taskSql("failed")).toMatchObject({ sql: "?", args: ["failed"] });
    expect(taskSql("canceled")).toMatchObject({ sql: "?", args: ["canceled"] });
  });

  it("throws on a stored status outside TaskState", () => {
    for (const value of ["auth-required", "rejected", "", null, undefined]) {
      expect(thrownCode(() => a2aTaskMachine.parseState(value))).toBe(
        "unknown_state",
      );
    }
  });
});

describe("a2aApprovalMachine", () => {
  it("starts pending and ends in completed or failed", () => {
    expect(a2aApprovalMachine.states).toEqual([
      "pending",
      "processing",
      "completed",
      "failed",
    ]);
    expect(a2aApprovalMachine.initial).toBe("pending");
    expect(a2aApprovalMachine.isTerminal("completed")).toBe(true);
    expect(a2aApprovalMachine.isTerminal("failed")).toBe(true);
    expect(a2aApprovalMachine.isTerminal("processing")).toBe(false);
    expect(a2aApprovalMachine.isTerminal("pending")).toBe(false);
  });

  it.each(APPROVAL_EVENTS)(
    "$event: source states and target are bound in SQL",
    ({ event, from, to, sqlTo }) => {
      expect(a2aApprovalMachine.fromStates(event)).toEqual(from);
      expect(approvalTarget(event)).toMatchObject({ sql: "?", args: [to] });
      expect(sqlTo).toBe(`'${to}'`);
      for (const state of from) {
        expect(a2aApprovalMachine.transition(state, event)).toBe(to);
      }
    },
  );

  it("binds approval state predicates", () => {
    expect(approvalSql("pending")).toMatchObject({
      sql: "?",
      args: ["pending"],
    });
    expect(approvalSql("processing")).toMatchObject({
      sql: "?",
      args: ["processing"],
    });
    expect(approvalIn("reclaim")).toMatchObject({
      sql: "(?)",
      args: ["processing"],
    });
  });

  it("rejects a settled approval being settled again", () => {
    expect(() => a2aApprovalMachine.transition("completed", "fail")).toThrow(
      StateMachineError,
    );
  });

  it("throws on a stored status outside the approval lifecycle", () => {
    for (const value of ["expired", "working", "", null]) {
      expect(thrownCode(() => a2aApprovalMachine.parseState(value))).toBe(
        "unknown_state",
      );
    }
  });
});

describe("A2A lifecycle traces", () => {
  it("renders the task happy path", () => {
    expect(
      renderMachineTrace(a2aTaskMachine, [
        "claimForProcessing",
        "completeProcessing",
      ]),
    ).toMatchInlineSnapshot(`
      "claimForProcessing -> processing [guard: 'submitted', 'working']
      completeProcessing -> completed [guard: 'processing']"
    `);
  });

  it("renders cancellation from each non-final task state", () => {
    expect({
      submitted: renderMachineTrace(a2aTaskMachine, ["cancel"], "submitted"),
      working: renderMachineTrace(a2aTaskMachine, ["cancel"], "working"),
      processing: renderMachineTrace(a2aTaskMachine, ["cancel"], "processing"),
      inputRequired: renderMachineTrace(
        a2aTaskMachine,
        ["cancel"],
        "input-required",
      ),
    }).toMatchInlineSnapshot(`
      {
        "inputRequired": "cancel -> canceled [guard: 'submitted', 'working', 'processing', 'input-required']",
        "processing": "cancel -> canceled [guard: 'submitted', 'working', 'processing', 'input-required']",
        "submitted": "cancel -> canceled [guard: 'submitted', 'working', 'processing', 'input-required']",
        "working": "cancel -> canceled [guard: 'submitted', 'working', 'processing', 'input-required']",
      }
    `);
  });

  it("renders the completed-task cancellation refusal", () => {
    expect(
      renderMachineTrace(a2aTaskMachine, ["cancel"], "completed"),
    ).toMatchInlineSnapshot(
      `"cancel -> completed (rejected) [guard: 'submitted', 'working', 'processing', 'input-required']"`,
    );
  });

  it("keeps cancellation when processing completes late", () => {
    expect(
      renderMachineTrace(a2aTaskMachine, [
        "claimForProcessing",
        "cancel",
        "completeProcessing",
      ]),
    ).toMatchInlineSnapshot(`
      "claimForProcessing -> processing [guard: 'submitted', 'working']
      cancel -> canceled [guard: 'submitted', 'working', 'processing', 'input-required']
      completeProcessing -> canceled (rejected) [guard: 'processing']"
    `);
  });

  it("renders the approval happy path", () => {
    expect(renderMachineTrace(a2aApprovalMachine, ["claim", "complete"]))
      .toMatchInlineSnapshot(`
      "claim -> processing [guard: 'pending']
      complete -> completed [guard: 'processing']"
    `);
  });
});
