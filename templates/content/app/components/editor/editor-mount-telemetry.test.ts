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

  it("counts the first editor on a rebuilt doc as recovery, apart from remounts", async () => {
    vi.useFakeTimers();
    const report = vi.fn();
    const observe = createEditorMountObserver(report, () => "visit");
    const rebuilt = { doc: {}, cause: "recovery" } as const;
    observe({}, "page", "route", "editing");
    observe({}, "page", "route", "editing", rebuilt);
    observe({}, "page", "route", "editing", rebuilt);
    observe({}, "page", "route", "suggesting", null);
    await vi.runAllTimersAsync();
    expect(report.mock.calls.map(([event]) => event.outcome)).toEqual([
      "initial",
      "recovery",
      "remount",
      "mode_switch",
    ]);
  });

  it("counts the first editor on the doc an account change started over on apart from remounts", async () => {
    vi.useFakeTimers();
    const report = vi.fn();
    const observe = createEditorMountObserver(report, () => "visit");
    const startedOver = { doc: {}, cause: "account_change" } as const;
    observe({}, "page", "route", "editing");
    observe({}, "page", "route", "editing", startedOver);
    observe({}, "page", "route", "editing", startedOver);
    // A rebuild after the account change starts over on a doc of its own.
    observe({}, "page", "route", "editing", { doc: {}, cause: "recovery" });
    await vi.runAllTimersAsync();
    expect(report.mock.calls.map(([event]) => event.outcome)).toEqual([
      "initial",
      "account_change",
      "remount",
      "recovery",
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
    observe.contextChanged(editor, "page", "route", "readonly");
    observe({}, "page", "route", "readonly");
    await vi.runAllTimersAsync();
    expect(report.mock.calls.map(([event]) => event.outcome)).toEqual([
      "initial",
      "remount",
    ]);
  });

  it("retains in-place navigation for later remount and mode-switch classification", async () => {
    vi.useFakeTimers();
    const report = vi.fn();
    const visits = vi
      .fn()
      .mockReturnValueOnce("visit-a")
      .mockReturnValueOnce("visit-b")
      .mockReturnValueOnce("visit-c");
    const observe = createEditorMountObserver(report, visits);
    const editor = {};
    observe(editor, "page", "route-a", "editing");
    observe.contextChanged(editor, "page", "route-b", "editing");
    const remounted = {};
    expect(observe(remounted, "page", "route-b", "editing")).toBe("visit-b");
    observe.contextChanged(editor, "page", "route-a", "readonly");
    observe.contextChanged(remounted, "page", "route-c", "editing");
    expect(observe({}, "page", "route-c", "suggesting")).toBe("visit-c");
    await vi.runAllTimersAsync();
    expect(report.mock.calls.map(([event]) => event)).toEqual([
      { id: "page", visitId: "visit-a", outcome: "initial", mode: "editing" },
      { id: "page", visitId: "visit-b", outcome: "remount", mode: "editing" },
      {
        id: "page",
        visitId: "visit-c",
        outcome: "mode_switch",
        mode: "suggesting",
      },
    ]);
    expect(visits).toHaveBeenCalledTimes(3);
  });
});
