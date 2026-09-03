// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewCommentComposer } from "./ReviewCommentComposer.js";

describe("ReviewCommentComposer actions", () => {
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

  it("can expose only a dedicated agent action", () => {
    const onSubmit = vi.fn();
    act(() => {
      root.render(
        <ReviewCommentComposer
          value="Make the heading concise"
          onChange={() => {}}
          onSubmit={onSubmit}
          showCommentAction={false}
          showAgentAction
          agentLabel="Edit with AI"
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(
      buttons.some((button) => button.textContent?.trim() === "Comment"),
    ).toBe(false);
    const editWithAi = buttons.find(
      (button) => button.textContent?.trim() === "Edit with AI",
    );
    expect(editWithAi).toBeTruthy();

    act(() => editWithAi?.click());
    expect(onSubmit).toHaveBeenCalledWith("agent");
  });

  it("routes implicit submission to the visible agent action", () => {
    const onSubmit = vi.fn();
    act(() => {
      root.render(
        <ReviewCommentComposer
          value="Make the heading concise"
          onChange={() => {}}
          onSubmit={onSubmit}
          showCommentAction={false}
          showAgentAction
          submitOnEnter
        />,
      );
    });

    const textarea = container.querySelector("textarea");
    const form = container.querySelector("form");
    act(() => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenNthCalledWith(1, "agent");
    expect(onSubmit).toHaveBeenNthCalledWith(2, "agent");
  });
});
