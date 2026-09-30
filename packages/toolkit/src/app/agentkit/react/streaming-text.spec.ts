// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { advanceBufferedText, AgentStreamingText } from "./streaming-text.js";

let container: HTMLDivElement;
let root: Root;

async function renderBufferedText({
  active,
  resetKey,
  text,
}: {
  active: boolean;
  resetKey: string;
  text: string;
}) {
  await act(async () => {
    root.render(
      createElement(
        AgentStreamingText,
        { active, frameMs: 20, resetKey, text },
        (visibleText) =>
          createElement("span", { "data-buffered-text": true }, visibleText),
      ),
    );
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("advanceBufferedText", () => {
  it("paces a large chunk across multiple frames", () => {
    const target = "A large response arrived in one uneven network chunk.";
    const first = advanceBufferedText("", target);

    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(target.length);
  });

  it("preserves grapheme clusters and settles exactly", () => {
    const target = "Hello 👩‍💻";
    let visible = "";
    for (let index = 0; index < 20 && visible !== target; index += 1) {
      visible = advanceBufferedText(visible, target);
    }

    expect(visible).toBe(target);
    expect(visible).not.toContain("�");
  });

  it("resets safely when a new message does not extend the old one", () => {
    expect(advanceBufferedText("Old response", "New response")).toBe(
      "New response",
    );
  });

  it("drains a large final chunk naturally after completion", async () => {
    const resetKey = "large-final-chunk";
    const initial = "The release";
    const complete =
      "The release is ready after validating protocol compatibility, accessibility, and recovery behavior.";

    await renderBufferedText({ active: true, resetKey, text: initial });
    await act(async () => vi.runAllTimers());
    expect(container.textContent).toBe(initial);

    await renderBufferedText({ active: false, resetKey, text: complete });
    expect(container.textContent).toBe(initial);

    await act(async () => vi.advanceTimersByTime(40));
    expect(container.textContent?.length).toBeGreaterThan(initial.length);
    expect(container.textContent?.length).toBeLessThan(complete.length);

    await act(async () => vi.runAllTimers());
    expect(container.textContent).toBe(complete);
  });

  it("keeps a large transport burst paced by animation frames", async () => {
    const text = "Architecture and lifecycle details. ".repeat(500);

    await renderBufferedText({
      active: true,
      resetKey: "large-transport-burst",
      text,
    });
    expect(container.textContent).toBe("");

    await act(async () => vi.advanceTimersByTime(40));
    const firstFrameLength = container.textContent?.length ?? 0;
    expect(firstFrameLength).toBeGreaterThan(0);
    expect(firstFrameLength).toBeLessThan(text.length / 10);

    await act(async () => vi.advanceTimersByTime(40));
    expect(container.textContent?.length).toBeGreaterThan(firstFrameLength);
    expect(container.textContent?.length).toBeLessThan(text.length);
  });

  it("renders hydrated completed messages immediately despite a partial cache", async () => {
    const resetKey = "hydrated-completed-message";
    const complete =
      "Hydrated history should never replay its streaming animation on mount.";

    await renderBufferedText({ active: true, resetKey, text: complete });
    await act(async () => vi.advanceTimersByTime(20));
    expect(container.textContent?.length).toBeLessThan(complete.length);

    await act(async () => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await renderBufferedText({ active: false, resetKey, text: complete });
    expect(container.textContent).toBe(complete);
  });
});
