// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatFirstSurfacePanel } from "./surface-panel.js";

describe("ChatFirstSurfacePanel", () => {
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
  });

  it("sizes itself without relying on a generated width utility", () => {
    act(() => {
      root.render(
        <ChatFirstSurfacePanel width={520} onResizePointerDown={vi.fn()}>
          <div>content</div>
        </ChatFirstSurfacePanel>,
      );
    });

    const panel = container.querySelector<HTMLElement>(
      "[data-chat-first-surface-panel]",
    );
    expect(panel?.style.getPropertyValue("--chat-first-surface-width")).toBe(
      "520px",
    );
    // A host whose stylesheet lacks `w-[var(--chat-first-surface-width)]`
    // would otherwise lay the panel out at the width of its tab strip (about
    // 100px) and the app frame inside it at 0 x 0.
    expect(panel?.style.flexBasis).toBe("var(--chat-first-surface-width)");
  });
});
