// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { ActionCircuitOpenError } from "./action-failure-circuit.js";
import {
  classifyWriteFailure,
  reportWriteFailure,
  surfaceMutationError,
  WRITE_FAILURE_EVENT,
  writeFailureFromResponse,
  type WriteFailureDetail,
} from "./write-failure.js";

function actionError(init: {
  status?: number;
  message?: string;
  actionMessage?: string;
  timedOut?: boolean;
}): Error {
  const error = new Error(init.message ?? "Action save failed");
  Object.assign(error, {
    status: init.status,
    actionMessage: init.actionMessage,
    timedOut: init.timedOut,
  });
  return error;
}

describe("classifyWriteFailure", () => {
  it("skips a 401, which the session recheck owns", () => {
    expect(classifyWriteFailure(actionError({ status: 401 }))).toEqual({
      skip: true,
    });
  });

  it("skips an AbortError", () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    expect(classifyWriteFailure(abort)).toEqual({ skip: true });
  });

  it("calls a network-level fetch failure offline", () => {
    expect(
      classifyWriteFailure(
        new Error("Action save-record failed: Failed to fetch"),
      ),
    ).toEqual({ skip: false, kind: "offline" });
  });

  it("calls an action timeout a timeout, not a refusal", () => {
    expect(
      classifyWriteFailure(
        actionError({
          status: 408,
          timedOut: true,
          message: "Action save-record timed out after 60s",
        }),
      ),
    ).toEqual({ skip: false, kind: "timeout" });
  });

  it("calls a 403 forbidden and never carries its system-authored message", () => {
    const result = classifyWriteFailure(
      actionError({
        status: 403,
        actionMessage: "No access to design d_8f3a21 for org org_77c0",
      }),
    );

    expect(result).toEqual({ skip: false, kind: "forbidden" });
    expect(result).not.toHaveProperty("authoredMessage");
  });

  it("keeps the authored message of a typed 4xx refusal", () => {
    expect(
      classifyWriteFailure(
        actionError({ status: 409, actionMessage: "Name already taken" }),
      ),
    ).toEqual({
      skip: false,
      kind: "refused",
      authoredMessage: "Name already taken",
    });
  });

  it("has no authored message for a 4xx refusal without one", () => {
    expect(classifyWriteFailure(actionError({ status: 400 }))).toEqual({
      skip: false,
      kind: "refused",
    });
  });

  it("never uses the authored message of a 5xx", () => {
    expect(
      classifyWriteFailure(
        actionError({ status: 500, actionMessage: "Internal server error" }),
      ),
    ).toEqual({ skip: false, kind: "server" });
  });

  it("calls an open failure circuit a server failure", () => {
    const circuit = new ActionCircuitOpenError(actionError({ status: 503 }));
    expect(classifyWriteFailure(circuit)).toEqual({
      skip: false,
      kind: "server",
    });
  });

  it.each([
    ["a bare error", new Error("boom")],
    ["a string", "boom"],
    ["undefined", undefined],
    ["a 3xx status", actionError({ status: 302 })],
  ])("calls %s unknown", (_label, error) => {
    expect(classifyWriteFailure(error)).toEqual({
      skip: false,
      kind: "unknown",
    });
  });
});

describe("reportWriteFailure", () => {
  const seen: WriteFailureDetail[] = [];
  const onEvent = (event: Event) => {
    seen.push((event as CustomEvent<WriteFailureDetail>).detail);
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    window.removeEventListener(WRITE_FAILURE_EVENT, onEvent);
    seen.length = 0;
  });

  it("dispatches the error and label on window", () => {
    window.addEventListener(WRITE_FAILURE_EVENT, onEvent);
    const error = new Error("x");

    reportWriteFailure(error, { label: "Couldn't rename." });
    reportWriteFailure(error);

    expect(seen).toEqual([
      { error, label: "Couldn't rename." },
      { error, label: undefined },
    ]);
  });

  it("does nothing without a window", () => {
    vi.stubGlobal("window", undefined);
    expect(() => reportWriteFailure(new Error("x"))).not.toThrow();
  });
});

describe("surfaceMutationError", () => {
  it("opts a raw mutation in with or without a label", () => {
    expect(surfaceMutationError()).toEqual({ surfaceError: true });
    expect(surfaceMutationError("Couldn't save.")).toEqual({
      surfaceError: true,
      errorLabel: "Couldn't save.",
    });
  });
});

describe("writeFailureFromResponse", () => {
  it("carries the status so the classifier can tell the cases apart", () => {
    expect(
      classifyWriteFailure(writeFailureFromResponse({ status: 401 })),
    ).toEqual({
      skip: true,
    });
    expect(
      classifyWriteFailure(writeFailureFromResponse({ status: 403 })),
    ).toEqual({
      skip: false,
      kind: "forbidden",
    });
    expect(
      classifyWriteFailure(writeFailureFromResponse({ status: 503 })),
    ).toEqual({
      skip: false,
      kind: "server",
    });
  });
});
