// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isTrailingTextPartOfMessage,
  shouldAnimateMarkdownText,
  shouldShowStreamingCaret,
  StreamingText,
} from "./markdown-renderer.js";

const CARET = "[data-agent-streaming-cursor='true']";

describe("shouldShowStreamingCaret", () => {
  it("shows the caret for the whole live turn, including once the reveal caught up", () => {
    expect(
      shouldShowStreamingCaret({
        isLastAssistantMessage: true,
        isTrailingTextPart: true,
        runActive: true,
      }),
    ).toBe(true);
  });

  it("removes the caret as soon as the run reaches a terminal state", () => {
    expect(
      shouldShowStreamingCaret({
        isLastAssistantMessage: true,
        isTrailingTextPart: true,
        runActive: false,
      }),
    ).toBe(false);
  });

  it("stays off when a tool call or reasoning cell trails the text", () => {
    expect(
      shouldShowStreamingCaret({
        isLastAssistantMessage: true,
        isTrailingTextPart: false,
        runActive: true,
      }),
    ).toBe(false);
  });

  it("stays off on historical messages", () => {
    expect(
      shouldShowStreamingCaret({
        isLastAssistantMessage: false,
        isTrailingTextPart: true,
        runActive: true,
      }),
    ).toBe(false);
  });

  it("follows external transcript liveness when there is no local run", () => {
    expect(
      shouldShowStreamingCaret({
        isLastAssistantMessage: true,
        isTrailingTextPart: true,
        externalStreaming: true,
      }),
    ).toBe(true);
    expect(
      shouldShowStreamingCaret({
        isLastAssistantMessage: true,
        isTrailingTextPart: true,
        externalStreaming: false,
      }),
    ).toBe(false);
  });
});

describe("isTrailingTextPartOfMessage", () => {
  it("matches the final text part", () => {
    const message = {
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "last" },
      ],
    };
    expect(isTrailingTextPartOfMessage(message, { text: "last" })).toBe(true);
    expect(isTrailingTextPartOfMessage(message, { text: "first" })).toBe(false);
  });

  it("does not match when a tool call trails the message", () => {
    const message = {
      content: [
        { type: "text", text: "working on it" },
        { type: "tool-call", toolName: "read" },
      ],
    };
    expect(
      isTrailingTextPartOfMessage(message, { text: "working on it" }),
    ).toBe(false);
  });

  it("reports false rather than guessing when the message has no parts", () => {
    expect(isTrailingTextPartOfMessage(null, { text: "x" })).toBe(false);
    expect(isTrailingTextPartOfMessage({ content: [] }, { text: "x" })).toBe(
      false,
    );
  });
});

describe("shouldAnimateMarkdownText run-activity gate", () => {
  it("does not keep a finished turn streaming just because its identity is retained", () => {
    expect(
      shouldAnimateMarkdownText({
        textStreaming: false,
        isLastAssistantMessage: true,
        statusType: "complete",
        activeMessageStreaming: true,
        runActive: false,
      }),
    ).toBe(false);
  });

  it("still animates a complete part that belongs to the live turn", () => {
    expect(
      shouldAnimateMarkdownText({
        textStreaming: false,
        isLastAssistantMessage: true,
        statusType: "complete",
        activeMessageStreaming: true,
        runActive: true,
      }),
    ).toBe(true);
  });

  it("leaves hosts that report no run state alone", () => {
    expect(
      shouldAnimateMarkdownText({
        textStreaming: false,
        isLastAssistantMessage: true,
        statusType: "complete",
        activeMessageStreaming: true,
      }),
    ).toBe(true);
  });
});

describe("StreamingText caret rendering", () => {
  let container: HTMLDivElement;
  let root: Root;
  let frameCallbacks: Array<(time: number) => void>;
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    frameCallbacks = [];
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    let nextFrameId = 0;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      nextFrameId += 1;
      return nextFrameId;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame =
      (() => {}) as typeof window.cancelAnimationFrame;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("keeps the caret up while the run is live and the reveal has nothing left to show", () => {
    const text = "Here is the deck outline.";
    act(() => {
      root.render(
        <StreamingText
          text={text}
          streaming
          caret
          resetKey="slides-turn"
          statusType="running"
          animateStreaming={false}
        />,
      );
    });

    expect(container.textContent).toContain(text);
    expect(container.querySelector(CARET)).not.toBeNull();
  });

  it("removes the caret when the run completes even with reveal backlog left", () => {
    const text =
      "I rewrote slide three and tightened the closing slide copy for you.";
    act(() => {
      root.render(
        <StreamingText
          text={text}
          streaming
          caret
          resetKey="slides-turn"
          statusType="running"
        />,
      );
    });
    act(() => {
      frameCallbacks.shift()?.(16);
    });

    const revealed = container.textContent ?? "";
    expect(revealed).not.toBe(text);
    expect(container.querySelector(CARET)).not.toBeNull();

    act(() => {
      root.render(
        <StreamingText
          text={text}
          streaming={false}
          caret={false}
          resetKey="slides-turn"
          statusType="complete"
        />,
      );
    });

    expect(container.querySelector(CARET)).toBeNull();
  });

  it("drops the caret when a finished run still has its turn identity retained", () => {
    // The reported Slides symptom: the turn ended, the Thinking indicator was
    // gone, and the caret kept blinking under the last answer because the
    // retained turn identity still marked that message as streaming.
    const text = "Done - slide three now leads with the revenue chart.";
    const renderTurn = (runActive: boolean) => {
      root.render(
        <StreamingText
          text={text}
          streaming={shouldAnimateMarkdownText({
            textStreaming: runActive,
            isLastAssistantMessage: true,
            statusType: "complete",
            activeMessageStreaming: true,
            runActive,
          })}
          caret={shouldShowStreamingCaret({
            isLastAssistantMessage: true,
            isTrailingTextPart: true,
            runActive,
          })}
          resetKey="slides-retained-turn"
          statusType={runActive ? "running" : "complete"}
        />,
      );
    };

    act(() => renderTurn(true));
    act(() => {
      frameCallbacks.shift()?.(16);
    });
    expect(container.querySelector(CARET)).not.toBeNull();
    expect(container.textContent).not.toBe(text);

    act(() => renderTurn(false));

    // The tail settles over a few frames; the caret must stay gone for every
    // one of them, not reappear while the buffered text drains.
    let time = 32;
    for (let i = 0; i < 40 && container.textContent !== text; i += 1) {
      act(() => {
        frameCallbacks.shift()?.(time);
      });
      time += 16;
      expect(container.querySelector(CARET)).toBeNull();
    }

    expect(container.textContent).toBe(text);
    expect(container.querySelector(CARET)).toBeNull();
  });

  it("never renders a caret for a surface that does not report liveness", () => {
    act(() => {
      root.render(
        <StreamingText
          text="A stored answer."
          streaming={false}
          resetKey="history"
          statusType="complete"
        />,
      );
    });

    expect(container.querySelector(CARET)).toBeNull();
  });
});
