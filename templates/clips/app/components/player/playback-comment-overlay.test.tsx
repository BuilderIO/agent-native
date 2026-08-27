// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getActivePlaybackComments,
  getPlaybackCommentVisibleMs,
  PlaybackCommentOverlay,
  PLAYBACK_COMMENT_VISIBLE_MS,
  type PlaybackComment,
} from "./playback-comment-overlay";

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

const comment: PlaybackComment = {
  id: "comment-1",
  authorEmail: "madison@example.com",
  authorName: "Madison",
  content: "Please take a look at this.",
  videoTimestampMs: 12_000,
  parentId: null,
  resolved: false,
};

describe("playback comment timing", () => {
  it("shows a root comment from its timestamp for three seconds", () => {
    expect(getActivePlaybackComments([comment], 11_999)).toEqual([]);
    expect(getActivePlaybackComments([comment], 12_000)).toEqual([comment]);
    expect(
      getActivePlaybackComments(
        [comment],
        12_000 + PLAYBACK_COMMENT_VISIBLE_MS - 1,
      ),
    ).toEqual([comment]);
    expect(
      getActivePlaybackComments(
        [comment],
        12_000 + PLAYBACK_COMMENT_VISIBLE_MS,
      ),
    ).toEqual([]);
  });

  it("scales the media-time window with playback speed", () => {
    expect(getPlaybackCommentVisibleMs(2.5)).toBe(7_500);
    expect(getActivePlaybackComments([comment], 12_000 + 7_499, 2.5)).toEqual([
      comment,
    ]);
    expect(getActivePlaybackComments([comment], 12_000 + 7_500, 2.5)).toEqual(
      [],
    );
  });

  it("does not surface replies or resolved comments over playback", () => {
    const reply = { ...comment, id: "reply-1", parentId: comment.id };
    const resolved = { ...comment, id: "resolved-1", resolved: true };

    expect(getActivePlaybackComments([reply, resolved], 12_500)).toEqual([]);
  });
});

describe("PlaybackCommentOverlay", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the author and comment above the timeline window", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <PlaybackCommentOverlay comments={[comment]} currentMs={12_500} />,
      );
    });

    expect(container.textContent).toContain("Madison");
    expect(container.textContent).toContain("Please take a look at this.");
    expect(
      container.querySelector("[data-player-playback-comment]")?.className,
    ).toContain("bottom-[6.5rem]");
    expect(
      container.querySelector("[data-player-playback-comment]")?.className,
    ).toContain("z-40");
    expect(
      container
        .querySelector("[data-player-comment-preview] img")
        ?.getAttribute("src"),
    ).toBe("https://lh3.googleusercontent.com/avatar.jpg");

    act(() => root.unmount());
    container.remove();
  });

  it("anchors the highlighted comment to its timeline position", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <PlaybackCommentOverlay
          comments={[comment]}
          currentMs={12_500}
          durationMs={60_000}
          getTimelinePositionMs={() => 15_000}
          getTimelineLane={() => 1}
        />,
      );
    });

    expect(
      container.querySelector<HTMLElement>("[data-player-comment-preview]")
        ?.parentElement?.style.left,
    ).toBe("25%");
    expect(
      container.querySelector<HTMLElement>("[data-player-comment-preview]")
        ?.parentElement?.style.bottom,
    ).toBe("1.75rem");

    act(() => root.unmount());
    container.remove();
  });

  it("renders inline Markdown without creating heading elements", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <PlaybackCommentOverlay
          comments={[
            {
              ...comment,
              content:
                "# Label\n\n**Bold**, `code`, and [link](https://example.com)",
            },
          ]}
          currentMs={12_500}
        />,
      );
    });

    expect(container.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("Bold");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.textContent).toContain("Label");
    expect(
      container.querySelector('[class*="line-clamp-3"]')?.className,
    ).toContain("text-background dark:text-foreground");
    expect(container.querySelector("a")?.className).toContain(
      "text-background",
    );
    expect(container.querySelector("a")?.className).toContain(
      "dark:text-foreground",
    );
    expect(container.querySelector("code")?.className).toContain(
      "bg-background/15 text-background",
    );
    expect(container.querySelector("code")?.className).toContain(
      "dark:bg-foreground/15 dark:text-foreground",
    );
    expect(container.innerHTML).not.toContain("text-primary-foreground");

    act(() => root.unmount());
    container.remove();
  });
});

describe("embedded playback comments", () => {
  it("passes public comments into the player used by Slack unfurls", () => {
    const embedRoute = readFileSync(
      resolve(process.cwd(), "app/routes/embed.$shareId.tsx"),
      "utf8",
    );

    expect(embedRoute).toContain(
      "const comments = dataQ.data?.data?.comments ?? [];",
    );
    expect(embedRoute).toContain("comments={comments}");
  });
});
