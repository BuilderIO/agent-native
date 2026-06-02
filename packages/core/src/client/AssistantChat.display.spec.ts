// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssistantMessageListErrorBoundary,
  AssistantUiStaleIndexErrorBoundary,
  assistantUiRecoverableRenderErrorKind,
  displayableUserMessageText,
  isAssistantUiRecoverableRenderError,
  isAssistantUiStaleIndexError,
  latestNonRecoveryUserMessageText,
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

describe("latestNonRecoveryUserMessageText", () => {
  it("skips recovery prompts when finding the original user request", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "Build a CS operations tool" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I stopped before finishing" }],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Continue from where you stopped. Use the partial work above.",
          },
        ],
        metadata: { custom: { agentNativeRecoveryAction: "continue" } },
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I stopped again" }],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Retry the previous request from a clean approach.\n\nOriginal request:\n\nBuild a CS operations tool",
          },
        ],
      },
    ];

    expect(latestNonRecoveryUserMessageText(messages)).toBe(
      "Build a CS operations tool",
    );
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

  it("does not match other assistant-ui recoverable errors", () => {
    expect(
      isAssistantUiStaleIndexError(
        new Error("Duplicate key toolCallId-tc_1 in tapResources"),
      ),
    ).toBe(false);
  });

  it("ignores unrelated errors", () => {
    expect(isAssistantUiStaleIndexError(new Error("boom"))).toBe(false);
  });
});

describe("assistantUiRecoverableRenderErrorKind", () => {
  it("matches assistant-ui stale message index crashes", () => {
    expect(
      assistantUiRecoverableRenderErrorKind(
        new Error("tapClientLookup: Index 79 out of bounds (length: 78)"),
      ),
    ).toBe("assistant-ui-stale-message-index");
  });

  it("matches React fiber unmount crashes from assistant-ui composer teardown", () => {
    expect(
      assistantUiRecoverableRenderErrorKind(
        new Error(
          "Tried to unmount a fiber that is already unmounted. This is a React internal error.",
        ),
      ),
    ).toBe("assistant-ui-react-fiber-unmount");
  });

  it("matches duplicate resource-key crashes from assistant-ui composer state", () => {
    expect(
      assistantUiRecoverableRenderErrorKind(
        new Error("Duplicate key toolCallId-tc_1 in tapResources"),
      ),
    ).toBe("assistant-ui-duplicate-resource-key");
  });

  it("ignores unrelated errors", () => {
    expect(assistantUiRecoverableRenderErrorKind(new Error("boom"))).toBeNull();
  });
});

describe("isAssistantUiRecoverableRenderError", () => {
  it("matches assistant-ui duplicate resource key crashes", () => {
    expect(
      isAssistantUiRecoverableRenderError(
        new Error("Duplicate key toolCallId-tc_1 in tapResources"),
      ),
    ).toBe(true);
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

  it("remounts any assistant-ui subtree after a React fiber unmount error", async () => {
    let renders = 0;
    function FlakyComposer() {
      renders += 1;
      if (renders === 1) {
        throw new Error(
          "Tried to unmount a fiber that is already unmounted. This is a React internal error.",
        );
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

  it("remounts any assistant-ui subtree after a duplicate resource key error", async () => {
    let renders = 0;
    function FlakyComposer() {
      renders += 1;
      if (renders === 1) {
        throw new Error("Duplicate key toolCallId-tc_1 in tapResources");
      }
      return React.createElement("div", null, "Recovered resources");
    }

    act(() => {
      root.render(
        React.createElement(
          AssistantUiStaleIndexErrorBoundary,
          { resetKey: "thread-1", componentName: "PromptComposer" },
          React.createElement(FlakyComposer),
        ),
      );
    });

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.textContent).toContain("Recovered resources");
  });
});
