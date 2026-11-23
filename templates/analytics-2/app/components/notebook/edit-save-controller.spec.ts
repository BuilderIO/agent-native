import { describe, expect, it, vi } from "vitest";

import {
  createEditSaveController,
  EDIT_SAVE_DELAY_MS,
} from "./edit-save-controller";

/** A timer the test drives by hand, recording the delay each schedule asked for. */
function manualTimer() {
  let next = 1;
  const pending = new Map<number, () => void>();
  const delays: number[] = [];
  return {
    timer: {
      schedule: (callback: () => void, delayMs: number) => {
        delays.push(delayMs);
        const handle = next++;
        pending.set(handle, callback);
        return handle;
      },
      clear: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
    delays,
    fireAll: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    size: () => pending.size,
  };
}

const drain = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("edit save controller", () => {
  it("schedules the save with the settle delay, not immediately", () => {
    const manual = manualTimer();
    const save = vi.fn(async () => undefined);
    const controller = createEditSaveController({ timer: manual.timer });

    controller.edit("cell-1", save);
    // The delay the controller actually asked the timer for is the rule, so a
    // zero-delay mutant fails here even though a hand-driven timer fires later.
    expect(manual.delays).toEqual([EDIT_SAVE_DELAY_MS]);
    expect(EDIT_SAVE_DELAY_MS).toBe(500);
    expect(save).not.toHaveBeenCalled();
  });

  it("collapses edits inside the window into one save that uses the latest save", async () => {
    const manual = manualTimer();
    const first = vi.fn(async () => undefined);
    const latest = vi.fn(async () => undefined);
    const controller = createEditSaveController({ timer: manual.timer });

    controller.edit("cell-1", first);
    controller.edit("cell-1", latest);
    controller.edit("cell-1", latest);
    expect(manual.size()).toBe(1);

    manual.fireAll();
    await drain();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("queues exactly one more save when an edit lands mid-flight", async () => {
    const manual = manualTimer();
    const releases: Array<() => void> = [];
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );
    const controller = createEditSaveController({ timer: manual.timer });

    controller.edit("cell-1", save);
    manual.fireAll();
    await drain();
    expect(save).toHaveBeenCalledTimes(1);

    // Typing continues while the first save is still running: two edits, one save.
    controller.edit("cell-1", save);
    controller.edit("cell-1", save);
    expect(save).toHaveBeenCalledTimes(1);

    releases.shift()?.();
    await drain();
    expect(save).toHaveBeenCalledTimes(2);

    releases.shift()?.();
    await drain();
    // Nothing left to save, so a third call would mean the queue re-armed itself.
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("drops a pending save when the cell is discarded", async () => {
    const manual = manualTimer();
    const save = vi.fn(async () => undefined);
    const controller = createEditSaveController({ timer: manual.timer });

    controller.edit("cell-1", save);
    controller.cancel("cell-1");
    expect(manual.size()).toBe(0);
    manual.fireAll();
    await drain();
    expect(save).not.toHaveBeenCalled();
    expect(controller.pendingIds()).toEqual([]);
  });

  it("flushes a pending save immediately, once", async () => {
    const manual = manualTimer();
    const save = vi.fn(async () => undefined);
    const controller = createEditSaveController({ timer: manual.timer });

    controller.edit("cell-1", save);
    await controller.flush("cell-1");
    expect(save).toHaveBeenCalledTimes(1);

    manual.fireAll();
    await drain();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flushes every pending cell at once, for the page-hide path", async () => {
    const manual = manualTimer();
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const controller = createEditSaveController({ timer: manual.timer });
    controller.edit("cell-1", first);
    controller.edit("cell-2", second);
    await controller.flushAll();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    manual.fireAll();
    await drain();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
