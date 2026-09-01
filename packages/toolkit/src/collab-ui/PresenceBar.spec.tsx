// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PresenceBar } from "./PresenceBar.js";

describe("PresenceBar", () => {
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
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows AI initials with an editing tooltip", () => {
    vi.useFakeTimers();
    act(() => {
      root.render(<PresenceBar activeUsers={[]} agentActive agentPresent />);
    });

    const avatar = container.querySelector<HTMLElement>(
      '[aria-label="AI is editing"]',
    );
    expect(avatar?.textContent).toBe("AI");
    expect(container.textContent).toBe("AI");

    act(() => {
      avatar?.dispatchEvent(new Event("pointermove", { bubbles: true }));
      vi.advanceTimersByTime(200);
    });

    expect(
      document
        .querySelector('[data-agent-native-tooltip="true"]')
        ?.textContent?.includes("AI is editing"),
    ).toBe(true);

    act(() => {
      root.render(<PresenceBar activeUsers={[]} agentPresent />);
    });
    expect(container.querySelector('[aria-label="AI agent"]')).not.toBeNull();
  });
});
