// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommentComposer } from "./CommentComposer";

vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));

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
          mentions: [],
          onMentionsChange: vi.fn(),
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
    expect(editor.className).toContain(
      "max-h-[var(--agentkit-composer-editor-max-height,10rem)]",
    );
  });

  describe("when collapsible", () => {
    function renderCollapsible() {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() => {
        root!.render(
          createElement(CommentComposer, {
            value: "",
            onChange: vi.fn(),
            onSubmit: vi.fn(),
            mentions: [],
            onMentionsChange: vi.fn(),
            collapsible: true,
          }),
        );
      });
      const composer = container.querySelector(
        "[data-comment-composer]",
      ) as HTMLElement;
      const editor = container.querySelector(".ProseMirror") as HTMLElement;
      act(() => {
        editor.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      });
      return { composer, editor };
    }

    const blur = (editor: HTMLElement) =>
      act(() => {
        editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
    const press = (type: "pointerdown" | "pointerup") =>
      act(() => {
        document.body.dispatchEvent(new Event(type, { bubbles: true }));
      });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("rests at once when focus leaves without a press", () => {
      const { composer, editor } = renderCollapsible();
      expect(composer.getAttribute("data-state")).toBe("expanded");

      blur(editor);

      expect(composer.getAttribute("data-state")).toBe("resting");
    });

    // Collapsing mid-press moves the card, so the press on Resolve misses and
    // reads as a click away from the comment.
    it("stays expanded until a press outside it has finished", () => {
      vi.useFakeTimers();
      const { composer, editor } = renderCollapsible();

      press("pointerdown");
      blur(editor);
      expect(composer.getAttribute("data-state")).toBe("expanded");

      press("pointerup");
      expect(composer.getAttribute("data-state")).toBe("expanded");

      act(() => {
        vi.runOnlyPendingTimers();
      });
      expect(composer.getAttribute("data-state")).toBe("resting");
    });
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
          mentions: [],
          onMentionsChange: vi.fn(),
          onCancel: vi.fn(),
          aiDraft: {
            selection: {
              model: "claude-sonnet-5-5",
              engine: "anthropic",
              provider: "Anthropic",
            },
            mode: "auto",
          },
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
