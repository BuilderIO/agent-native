// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { splitMarkdownBlocks } from "../../../markdown-block-split.js";
import {
  loadMarkdown,
  markdownComponents,
  messageMatchesActiveTextStream,
  onMarkdownReady,
  shouldAnimateMarkdownText,
  SmoothMarkdownText,
  useSmoothStreamingText,
} from "./markdown-renderer.js";

function Probe({ text, resetKey }: { text: string; resetKey: string }) {
  const visibleText = useSmoothStreamingText(text, true, resetKey);
  return <span data-testid="visible-text">{visibleText}</span>;
}

function MarkdownTableProbe() {
  const Table = markdownComponents.table;
  return (
    <Table>
      <thead>
        <tr>
          <th>Column</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Value</td>
        </tr>
        <tr>
          <td>A sentence long enough to wrap inside the conversation lane.</td>
        </tr>
      </tbody>
    </Table>
  );
}

describe("markdown links", () => {
  it("opens external links in a new tab without granting opener access", () => {
    const link = markdownComponents.a({
      href: "https://example.com",
      children: "Open link",
    });

    expect(link).toMatchObject({
      type: "a",
      props: {
        href: "https://example.com",
        target: "_blank",
        rel: "noopener noreferrer",
      },
    });
  });

  it("keeps relative and same-origin links in the current tab", () => {
    const relative = markdownComponents.a({
      href: "/brain/sources",
      children: "Brain sources",
    });
    const sameOrigin = markdownComponents.a({
      href: `${window.location.origin}/brain/sources`,
      children: "Brain sources",
    });

    expect(relative).toMatchObject({
      type: "a",
      props: { href: "/brain/sources", target: undefined },
    });
    expect(sameOrigin).toMatchObject({
      type: "a",
      props: { target: undefined, rel: undefined },
    });
  });
});

describe("shouldAnimateMarkdownText", () => {
  it("does not replay a completed last response when chat starts another run", () => {
    expect(
      shouldAnimateMarkdownText({
        textStreaming: true,
        isLastAssistantMessage: true,
        statusType: "complete",
      }),
    ).toBe(false);
  });

  it("animates the last response while its text is running", () => {
    expect(
      shouldAnimateMarkdownText({
        textStreaming: true,
        isLastAssistantMessage: true,
        statusType: "running",
      }),
    ).toBe(true);
  });

  it("animates complete messages from an active external transcript", () => {
    expect(
      shouldAnimateMarkdownText({
        textStreaming: true,
        isLastAssistantMessage: true,
        statusType: "complete",
        externalStreaming: true,
      }),
    ).toBe(true);
  });

  it("animates a complete text part that belongs to the active AgentKit turn", () => {
    expect(
      shouldAnimateMarkdownText({
        textStreaming: false,
        isLastAssistantMessage: true,
        statusType: "complete",
        activeMessageStreaming: true,
      }),
    ).toBe(true);
  });

  it("matches active turns before continuation run ids", () => {
    expect(
      messageMatchesActiveTextStream(
        {
          metadata: {
            custom: { runId: "run-2", turnId: "turn-current" },
          },
        },
        { runId: "run-1", turnId: "turn-current" },
      ),
    ).toBe(true);
    expect(
      messageMatchesActiveTextStream(
        { metadata: { runId: "run-current", turnId: "turn-previous" } },
        { runId: "run-current", turnId: "turn-current" },
      ),
    ).toBe(false);
  });
});

describe("useSmoothStreamingText", () => {
  let container: HTMLDivElement;
  let root: Root;
  let nextFrameId: number;
  let frameCallbacks: Array<(time: number) => void>;
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    nextFrameId = 0;
    frameCallbacks = [];
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
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

  it("continues from the existing reveal cursor after a structural remount", () => {
    const text = "I'll inspect the available actions and workspace state.";
    act(() => {
      root.render(<Probe text={text} resetKey="message-1" />);
    });

    act(() => {
      const callback = frameCallbacks.shift();
      callback?.(40);
    });
    const firstVisibleText = container.querySelector(
      "[data-testid='visible-text']",
    )?.textContent;
    expect(firstVisibleText).toBeTruthy();
    expect(firstVisibleText).not.toBe(text);

    act(() => root.unmount());
    root = createRoot(container);
    act(() => {
      root.render(<Probe text={text} resetKey="message-1" />);
    });

    expect(
      container.querySelector("[data-testid='visible-text']")?.textContent,
    ).toBe(firstVisibleText);
  });

  it("starts a new message from its own cursor when the message key changes", () => {
    const firstText = "The first response is still being revealed.";
    const nextText = "The first response is replaced by a follow-up.";

    act(() => {
      root.render(<Probe text={firstText} resetKey="message-1" />);
    });

    act(() => {
      const callback = frameCallbacks.shift();
      callback?.(40);
    });
    expect(
      container.querySelector("[data-testid='visible-text']")?.textContent,
    ).not.toBe(firstText);

    act(() => {
      root.render(<Probe text={nextText} resetKey="message-2" />);
    });

    const visibleText = container.querySelector(
      "[data-testid='visible-text']",
    )?.textContent;
    expect(visibleText).not.toContain(firstText.slice(0, 12));
    expect(nextText.startsWith(visibleText ?? "")).toBe(true);
  });

  function runFrames(count: number, startAt = 16) {
    for (let index = 0; index < count; index += 1) {
      const callbacks = frameCallbacks.splice(0);
      act(() => {
        for (const callback of callbacks) callback(startAt + index * 16);
      });
    }
  }

  it("paces in-app markdown with the shared word reveal, fade and hold-back", async () => {
    await new Promise<void>((resolve) => {
      loadMarkdown();
      onMarkdownReady(resolve);
    });
    const text = "Shared pacing reveals words. Then **a bold run that";
    act(() => {
      root.render(
        <SmoothMarkdownText
          text={text}
          streaming
          resetKey="in-app-fade"
          statusType="running"
        />,
      );
    });
    runFrames(120);

    const paragraph = container.querySelector(".agent-markdown p");
    expect(paragraph?.classList.contains("agentkit-stream-block")).toBe(true);
    expect(
      container.querySelectorAll(".agentkit-stream-word")[0]?.textContent,
    ).toBe("Shared ");
    // The unclosed bold run streams in bold instead of showing its asterisks.
    expect(paragraph?.textContent).toBe(
      "Shared pacing reveals words. Then a bold run that",
    );
    expect(paragraph?.querySelector("strong")?.textContent).toBe(
      "a bold run that",
    );

    act(() => {
      root.render(
        <SmoothMarkdownText
          text={`${text} closes**.`}
          streaming={false}
          resetKey="in-app-fade"
          statusType="complete"
        />,
      );
    });
    runFrames(120, 2_000);
    expect(container.querySelector(".agent-markdown p")).toBe(paragraph);
    expect(container.querySelector("strong")?.textContent).toBe(
      "a bold run that closes",
    );
  });

  it("does not animate an in-app message that mounts complete", async () => {
    await new Promise<void>((resolve) => {
      loadMarkdown();
      onMarkdownReady(resolve);
    });
    act(() => {
      root.render(
        <SmoothMarkdownText
          text="A finished **answer**."
          streaming={false}
          resetKey="in-app-history"
        />,
      );
    });

    expect(container.textContent).toBe("A finished answer.");
    expect(container.querySelector(".agentkit-stream-word")).toBeNull();
    expect(container.querySelector(".agentkit-stream-block")).toBeNull();
  });

  it("paces in-app markdown without fading under reduced motion", async () => {
    await new Promise<void>((resolve) => {
      loadMarkdown();
      onMarkdownReady(resolve);
    });
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      const text =
        "One network chunk carries fifteen words that should still arrive at a steady pace.";
      act(() => {
        root.render(
          <SmoothMarkdownText
            text={text}
            streaming
            resetKey="in-app-reduced-motion"
            statusType="running"
          />,
        );
      });
      runFrames(1);
      const first = container.textContent ?? "";
      expect(first.length).toBeGreaterThan(0);
      expect(first.length).toBeLessThan(text.length);

      runFrames(400, 32);
      expect(container.textContent).toBe(text);
      expect(container.querySelector(".agentkit-stream-word")).toBeNull();
      expect(container.querySelector(".agentkit-stream-block")).toBeNull();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("keeps wide markdown tables inside a scrollable wrapper", () => {
    act(() => {
      root.render(<MarkdownTableProbe />);
    });

    const wrapper = container.querySelector(".agent-markdown-table-wrap");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector("table")).not.toBeNull();
    expect(wrapper?.querySelector("th")?.textContent).toBe("Column");
    // Prose cells wrap; short ones stay on one line.
    const cells = Array.from(
      wrapper?.querySelectorAll("th, td") ?? [],
      (cell) => [cell.textContent?.trim(), cell.hasAttribute("data-prose")],
    );
    expect(cells).toEqual([
      ["Column", false],
      ["Value", false],
      ["A sentence long enough to wrap inside the conversation lane.", true],
    ]);
  });

  it("keeps completed live markdown blocks memoized while the tail streams", async () => {
    await new Promise<void>((resolve) => {
      loadMarkdown();
      onMarkdownReady(resolve);
    });

    const text =
      "### Heading\n\nA paragraph with **bold** text.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nLive tail";
    const split = splitMarkdownBlocks(text);
    expect(split.completedBlocks.length).toBeGreaterThan(0);
    act(() => {
      root.render(
        <SmoothMarkdownText
          text={text}
          streaming
          resetKey="stable-live-response"
          statusType="running"
          animateStreaming={false}
        />,
      );
    });

    const live = container.querySelector("[data-streaming='true']");
    expect(live?.querySelector("h3")).not.toBeNull();
    expect(live?.querySelector("table")).not.toBeNull();
    expect(live?.textContent).toContain("Live tail");

    act(() => {
      root.render(
        <SmoothMarkdownText
          text={text}
          streaming={false}
          resetKey="stable-live-response"
          statusType="complete"
        />,
      );
    });

    expect(container.querySelector("[data-streaming='true']")).toBeNull();
    expect(container.querySelector("h3")).not.toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
  });
});
