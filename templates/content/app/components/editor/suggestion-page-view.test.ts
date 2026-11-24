// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { scrollSuggestionIntoPageView } from "./suggestion-page-view";

const box = (top: number, height: number) =>
  DOMRect.fromRect({ x: 0, y: top, width: 600, height });

function page(editTop: number) {
  const scroller = document.createElement("div");
  scroller.getBoundingClientRect = () => box(0, 800);
  const editor = document.createElement("div");
  editor.className = "content-editor";
  const edit = document.createElement("span");
  edit.setAttribute("data-suggestion-id", "edit-4");
  edit.getBoundingClientRect = () => box(editTop, 24);
  const editScroll = vi.fn();
  edit.scrollIntoView = editScroll;
  editor.append(edit);
  scroller.append(editor);
  const card = document.createElement("div");
  card.setAttribute("data-suggestion-id", "edit-4");
  const cardScroll = vi.fn();
  card.scrollIntoView = cardScroll;
  const reply = document.createElement("textarea");
  document.body.append(scroller, card, reply);
  return { scroller, editScroll, cardScroll, reply };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("scrollSuggestionIntoPageView", () => {
  it("brings an edit below the fold into view on the page, not its card, and leaves focus in Reply", () => {
    const { scroller, editScroll, cardScroll, reply } = page(1400);
    reply.focus();

    scrollSuggestionIntoPageView("edit-4", scroller);

    expect(editScroll).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "nearest",
    });
    expect(cardScroll).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(reply);
  });

  it("brings an edit above the fold into view", () => {
    const { scroller, editScroll } = page(-200);

    scrollSuggestionIntoPageView("edit-4", scroller);

    expect(editScroll).toHaveBeenCalledOnce();
  });

  it("leaves the page where it is when the edit already shows", () => {
    const { scroller, editScroll } = page(300);

    scrollSuggestionIntoPageView("edit-4", scroller);

    expect(editScroll).not.toHaveBeenCalled();
  });

  it("does nothing for an edit the page doesn't show", () => {
    const { scroller, editScroll, cardScroll } = page(1400);

    scrollSuggestionIntoPageView("edit-9", scroller);
    scrollSuggestionIntoPageView("edit-4", null);

    expect(editScroll).not.toHaveBeenCalled();
    expect(cardScroll).not.toHaveBeenCalled();
  });
});
