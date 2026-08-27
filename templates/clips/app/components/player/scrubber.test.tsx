// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tabler/icons-react", () => ({
  IconMessageFilled: () => <span data-icon-comment />,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useAvatarUrl: () => "https://lh3.googleusercontent.com/avatar.jpg",
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  AvatarImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img {...props} />
  ),
  AvatarFallback: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
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
    const onSeek = vi.fn();

    act(() => {
      root.render(
        <Scrubber
          currentMs={2_000}
          durationMs={10_000}
          onSeek={onSeek}
          comments={[
            {
              id: "comment-1",
              authorEmail: "brent@example.com",
              authorName: "Brent",
              content: "Nice",
              videoTimestampMs: 1_000,
            },
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

    const markerGroup = container.querySelector<HTMLDivElement>(
      "[data-player-marker-group]",
    );

    expect(markerGroup?.className).toContain("-top-7");
    expect(markerGroup?.className).toContain("gap-0.5");
    expect(markerGroup?.children).toHaveLength(2);
    expect(comment?.className).toContain("drop-shadow-md");
    expect(comment?.className).not.toContain("rounded-full");
    expect(comment?.querySelector("[data-icon-comment]")).not.toBeNull();
    expect(reaction?.className).not.toContain("rounded-full");

    act(() => {
      comment?.click();
      reaction?.click();
    });
    expect(onSeek).toHaveBeenNthCalledWith(1, 1_000);
    expect(onSeek).toHaveBeenNthCalledWith(2, 1_000);
  });

  it("uses the highlighted comment treatment for hover previews", () => {
    act(() => {
      root.render(
        <Scrubber
          currentMs={2_000}
          durationMs={10_000}
          onSeek={vi.fn()}
          comments={[
            {
              id: "comment-1",
              authorEmail: "brent@example.com",
              authorName: "Brent",
              content: "Please check this.",
              videoTimestampMs: 1_000,
            },
          ]}
        />,
      );
    });

    const comment = container.querySelector<HTMLButtonElement>(
      '[aria-label="1 comment"]',
    );
    act(() => {
      comment?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    const preview = container.querySelector<HTMLElement>(
      "[data-player-comment-hover]",
    );
    expect(preview?.className).toContain("bottom-[calc(100%+1rem)]");
    expect(preview?.className).toContain("z-50");
    expect(
      container.querySelector("[data-player-comment-preview]")?.className,
    ).toContain("bg-foreground/95");
    expect(container.textContent).toContain("Brent");
    expect(container.textContent).toContain("Please check this.");
    expect(
      container
        .querySelector("[data-player-comment-preview] img")
        ?.getAttribute("src"),
    ).toBe("https://lh3.googleusercontent.com/avatar.jpg");
  });

  it("stagger adjacent marker groups into separate hit-target lanes", () => {
    act(() => {
      root.render(
        <Scrubber
          currentMs={2_000}
          durationMs={10_000}
          onSeek={vi.fn()}
          comments={[
            {
              id: "comment-1",
              authorEmail: "brent@example.com",
              authorName: "Brent",
              content: "First",
              videoTimestampMs: 1_000,
            },
            {
              id: "comment-2",
              authorEmail: "brent@example.com",
              authorName: "Brent",
              content: "Next",
              videoTimestampMs: 1_500,
            },
          ]}
        />,
      );
    });

    const groups = container.querySelectorAll("[data-player-marker-group]");
    expect(groups).toHaveLength(2);
    expect(groups[0]?.className).toContain("-top-7");
    expect(groups[1]?.className).toContain("-top-14");
  });

  it("keeps hover previews inside the timeline at either edge", () => {
    act(() => {
      root.render(
        <Scrubber
          currentMs={2_000}
          durationMs={10_000}
          onSeek={vi.fn()}
          comments={[
            {
              id: "comment-start",
              authorEmail: "brent@example.com",
              authorName: "Brent",
              content: "At the start",
              videoTimestampMs: 0,
            },
            {
              id: "comment-end",
              authorEmail: "brent@example.com",
              authorName: "Brent",
              content: "At the end",
              videoTimestampMs: 10_000,
            },
          ]}
        />,
      );
    });

    const comments = container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="1 comment"]',
    );
    act(() => {
      comments[0]?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
    });
    let preview = container.querySelector<HTMLElement>(
      "[data-player-comment-hover]",
    );
    expect(preview?.className).not.toContain("-translate-x-1/2");
    expect(preview?.style.left).toBe("0%");

    act(() => {
      comments[1]?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
    });
    preview = container.querySelector<HTMLElement>(
      "[data-player-comment-hover]",
    );
    expect(preview?.className).not.toContain("-translate-x-1/2");
    expect(preview?.style.right).toBe("0%");
  });
});
