// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getActivePlaybackComments,
  PlaybackCommentOverlay,
  PLAYBACK_COMMENT_VISIBLE_MS,
  type PlaybackComment,
} from "./playback-comment-overlay";

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
  it("shows a root comment from its timestamp for four seconds", () => {
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
        <PlaybackCommentOverlay comments={[comment]} currentMs={13_000} />,
      );
    });

    expect(container.textContent).toContain("Madison");
    expect(container.textContent).toContain("Please take a look at this.");

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
