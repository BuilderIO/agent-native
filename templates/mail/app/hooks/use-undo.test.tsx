// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({ dismiss: vi.fn() }));

vi.mock("sonner", () => ({ toast: { dismiss: toastMocks.dismiss } }));

import {
  clearUndoAction,
  runUndo,
  setUndoAction,
  setUndoToastId,
  UNDO_DURATION,
  useHasUndo,
} from "./use-undo";

beforeEach(() => {
  vi.useFakeTimers();
  toastMocks.dismiss.mockClear();
});

afterEach(() => {
  cleanup();
  clearUndoAction();
  vi.useRealTimers();
});

describe("global undo lifecycle", () => {
  it("is available before 10 seconds and expires at the boundary", () => {
    const action = vi.fn();
    const { result } = renderHook(() => useHasUndo());

    expect(UNDO_DURATION).toBe(10_000);
    act(() => setUndoAction(action));
    expect(result.current).toBe(true);

    act(() => vi.advanceTimersByTime(UNDO_DURATION - 1));
    expect(result.current).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
    act(runUndo);
    expect(action).not.toHaveBeenCalled();
  });

  it("replaces the previous action and makes its toast callback stale", () => {
    const previous = vi.fn();
    const latest = vi.fn();
    let oldToastAction = () => {};
    let latestToastAction = () => {};

    act(() => {
      oldToastAction = setUndoAction(previous);
      setUndoToastId("old-toast");
      latestToastAction = setUndoAction(latest);
      setUndoToastId("latest-toast");
    });

    expect(toastMocks.dismiss).toHaveBeenCalledExactlyOnceWith("old-toast");
    act(oldToastAction);
    expect(previous).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();

    act(latestToastAction);
    expect(latest).toHaveBeenCalledOnce();
    expect(toastMocks.dismiss).toHaveBeenLastCalledWith("latest-toast");
  });

  it("consumes once whether invoked by the toast or the keyboard", () => {
    const fromToast = vi.fn();
    const toastAction = setUndoAction(fromToast);
    setUndoToastId("toast-action");

    act(toastAction);
    act(runUndo);
    act(toastAction);
    expect(fromToast).toHaveBeenCalledOnce();
    expect(toastMocks.dismiss).toHaveBeenCalledExactlyOnceWith("toast-action");

    const fromKeyboard = vi.fn();
    setUndoAction(fromKeyboard);
    setUndoToastId("keyboard-action");
    act(runUndo);
    act(runUndo);
    expect(fromKeyboard).toHaveBeenCalledOnce();
    expect(toastMocks.dismiss).toHaveBeenLastCalledWith("keyboard-action");
  });

  it("clears only the active undo toast and reports no available action", () => {
    const action = vi.fn();
    const { result } = renderHook(() => useHasUndo());

    act(() => {
      setUndoAction(action);
      setUndoToastId("active-toast");
    });
    expect(result.current).toBe(true);

    act(clearUndoAction);
    expect(result.current).toBe(false);
    expect(toastMocks.dismiss).toHaveBeenCalledExactlyOnceWith("active-toast");
    act(runUndo);
    expect(action).not.toHaveBeenCalled();
  });

  it("ignores toast callbacks before they can consume an expired action", () => {
    const action = vi.fn();
    const toastAction = setUndoAction(action);
    setUndoToastId("expired-toast");

    act(() => vi.advanceTimersByTime(UNDO_DURATION + 1));
    act(toastAction);

    expect(action).not.toHaveBeenCalled();
    expect(toastMocks.dismiss).toHaveBeenCalledExactlyOnceWith("expired-toast");
  });
});
