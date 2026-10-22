import { describe, expect, it } from "vitest";

import { classifyReadError } from "./read-failure";

function actionError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error("Action get-item-journey failed: x"), fields);
}

describe("classifyReadError", () => {
  it("keeps every typed code the read actions send", () => {
    for (const code of [
      "workflow_not_found",
      "workflow_item_not_found",
      "workflow_node_not_found",
      "factory_not_found",
      "bad_cursor",
      "stored_record_unreadable",
    ]) {
      expect(
        classifyReadError(actionError({ errorCode: code, status: 404 })).kind,
      ).toBe(code);
    }
  });

  it("prefers the message the action authored over the wrapped one", () => {
    const failure = classifyReadError(
      actionError({
        errorCode: "workflow_node_not_found",
        actionMessage: "Node n9 is not in version 3.",
      }),
    );
    expect(failure.message).toBe("Node n9 is not in version 3.");
  });

  it("calls a 404 with no code a missing action, not an empty result", () => {
    expect(classifyReadError(actionError({ status: 404 })).kind).toBe(
      "action_unavailable",
    );
    expect(classifyReadError(actionError({ status: 405 })).kind).toBe(
      "action_unavailable",
    );
  });

  it("does not mistake a server fault for a missing action", () => {
    expect(classifyReadError(actionError({ status: 500 })).kind).toBe(
      "generic",
    );
    expect(
      classifyReadError(
        actionError({ status: 404, errorCode: "something_else" }),
      ).kind,
    ).toBe("generic");
  });

  it("survives a value that is not an Error", () => {
    expect(classifyReadError(null).kind).toBe("generic");
    expect(classifyReadError("boom").kind).toBe("generic");
  });
});
