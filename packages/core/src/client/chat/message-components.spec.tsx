// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  shouldShowAssistantMessageFooter,
  ThinkingIndicator,
} from "./message-components.js";

describe("ThinkingIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders plain accessible status text", () => {
    act(() => {
      root.render(<ThinkingIndicator />);
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-label")).toBe("Thinking");
    expect(status?.textContent).toBe("Thinking");
    expect(container.querySelector("svg")).toBeNull();
    expect(
      container.querySelectorAll(".agent-thinking-indicator__ellipsis-dot"),
    ).toHaveLength(0);
    expect(
      container.querySelector(".agent-thinking-indicator__logo"),
    ).toBeNull();
  });
});

describe("shouldShowAssistantMessageFooter", () => {
  it("hides controls for the current assistant response while it is running", () => {
    expect(
      shouldShowAssistantMessageFooter({
        isLast: true,
        chatRunning: true,
        hasRenderableContent: true,
        statusIsTerminal: false,
      }),
    ).toBe(false);
  });

  it("hides controls for empty assistant placeholders", () => {
    expect(
      shouldShowAssistantMessageFooter({
        isLast: true,
        chatRunning: false,
        hasRenderableContent: false,
        statusIsTerminal: true,
      }),
    ).toBe(false);
  });

  it("shows controls for the final assistant response only after terminal status", () => {
    expect(
      shouldShowAssistantMessageFooter({
        isLast: true,
        chatRunning: false,
        hasRenderableContent: true,
        statusIsTerminal: true,
      }),
    ).toBe(true);
  });

  it("keeps completed historical assistant messages actionable", () => {
    expect(
      shouldShowAssistantMessageFooter({
        isLast: false,
        chatRunning: true,
        hasRenderableContent: true,
        statusIsTerminal: true,
      }),
    ).toBe(true);
  });
});
