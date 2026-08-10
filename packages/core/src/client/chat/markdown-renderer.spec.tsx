// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  markdownComponents,
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
      </tbody>
    </Table>
  );
}

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

  it("keeps wide markdown tables inside a scrollable wrapper", () => {
    act(() => {
      root.render(<MarkdownTableProbe />);
    });

    const wrapper = container.querySelector(".agent-markdown-table-wrap");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector("table")).not.toBeNull();
    expect(wrapper?.querySelector("th")?.textContent).toBe("Column");
  });
});
