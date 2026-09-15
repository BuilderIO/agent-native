import { describe, expect, it, vi } from "vitest";

import {
  createDesignCanvasInteractionAdapter,
  DESIGN_CANVAS_INTERACTION_CAPABILITIES,
  resolveDesignCanvasShortcut,
} from "./design-canvas-interactions";

function shortcutEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("Design canvas interaction adapter", () => {
  it("resolves Design's standard commands through the shared shortcut registry", () => {
    expect(resolveDesignCanvasShortcut({ key: "d", metaKey: true })).toBe(
      "duplicate",
    );
    expect(
      resolveDesignCanvasShortcut({
        key: "}",
        code: "BracketRight",
        metaKey: true,
      }),
    ).toBe("bring-forward");
    expect(
      resolveDesignCanvasShortcut({ key: "c", metaKey: true, shiftKey: true }),
    ).toBeNull();
  });

  it("keeps Design's double-click text policy and supported capabilities explicit", () => {
    const adapter = createDesignCanvasInteractionAdapter({
      shortcuts: {},
    });

    expect(adapter).toMatchObject({
      id: "design",
      textEditing: {
        activation: "double-click",
        escapeBehavior: "select-object",
      },
      capabilities: {
        selection: true,
        move: true,
        duplicate: true,
        multiSelection: true,
        snapping: true,
        alignment: true,
        grouping: true,
      },
    });
  });

  it("dispatches only commands whose current Design handler is wired", () => {
    const onDuplicate = vi.fn();
    const adapter = createDesignCanvasInteractionAdapter({
      shortcuts: { onDuplicate },
    });
    const event = shortcutEvent({
      key: "d",
      metaKey: true,
    });

    expect(adapter.dispatchShortcut("duplicate", event)).toEqual({
      handled: true,
    });
    expect(onDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ key: "d", primary: true }),
    );
    expect(adapter.dispatchShortcut("delete", event)).toEqual({
      handled: false,
      reason: "unhandled",
    });
  });

  it("uses shared semantic command ids for nudge, alignment, and distribution", () => {
    const onNudge = vi.fn();
    const onAlignSelection = vi.fn();
    const onDistributeSelection = vi.fn();
    const event = shortcutEvent({ key: "ArrowRight", shiftKey: true });
    const adapter = createDesignCanvasInteractionAdapter({
      shortcuts: { onNudge, onAlignSelection, onDistributeSelection },
      getHotkeyDetails: () => ({
        event,
        key: event.key,
        primary: false,
        shift: true,
        alt: false,
        repeat: false,
      }),
    });

    expect(
      adapter.dispatch({ id: "nudge-right", delta: { x: 10, y: 0 } }),
    ).toEqual({ handled: true });
    expect(onNudge).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "right", largeStep: true }),
    );
    expect(adapter.dispatch({ id: "align-middle" })).toEqual({
      handled: true,
    });
    expect(onAlignSelection).toHaveBeenCalledWith(
      expect.objectContaining({ edge: "center-v" }),
    );
    expect(adapter.dispatch({ id: "distribute-horizontal" })).toEqual({
      handled: true,
    });
    expect(onDistributeSelection).toHaveBeenCalledWith(
      expect.objectContaining({ axis: "horizontal" }),
    );
    expect(adapter.dispatch({ id: "nudge" })).toEqual({
      handled: false,
      reason: "unhandled",
    });
  });

  it("routes live keyboard events through the adapter's one dispatch path", () => {
    const onNudge = vi.fn();
    const adapter = createDesignCanvasInteractionAdapter({
      shortcuts: { onNudge },
    });
    const event = shortcutEvent({ key: "ArrowLeft", shiftKey: true });

    expect(adapter.dispatchKeyboardEvent(event)).toEqual({ handled: true });
    expect(onNudge).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "left", largeStep: true }),
    );
  });

  it("keeps every shared capability explicit rather than maintaining a local mirror", () => {
    expect(DESIGN_CANVAS_INTERACTION_CAPABILITIES).toEqual({
      selection: true,
      multiSelection: true,
      move: true,
      resize: true,
      textEditing: true,
      nudge: true,
      duplicate: true,
      clipboard: true,
      delete: true,
      arrange: true,
      snapping: true,
      alignment: true,
      distribution: true,
      grouping: true,
      rotation: true,
      marquee: true,
    });
  });
});
