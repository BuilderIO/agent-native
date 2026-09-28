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
});
