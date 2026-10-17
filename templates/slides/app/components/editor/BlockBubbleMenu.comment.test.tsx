// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { BlockBubbleMenu } from "./BlockBubbleMenu";
import { startInPlaceTextSession } from "./in-place-text-session";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

let activeTextSession: ReturnType<typeof startInPlaceTextSession> | null = null;

describe("BlockBubbleMenu comments", () => {
  afterEach(() => {
    activeTextSession?.end();
    activeTextSession = null;
    cleanup();
    document.body.innerHTML = "";
  });

  it("passes the selected text and live range to the comment flow", async () => {
    const editingEl = document.createElement("div");
    editingEl.contentEditable = "true";
    editingEl.textContent = "Quarterly revenue";
    document.body.append(editingEl);
    const range = document.createRange();
    range.selectNodeContents(editingEl);
    Object.defineProperty(range, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 80,
        height: 20,
        left: 100,
        right: 240,
        top: 60,
        width: 140,
        x: 100,
        y: 60,
      }),
    });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const onComment = vi.fn();

    render(
      <TooltipProvider>
        <BlockBubbleMenu editingEl={editingEl} onComment={onComment} />
      </TooltipProvider>,
    );
    document.dispatchEvent(new Event("selectionchange"));

    const commentButton = await screen.findByRole("button", {
      name: "comments.addComment",
    });
    fireEvent.click(commentButton);

    await waitFor(() => expect(onComment).toHaveBeenCalledOnce());
    const [quotedText, selectedRange, target] = onComment.mock.calls[0] as [
      string,
      Range,
      HTMLElement,
    ];
    expect(quotedText).toBe("Quarterly revenue");
    expect(selectedRange.toString()).toBe("Quarterly revenue");
    expect(target).toBe(editingEl);
  });

  it("opens the link input for Cmd+K and applies it to the saved selection", async () => {
    const editingEl = document.createElement("div");
    editingEl.textContent = "Quarterly revenue";
    document.body.append(editingEl);
    const textSession = (activeTextSession =
      startInPlaceTextSession(editingEl));
    const range = document.createRange();
    range.setStart(editingEl.firstChild!, 10);
    range.setEnd(editingEl.firstChild!, 17);
    Object.defineProperty(range, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 80,
        height: 20,
        left: 100,
        right: 240,
        top: 60,
        width: 140,
        x: 100,
        y: 60,
      }),
    });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    render(
      <TooltipProvider>
        <BlockBubbleMenu
          editingEl={editingEl}
          textSession={textSession}
          linkRequest={{ editingEl, range }}
        />
      </TooltipProvider>,
    );
    document.dispatchEvent(new Event("selectionchange"));

    const input = await screen.findByPlaceholderText("raw.pasteUrl");
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(editingEl.innerHTML).toBe(
      'Quarterly <a href="https://example.com">revenue</a>',
    );
  });
});
