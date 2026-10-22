// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UndoReveal } from "@/lib/undo-reveal";

import { UNDO_SELECTION_TTL_MS, useUndoSelection } from "./use-undo-selection";

function setup(currentSlideId: string | undefined = "slide-1") {
  let emit: (reveal: UndoReveal) => void = () => {};
  const subscribe = vi.fn((listener: (reveal: UndoReveal) => void) => {
    emit = listener;
    return () => {};
  });
  const selectSlide = vi.fn();
  const hook = renderHook(() =>
    useUndoSelection({
      deckId: "deck-1",
      subscribe,
      getCurrentSlideId: () => currentSlideId,
      selectSlide,
    }),
  );
  const reveal = (slideId: string, deckId = "deck-1"): UndoReveal => ({
    deckId,
    direction: "undo",
    slides: [{ slideId, targets: [{ objectId: "a", path: [0] }] }],
  });
  return {
    hook,
    selectSlide,
    emit: (r: UndoReveal) => act(() => emit(r)),
    reveal,
  };
}

describe("useUndoSelection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("hands the editor a request for the rewritten slide", () => {
    const { hook, emit, reveal, selectSlide } = setup();
    emit(reveal("slide-1"));
    expect(hook.result.current.undoSelection).toMatchObject({
      sequence: 1,
      slideId: "slide-1",
    });
    expect(selectSlide).not.toHaveBeenCalled();
  });

  it("switches to a rewritten slide that is not open and keeps the request for it", () => {
    const { hook, emit, reveal, selectSlide } = setup("slide-1");
    emit(reveal("slide-2"));
    expect(selectSlide).toHaveBeenCalledWith("slide-2");
    expect(hook.result.current.undoSelection?.slideId).toBe("slide-2");
  });

  it("ignores a step from another deck", () => {
    const { hook, emit, reveal } = setup();
    emit(reveal("slide-1", "deck-2"));
    expect(hook.result.current.undoSelection).toBeNull();
  });

  it("expires a request no editor applied, so later content cannot reuse its paths", () => {
    const { hook, emit, reveal } = setup();
    emit(reveal("slide-1"));
    act(() => vi.advanceTimersByTime(UNDO_SELECTION_TTL_MS - 1));
    expect(hook.result.current.undoSelection).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(hook.result.current.undoSelection).toBeNull();
  });

  it("restarts the lifetime for a newer request", () => {
    const { hook, emit, reveal } = setup();
    emit(reveal("slide-1"));
    act(() => vi.advanceTimersByTime(UNDO_SELECTION_TTL_MS - 100));
    emit(reveal("slide-1"));
    act(() => vi.advanceTimersByTime(UNDO_SELECTION_TTL_MS - 100));
    expect(hook.result.current.undoSelection?.sequence).toBe(2);
  });

  it("drops the request as soon as the editor consumes it", () => {
    const { hook, emit, reveal } = setup();
    emit(reveal("slide-1"));
    act(() => hook.result.current.clearUndoSelection());
    expect(hook.result.current.undoSelection).toBeNull();
  });
});
