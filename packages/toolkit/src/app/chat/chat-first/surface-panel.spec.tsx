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
    expect(panel?.style.flexBasis).toBe("var(--chat-first-surface-width)");
  });
});
