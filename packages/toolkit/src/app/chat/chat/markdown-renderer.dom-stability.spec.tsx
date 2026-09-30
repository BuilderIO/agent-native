// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadMarkdown,
  onMarkdownReady,
  SmoothMarkdownText,
} from "./markdown-renderer.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function waitForMarkdown(): Promise<void> {
  loadMarkdown();
  await new Promise<void>((resolve) => {
    onMarkdownReady(() => resolve());
  });
}

function render(text: string, streaming: boolean) {
  act(() => {
    root.render(
      <SmoothMarkdownText
        text={text}
        streaming={streaming}
        resetKey="msg-1"
        animateStreaming={false}
      />,
    );
  });
}

function tagNodes(): void {
  container.querySelectorAll("*").forEach((el, i) => {
    (el as HTMLElement).dataset.probe = String(i);
  });
}

function survivingTagCount(): number {
  return container.querySelectorAll("[data-probe]").length;
}

describe("SmoothMarkdownText DOM stability while streaming", () => {
  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await waitForMarkdown();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the rendered DOM when a turn finishes streaming", async () => {
    const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";

    render(text, true);
    const streamingHtml = container.innerHTML;
    expect(streamingHtml).toContain("First paragraph.");
    tagNodes();
    const tagged = survivingTagCount();
    expect(tagged).toBeGreaterThan(0);

    render(text, false);

    expect(survivingTagCount()).toBe(tagged);
  });

  it("keeps the DOM stable across a trailing newline", () => {
    render("A paragraph of text", true);
    tagNodes();
    const tagged = survivingTagCount();

    render("A paragraph of text\n", true);
    expect(survivingTagCount()).toBe(tagged);

    render("A paragraph of text\nmore text", true);
    expect(survivingTagCount()).toBe(tagged);
  });

  it("keeps earlier paragraphs mounted as the streaming tail grows", () => {
    render("First paragraph.\n\nSecond para", true);
    tagNodes();
    const tagged = survivingTagCount();

    render("First paragraph.\n\nSecond paragraph.\n\nThird", true);

    expect(survivingTagCount()).toBe(tagged);
  });
});
