import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorMountObserver } from "./editor-mount-telemetry";

describe("editor mount observations", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("does not throw into editor creation when scheduling fails", () => {
    const scheduler = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(() => {
        throw new Error("scheduler unavailable");
      });
    try {
      const report = vi.fn();
      const observe = createEditorMountObserver(report, () => "visit");
      expect(observe({}, "page", "route", "editing")).toBe("visit");
      expect(report).not.toHaveBeenCalled();
    } finally {
      scheduler.mockRestore();
    }
  });
  it("classifies each created editor once within a tab-local visit", async () => {
    vi.useFakeTimers();
    const report = vi.fn();
    const visits = vi
      .fn()
      .mockReturnValueOnce("visit-a")
      .mockReturnValueOnce("visit-b")
      .mockReturnValueOnce("visit-c");
    const observe = createEditorMountObserver(report, visits);
    const editor = {};
    expect(observe(editor, "page-a", "route-a", "editing")).toBe("visit-a");
    expect(observe(editor, "page-a", "route-a", "editing")).toBeNull();
    expect(observe({}, "page-a", "route-a", "editing")).toBe("visit-a");
    expect(observe({}, "page-a", "route-a", "suggesting")).toBe("visit-a");
    expect(observe({}, "page-a", "route-a", "readonly")).toBe("visit-a");
    expect(observe({}, "page-b", "route-b", "editing")).toBe("visit-b");
    expect(observe({}, "page-a", "route-c", "editing")).toBe("visit-c");
    expect(report).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(report.mock.calls.map(([event]) => event)).toEqual([
      { id: "page-a", visitId: "visit-a", outcome: "initial", mode: "editing" },
      { id: "page-a", visitId: "visit-a", outcome: "remount", mode: "editing" },
      {
        id: "page-a",
        visitId: "visit-a",
        outcome: "mode_switch",
        mode: "suggesting",
      },
      {
        id: "page-a",
        visitId: "visit-a",
        outcome: "mode_switch",
        mode: "readonly",
      },
      {
        id: "page-b",
        visitId: "visit-b",
        outcome: "navigation",
        mode: "editing",
      },
      {
        id: "page-a",
        visitId: "visit-c",
        outcome: "navigation",
        mode: "editing",
      },
    ]);
  });

  it("does not wait for slow or failed delivery before the next creation", async () => {
    vi.useFakeTimers();
    let settle!: () => void;
    const slow = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const report = vi
      .fn()
      .mockReturnValueOnce(slow)
      .mockRejectedValueOnce(new Error("telemetry failed"))
      .mockImplementationOnce(() => {
        throw new Error("telemetry failed");
      });
    const observe = createEditorMountObserver(report, () => "visit");
    expect(observe({}, "page", "route", "editing")).toBe("visit");
    expect(observe({}, "page", "route", "editing")).toBe("visit");
    expect(observe({}, "page", "route", "editing")).toBe("visit");
    expect(report).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(report).toHaveBeenCalledTimes(3);
    settle();
    await slow;
  });

  it("does not classify a later remount as an earlier in-place mode switch", async () => {
    vi.useFakeTimers();
    const report = vi.fn();
    const observe = createEditorMountObserver(report, () => "visit");
    const editor = {};
    observe(editor, "page", "route", "editing");
    observe.modeChanged(editor, "page", "route", "readonly");
    observe({}, "page", "route", "readonly");
    await vi.runAllTimersAsync();
    expect(report.mock.calls.map(([event]) => event.outcome)).toEqual([
      "initial",
      "remount",
    ]);
  });
});
