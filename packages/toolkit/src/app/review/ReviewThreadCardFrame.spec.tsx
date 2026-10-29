// @vitest-environment happy-dom

import { act, createRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewThreadCardFrame } from "./ReviewThreadCardFrame.js";

describe("ReviewThreadCardFrame", () => {
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

  const render = (element: ReactElement) => act(() => root.render(element));
  const card = () =>
    container.querySelector<HTMLElement>("[data-review-thread-card]");

  it("is a dialog named by its visible title", () => {
    render(
      <ReviewThreadCardFrame title="Comment">
        <p>Body</p>
      </ReviewThreadCardFrame>,
    );

    expect(card()?.getAttribute("role")).toBe("dialog");
    const labelledBy = card()?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const title = labelledBy ? document.getElementById(labelledBy) : null;
    expect(title?.textContent).toBe("Comment");
    expect(card()?.contains(title)).toBe(true);
    expect(card()?.hasAttribute("aria-label")).toBe(false);
  });

  it("gives every card its own title id", () => {
    render(
      <>
        <ReviewThreadCardFrame title="First" />
        <ReviewThreadCardFrame title="Second" />
      </>,
    );

    const ids = Array.from(
      container.querySelectorAll("[data-review-thread-card]"),
    ).map((element) => element.getAttribute("aria-labelledby"));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("falls back to an aria-label when the title bar is hidden", () => {
    render(
      <ReviewThreadCardFrame showTitleBar={false} ariaLabel="Thread">
        <p>Body</p>
      </ReviewThreadCardFrame>,
    );

    expect(card()?.getAttribute("role")).toBe("dialog");
    expect(card()?.getAttribute("aria-label")).toBe("Thread");
    expect(card()?.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("takes programmatic focus through its ref but stays out of the tab order", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <>
        <button type="button">Before</button>
        <ReviewThreadCardFrame ref={ref} title="Comment" onClose={vi.fn()} />
      </>,
    );

    expect(ref.current).toBe(card());
    expect(card()?.getAttribute("tabindex")).toBe("-1");
    act(() => ref.current?.focus());
    expect(document.activeElement).toBe(card());
  });

  it("shows its focus outline for keyboard focus only, without adding chrome", () => {
    render(<ReviewThreadCardFrame title="Comment" />);

    const classes = card()?.className.split(/\s+/) ?? [];
    expect(classes).toContain("focus-visible:outline-2");
    expect(classes).not.toContain("outline-2");
    expect(classes).not.toContain("focus:outline-2");
  });
});
