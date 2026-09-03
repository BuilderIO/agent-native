// @vitest-environment happy-dom

import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SlideInner } from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";
import { sanitizeSlideHtml } from "@/lib/sanitize-slide-html";

import {
  applyInlineTextStyle,
  getInlineTextStyleSnapshot,
} from "./rich-text-selection";
import {
  ensureSlideTextBoxCanvas,
  freezeSlideElementForFreeform,
} from "./slide-object-interactions";

afterEach(() => {
  cleanup();
});

describe("markdown inline edit Escape round trip", () => {
  it("promotes an edited Markdown heading into the same persisted canvas used by text boxes", () => {
    const slide: Slide = {
      id: "markdown-heading",
      layout: "title",
      notes: "",
      content: "# Initial heading",
    };
    const view = render(<SlideInner slide={slide} />);
    const slideContent =
      view.container.querySelector<HTMLElement>(".slide-content");
    const heading = slideContent?.querySelector<HTMLElement>("h1");
    expect(slideContent).toBeTruthy();
    expect(heading).toBeTruthy();
    const originalChildren = Array.from(slideContent!.childNodes);
    const originalClassName = heading!.className;
    const originalStyle = heading!.getAttribute("style");

    heading!.contentEditable = "true";
    heading!.textContent = "Edited heading";
    heading!.style.color = "rgb(17, 24, 39)";
    heading!.style.fontSize = "48px";
    heading!.style.lineHeight = "56px";
    heading!.contentEditable = "false";

    // This is the visual model captured before the Markdown DOM is promoted
    // into raw HTML. happy-dom has no layout engine, so geometry is supplied
    // as the measured production boundary would supply it.
    const capturedGeometry = { x: 120, y: 96, width: 640, height: 86 };
    const capturedPresentation = {
      color: getComputedStyle(heading!).color,
      direction: getComputedStyle(heading!).direction,
      fontFamily: getComputedStyle(heading!).fontFamily,
      fontSize: getComputedStyle(heading!).fontSize,
      fontStyle: getComputedStyle(heading!).fontStyle,
      fontWeight: getComputedStyle(heading!).fontWeight,
      letterSpacing: getComputedStyle(heading!).letterSpacing,
      lineHeight: getComputedStyle(heading!).lineHeight,
      textAlign: getComputedStyle(heading!).textAlign,
      textDecoration: getComputedStyle(heading!).textDecoration,
      textShadow: getComputedStyle(heading!).textShadow,
      textTransform: getComputedStyle(heading!).textTransform,
      whiteSpace: getComputedStyle(heading!).whiteSpace,
      wordSpacing: getComputedStyle(heading!).wordSpacing,
    };
    const canvas = ensureSlideTextBoxCanvas(view.container);
    expect(canvas?.fmdSlide.contains(heading!)).toBe(true);

    freezeSlideElementForFreeform(
      heading!,
      capturedGeometry,
      {
        display: "block",
        flexGrow: "0",
        flexShrink: "1",
        flexBasis: "auto",
        alignSelf: "auto",
      },
      capturedPresentation,
    );

    const persisted = sanitizeSlideHtml(slideContent!.innerHTML);
    expect(persisted).toContain('class="fmd-slide"');
    expect(persisted).toContain("fmd-freeform-object");
    expect(persisted).toContain("Edited heading");

    // Restore the ReactMarkdown-owned nodes before the mode-switch render.
    // Production takes this same transactional step after serializing the
    // fmd document so React can safely replace Markdown with raw HTML.
    for (const child of originalChildren) slideContent!.append(child);
    canvas!.fmdSlide.remove();
    heading!.className = originalClassName;
    if (originalStyle === null) heading!.removeAttribute("style");
    else heading!.setAttribute("style", originalStyle);

    view.rerender(<SlideInner slide={{ ...slide, content: persisted }} />);

    const restored = view.container.querySelector<HTMLElement>(
      "h1.fmd-freeform-object",
    );
    expect(restored?.isContentEditable).toBe(false);
    expect(restored?.textContent).toBe("Edited heading");
    expect(restored?.style.position).toBe("absolute");
    expect(restored?.style.left).toBe(`${capturedGeometry.x}px`);
    expect(restored?.style.top).toBe(`${capturedGeometry.y}px`);
    expect(restored?.style.width).toBe(`${capturedGeometry.width}px`);
    expect(restored?.style.height).toBe(`${capturedGeometry.height}px`);
    expect(restored?.style.color).toBe(capturedPresentation.color);
    expect(restored?.style.fontSize).toBe(capturedPresentation.fontSize);
    expect(restored?.closest(".fmd-slide")).toBeTruthy();
  });

  it("round trips a selected inline color without nesting spans or changing the block style", () => {
    const editable = document.createElement("p");
    editable.contentEditable = "true";
    editable.style.color = "rgb(17, 24, 39)";
    editable.textContent = "Keep this word blue";
    document.body.append(editable);

    const text = editable.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 15);
    range.setEnd(text, 19);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    applyInlineTextStyle(editable, { color: "rgb(37, 99, 235)" });
    applyInlineTextStyle(editable, { color: "rgb(37, 99, 235)" });

    expect(editable.textContent).toBe("Keep this word blue");
    expect(
      editable.querySelectorAll("span[data-slide-inline-style]"),
    ).toHaveLength(1);
    expect(editable.querySelector("span")?.textContent).toBe("blue");

    const savedHtml = sanitizeSlideHtml(editable.outerHTML);
    expect(savedHtml).toContain("color: rgb(37, 99, 235)");
    expect(savedHtml).toContain("Keep this word ");
    editable.remove();

    const slide: Slide = {
      id: "rich-text-roundtrip",
      layout: "blank",
      notes: "",
      content: savedHtml,
    };
    const view = render(<SlideInner slide={slide} />);
    const restored = view.container.querySelector<HTMLElement>("p")!;
    const restoredBlue = restored.querySelector<HTMLSpanElement>("span")!;
    const restoredText = restoredBlue.firstChild as Text;

    expect(restored.textContent).toBe("Keep this word blue");
    expect(restoredBlue.style.color).toBe("rgb(37, 99, 235)");

    restored.contentEditable = "true";
    const restoredRange = document.createRange();
    restoredRange.selectNodeContents(restoredText);
    selection.removeAllRanges();
    selection.addRange(restoredRange);
    expect(getInlineTextStyleSnapshot(restored).values.color).toBe(
      "rgb(37, 99, 235)",
    );

    selection.removeAllRanges();
    expect(getInlineTextStyleSnapshot(restored).scope).toBe("block");
    expect(getInlineTextStyleSnapshot(restored).values.color).toBe(
      "rgb(17, 24, 39)",
    );
  });
});
