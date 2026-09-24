// @vitest-environment happy-dom

import { act } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSidebar } from "./sidebar.js";

describe("AppSidebar overflow affordances", () => {
  let container: HTMLDivElement;
  let root: Root;
  let resize: () => void;

  beforeEach(() => {
    const resizeCallbacks: Array<() => void> = [];
    resize = () => resizeCallbacks.forEach((callback) => callback());
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(children = <button type="button">Calendar</button>) {
    act(() => {
      root.render(
        <AppSidebar brandName="Calendar" overflowAffordances>
          {children}
        </AppSidebar>,
      );
    });
    return container.querySelector<HTMLDivElement>(
      "[data-app-sidebar-scroll-viewport]",
    )!;
  }

  function setDimensions(
    viewport: HTMLDivElement,
    height = 600,
    contentHeight = 1000,
  ) {
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: height },
      scrollHeight: { configurable: true, value: contentHeight },
    });
  }

  it("shows the relevant edge cues as the user scrolls", () => {
    const viewport = render();
    setDimensions(viewport);
    act(() => resize());
    expect(container.querySelector('[data-scroll-edge="top"]')).toBeNull();
    expect(
      container.querySelector('[data-scroll-edge="bottom"]'),
    ).not.toBeNull();

    act(() => {
      viewport.scrollTop = 200;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(container.querySelectorAll("[data-scroll-edge]")).toHaveLength(2);

    act(() => {
      viewport.scrollTop = 399.5;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(container.querySelector('[data-scroll-edge="top"]')).not.toBeNull();
    expect(container.querySelector('[data-scroll-edge="bottom"]')).toBeNull();
  });

  it("removes the cues when resized content fits", () => {
    const viewport = render();
    setDimensions(viewport);
    act(() => resize());
    setDimensions(viewport, 600, 600.5);
    act(() => resize());
    expect(container.querySelectorAll("[data-scroll-edge]")).toHaveLength(0);
  });

  it("reveals focused controls clear of an edge cue", () => {
    const viewport = render();
    setDimensions(viewport);
    const button = container.querySelector<HTMLButtonElement>("nav button")!;
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      top: 50,
      bottom: 650,
    } as DOMRect);
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      top: 640,
      bottom: 670,
    } as DOMRect);
    act(() => button.focus());
    expect(viewport.scrollTop).toBe(28);
  });

  it("does not scroll for a portaled control outside the viewport", () => {
    const portal = document.createElement("div");
    document.body.append(portal);
    try {
      const viewport = render(
        createPortal(<button type="button">Color</button>, portal),
      );
      setDimensions(viewport);
      const button = portal.querySelector<HTMLButtonElement>("button")!;
      vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
        top: 50,
        bottom: 650,
      } as DOMRect);
      vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
        top: 670,
        bottom: 700,
      } as DOMRect);
      act(() => button.focus());
      expect(viewport.scrollTop).toBe(0);
    } finally {
      portal.remove();
    }
  });
});
