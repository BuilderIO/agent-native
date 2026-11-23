import { describe, expect, it } from "vitest";

import type { NotebookCellOutputState } from "./types";
import { inheritUpstreamFailures } from "./upstream-failure";

const error = {
  type: "error" as const,
  message: "Your query could not be executed",
  detail: "syntax error",
};

describe("a cell held back by a failed upstream cell", () => {
  it("shows the upstream error as its own", () => {
    const outputs: Record<string, NotebookCellOutputState> = {
      a: { output: error, status: "error" },
      b: { output: null, status: "cancelled" },
    };
    inheritUpstreamFailures(
      { b: { attempt: { state: { status: "blocked", blockedBy: "a" } } } },
      outputs,
    );
    expect(outputs.b?.status).toBe("error");
    expect(outputs.b?.output).toEqual(error);
  });

  it("stays cancelled when the upstream cell did not fail", () => {
    const outputs: Record<string, NotebookCellOutputState> = {
      a: { output: null, status: "cancelled" },
      b: { output: null, status: "cancelled" },
    };
    inheritUpstreamFailures(
      { b: { attempt: { state: { status: "blocked", blockedBy: "a" } } } },
      outputs,
    );
    expect(outputs.b?.status).toBe("cancelled");
  });
});
