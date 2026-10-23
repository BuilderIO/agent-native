import { describe, expect, it } from "vitest";

import { MAX_SLIDE_RENDER_FONT_FAMILIES } from "../../shared/slide-design-tokens";
import { readSlideFontReferences } from "./slide-font-references";

describe("slide font references", () => {
  it("collects custom families from markup, styles, runtime design, and tokens", () => {
    expect(
      readSlideFontReferences({
        html: `<div style="font-family: 'Share Tech Mono', monospace"><style>.title{font-family: "Saira Semi Condensed", sans-serif}</style><svg font-family="Architects Daughter"></svg></div>`,
        styles: ["#slide-root { font-family: 'Share Tech Mono'; }"],
        designFonts: {
          display: "Saira Semi Condensed",
          body: "Inter",
        },
        tokenFamilies: ["Inter", "Arial"],
      }),
    ).toEqual([
      "Architects Daughter",
      "Arial",
      "Inter",
      "Saira Semi Condensed",
      "Share Tech Mono",
    ]);
  });

  it("rejects slides that reference more than the bounded family count", () => {
    const families = Array.from(
      { length: MAX_SLIDE_RENDER_FONT_FAMILIES + 1 },
      (_, index) => `Custom Font ${index}`,
    );
    expect(() =>
      readSlideFontReferences({
        html: "",
        styles: [
          `#slide-root{font-family:${families.map((family) => `\"${family}\"`).join(",")};}`,
        ],
      }),
    ).toThrow("slide-font-family-limit");
  });

  it("surfaces malformed styles instead of silently omitting their font references", () => {
    expect(() =>
      readSlideFontReferences({
        html: "",
        styles: [".title { font-family: Inter;"],
      }),
    ).toThrow("Slide CSS could not be parsed while resolving font references.");
  });
});
