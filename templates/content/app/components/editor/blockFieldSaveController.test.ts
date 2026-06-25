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
    // Save is in flight but not yet resolved — still dirty.
    expect(c.lastSaved).toBe("");

    resolveSave?.();
    await vi.runAllTicks();
    expect(c.lastSaved).toBe("typed");
  });

  it("tracks hasSavedLocally: false initially, true after a save resolves, cleared by mark()", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createBlockFieldSaveController({ initialContent: "", save });
    // Fresh controller has not originated any local save yet.
    expect(c.hasSavedLocally).toBe(false);

    c.change("typed");
    vi.advanceTimersByTime(500);
    await vi.runAllTicks();
    // A confirmed local save flips it true — lastSaved is now content we
    // originated that the server may not have echoed yet.
    expect(c.lastSaved).toBe("typed");
    expect(c.hasSavedLocally).toBe(true);

    // Adopting server content as the new baseline clears it: server is no longer
    // "behind" this controller.
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
    await vi.runAllTicks();
    // The save rejected, so the value stayed dirty and nothing was confirmed.
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

    // Failed save must not be recorded as saved, and must NOT auto-retry in a
    // tight loop (single save attempt for this debounce).
    expect(c.lastSaved).toBe("");
    expect(onError).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.isSaving).toBe(false);

    // A subsequent flush retries the still-dirty value rather than skipping it.
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

  it("single-flight: never overlaps two saves; an edit mid-flight coalesces into one trailing save", async () => {
    // The server write is unconditional (last write wins at the DB), so the ONLY
    // safe guarantee is that we never have two saves in flight. While save A is
    // in flight, typing more must NOT start save B; it coalesces, and a single
    // trailing save fires for the LATEST content only after A settles.
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

    // A: type "old", debounce fires → save("old") in flight.
    c.change("old");
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(1, "old");

    // While A is in flight, type "new" and let its debounce fire. Single-flight
    // means NO second save starts yet — it is coalesced into pending.
    c.change("new");
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.pending).toBe("new");

    // A settles. Its successful completion kicks exactly ONE trailing save for
    // the latest pending content.
    resolvers[0]!();
    await vi.runAllTicks();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, "new");
    expect(c.lastSaved).toBe("old"); // "new" not confirmed until it resolves.

    // Trailing save settles → latest content is the final persisted value.
    resolvers[1]!();
    await vi.runAllTicks();
    expect(c.lastSaved).toBe("new");

    // Server saw the writes in issue order: old before new.
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

    // First edit fires a debounced save that is still in flight.
    c.change("first");
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenNthCalledWith(1, "first");

    // User types more, then unmount-flushes before any new debounce fires. flush
    // must NOT start a second save while the first is in flight (single-flight);
    // it awaits the first, then sends the final pending content.
    c.change("second");
    const flushed = c.flush();
    expect(save).toHaveBeenCalledTimes(1); // not yet — first still in flight.

    // Let the in-flight first save resolve; flush then issues the trailing save.
    resolvers[0]!();
    await vi.runAllTicks();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, "second");
    resolvers[1]!();
    await vi.runAllTicks();
    await flushed;

    // Deterministically the latest content is the last thing written.
    expect(c.lastSaved).toBe("second");
    expect(order).toEqual(["first", "second"]); // never out of order.
  });
});
