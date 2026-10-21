import { describe, expect, it } from "vitest";

import {
  WorkflowActionError,
  failWorkflowAction,
  isOutcomeUnknown,
  isWorkflowActionError,
} from "./workflow-action-errors.js";

describe("WorkflowActionError", () => {
  it("is recognised by core as a typed action failure", () => {
    const error = new WorkflowActionError({
      message: "Nope.",
      errorCode: "thing_rejected",
      statusCode: 409,
    });

    expect(error).toMatchObject({
      actionContractError: true,
      errorCode: "thing_rejected",
      statusCode: 409,
      sideEffect: "none",
      retryable: false,
    });
    expect(error.details).toEqual({ sideEffect: "none", retryable: false });
  });

  it("says in its message and its code when the write may have happened", () => {
    const error = new WorkflowActionError({
      message: "Slack did not confirm the post.",
      errorCode: "slack_post_outcome_unknown",
    });

    expect(error.sideEffect).toBe("maybe");
    expect(error.message).toContain("may already have taken effect");
    expect(isOutcomeUnknown(error)).toBe(true);
    expect(error.details).toMatchObject({ sideEffect: "maybe" });
  });

  it("can be read as unknown from a code alone, as the engine sees a tool result", () => {
    expect(isOutcomeUnknown({ errorCode: "merge_outcome_unknown" })).toBe(true);
    expect(isOutcomeUnknown({ errorCode: "merge_rejected" })).toBe(false);
    expect(isOutcomeUnknown(new Error("plain"))).toBe(false);
  });

  it("will not let a code and a side effect disagree", () => {
    expect(
      () =>
        new WorkflowActionError({
          message: "x",
          errorCode: "plain_failure",
          sideEffect: "maybe",
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new WorkflowActionError({
          message: "x",
          errorCode: "thing_outcome_unknown",
          sideEffect: "none",
        }),
    ).toThrow(TypeError);
  });

  it("is thrown by failWorkflowAction", () => {
    expect(() =>
      failWorkflowAction({ message: "x", errorCode: "thing_failed" }),
    ).toThrow(WorkflowActionError);
    expect(isWorkflowActionError(new Error("x"))).toBe(false);
  });
});
