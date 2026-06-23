import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBlockFieldSaveController } from "./blockFieldSaveController";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("blockFieldSaveController", () => {
  it("debounces a save and persists after the delay", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createBlockFieldSaveController({ initialContent: "", save });

    c.change("hello");
    expect(save).not.toHaveBeenCalled();
    expect(c.hasPendingTimer).toBe(true);

    vi.advanceTimersByTime(500);
    await vi.runAllTicks();
    expect(save).toHaveBeenCalledExactlyOnceWith("hello");
  });

  it("flushes pending content on unmount/collapse instead of dropping it", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createBlockFieldSaveController({ initialContent: "", save });

    // User typed but the 500ms debounce has NOT fired yet.
    c.change("draft in flight");
    expect(save).not.toHaveBeenCalled();

    // Collapsing the field / navigating away flushes immediately.
    c.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith("draft in flight");
    expect(c.hasPendingTimer).toBe(false);
  });

  it("flush is a no-op when nothing is dirty", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createBlockFieldSaveController({ initialContent: "same", save });
    c.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("marks clean only AFTER the save resolves", async () => {
    let resolveSave: (() => void) | undefined;
    const save = vi.fn(
      () => new Promise<void>((resolve) => (resolveSave = resolve)),
    );
    const c = createBlockFieldSaveController({ initialContent: "", save });

    c.change("typed");
    vi.advanceTimersByTime(500);
    // Save is in flight but not yet resolved — still dirty.
    expect(c.lastSaved).toBe("");

    resolveSave?.();
    await vi.runAllTicks();
    expect(c.lastSaved).toBe("typed");
  });

  it("does NOT mark clean when the save fails, so the value stays dirty and retries", async () => {
    const onError = vi.fn();
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    const c = createBlockFieldSaveController({
      initialContent: "",
      save,
      onError,
    });

    c.change("v1");
    await vi.advanceTimersByTimeAsync(500);

    // Failed save must not be recorded as saved.
    expect(c.lastSaved).toBe("");
    expect(onError).toHaveBeenCalledOnce();

    // A subsequent flush retries the still-dirty value rather than skipping it.
    c.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("v1");
    await vi.advanceTimersByTimeAsync(0);
    expect(c.lastSaved).toBe("v1");
  });

  it("skips a redundant save when the content matches the confirmed baseline", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createBlockFieldSaveController({ initialContent: "x", save });
    c.change("x");
    expect(c.hasPendingTimer).toBe(false);
    c.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("mark() adopts server content as the baseline without scheduling a save", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createBlockFieldSaveController({ initialContent: "old", save });
    c.mark("agent edit");
    expect(c.lastSaved).toBe("agent edit");
    expect(c.pending).toBe("agent edit");
    expect(save).not.toHaveBeenCalled();
  });
});
