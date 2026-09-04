import { describe, expect, it } from "vitest";

import {
  formatHtmlStyleSummary,
  summarizeHtmlStyles,
} from "./html-style-summary.js";

const dark = (title: string) =>
  `<div class="slide" style="padding: 80px; background: #0a0a0a; font-family: 'Geist', sans-serif; color: #faf9f5"><div style="font: 600 13px &quot;Geist Mono&quot;, monospace; color: rgb(1, 200, 241)">01</div><h2 style="font-size: 38px; color: rgb(250, 249, 245)">${title}</h2></div>`;

describe("summarizeHtmlStyles", () => {
  it("tallies each value once per fragment and names the rare ones", () => {
    const summary = summarizeHtmlStyles([
      {
        label: "slide 1",
        html: `<div style="background: #FAF9F5; color: #171717"><h1 style="font-size: 56px; color: #171717">Title</h1></div>`,
      },
      { label: "slide 2", html: dark("What") },
      { label: "slide 3", html: dark("Why") },
      { label: "slide 4", html: dark("When") },
    ]);

    expect(summary.fragments).toBe(4);
    expect(summary.backgrounds).toEqual([
      { value: "#0a0a0a", fragments: 3 },
      { value: "#faf9f5", fragments: 1, labels: ["slide 1"] },
    ]);
    expect(summary.textColors[0]).toEqual({ value: "#faf9f5", fragments: 3 });
    // The accent is applied through `color:` on the eyebrow, so it counts as
    // a text color rather than an accent found elsewhere.
    expect(summary.textColors).toContainEqual({
      value: "rgb(1, 200, 241)",
      fragments: 3,
    });
    expect(summary.textColors).toContainEqual({
      value: "#171717",
      fragments: 1,
      labels: ["slide 1"],
    });
    expect(summary.otherColors).toEqual([]);
    expect(summary.fontFamilies).toEqual([
      { value: "Geist", fragments: 3 },
      { value: "Geist Mono", fragments: 3 },
    ]);
    expect(summary.headingSizes).toEqual([
      { value: "38px", fragments: 3 },
      { value: "56px", fragments: 1, labels: ["slide 1"] },
    ]);
  });

  it("ignores non-color keywords and reports gradients and images by kind", () => {
    const summary = summarizeHtmlStyles([
      {
        label: "a",
        html: `<div style="background: transparent; color: inherit; border-color: #ff0000"><p style="background: linear-gradient(#000, #fff); background-image: url(x.png)">x</p></div>`,
      },
    ]);
    expect(summary.backgrounds.map((entry) => entry.value)).toEqual([
      "gradient",
      "image",
    ]);
    expect(summary.textColors).toEqual([]);
    // Gradient stops and the border color are colors the fragment uses
    // without being its background or text, so they surface as accents.
    expect(summary.otherColors).toEqual([
      { value: "#000", fragments: 1, labels: ["a"] },
      { value: "#ff0000", fragments: 1, labels: ["a"] },
      { value: "#fff", fragments: 1, labels: ["a"] },
    ]);
  });

  it("formats lines an agent can act on and stays silent for unstyled html", () => {
    const lines = formatHtmlStyleSummary(
      summarizeHtmlStyles([
        { label: "slide 1", html: dark("a") },
        { label: "slide 2", html: dark("b") },
        { label: "slide 3", html: dark("c") },
      ]),
      { noun: "slide" },
    );
    expect(lines[0]).toBe("backgrounds: #0a0a0a (3 slides)");
    expect(lines.at(-1)).toMatch(/Reuse these values/);
    expect(
      formatHtmlStyleSummary(
        summarizeHtmlStyles([{ label: "x", html: "<p>plain</p>" }]),
      ),
    ).toEqual([]);
  });
});
