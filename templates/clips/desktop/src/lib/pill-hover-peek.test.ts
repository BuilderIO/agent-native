import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHoverPeek } from "./pill-hover-peek";

describe("createHoverPeek", () => {
  let setExpanded: ReturnType<typeof vi.fn<(expanded: boolean) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    setExpanded = vi.fn<(expanded: boolean) => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function peek() {
    return createHoverPeek({
      openDelayMs: 150,
      closeDelayMs: 300,
      setExpanded,
    });
  }

  it("reveals the transcript once the pointer rests on the pill", () => {
    const controller = peek();
    controller.hover(true);
    vi.advanceTimersByTime(149);
    expect(setExpanded).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setExpanded).toHaveBeenCalledWith(true);
    expect(controller.state()).toBe("peeking");
  });

  it("ignores a pointer that only passes over the pill", () => {
    const controller = peek();
    controller.hover(true);
    vi.advanceTimersByTime(100);
    controller.hover(false);
    vi.advanceTimersByTime(1_000);
    expect(setExpanded).not.toHaveBeenCalled();
    expect(controller.state()).toBe("closed");
  });

  it("hides the peeked transcript after the pointer leaves", () => {
    const controller = peek();
    controller.hover(true);
    vi.advanceTimersByTime(150);
    controller.hover(false);
    vi.advanceTimersByTime(299);
    expect(setExpanded).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(1);
    expect(setExpanded).toHaveBeenLastCalledWith(false);
    expect(controller.state()).toBe("closed");
  });

  it("keeps the transcript open when the pointer comes back within the grace period", () => {
    const controller = peek();
    controller.hover(true);
    vi.advanceTimersByTime(150);
    controller.hover(false);
    vi.advanceTimersByTime(200);
    controller.hover(true);
    vi.advanceTimersByTime(1_000);
    expect(setExpanded).toHaveBeenCalledTimes(1);
    expect(controller.state()).toBe("peeking");
  });

  it("keeps a transcript the user interacted with open after the pointer leaves", () => {
    const controller = peek();
    controller.hover(true);
    vi.advanceTimersByTime(150);
    controller.interact();
    controller.hover(false);
    vi.advanceTimersByTime(1_000);
    expect(setExpanded).toHaveBeenLastCalledWith(true);
    expect(controller.state()).toBe("pinned");
  });

  it("pins on toggle and collapses on a second toggle without re-peeking under the pointer", () => {
    const controller = peek();
    controller.hover(true);
    controller.toggle();
    expect(setExpanded).toHaveBeenLastCalledWith(true);
    expect(controller.state()).toBe("pinned");
    vi.advanceTimersByTime(1_000);
    controller.toggle();
    expect(setExpanded).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(1_000);
    expect(controller.state()).toBe("closed");
    controller.hover(false);
    controller.hover(true);
    vi.advanceTimersByTime(150);
    expect(controller.state()).toBe("peeking");
  });

  it("collapses a peek on toggle", () => {
    const controller = peek();
    controller.hover(true);
    vi.advanceTimersByTime(150);
    controller.toggle();
    expect(setExpanded).toHaveBeenLastCalledWith(false);
    expect(controller.state()).toBe("closed");
  });

  it("does not peek while disabled and closes a peek when disabled", () => {
    const controller = peek();
    controller.hover(true);
    vi.advanceTimersByTime(150);
    controller.setEnabled(false);
    expect(setExpanded).toHaveBeenLastCalledWith(false);
    controller.hover(false);
    controller.hover(true);
    vi.advanceTimersByTime(1_000);
    expect(setExpanded).toHaveBeenCalledTimes(2);
    controller.setEnabled(true);
    vi.advanceTimersByTime(150);
    expect(controller.state()).toBe("peeking");
  });

  it("leaves a pinned transcript open when disabled", () => {
    const controller = peek();
    controller.pin();
    controller.setEnabled(false);
    expect(setExpanded).toHaveBeenCalledTimes(1);
    expect(controller.state()).toBe("pinned");
  });

  it("forgets a pin when the owner collapses the pill, without re-peeking under the pointer", () => {
    const controller = peek();
    controller.pin();
    controller.hover(true);
    controller.reset();
    vi.advanceTimersByTime(1_000);
    expect(setExpanded).toHaveBeenCalledTimes(1);
    expect(controller.state()).toBe("closed");
    controller.toggle();
    expect(setExpanded).toHaveBeenLastCalledWith(true);
  });

  it("drops pending timers on dispose", () => {
    const controller = peek();
    controller.hover(true);
    controller.dispose();
    vi.advanceTimersByTime(1_000);
    expect(setExpanded).not.toHaveBeenCalled();
  });
});
