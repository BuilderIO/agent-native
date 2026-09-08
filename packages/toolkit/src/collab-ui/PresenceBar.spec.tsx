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

  it("keeps the AI avatar display-only when agent follow is disabled", () => {
    const onAvatarClick = vi.fn();
    act(() => {
      root.render(
        <PresenceBar
          activeUsers={[]}
          agentPresent
          onAvatarClick={onAvatarClick}
          disableAgentClick
        />,
      );
    });

    const avatar = container.querySelector<HTMLElement>(
      '[aria-label="AI agent"]',
    );
    expect(avatar?.getAttribute("role")).toBeNull();
    expect(avatar?.style.cursor).toBe("default");

    act(() =>
      avatar?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onAvatarClick).not.toHaveBeenCalled();
  });

  it("keeps overflow collaborators available for follow mode", () => {
    const onAvatarClick = vi.fn();
    const activeUsers = Array.from({ length: 6 }, (_, index) => ({
      email: `user-${index}@example.com`,
      name: `User ${index}`,
      color: "#123456",
    }));

    act(() => {
      root.render(
        <PresenceBar activeUsers={activeUsers} onAvatarClick={onAvatarClick} />,
      );
    });

    const overflow = container.querySelector<HTMLButtonElement>(
      '[aria-label="1 more collaborator"]',
    );
    expect(overflow).not.toBeNull();

    act(() => {
      overflow?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });

    const hiddenUser = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("User 5"));
    expect(hiddenUser).not.toBeUndefined();

    act(() => {
      hiddenUser?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
      hiddenUser?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onAvatarClick).toHaveBeenCalledWith(activeUsers[5]);
  });
});
