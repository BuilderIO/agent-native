// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tabler/icons-react", () => ({
  IconMessage2: () => <span data-icon-comment />,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

import { Scrubber } from "./scrubber";

describe("Scrubber reaction markers", () => {
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

  it("groups nearby reactions into a visible, seekable marker", () => {
    const onSeek = vi.fn();

    act(() => {
      root.render(
        <Scrubber
          currentMs={2_000}
          durationMs={10_000}
          onSeek={onSeek}
          reactions={[
            { id: "reaction-1", emoji: "👍", videoTimestampMs: 1_000 },
            { id: "reaction-2", emoji: "👀", videoTimestampMs: 1_200 },
          ]}
        />,
      );
    });

    const markers = container.querySelectorAll("[data-player-reaction-marker]");
    expect(markers).toHaveLength(1);
    expect(markers[0]?.textContent).toContain("2");
    expect(markers[0]?.getAttribute("aria-label")).toBe("2 reactions at 0:01");

    act(() => {
      (markers[0] as HTMLButtonElement).click();
    });
    expect(onSeek).toHaveBeenCalledWith(1_000);
  });

  it("keeps comments and reactions above the track without marker bubbles", () => {
    act(() => {
      root.render(
        <Scrubber
          currentMs={2_000}
          durationMs={10_000}
          onSeek={vi.fn()}
          comments={[
            { id: "comment-1", content: "Nice", videoTimestampMs: 1_000 },
          ]}
          reactions={[
            { id: "reaction-1", emoji: "👍", videoTimestampMs: 1_000 },
          ]}
        />,
      );
    });

    const comment = container.querySelector<HTMLButtonElement>(
      '[aria-label="1 comment"]',
    );
    const reaction = container.querySelector<HTMLButtonElement>(
      "[data-player-reaction-marker]",
    );

    expect(comment?.className).toContain("-top-10");
    expect(comment?.className).not.toContain("rounded-full");
    expect(comment?.querySelector("[data-icon-comment]")).not.toBeNull();
    expect(reaction?.className).toContain("-top-8");
    expect(reaction?.className).not.toContain("rounded-full");
  });
});
