// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SharedRichEditor } from "./SharedRichEditor.js";

describe("SharedRichEditor block controls", () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("mounts the shared Notion-style block grip by default", async () => {
    await act(async () => {
      root.render(
        <SharedRichEditor value="First\n\nSecond" onChange={() => undefined} />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const prose = container.querySelector<HTMLElement>(".an-rich-md-prose");
    const firstBlock = prose?.firstElementChild;
    for (const [element, rect] of [
      [prose, { left: 0, top: 0, right: 640, bottom: 100 }],
      [firstBlock, { left: 0, top: 0, right: 640, bottom: 24 }],
    ] as const) {
      if (!element) continue;
      Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          ...rect,
          x: rect.left,
          y: rect.top,
          width: rect.right - rect.left,
          height: rect.bottom - rect.top,
          toJSON: () => ({}),
        }),
      });
    }
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 8,
        clientY: 8,
      }),
    );
    expect(container.querySelector(".an-rich-md-wrapper")).not.toBeNull();
    expect(container.querySelector(".drag-handle")).not.toBeNull();
  });

  it("allows hosts to opt out when they own block controls", async () => {
    await act(async () => {
      root.render(
        <SharedRichEditor
          value="First"
          onChange={() => undefined}
          dragHandle={false}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(container.querySelector(".drag-handle")).toBeNull();
  });
});
