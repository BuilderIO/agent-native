import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBlockFieldSaveController } from "./blockFieldSaveController";

function flushTicks(): Promise<void> {
  vi.runAllTicks();
  return Promise.resolve();
}

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
    await flushTicks();
    expect(save).toHaveBeenCalledExactlyOnceWith("hello");
  });

  it("flushes pending content on unmount/collapse instead of dropping it", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createBlockFieldSaveController({ initialContent: "", save });

    c.change("draft in flight");
    expect(save).not.toHaveBeenCalled();

    const flushed = c.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith("draft in flight");
    expect(c.hasPendingTimer).toBe(false);
    await flushed;
    expect(c.lastSaved).toBe("draft in flight");
  });

  it("flush is a no-op when nothing is dirty", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createBlockFieldSaveController({ initialContent: "same", save });
    await c.flush();
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
    expect(c.lastSaved).toBe("");

    resolveSave?.();
    await flushTicks();
    expect(c.lastSaved).toBe("typed");
  });

  it("tracks hasSavedLocally: false initially, true after a save resolves, cleared by mark()", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createBlockFieldSaveController({ initialContent: "", save });
    expect(c.hasSavedLocally).toBe(false);

    c.change("typed");
    vi.advanceTimersByTime(500);
    await flushTicks();
    expect(c.lastSaved).toBe("typed");
    expect(c.hasSavedLocally).toBe(true);

    c.mark("server value");
    expect(c.hasSavedLocally).toBe(false);
  });

  it("a FAILED save does not set hasSavedLocally", async () => {
    const onError = vi.fn();
    const save = vi.fn().mockRejectedValue(new Error("network"));
    const c = createBlockFieldSaveController({
      initialContent: "",
      save,
      onError,
    });

    c.change("typed");
    vi.advanceTimersByTime(500);
    await flushTicks();
    expect(c.hasSavedLocally).toBe(false);
    expect(c.lastSaved).toBe("");
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

    expect(c.lastSaved).toBe("");
    expect(onError).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.isSaving).toBe(false);

    await c.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("v1");
    expect(c.lastSaved).toBe("v1");
  });

  it("skips a redundant save when the content matches the confirmed baseline", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createBlockFieldSaveController({ initialContent: "x", save });
    c.change("x");
    expect(c.hasPendingTimer).toBe(false);
    void c.flush();
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

  it("single-flight: never overlaps two saves; an edit mid-flight coalesces into one trailing save", async () => {
    const resolvers: Array<() => void> = [];
    const order: string[] = [];
    const save = vi.fn(
      (content: string) =>
        new Promise<void>((resolve) => {
          order.push(content);
          resolvers.push(() => resolve());
        }),
    );
    const c = createBlockFieldSaveController({ initialContent: "", save });

    c.change("old");
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(1, "old");

    c.change("new");
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.pending).toBe("new");

    resolvers[0]!();
    await flushTicks();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, "new");
    expect(c.lastSaved).toBe("old");

    resolvers[1]!();
    await flushTicks();
    expect(c.lastSaved).toBe("new");

    expect(order).toEqual(["old", "new"]);
  });

  it("flush awaits the in-flight save then persists the LATEST content (deterministic last write)", async () => {
    const resolvers: Array<() => void> = [];
    const order: string[] = [];
    const save = vi.fn(
      (content: string) =>
        new Promise<void>((resolve) => {
          order.push(content);
          resolvers.push(() => resolve());
        }),
    );
    const c = createBlockFieldSaveController({ initialContent: "", save });

    c.change("first");
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenNthCalledWith(1, "first");

    c.change("second");
    const flushed = c.flush();
    expect(save).toHaveBeenCalledTimes(1);

    resolvers[0]!();
    await flushTicks();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, "second");
    resolvers[1]!();
    await flushTicks();
    await flushed;

    expect(c.lastSaved).toBe("second");
    expect(order).toEqual(["first", "second"]);
  });
});
