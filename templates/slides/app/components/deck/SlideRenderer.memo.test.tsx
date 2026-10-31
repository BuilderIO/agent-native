// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

const markdownParses = vi.hoisted(() => [] as string[]);

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: ReactNode }) => {
    markdownParses.push(String(children));
    return <div>{children}</div>;
  },
}));

vi.mock("./MermaidRenderer", () => ({
  MermaidRenderer: () => null,
}));

vi.mock("./ExcalidrawSlide", () => ({
  ExcalidrawThumbnail: () => null,
  parseExcalidrawData: () => null,
}));

import SlideRenderer from "./SlideRenderer";

afterEach(() => {
  cleanup();
  markdownParses.length = 0;
});

const slide: Slide = {
  id: "slide-1",
  content: "# Heading\n\nBody",
  notes: "",
  layout: "content",
};

describe("SlideRenderer memoization", () => {
  it("skips a re-render whose props are equal, including an inline slide position", () => {
    const { rerender } = render(
      <SlideRenderer slide={slide} slidePosition={{ number: 1, count: 3 }} />,
    );
    const parsesAfterMount = markdownParses.length;
    expect(parsesAfterMount).toBeGreaterThan(0);

    rerender(
      <SlideRenderer slide={slide} slidePosition={{ number: 1, count: 3 }} />,
    );
    expect(markdownParses).toHaveLength(parsesAfterMount);

    rerender(
      <SlideRenderer slide={slide} slidePosition={{ number: 2, count: 3 }} />,
    );
    // The position changed, but the Markdown source did not: no re-parse.
    expect(markdownParses).toHaveLength(parsesAfterMount);

    rerender(
      <SlideRenderer
        slide={{ ...slide, content: "# Heading\n\nEdited" }}
        slidePosition={{ number: 2, count: 3 }}
      />,
    );
    expect(markdownParses.at(-1)).toBe("# Heading\n\nEdited");
  });
});
