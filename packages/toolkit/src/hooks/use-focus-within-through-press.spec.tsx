// @vitest-environment happy-dom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFocusWithinThroughPress } from "./use-focus-within-through-press.js";

function Field() {
  const ref = useRef<HTMLDivElement>(null);
  const { focused, focusWithinProps } = useFocusWithinThroughPress(ref);
  return (
    <div>
      <div ref={ref} data-focused={focused} {...focusWithinProps}>
        <input data-testid="inside" />
        <input data-testid="inside-too" />
      </div>
      <button data-testid="outside" />
    </div>
  );
}

describe("useFocusWithinThroughPress", () => {
  let container: HTMLDivElement;
  let root: Root;

  const inside = () =>
    container.querySelector<HTMLInputElement>('[data-testid="inside"]')!;
  const insideToo = () =>
    container.querySelector<HTMLInputElement>('[data-testid="inside-too"]')!;
  const outside = () =>
    container.querySelector<HTMLButtonElement>('[data-testid="outside"]')!;
  const focused = () =>
    container.querySelector("[data-focused]")?.getAttribute("data-focused");

  const press = (type: "pointerdown" | "pointerup" | "pointercancel") =>
    act(() => {
      outside().dispatchEvent(new Event(type, { bubbles: true }));
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Field />));
    act(() => inside().focus());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports focus entering the element", () => {
    expect(focused()).toBe("true");
  });

  it("clears at once when focus leaves without a press", () => {
    act(() => outside().focus());
    expect(focused()).toBe("false");
  });

  it("stays focused when focus moves within the element", () => {
    act(() => insideToo().focus());
    expect(focused()).toBe("true");
  });

  it("holds through a press outside until that press's click has fired", () => {
    let focusedAtClick: string | null | undefined;
    const onClick = () => {
      focusedAtClick = focused();
    };
    outside().addEventListener("click", onClick);

    press("pointerdown");
    act(() => outside().focus());
    expect(focused()).toBe("true");

    press("pointerup");
    expect(focused()).toBe("true");
    act(() => outside().click());
    expect(focusedAtClick).toBe("true");

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(focused()).toBe("false");
  });

  it("settles after a cancelled press too", () => {
    press("pointerdown");
    act(() => outside().focus());
    press("pointercancel");
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(focused()).toBe("false");
  });

  it("stays focused when focus returns during the press", () => {
    press("pointerdown");
    act(() => outside().focus());
    act(() => inside().focus());
    press("pointerup");
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(focused()).toBe("true");
  });

  it("stays focused when focus returns between the release and the timer", () => {
    press("pointerdown");
    act(() => outside().focus());
    press("pointerup");
    act(() => inside().focus());
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(focused()).toBe("true");
  });

  it("treats a blur after the press as a plain blur", () => {
    press("pointerdown");
    press("pointerup");
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(focused()).toBe("true");
    act(() => outside().focus());
    expect(focused()).toBe("false");
  });

  it("drops a pending settle when it unmounts", () => {
    press("pointerdown");
    act(() => outside().focus());
    press("pointerup");
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });
});
