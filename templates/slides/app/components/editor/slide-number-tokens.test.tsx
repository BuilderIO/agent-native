// @vitest-environment happy-dom

import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SlideInner } from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";

import {
  type InPlaceTextSession,
  startInPlaceTextSession,
} from "./in-place-text-session";

const FOOTER =
  '<p id="footer">Page <span data-slide-number="pad"></span> / <span data-slide-total="pad"></span></p>';
const slide: Slide = {
  id: "footer-slide",
  layout: "blank",
  notes: "",
  content: `<div class="fmd-slide">${FOOTER}</div>`,
};

let session: InPlaceTextSession | null = null;

afterEach(() => {
  session?.end();
  session = null;
  cleanup();
});

describe("slide-number tokens in the rendered slide", () => {
  it("stamps the canvas root with the slide position", () => {
    const view = render(
      <SlideInner slide={slide} slidePosition={{ number: 4, count: 8 }} />,
    );
    const root = view.container.querySelector<HTMLElement>(
      "[data-slide-canvas]",
    )!;
    expect(root.getAttribute("data-slide-index")).toBe("4");
    expect(root.getAttribute("data-slide-count")).toBe("8");
    expect(root.style.getPropertyValue("--slide-index")).toBe("4");
    expect(root.style.getPropertyValue("--slide-count")).toBe("8");
  });

  it("leaves a deck-less render unstamped, so the tokens stay empty", () => {
    const view = render(<SlideInner slide={slide} />);
    const root = view.container.querySelector<HTMLElement>(
      "[data-slide-canvas]",
    )!;
    expect(root.hasAttribute("data-slide-count")).toBe(false);
    expect(root.style.getPropertyValue("--slide-index")).toBe("");
  });

  it("never writes digits into the DOM, so an edit saves the empty tokens", () => {
    const view = render(
      <SlideInner slide={slide} slidePosition={{ number: 4, count: 8 }} />,
    );
    const slideContent =
      view.container.querySelector<HTMLElement>(".slide-content")!;
    const footer = view.container.querySelector<HTMLElement>("#footer")!;
    expect(footer.textContent).toBe("Page  / ");

    session = startInPlaceTextSession(footer);
    const label = footer.firstChild as Text;
    const range = document.createRange();
    range.setStart(label, label.length);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const typed = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: "s",
      bubbles: true,
      cancelable: true,
    });
    footer.dispatchEvent(typed);
    if (!typed.defaultPrevented) label.insertData(label.length, "s");

    const saved = session.cloneWithoutPlaceholders(slideContent);
    const savedFooter = saved.querySelector("#footer")!;
    expect(savedFooter.textContent).toBe("Page s / ");
    expect(savedFooter.querySelectorAll("[data-slide-number]")).toHaveLength(1);
    expect(savedFooter.querySelectorAll("[data-slide-total]")).toHaveLength(1);
    expect(savedFooter.querySelector("[data-slide-number]")!.textContent).toBe(
      "",
    );

    session.end();
    expect(footer.querySelector("[data-slide-number]")!.textContent).toBe("");
    expect(footer.innerHTML).toMatch(
      /<span data-slide-number="pad"><\/span> \/ <span data-slide-total="pad"><\/span>/,
    );
  });
});
