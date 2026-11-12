// @vitest-environment happy-dom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRovingFocus } from "./roving-focus.js";

function Toolbar({
  dir,
  disabledMiddle = false,
}: {
  dir?: "rtl";
  disabledMiddle?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [extra, setExtra] = useState(false);
  useRovingFocus(ref);
  return (
    <div ref={ref} role="toolbar" dir={dir}>
      <button type="button">Copy</button>
      <button type="button" disabled={disabledMiddle}>
        Good
      </button>
      <button type="button" onClick={() => setExtra(true)}>
        More
      </button>
      <div inert>
        <button type="button">Hidden</button>
      </div>
      {extra ? <button type="button">Fork</button> : null}
    </div>
  );
}

describe("useRovingFocus", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const button = (name: string) => {
    const match = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === name,
    );
    if (!match) throw new Error(`No ${name} button`);
    return match;
  };
  const tabStops = () =>
    Array.from(container.querySelectorAll("button"))
      .filter((item) => item.tabIndex === 0)
      .map((item) => item.textContent);
  const press = (key: string) =>
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    });

  it("gives the toolbar one tab stop and moves it with the arrow keys", async () => {
    await act(async () => root.render(<Toolbar />));
    expect(tabStops()).toEqual(["Copy"]);

    act(() => button("Copy").focus());
    await press("ArrowRight");
    expect(document.activeElement).toBe(button("Good"));
    expect(tabStops()).toEqual(["Good"]);

    await press("End");
    expect(document.activeElement).toBe(button("More"));
    await press("ArrowRight");
    expect(document.activeElement).toBe(button("Copy"));
    await press("ArrowLeft");
    expect(document.activeElement).toBe(button("More"));
    await press("Home");
    expect(document.activeElement).toBe(button("Copy"));
  });

  it("skips disabled and inert items", async () => {
    await act(async () => root.render(<Toolbar disabledMiddle />));
    act(() => button("Copy").focus());
    await press("ArrowRight");
    expect(document.activeElement).toBe(button("More"));
    expect(button("Hidden").tabIndex).not.toBe(0);
  });

  it("follows reading direction in a right-to-left toolbar", async () => {
    await act(async () => root.render(<Toolbar dir="rtl" />));
    act(() => button("Copy").focus());
    await press("ArrowLeft");
    expect(document.activeElement).toBe(button("Good"));
  });

  it("keeps a button added later out of the tab order", async () => {
    await act(async () => root.render(<Toolbar />));
    await act(async () => button("More").click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tabStops()).toEqual(["Copy"]);
    expect(button("Fork").tabIndex).toBe(-1);
  });
});
