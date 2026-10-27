import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorMergeReporter } from "./editor-merge-telemetry";

describe("editor merge reports", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("reports each merge after it, as kept_all or set_aside, with its path", async () => {
    vi.useFakeTimers();
    const report = vi.fn();
    const reportMerge = createEditorMergeReporter(report);
    reportMerge("page", "open_editor", { setAside: 0 });
    reportMerge("page", "save_rebase", { setAside: 2 });
    expect(report).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(report.mock.calls.map(([event]) => event)).toEqual([
      { id: "page", outcome: "kept_all", path: "open_editor" },
      { id: "page", outcome: "set_aside", path: "save_rebase" },
    ]);
  });
  it("does not throw into the merge when scheduling fails", () => {
    const scheduler = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(() => {
        throw new Error("scheduler unavailable");
      });
    try {
      const report = vi.fn();
      expect(() =>
        createEditorMergeReporter(report)("page", "open_editor", {
          setAside: 0,
        }),
      ).not.toThrow();
      expect(report).not.toHaveBeenCalled();
    } finally {
      scheduler.mockRestore();
    }
  });
  it("does not wait for slow or failed delivery before the next merge", async () => {
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
    const reportMerge = createEditorMergeReporter(report);
    for (let i = 0; i < 3; i++) {
      reportMerge("page", "open_editor", { setAside: 0 });
    }
    await vi.runAllTimersAsync();
    expect(report).toHaveBeenCalledTimes(3);
    settle();
    await slow;
  });
});
