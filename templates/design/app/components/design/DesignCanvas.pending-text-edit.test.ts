import { describe, expect, it, vi } from "vitest";

import {
  PENDING_TEXT_EDIT_TIMEOUT_MS,
  POINTER_TEXT_EDIT_ACTIVATION_DELAY_MS,
  routePendingTextEditKey,
  schedulePendingTextEditActivation,
} from "./design-canvas/pending-text-edit";

// Creation-race keystroke routing: while a begin-text-edit command is pending
// (text element created, bridge session not yet active), host keystrokes are
// routed through this policy so they can never hit host shortcuts — the
// overnight failure mode was arrow keys panning and Delete deleting whole
// layers/screens while the user believed they were typing into the new text.
describe("routePendingTextEditKey", () => {
  it("buffers printable characters (letters, digits, space, symbols)", () => {
    expect(routePendingTextEditKey({ key: "h" })).toEqual({
      action: "buffer",
      char: "h",
    });
    expect(routePendingTextEditKey({ key: "5" })).toEqual({
      action: "buffer",
      char: "5",
    });
    expect(routePendingTextEditKey({ key: " " })).toEqual({
      action: "buffer",
      char: " ",
    });
    expect(routePendingTextEditKey({ key: "!" })).toEqual({
      action: "buffer",
      char: "!",
    });
    // Alt-composed glyphs (e.g. Option+e on macOS) still arrive as a single
    // printable key value and belong in the text, not in host shortcuts.
    expect(routePendingTextEditKey({ key: "é", altKey: true })).toEqual({
      action: "buffer",
      char: "é",
    });
  });

  it("never lets destructive/navigation keys fall through to host shortcuts", () => {
    expect(routePendingTextEditKey({ key: "Delete" })).toEqual({
      action: "swallow",
    });
    expect(routePendingTextEditKey({ key: "Enter" })).toEqual({
      action: "swallow",
    });
    expect(routePendingTextEditKey({ key: "Tab" })).toEqual({
      action: "swallow",
    });
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      expect(routePendingTextEditKey({ key })).toEqual({ action: "swallow" });
    }
  });

  it("Backspace edits the pending buffer instead of deleting layers", () => {
    expect(routePendingTextEditKey({ key: "Backspace" })).toEqual({
      action: "drop-last",
    });
  });

  it("Escape aborts the pending replay and is swallowed", () => {
    expect(routePendingTextEditKey({ key: "Escape" })).toEqual({
      action: "clear-and-swallow",
    });
  });

  it("passes through IME composition and Cmd/Ctrl chords (undo must keep working)", () => {
    expect(routePendingTextEditKey({ key: "a", isComposing: true })).toEqual({
      action: "pass",
    });
    expect(routePendingTextEditKey({ key: "z", metaKey: true })).toEqual({
      action: "pass",
    });
    expect(routePendingTextEditKey({ key: "z", ctrlKey: true })).toEqual({
      action: "pass",
    });
  });

  it("passes through non-printable keys it has no opinion about", () => {
    expect(routePendingTextEditKey({ key: "F5" })).toEqual({ action: "pass" });
    expect(routePendingTextEditKey({ key: "Shift" })).toEqual({
      action: "pass",
    });
    expect(routePendingTextEditKey({ key: "Home" })).toEqual({
      action: "pass",
    });
  });

  it("keeps the stand-down timeout aligned with the bridge retry window", () => {
    // Bridge begin-text-edit retry window is ~2s; the host buffer must
    // outlive it (plus round-trip slack) or keys leak to shortcuts right at
    // the end of a slow activation.
    expect(PENDING_TEXT_EDIT_TIMEOUT_MS).toBeGreaterThanOrEqual(2000);
    expect(PENDING_TEXT_EDIT_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});

describe("schedulePendingTextEditActivation", () => {
  it("waits for the trailing click task after pointer-created text", () => {
    const scheduled: Array<() => void> = [];
    const delays: number[] = [];
    const activate = vi.fn();

    schedulePendingTextEditActivation(activate, {
      afterPointerGesture: true,
      schedule: (callback, delayMs) => {
        scheduled.push(callback);
        delays.push(delayMs);
      },
    });

    expect(activate).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    expect(delays).toEqual([POINTER_TEXT_EDIT_ACTIVATION_DELAY_MS]);
    scheduled[0]?.();
    expect(activate).toHaveBeenCalledOnce();
  });

  it("keeps non-pointer activation synchronous", () => {
    const activate = vi.fn();
    schedulePendingTextEditActivation(activate);
    expect(activate).toHaveBeenCalledOnce();
  });
});
