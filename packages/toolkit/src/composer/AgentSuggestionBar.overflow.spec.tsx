// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSuggestionBar } from "./AgentSuggestionBar.js";

const DOCUMENT_SUGGESTIONS = [
  "Summarize this document",
  "Improve this document",
  "Find the action items",
];
const CHIP_WIDTHS: Record<string, number> = {
  "Summarize this document": 155,
  "Improve this document": 144,
  "Find the action items": 144,
};
// A 280px agent panel minus the bar's and scroller's inline padding.
const NARROWEST_SCROLLER_WIDTH = 252;

describe("AgentSuggestionBar overflow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let gapStyle: HTMLStyleElement;
  let scrollerWidth: number;
  let scrollOffset: number;
  let resizeCallbacks: Array<() => void>;
  let disconnectObserver: ReturnType<typeof vi.fn>;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();

  const scroller = () =>
    container.querySelector<HTMLElement>(
      '[data-agent-suggestion-scroller="true"]',
    )!;
  const track = () =>
    container.querySelector<HTMLElement>(
      '[data-agent-suggestion-track="true"]',
    )!;
  const trackWidth = () =>
    Number.parseFloat(
      track().style.getPropertyValue("--agent-suggestion-track-width"),
    );
  const fadeEdges = () => ({
    start: scroller().getAttribute("data-overflow-start"),
    end: scroller().getAttribute("data-overflow-end"),
  });

  function defineLayout(name: string, descriptor: PropertyDescriptor) {
    descriptors.set(
      name,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
    );
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      ...descriptor,
    });
  }

  function render(suggestions: string[]) {
    act(() => {
      root.render(
        <AgentSuggestionBar
          ariaLabel="Suggested prompts"
          suggestions={suggestions}
          onSelect={() => {}}
        />,
      );
    });
  }

  function resizeScroller(width: number) {
    scrollerWidth = width;
    act(() => resizeCallbacks.forEach((callback) => callback()));
  }

  function scrollTo(offset: number) {
    scrollOffset = offset;
    act(() => {
      scroller().dispatchEvent(new Event("scroll"));
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    scrollerWidth = NARROWEST_SCROLLER_WIDTH;
    scrollOffset = 0;
    resizeCallbacks = [];
    disconnectObserver = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        disconnect = disconnectObserver;
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    gapStyle = document.createElement("style");
    gapStyle.textContent =
      '[data-agent-suggestion-track="true"] { column-gap: 4px; }';
    document.head.appendChild(gapStyle);

    defineLayout("getBoundingClientRect", {
      value(this: HTMLElement) {
        const width = CHIP_WIDTHS[this.textContent ?? ""] ?? 0;
        return { width, height: 28, top: 0, left: 0, right: width, bottom: 28 };
      },
    });
    defineLayout("clientWidth", {
      get(this: HTMLElement) {
        return this.dataset.agentSuggestionScroller ? scrollerWidth : 0;
      },
    });
    defineLayout("scrollWidth", {
      get(this: HTMLElement) {
        if (!this.dataset.agentSuggestionScroller) return 0;
        return Math.max(scrollerWidth, trackWidth());
      },
    });
    defineLayout("scrollLeft", {
      get() {
        return scrollOffset;
      },
      set(value: number) {
        scrollOffset = value;
      },
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    gapStyle.remove();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, name, descriptor);
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
          name
        ];
      }
    }
    descriptors.clear();
    vi.unstubAllGlobals();
  });

  it("wraps document suggestions onto two lines at the narrowest panel", () => {
    render(DOCUMENT_SUGGESTIONS);

    expect(
      [...container.querySelectorAll("button")].map(
        (button) => button.textContent,
      ),
    ).toEqual(DOCUMENT_SUGGESTIONS);
    expect(track().className).toContain("flex-wrap");
    expect(track().className).toContain("min-w-full");
    expect(trackWidth()).toBe(144 + 4 + 144);
    expect(fadeEdges()).toEqual({ start: null, end: "true" });
  });

  it("fades only the edges that still hide suggestions", () => {
    render(DOCUMENT_SUGGESTIONS);
    const hidden = trackWidth() - NARROWEST_SCROLLER_WIDTH;

    scrollTo(hidden / 2);
    expect(fadeEdges()).toEqual({ start: "true", end: "true" });

    scrollTo(hidden);
    expect(fadeEdges()).toEqual({ start: "true", end: null });
  });

  it("drops the fade once a resize lets every suggestion fit", () => {
    render(DOCUMENT_SUGGESTIONS);
    expect(fadeEdges().end).toBe("true");

    resizeScroller(480);
    expect(fadeEdges()).toEqual({ start: null, end: null });

    resizeScroller(NARROWEST_SCROLLER_WIDTH);
    expect(fadeEdges()).toEqual({ start: null, end: "true" });

    act(() => root.unmount());
    expect(disconnectObserver).toHaveBeenCalled();
    root = createRoot(container);
  });

  it("scrolls a keyboard-focused suggestion out from under the fade", () => {
    const scrollIntoView = vi.fn();
    defineLayout("scrollIntoView", { value: scrollIntoView });
    render(DOCUMENT_SUGGESTIONS);
    const lastChip = [...container.querySelectorAll("button")].at(-1)!;

    act(() => lastChip.focus());

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
  });

  it("ships the fade and wrap styles for every host", () => {
    const styles = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../app/agentkit/react/styles.css",
      ),
      "utf8",
    ).replace(/\r\n/g, "\n");

    expect(styles).toMatch(
      /\[data-agent-suggestion-scroller="true"\]:is\(\s*\[data-overflow-start\],\s*\[data-overflow-end\]\s*\) \{[\s\S]*?mask-image: linear-gradient\(/,
    );
    expect(styles).toMatch(
      /\[data-agent-suggestion-scroller="true"\]\[data-overflow-end\] \{\n  --agent-suggestion-fade-end: 1\.5rem;/,
    );
    expect(styles).toMatch(
      /\.agentkit-suggestions \[data-agent-suggestion-track="true"\] \{[\s\S]*?flex-wrap: wrap;[\s\S]*?inline-size: var\(--agent-suggestion-track-width\);[\s\S]*?min-inline-size: 100%;/,
    );
  });
});
