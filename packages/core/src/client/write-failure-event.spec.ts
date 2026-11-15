// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  reportWriteFailure,
  WRITE_FAILURE_EVENT,
  type WriteFailureDetail,
} from "./write-failure-event.js";

describe("reportWriteFailure", () => {
  const reports: WriteFailureDetail[] = [];
  const onReport = (event: Event) => {
    reports.push((event as CustomEvent<WriteFailureDetail>).detail);
  };

  afterEach(() => {
    window.removeEventListener(WRITE_FAILURE_EVENT, onReport);
    reports.length = 0;
    vi.unstubAllGlobals();
  });

  it("announces the failure on the window under the shared event name", () => {
    const received = vi.fn();
    window.addEventListener("agent-native:write-failure", received);
    try {
      reportWriteFailure(new Error("save failed"));
    } finally {
      window.removeEventListener("agent-native:write-failure", received);
    }

    expect(WRITE_FAILURE_EVENT).toBe("agent-native:write-failure");
    expect(received).toHaveBeenCalledTimes(1);
  });

  it("carries the error itself and the translated label to the toaster", () => {
    window.addEventListener(WRITE_FAILURE_EVENT, onReport);
    const error = new Error("save failed");

    reportWriteFailure(error, { label: "Could not save the title" });

    expect(reports).toHaveLength(1);
    expect(reports[0]?.error).toBe(error);
    expect(reports[0]?.label).toBe("Could not save the title");
  });

  it("leaves the label unset when none is given", () => {
    window.addEventListener(WRITE_FAILURE_EVENT, onReport);

    reportWriteFailure("offline");
    reportWriteFailure("offline", {});

    expect(reports).toEqual([
      { error: "offline", label: undefined },
      { error: "offline", label: undefined },
    ]);
  });

  it("does nothing where there is no window", () => {
    window.addEventListener(WRITE_FAILURE_EVENT, onReport);
    const dispatch = vi.spyOn(window, "dispatchEvent");
    vi.stubGlobal("window", undefined);

    expect(() => reportWriteFailure(new Error("save failed"))).not.toThrow();

    vi.unstubAllGlobals();
    expect(dispatch).not.toHaveBeenCalled();
    expect(reports).toEqual([]);
  });
});
