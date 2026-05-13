// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssistantMessageListErrorBoundary,
  AssistantUiStaleIndexErrorBoundary,
  displayableUserMessageText,
  isAssistantUiStaleIndexError,
} from "./AssistantChat.js";

describe("displayableUserMessageText", () => {
  it("treats context-only messages as empty for user bubble display", () => {
    expect(
      displayableUserMessageText(
        "\n\n<context>\nHidden attachment instructions\n</context>",
      ),
    ).toBe("");
  });
});

describe("isAssistantUiStaleIndexError", () => {
  it("matches assistant-ui stale message index crashes", () => {
    expect(
      isAssistantUiStaleIndexError(
        new Error("tapClientLookup: Index 79 out of bounds (length: 78)"),
      ),
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isAssistantUiStaleIndexError(new Error("boom"))).toBe(false);
  });
});

describe("AssistantMessageListErrorBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("remounts the message list after assistant-ui renders a stale index", async () => {
    let renders = 0;
    function FlakyMessageList() {
      renders += 1;
      if (renders === 1) {
        throw new Error("tapClientLookup: Index 79 out of bounds (length: 78)");
      }
      return React.createElement("div", null, "Recovered messages");
    }

    act(() => {
      root.render(
        React.createElement(
          AssistantMessageListErrorBoundary,
          { resetKey: "messages" },
          React.createElement(FlakyMessageList),
        ),
      );
    });

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.textContent).toContain("Recovered messages");
  });
});

describe("AssistantUiStaleIndexErrorBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("remounts any assistant-ui subtree after a stale index render error", async () => {
    let renders = 0;
    function FlakyComposer() {
      renders += 1;
      if (renders === 1) {
        throw new Error("tapClientLookup: Index 4 out of bounds (length: 3)");
      }
      return React.createElement("div", null, "Recovered composer");
    }

    act(() => {
      root.render(
        React.createElement(
          AssistantUiStaleIndexErrorBoundary,
          { resetKey: "thread-1", componentName: "AssistantChat" },
          React.createElement(FlakyComposer),
        ),
      );
    });

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.textContent).toContain("Recovered composer");
  });
});
