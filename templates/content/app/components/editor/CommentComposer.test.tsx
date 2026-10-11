// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommentComposer } from "./CommentComposer";

describe("CommentComposer", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function render(disabled: boolean) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        createElement(CommentComposer, {
          value: "A durable draft",
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          onMentionAdd: vi.fn(),
          members: [],
          disabled,
        }),
      );
    });
    return container.querySelector(".ProseMirror") as HTMLElement;
  }

  it("freezes the draft while its mutation is pending", () => {
    const editor = render(true);

    expect(editor.getAttribute("contenteditable")).toBe("false");
    expect(editor.textContent).toBe("A durable draft");
  });

  it("keeps the composer editable before submission", () => {
    const editor = render(false);

    expect(editor.getAttribute("contenteditable")).toBe("true");
    expect(editor.className).toContain("agent-composer-prosemirror");
    expect(editor.className).toContain("max-h-[10rem]");
  });

  it("keeps Cancel on one line beside the Send to AI control", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        createElement(CommentComposer, {
          value: "Make this more specific",
          onChange: vi.fn(),
          onSubmit: vi.fn(),
          onMentionAdd: vi.fn(),
          onCancel: vi.fn(),
          aiDraft: {
            selection: {
              model: "claude-sonnet-5-5",
              engine: "anthropic",
              provider: "Anthropic",
            },
            mode: "auto",
          },
          members: [],
        }),
      );
    });
    const cancel = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel",
    )!;
    const actions = cancel.parentElement!;

    expect(actions.querySelector("[data-comment-ai-send-control]")).not.toBe(
      null,
    );
    expect(cancel.classList).toContain("whitespace-nowrap");
    expect(cancel.classList).toContain("shrink-0");
    expect(actions.classList).toContain("shrink-0");
  });
});
