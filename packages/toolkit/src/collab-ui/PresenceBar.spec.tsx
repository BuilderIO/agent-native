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

  it("shows a valid collaborator photo", () => {
    const user = {
      email: "steve@example.com",
      name: "Steve",
      color: "#123456",
      avatarUrl: "https://example.com/steve.png",
    };

    act(() => {
      root.render(<PresenceBar activeUsers={[user]} />);
    });

    const image = container.querySelector<HTMLImageElement>("img");
    expect(image?.getAttribute("src")).toBe(user.avatarUrl);
    act(() => image?.dispatchEvent(new Event("load")));
    expect(container.querySelector("img")).toBe(image);
  });

  it("falls back on image failure and retries when the URL changes", () => {
    const user = {
      email: "steve@example.com",
      name: "Steve",
      color: "#123456",
      avatarUrl: "https://example.com/missing.png",
    };
    const renderUser = (avatarUrl: string) => {
      act(() => {
        root.render(<PresenceBar activeUsers={[{ ...user, avatarUrl }]} />);
      });
    };

    renderUser(user.avatarUrl);
    const failedImage = container.querySelector<HTMLImageElement>("img");
    expect(failedImage?.getAttribute("src")).toBe(user.avatarUrl);
    act(() => failedImage?.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector('[aria-label="Steve (steve@example.com)"]')
        ?.textContent,
    ).toBe("S");

    const newUrl = "https://example.com/new.png";
    renderUser(newUrl);
    const newImage = container.querySelector<HTMLImageElement>("img");
    expect(newImage?.getAttribute("src")).toBe(newUrl);
    act(() => newImage?.dispatchEvent(new Event("load")));
    expect(container.querySelector("img")).toBe(newImage);

    renderUser(user.avatarUrl);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      user.avatarUrl,
    );
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

  it("can show the current user without allowing self-follow", () => {
    const onAvatarClick = vi.fn();
    const currentUser = {
      email: "steve@example.com",
      name: "Steve",
      color: "#123456",
    };
    const otherUser = {
      email: "other@example.com",
      name: "Other",
      color: "#654321",
    };

    act(() => {
      root.render(
        <PresenceBar
          activeUsers={[currentUser, otherUser]}
          currentUserEmail={currentUser.email}
          showCurrentUser
          onAvatarClick={onAvatarClick}
        />,
      );
    });

    const currentAvatar = container.querySelector<HTMLElement>(
      '[aria-label="Steve (steve@example.com)"]',
    );
    expect(currentAvatar?.getAttribute("role")).toBeNull();

    act(() =>
      currentAvatar?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onAvatarClick).not.toHaveBeenCalled();

    const otherAvatar = container.querySelector<HTMLElement>(
      '[aria-label="Other (other@example.com)"]',
    );
    act(() =>
      otherAvatar?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onAvatarClick).toHaveBeenCalledWith(otherUser);
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
