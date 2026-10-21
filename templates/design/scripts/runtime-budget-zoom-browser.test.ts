import { errors, type CDPSession, type Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { runRuntimeZoomBrowserAttempt } from "./_runtime-budget-zoom-browser";
import {
  readRuntimeZoomSnapshot,
  type ZoomSnapshotRead,
} from "./_runtime-budget-zoom-snapshot";

const config = {
  defaultFrameWidth: 320,
  defaultSourceWidth: 1280,
  deviceWidths: { desktop: 1280 },
};
const available: ZoomSnapshotRead = {
  status: "available",
  snapshot: {
    sampledAt: 0,
    sampleRevision: 1,
    renderRevision: 1,
    committedCanvasScale: 60 / 1.125,
    camera: {
      sampleRevision: 1,
      scale: 60 / 1.125,
      transform: "scale(0.5333333333333333)",
    },
    basis: {
      sampleRevision: 1,
      screenId: "screen-a",
      frameWidth: 1440,
      sourceWidth: 1280,
      scale: 1.125,
    },
    routeZoom: 60,
    label: "60%",
  },
};

function browser() {
  let clock = 0;
  const handle = { dispose: vi.fn(async () => {}) };
  const readout = {
    first: vi.fn(() => readout),
    elementHandles: vi.fn(async () => [handle]),
    click: vi.fn(async (_options: { timeout: number }) => {}),
  };
  const input = {
    fill: vi.fn(async (_value: string, _options: { timeout: number }) => {}),
    press: vi.fn(async (_key: string, _options: { timeout: number }) => {}),
  };
  const page = {
    getByRole: vi.fn((role: string, _options: unknown) =>
      role === "button" ? readout : input,
    ),
    evaluate: vi.fn(
      async (_reader: unknown, _config: unknown): Promise<ZoomSnapshotRead> =>
        available,
    ),
    waitForTimeout: vi.fn(async (ms: number) => {
      clock += ms;
    }),
  };
  const cdp = { send: vi.fn(async (_method: string) => {}) };
  return {
    handle,
    readout,
    input,
    page,
    cdp,
    advance: (ms: number) => {
      clock += ms;
    },
    run: () =>
      runRuntimeZoomBrowserAttempt(
        60,
        page as unknown as Page,
        cdp as unknown as CDPSession,
        config,
        () => clock,
      ),
  };
}

describe("runtime zoom production browser adapter", () => {
  it("uses non-waiting current toolbar handles and the exact shared reader", async () => {
    const b = browser();
    const result = await b.run();
    expect(result.arrived).toBe(true);
    expect(b.page.getByRole).toHaveBeenCalledWith("button", { name: /^\d+%$/ });
    expect(b.readout.first).toHaveBeenCalledOnce();
    expect(b.readout.elementHandles.mock.calls).toEqual([[], []]);
    expect(b.page.evaluate).toHaveBeenCalledWith(readRuntimeZoomSnapshot, {
      ...config,
      readout: b.handle,
    });
    expect(b.handle.dispose).toHaveBeenCalledTimes(2);
    expect(b.input.fill).toHaveBeenCalledWith("60%", { timeout: 10_000 });
    expect(b.input.press).toHaveBeenCalledWith("Enter", { timeout: 10_000 });
  });

  it("retries missing toolbar without a blocking locator wait or false success", async () => {
    const b = browser();
    b.readout.elementHandles.mockResolvedValue([]);
    const result = await b.run();
    expect(result.before).toEqual({
      status: "unavailable",
      reason: "toolbar-absent",
    });
    expect(result.error).toEqual({
      phase: "baseline",
      reason: "deadline-exceeded",
    });
    expect(result.arrived).toBe(false);
    expect(result.elapsedMs).toBe(10_000);
    expect(b.readout.elementHandles).toHaveBeenCalledTimes(40);
    expect(b.page.evaluate).not.toHaveBeenCalled();
    expect(b.readout.click).not.toHaveBeenCalled();
  });

  it("continues when a temporarily absent toolbar mounts within the same budget", async () => {
    const b = browser();
    b.readout.elementHandles.mockResolvedValueOnce([]);
    const result = await b.run();
    expect(result.arrived).toBe(true);
    expect(result.elapsedMs).toBe(250);
    expect(b.input.fill).toHaveBeenCalledWith("60%", { timeout: 9_750 });
  });

  it("does not evaluate a snapshot after the toolbar query itself exhausts the deadline", async () => {
    const b = browser();
    b.readout.elementHandles.mockImplementationOnce(async () => {
      b.advance(10_000);
      return [b.handle];
    });
    const result = await b.run();
    expect(result.before).toEqual({
      status: "unavailable",
      reason: "attempt-deadline-exceeded",
    });
    expect(result.error).toEqual({
      phase: "baseline",
      reason: "deadline-exceeded",
    });
    expect(result.arrived).toBe(false);
    expect(b.page.evaluate).not.toHaveBeenCalled();
    expect(b.readout.click).not.toHaveBeenCalled();
    expect(b.handle.dispose).toHaveBeenCalledOnce();
  });

  it("classifies an actual Playwright apply timeout at the deadline and preserves its cause", async () => {
    const b = browser();
    b.input.fill.mockImplementationOnce(async () => {
      b.advance(10_000);
      throw new errors.TimeoutError("fill exceeded remaining deadline");
    });
    const result = await b.run();
    expect(result.error).toEqual({
      phase: "apply",
      reason: "deadline-exceeded",
      cause: {
        type: "timeout",
        name: "TimeoutError",
        message: "TimeoutError: fill exceeded remaining deadline",
      },
    });
    expect(result.final).toBeNull();
    expect(result.arrived).toBe(false);
    expect(b.input.press).not.toHaveBeenCalled();
    expect(b.page.evaluate).toHaveBeenCalledOnce();
  });

  it("stops input operations when a successful click exhausts the deadline", async () => {
    const b = browser();
    b.readout.click.mockImplementationOnce(async () => {
      b.advance(10_000);
    });
    const result = await b.run();
    expect(result.error).toMatchObject({
      phase: "apply",
      reason: "deadline-exceeded",
      cause: { type: "timeout" },
    });
    expect(b.input.fill).not.toHaveBeenCalled();
    expect(b.input.press).not.toHaveBeenCalled();
    expect(b.page.evaluate).toHaveBeenCalledOnce();
  });

  it.each([0, 10_001])(
    "keeps unrelated lookup rejection at %i ms distinct from a timeout",
    async (elapsed) => {
      const b = browser();
      const cause = new Error("page closed during lookup");
      cause.name = "TimeoutError";
      b.readout.elementHandles.mockImplementationOnce(async () => {
        b.advance(elapsed);
        throw cause;
      });
      const result = await b.run();
      expect(result.error).toMatchObject({
        phase: "baseline",
        reason: "snapshot-error",
        snapshotError: {
          reason: "snapshot-read-failed",
          cause: {
            type: "error",
            name: "TimeoutError",
            message: "TimeoutError: page closed during lookup",
          },
        },
      });
      expect(result.arrived).toBe(false);
      expect(b.readout.click).not.toHaveBeenCalled();
    },
  );

  it("preserves an actual lookup timeout at the deadline as a baseline deadline", async () => {
    const b = browser();
    b.readout.elementHandles.mockImplementationOnce(async () => {
      b.advance(10_000);
      throw new errors.TimeoutError("lookup timed out");
    });
    const result = await b.run();
    expect(result.error).toMatchObject({
      phase: "baseline",
      reason: "deadline-exceeded",
      cause: { type: "timeout", message: "TimeoutError: lookup timed out" },
    });
    expect(result.before).toMatchObject({
      status: "error",
      reason: "snapshot-read-timed-out",
    });
    expect(result.arrived).toBe(false);
    expect(b.page.evaluate).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "preserves the primary read cause when disposal also fails (primary timeout: %s)",
    async (primaryTimeout) => {
      const b = browser();
      b.page.evaluate.mockImplementationOnce(async () => {
        b.advance(10_000);
        throw primaryTimeout
          ? new errors.TimeoutError("primary read timeout")
          : new Error("primary read failure");
      });
      b.handle.dispose.mockRejectedValueOnce(
        new errors.TimeoutError("secondary disposal timeout"),
      );
      const result = await b.run();
      expect(result.error).toMatchObject({
        phase: "baseline",
        reason: primaryTimeout ? "deadline-exceeded" : "snapshot-error",
      });
      expect(result.before).toMatchObject({
        status: "error",
        reason: primaryTimeout
          ? "snapshot-read-timed-out"
          : "snapshot-read-failed",
        cause: {
          type: primaryTimeout ? "timeout" : "error",
          message: primaryTimeout
            ? "TimeoutError: primary read timeout"
            : "Error: primary read failure",
        },
      });
      expect(result.readCleanup).toEqual([
        {
          status: "failed",
          cause: {
            type: "timeout",
            name: "TimeoutError",
            message: "TimeoutError: secondary disposal timeout",
          },
        },
      ]);
      expect(result.arrived).toBe(false);
      expect(b.readout.click).not.toHaveBeenCalled();
    },
  );

  it.each(["pending", "failed"])(
    "preserves a returned typed fiber failure when disposal is %s",
    async (status) => {
      vi.useFakeTimers();
      let rejectDisposal: ((cause: Error) => void) | undefined;
      try {
        const b = browser();
        const failure: ZoomSnapshotRead = {
          status: "error",
          reason: "fiber-path-unreadable",
          paths: [{ branch: "host", reason: "path-disconnected" }],
        };
        b.page.evaluate.mockResolvedValueOnce(failure);
        b.handle.dispose.mockImplementationOnce(() =>
          status === "pending"
            ? new Promise((_, reject) => {
                rejectDisposal = reject;
              })
            : Promise.reject(new errors.TimeoutError("disposal timeout")),
        );
        let result: Awaited<ReturnType<typeof b.run>> | undefined;
        const pending = b.run().then((value) => {
          result = value;
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(result).toBeDefined();
        expect(result?.error).toEqual({
          phase: "baseline",
          reason: "snapshot-error",
          snapshotError: failure,
        });
        expect(result?.before).toEqual(failure);
        expect(result?.readCleanup).toEqual(
          status === "pending"
            ? [{ status }]
            : [
                {
                  status,
                  cause: {
                    type: "timeout",
                    name: "TimeoutError",
                    message: "TimeoutError: disposal timeout",
                  },
                },
              ],
        );
        expect(result?.arrived).toBe(false);
        expect(b.readout.click).not.toHaveBeenCalled();
        const artifact = JSON.stringify(result);
        b.advance(10_001);
        rejectDisposal?.(new Error("late disposal rejection"));
        await vi.advanceTimersByTimeAsync(0);
        expect(JSON.stringify(result)).toBe(artifact);
        await pending;
      } finally {
        rejectDisposal?.(new Error("test cleanup"));
        await vi.advanceTimersByTimeAsync(0);
        vi.useRealTimers();
      }
    },
  );

  it("does not accept a successful snapshot when its disposal fails", async () => {
    const b = browser();
    b.handle.dispose.mockRejectedValueOnce(
      new Error("disposal failed after successful read"),
    );
    const result = await b.run();
    expect(result.arrived).toBe(false);
    expect(result.error).toMatchObject({
      phase: "baseline",
      reason: "snapshot-error",
      snapshotError: {
        reason: "snapshot-read-failed",
        cause: {
          type: "error",
          message: "Error: disposal failed after successful read",
        },
      },
    });
    expect(b.readout.click).not.toHaveBeenCalled();
  });

  it("returns the deadline receipt even if CDP cleanup remains pending, without later rewriting it", async () => {
    vi.useFakeTimers();
    let rejectCleanup!: (cause: Error) => void;
    let rejectRead!: (cause: Error) => void;
    try {
      const b = browser();
      b.page.evaluate.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectRead = reject;
          }),
      );
      b.cdp.send.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectCleanup = reject;
          }),
      );
      let result: Awaited<ReturnType<typeof b.run>> | undefined;
      const pending = b.run().then((value) => {
        result = value;
      });
      await vi.advanceTimersByTimeAsync(0);
      b.advance(10_000);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(result).toBeDefined();
      expect(result?.error).toEqual({
        phase: "baseline",
        reason: "deadline-exceeded",
      });
      expect(result).toMatchObject({ cleanup: { status: "pending" } });
      expect(result?.arrived).toBe(false);
      expect(b.page.evaluate).toHaveBeenCalledOnce();
      const artifact = JSON.stringify(result);
      rejectCleanup(new Error("late cleanup rejection"));
      rejectRead(new Error("late read rejection"));
      await vi.advanceTimersByTimeAsync(0);
      expect(JSON.stringify(result)).toBe(artifact);
      await pending;
    } finally {
      rejectCleanup?.(new Error("test cleanup"));
      rejectRead?.(new Error("test cleanup"));
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
    }
  });

  it.each([false, true])(
    "exposes a known primary failure immediately while disposal remains pending (timeout: %s)",
    async (primaryTimeout) => {
      vi.useFakeTimers();
      let rejectDisposal!: (cause: Error) => void;
      try {
        const b = browser();
        b.page.evaluate.mockRejectedValueOnce(
          primaryTimeout
            ? new errors.TimeoutError("known primary timeout")
            : new Error("known primary failure"),
        );
        b.handle.dispose.mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectDisposal = reject;
            }),
        );
        let result: Awaited<ReturnType<typeof b.run>> | undefined;
        const pending = b.run().then((value) => {
          result = value;
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(result).toBeDefined();
        expect(result?.error).toMatchObject({
          phase: "baseline",
          reason: primaryTimeout ? "operation-timeout" : "snapshot-error",
        });
        expect(result?.before).toMatchObject({
          cause: {
            type: primaryTimeout ? "timeout" : "error",
            message: primaryTimeout
              ? "TimeoutError: known primary timeout"
              : "Error: known primary failure",
          },
        });
        expect(result).toMatchObject({
          readCleanup: [{ status: "pending" }],
          elapsedMs: 0,
          arrived: false,
        });
        const artifact = JSON.stringify(result);
        b.advance(10_001);
        rejectDisposal(new errors.TimeoutError("late disposal timeout"));
        await vi.advanceTimersByTimeAsync(0);
        expect(JSON.stringify(result)).toBe(artifact);
        await pending;
      } finally {
        rejectDisposal?.(new Error("test cleanup"));
        await vi.advanceTimersByTimeAsync(0);
        vi.useRealTimers();
      }
    },
  );

  it.each(["completed", "failed"])(
    "retains an immediately %s CDP cleanup outcome",
    async (status) => {
      vi.useFakeTimers();
      let rejectRead!: (cause: Error) => void;
      try {
        const b = browser();
        b.page.evaluate.mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectRead = reject;
            }),
        );
        b.cdp.send.mockImplementationOnce(async () => {
          if (status === "failed")
            throw new Error("cleanup transport rejected");
        });
        const pending = b.run();
        await vi.advanceTimersByTimeAsync(0);
        b.advance(10_000);
        await vi.advanceTimersByTimeAsync(10_000);
        const result = await pending;
        expect(result.error).toEqual({
          phase: "baseline",
          reason: "deadline-exceeded",
        });
        expect(result.cleanup).toEqual(
          status === "completed"
            ? { status }
            : {
                status,
                cause: {
                  type: "error",
                  name: "Error",
                  message: "Error: cleanup transport rejected",
                },
              },
        );
        expect(result.arrived).toBe(false);
      } finally {
        rejectRead?.(new Error("test cleanup"));
        await vi.advanceTimersByTimeAsync(0);
        vi.useRealTimers();
      }
    },
  );

  it("still refuses an unapplied camera across all settle polls", async () => {
    const b = browser();
    if (available.status !== "available")
      throw new Error("fixture requires available snapshot");
    b.page.evaluate.mockResolvedValue({
      status: "available",
      snapshot: {
        ...available.snapshot,
        camera: { sampleRevision: 1, scale: 2, transform: "scale(0.02)" },
      },
    });
    const result = await b.run();
    expect(result.arrived).toBe(false);
    expect(result.elapsedMs).toBe(10_000);
    expect(result.finalMeasurement.failedChecks).toEqual([
      "camera",
      "committedCamera",
    ]);
    expect(b.page.evaluate).toHaveBeenCalledTimes(41);
  });

  it.each(["during", "after"])(
    "preserves the receipt when a pending adapter read rejects %s cleanup",
    async (ordering) => {
      vi.useFakeTimers();
      try {
        const b = browser();
        let rejectRead!: (cause: Error) => void;
        b.page.evaluate.mockResolvedValueOnce(available).mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectRead = reject;
            }),
        );
        b.cdp.send.mockImplementationOnce(async () => {
          if (ordering === "during")
            rejectRead(new Error("CDP execution terminated"));
        });
        const pending = b.run();
        await vi.advanceTimersByTimeAsync(0);
        b.advance(10_000);
        await vi.advanceTimersByTimeAsync(10_000);
        const result = await pending;
        expect(result.arrived).toBe(false);
        expect(result.error).toEqual({
          phase: "settle",
          reason: "deadline-exceeded",
        });
        expect(b.cdp.send).toHaveBeenCalledExactlyOnceWith(
          "Runtime.terminateExecution",
        );
        if (ordering === "during") {
          expect(result.final).toMatchObject({
            status: "error",
            reason: "snapshot-read-failed",
            cause: {
              type: "error",
              message: "Error: CDP execution terminated",
            },
          });
        } else {
          expect(result.final).toEqual({
            status: "error",
            reason: "snapshot-read-timed-out",
          });
        }
        const artifact = JSON.stringify(result);
        if (ordering === "after") rejectRead(new Error("late CDP rejection"));
        await vi.advanceTimersByTimeAsync(0);
        expect(JSON.stringify(result)).toBe(artifact);
        expect(b.handle.dispose).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
