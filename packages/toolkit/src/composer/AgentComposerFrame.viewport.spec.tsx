// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@assistant-ui/react", () => ({
  ComposerPrimitive: {
    Root: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

import { AgentComposerFrame } from "./AgentComposerFrame.js";

let container: HTMLDivElement;
let root: Root;
let viewportHeight: number;
let viewport: EventTarget;
let originalViewport: PropertyDescriptor | undefined;
let originalInnerHeight: PropertyDescriptor | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  viewportHeight = 800;
  viewport = new EventTarget();
  Object.defineProperty(viewport, "height", { get: () => viewportHeight });
  originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
  originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: viewport,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  if (originalViewport) {
    Object.defineProperty(window, "visualViewport", originalViewport);
  } else {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: null,
    });
  }
  if (originalInnerHeight) {
    Object.defineProperty(window, "innerHeight", originalInnerHeight);
  }
});

describe("AgentComposerFrame visual viewport sizing", () => {
  it("keeps a focused composer above the keyboard and restores the shell height", async () => {
    await act(async () => {
      root.render(
        <div
          className="agent-layout-shell"
          style={
            {
              "--agent-native-viewport-height": "100%",
            } as React.CSSProperties
          }
        >
          <AgentComposerFrame>
            <div contentEditable="true" aria-label="Message agent" />
          </AgentComposerFrame>
        </div>,
      );
    });

    const shell = container.querySelector<HTMLElement>(".agent-layout-shell")!;
    const editor = container.querySelector<HTMLElement>(
      '[contenteditable="true"]',
    )!;
    await act(async () => editor.focus());
    expect(shell.style.getPropertyValue("--agent-native-viewport-height")).toBe(
      "100%",
    );

    await act(async () => {
      viewportHeight = 360;
      viewport.dispatchEvent(new Event("resize"));
    });

    expect(shell.style.getPropertyValue("--agent-native-viewport-height")).toBe(
      "360px",
    );

    await act(async () => {
      editor.blur();
      await Promise.resolve();
    });
    expect(shell.style.getPropertyValue("--agent-native-viewport-height")).toBe(
      "360px",
    );

    await act(async () => {
      viewportHeight = 800;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(shell.style.getPropertyValue("--agent-native-viewport-height")).toBe(
      "100%",
    );
  });

  it("does not resize the shell when focus stays outside the composer editor", async () => {
    await act(async () => {
      root.render(
        <div className="agent-sidebar-shell">
          <AgentComposerFrame>
            <button type="button">Attach</button>
          </AgentComposerFrame>
        </div>,
      );
    });

    const shell = container.querySelector<HTMLElement>(".agent-sidebar-shell")!;
    const button = container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => button.focus());

    expect(shell.style.getPropertyValue("--agent-native-viewport-height")).toBe(
      "",
    );
  });
});
