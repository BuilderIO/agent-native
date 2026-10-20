import { describe, expect, it, vi } from "vitest";

import {
  deferCaptureUntilDisplaySelection,
  waitForMonitorPickerSelection,
} from "./recorder";

describe("native capture selection lifecycle", () => {
  it("does not start secondary capture while display selection is pending", async () => {
    let resolveDisplay!: () => void;
    const displaySelection = new Promise<void>((resolve) => {
      resolveDisplay = resolve;
    });
    const acquire = vi.fn(async () => "mic");

    const secondary = deferCaptureUntilDisplaySelection(
      displaySelection,
      acquire,
    );
    await Promise.resolve();
    expect(acquire).not.toHaveBeenCalled();

    resolveDisplay();
    await expect(secondary).resolves.toBe("mic");
    expect(acquire).toHaveBeenCalledOnce();
  });

  it("waits for both event listeners before declaring the picker ready", async () => {
    const handlers = new Map<
      string,
      (event?: { payload?: { displayId?: number | null } }) => void
    >();
    const unlistenSelected = vi.fn();
    const unlistenCancelled = vi.fn();
    let resolveSelected!: (unlisten: () => void) => void;
    let resolveCancelled!: (unlisten: () => void) => void;
    const selectedReady = new Promise<() => void>((resolve) => {
      resolveSelected = resolve;
    });
    const cancelledReady = new Promise<() => void>((resolve) => {
      resolveCancelled = resolve;
    });
    const register = vi.fn(
      (
        event: string,
        handler: (event?: { payload?: { displayId?: number | null } }) => void,
      ) => {
        handlers.set(event, handler);
        return event.endsWith("selected") ? selectedReady : cancelledReady;
      },
    );

    const waiter = waitForMonitorPickerSelection(register as never);
    let ready = false;
    void waiter.listenersReady.then(() => {
      ready = true;
    });

    handlers.get("clips:monitor-picker-selected")?.({
      payload: { displayId: 42 },
    });
    await expect(waiter.promise).resolves.toBe(42);
    expect(ready).toBe(false);

    resolveSelected(unlistenSelected);
    resolveCancelled(unlistenCancelled);
    await waiter.listenersReady;
    expect(ready).toBe(true);
    expect(unlistenSelected).toHaveBeenCalledOnce();
    expect(unlistenCancelled).toHaveBeenCalledOnce();
  });

  it("cancels and removes picker listeners exactly once", async () => {
    const handlers = new Map<string, () => void>();
    const unlisten = vi.fn();
    const register = vi.fn((event: string, handler: () => void) => {
      handlers.set(event, handler);
      return Promise.resolve(unlisten);
    });
    const waiter = waitForMonitorPickerSelection(register as never);
    await waiter.listenersReady;

    handlers.get("clips:monitor-picker-cancelled")?.();
    await expect(waiter.promise).rejects.toMatchObject({ name: "AbortError" });
    waiter.cleanup();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });
});
