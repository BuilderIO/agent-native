import { describe, expect, it } from "vitest";

import {
  pickRepresentativeSlide,
  slideStyleFragment,
} from "./representative-slide.js";

const dark = (id: string, layout: string) => ({
  id,
  layout,
  content: `<div style="background: #0a0a0a; color: #faf9f5"><h2 style="font-size: 38px">${id}</h2></div>`,
});

describe("pickRepresentativeSlide", () => {
  it("prefers a same-layout sibling that carries the deck's majority palette", () => {
    const slides = [
      {
        id: "light-title",
        layout: "statement",
        content: `<div style="background: #faf9f5; color: #171717"><h1>T</h1></div>`,
      },
      dark("c1", "content"),
      dark("c2", "content"),
      dark("dark-title", "statement"),
    ];
    expect(pickRepresentativeSlide(slides, 0)).toBe(3);
  });

  it("falls back to any majority-palette sibling, then any other slide", () => {
    const slides = [
      {
        id: "odd",
        layout: "image",
        content: `<div style="background: #ffffff; color: #000000">x</div>`,
      },
      dark("c1", "content"),
      dark("c2", "content"),
    ];
    expect(pickRepresentativeSlide(slides, 0)).toBe(1);
    expect(
      pickRepresentativeSlide(
        [slides[0]!, { id: "blank", layout: "blank", content: "" }],
        0,
      ),
    ).toBe(1);
    expect(pickRepresentativeSlide([slides[0]!], 0)).toBeNull();
  });

  it("keeps the layout preference when no color is shared by two slides", () => {
    const slides = [
      {
        id: "current",
        layout: "content",
        content: `<div style="background: #ffffff; color: #111111">a</div>`,
      },
      {
        id: "sorts-first",
        layout: "image",
        content: `<div style="background: #000000; color: #222222">b</div>`,
      },
      {
        id: "same-layout",
        layout: "content",
        content: `<div style="background: #cccccc; color: #333333">c</div>`,
      },
    ];
    expect(pickRepresentativeSlide(slides, 0)).toBe(2);
  });

  it("folds in an explicit background but not the renderer's default", () => {
    expect(slideStyleFragment({ id: "a", content: "<p>a</p>" })).toBe(
      "<p>a</p>",
    );
    expect(
      slideStyleFragment({
        id: "b",
        content: "<p>b</p>",
        background: "bg-[#0a0a0a]",
      }),
    ).toBe('<div style="background: #0a0a0a"><p>b</p></div>');
    expect(
      slideStyleFragment({
        id: "c",
        content: "<p>c</p>",
        background: "bg-black",
      }),
    ).toBe("<p>c</p>");
  });

  it("reads the fill from slide.background when the HTML has none", () => {
    const slides = [
      {
        id: "a",
        layout: "content",
        content: "<p>a</p>",
        background: "bg-[#0a0a0a]",
      },
      {
        id: "b",
        layout: "content",
        content: "<p>b</p>",
        background: "#0a0a0a",
      },
      {
        id: "c",
        layout: "content",
        content: "<p>c</p>",
        background: "#ffffff",
      },
    ];
    expect(pickRepresentativeSlide(slides, 2)).toBe(0);
  });
});
