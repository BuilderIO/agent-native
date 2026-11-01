// @vitest-environment happy-dom

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewReactionBar } from "./ReviewReactionBar.js";

describe("ReviewReactionBar chips", () => {
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
    vi.unstubAllGlobals();
  });

  const render = (element: ReactElement) => act(() => root.render(element));
  const chips = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
      (button) => button.hasAttribute("aria-pressed"),
    );

  it("names each chip with its count and whether the current user reacted", () => {
    render(
      <ReviewReactionBar
        canReact
        reactions={[
          { reaction: "👍", count: 3, reactedByMe: true },
          { reaction: "🔥", count: 1, reactedByMe: false },
          { reaction: "🎉", count: 2, reactedByMe: false },
        ]}
        onReact={vi.fn()}
      />,
    );

    expect(chips().map((chip) => chip.getAttribute("aria-label"))).toEqual([
      "👍, 3 reactions, including you",
      "🔥, 1 reaction",
      "🎉, 2 reactions",
    ]);
  });

  it("keeps the visible text to the emoji and a count of two or more", () => {
    render(
      <ReviewReactionBar
        canReact
        reactions={[
          { reaction: "🔥", count: 1, reactedByMe: false },
          { reaction: "👍", count: 3, reactedByMe: true },
        ]}
        onReact={vi.fn()}
      />,
    );

    expect(chips().map((chip) => chip.textContent?.trim())).toEqual([
      "🔥",
      "👍3",
    ]);
  });

  it("lets the host build a localized chip name from the emoji, count and own reaction", () => {
    const reactionLabel = vi.fn(
      ({
        emoji,
        count,
        includesYou,
      }: {
        emoji: string;
        count: number;
        includesYou: boolean;
      }) => `${count}x ${emoji}${includesYou ? " (du)" : ""}`,
    );
    render(
      <ReviewReactionBar
        canReact
        reactionLabel={reactionLabel}
        reactions={[
          { reaction: "👍", count: 3, reactedByMe: true },
          { reaction: "🔥", count: 1, reactedByMe: false },
        ]}
        onReact={vi.fn()}
      />,
    );

    expect(chips().map((chip) => chip.getAttribute("aria-label"))).toEqual([
      "3x 👍 (du)",
      "1x 🔥",
    ]);
    expect(reactionLabel).toHaveBeenCalledWith({
      emoji: "👍",
      count: 3,
      includesYou: true,
    });
  });

  it("draws the chosen chip with a full-strength border and every chip 24px tall", () => {
    render(
      <ReviewReactionBar
        canReact
        reactions={[
          { reaction: "👍", count: 2, reactedByMe: true },
          { reaction: "🔥", count: 2, reactedByMe: false },
        ]}
        onReact={vi.fn()}
      />,
    );
    const [mine, others] = chips();

    expect(mine?.className).toContain("border-primary");
    expect(mine?.className).not.toContain("ring-primary/40");
    expect(others?.className).toContain("border-transparent");
    expect(others?.className).not.toContain("border-primary");
    for (const chip of [mine, others]) {
      expect(chip?.className).toContain("h-6");
      expect(chip?.className).not.toContain("h-[22px]");
    }
  });

  it("reports the toggled state when a chip is pressed", () => {
    const onReact = vi.fn();
    render(
      <ReviewReactionBar
        canReact
        reactions={[
          { reaction: "👍", count: 2, reactedByMe: true },
          { reaction: "🔥", count: 1, reactedByMe: false },
        ]}
        onReact={onReact}
      />,
    );
    const [mine, others] = chips();

    act(() => mine?.click());
    act(() => others?.click());

    expect(onReact).toHaveBeenNthCalledWith(1, "👍", false);
    expect(onReact).toHaveBeenNthCalledWith(2, "🔥", true);
  });
});
