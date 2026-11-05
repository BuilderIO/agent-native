// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimestampedCommentBar } from "./timestamped-comment-button";

describe("TimestampedCommentBar inside the player", () => {
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

  it("opts back in to text selection so Safari can type in the select-none player", () => {
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <div className="select-none">
            <TimestampedCommentBar
              recordingId="rec-1"
              atMs={1000}
              onClose={() => {}}
            />
          </div>
        </QueryClientProvider>,
      ),
    );

    const bar = container.querySelector("[data-player-ui]");
    expect(bar?.classList.contains("select-text")).toBe(true);
  });
});
