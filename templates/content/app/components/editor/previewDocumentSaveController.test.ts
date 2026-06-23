import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPreviewDocumentSaveController,
  type PreviewDocumentPayload,
} from "./previewDocumentSaveController";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const initial: PreviewDocumentPayload = { title: "T0", content: "C0" };

describe("previewDocumentSaveController", () => {
  it("debounces a primary-body edit and persists after the delay", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createPreviewDocumentSaveController({ initial, save });

    c.changeContent("C1");
    expect(save).not.toHaveBeenCalled();
    expect(c.hasPendingTimer).toBe(true);

    vi.advanceTimersByTime(450);
    await vi.runAllTicks();
    expect(save).toHaveBeenCalledExactlyOnceWith({ title: "T0", content: "C1" });
    expect(c.lastSaved).toEqual({ title: "T0", content: "C1" });
  });

  // THE BUG: a pending primary-body edit was DROPPED when the peek closed /
  // switched row / unmounted before the 450ms debounce fired. flush() must
  // persist it instead.
  it("flushes a pending primary-body edit on close/switch/unmount instead of dropping it", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createPreviewDocumentSaveController({ initial, save });

    // User typed in the peek body but the debounce has NOT fired yet.
    c.changeContent("edited body");
    expect(save).not.toHaveBeenCalled();
    expect(c.hasPendingTimer).toBe(true);

    // Sheet close / row switch / unmount flushes immediately, before the timer.
    const flushed = c.flush();
    expect(c.hasPendingTimer).toBe(false);
    expect(save).toHaveBeenCalledExactlyOnceWith({
      title: "T0",
      content: "edited body",
    });
    await flushed;
    expect(c.lastSaved).toEqual({ title: "T0", content: "edited body" });
  });

  it("flush issues the save synchronously (write dispatched before async teardown like Open-page)", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createPreviewDocumentSaveController({ initial, save });

    c.changeContent("body before navigate");
    // The Open-page handler navigates right after teardown; the write must
    // already be in flight by the time flush() returns its promise.
    void c.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith({
      title: "T0",
      content: "body before navigate",
    });
  });

  it("flush is a no-op when nothing is dirty (no double-save of unchanged content)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createPreviewDocumentSaveController({ initial, save });
    await c.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("does NOT re-save after a debounced save already persisted (no double-save)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createPreviewDocumentSaveController({ initial, save });

    c.changeContent("C1");
    vi.advanceTimersByTime(450);
    await vi.runAllTicks();
    expect(save).toHaveBeenCalledTimes(1);

    // Closing afterwards must not fire a second identical save.
    await c.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("marks clean only AFTER the save resolves; a failed save stays dirty and retries on flush", async () => {
    let rejectSave: ((err: unknown) => void) | undefined;
    const onError = vi.fn();
    const save = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((_resolve, reject) => (rejectSave = reject)),
      )
      .mockResolvedValue(undefined);
    const c = createPreviewDocumentSaveController({ initial, save, onError });

    c.changeContent("C1");
    vi.advanceTimersByTime(450);
    // In flight, not yet resolved — still dirty.
    expect(c.isSaving).toBe(true);
    expect(c.lastSaved).toEqual({ title: "T0", content: "C0" });

    rejectSave?.(new Error("network"));
    // Let the rejection's .catch microtask settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
    expect(c.lastSaved).toEqual({ title: "T0", content: "C0" });

    // A subsequent flush retries the still-dirty value rather than skipping it.
    await c.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ title: "T0", content: "C1" });
    expect(c.lastSaved).toEqual({ title: "T0", content: "C1" });
  });

  it("coalesces edits made while a save is in flight into one trailing save (single-flight)", async () => {
    let resolveFirst: (() => void) | undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValue(undefined);
    const c = createPreviewDocumentSaveController({ initial, save });

    c.changeContent("C1");
    vi.advanceTimersByTime(450);
    await vi.runAllTicks();
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.isSaving).toBe(true);

    // Two more edits while the first save is in flight — they must NOT start new
    // saves; they coalesce into one trailing save of the LATEST payload.
    c.changeContent("C2");
    c.changeTitle("T1");
    vi.advanceTimersByTime(450);
    await vi.runAllTicks();
    expect(save).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await vi.runAllTicks();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ title: "T1", content: "C2" });
  });

  it("mark() adopts a new baseline (e.g. row switch) without scheduling a save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createPreviewDocumentSaveController({ initial, save });

    c.mark({ title: "T9", content: "C9" });
    expect(c.hasPendingTimer).toBe(false);
    await c.flush();
    expect(save).not.toHaveBeenCalled();
    expect(c.lastSaved).toEqual({ title: "T9", content: "C9" });
  });

  it("title and content edits both flush together in one payload", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = createPreviewDocumentSaveController({ initial, save });

    c.changeTitle("new title");
    c.changeContent("new body");
    // Both edits pending, debounce not fired — closing flushes the combined payload.
    await c.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith({
      title: "new title",
      content: "new body",
    });
  });
});
