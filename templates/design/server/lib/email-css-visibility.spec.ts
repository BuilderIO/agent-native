import { describe, expect, it } from "vitest";

import { canClipText, hasClippedText } from "./email-css-visibility.js";

function declarations(entries: Array<[string, string]>) {
  return entries.map(([prop, value]) => ({ prop, value }));
}

describe("email CSS text clipping", () => {
  it.each(["0", "-0px", "+0em", ".0rem", "0%", "0e3pt", "0vh"])(
    "recognizes a literal zero extent (%s)",
    (value) => {
      expect(
        hasClippedText(
          declarations([
            ["max-height", value],
            ["overflow", "hidden"],
          ]),
        ),
      ).toBe(true);
    },
  );

  it.each(
    (
      [
        [["height", "0"]],
        [
          ["height", "0"],
          ["overflow", "visible"],
        ],
        [
          ["width", "0"],
          ["overflow-y", "clip"],
        ],
        [
          ["height", "0"],
          ["overflow-x", "clip"],
        ],
        [
          ["height", "0"],
          ["overflow", "clip visible"],
        ],
        [
          ["width", "0"],
          ["overflow", "visible clip"],
        ],
        [
          ["height", "12px"],
          ["overflow", "hidden"],
        ],
        [
          ["height", "-1px"],
          ["overflow", "hidden"],
        ],
        [
          ["height", "calc(1px - 1px)"],
          ["overflow", "hidden"],
        ],
        [
          ["height", "0bogus"],
          ["overflow", "hidden"],
        ],
        [
          ["min-height", "0"],
          ["overflow", "hidden"],
        ],
        [
          ["height", "0"],
          ["overflow", "hidden visible hidden"],
        ],
      ] as Array<Array<[string, string]>>
    ).map((entries) => [entries]),
  )(
    "does not claim clipping without matching static zero and overflow (%j)",
    (entries) => {
      expect(hasClippedText(declarations(entries))).toBe(false);
    },
  );

  it.each([
    ["width", "overflow", "clip visible"],
    ["height", "overflow", "visible clip"],
    ["max-width", "overflow-x", "clip"],
    ["max-height", "overflow-y", "scroll"],
    ["height", "overflow-x", "hidden"],
    ["width", "overflow-y", "auto"],
    ["WIDTH", "OVERFLOW", "VISIBLE HIDDEN"],
  ])("matches clipping axes (%s / %s:%s)", (dimension, property, value) => {
    expect(
      hasClippedText(
        declarations([
          [dimension, "0"],
          [property, value],
        ]),
      ),
    ).toBe(true);
  });

  it("preserves possible clipping when the caller unions conditional declarations", () => {
    expect(
      hasClippedText(
        declarations([
          ["max-height", "0"],
          ["overflow", "hidden"],
          ["overflow", "visible"],
          ["max-height", "none"],
        ]).values(),
      ),
    ).toBe(true);
  });

  it.each([
    ["height", "0", true],
    ["max-width", "0px", true],
    ["overflow-x", "clip", true],
    ["overflow", "visible hidden", true],
    ["height", "10px", false],
    ["height", "calc(0px)", false],
    ["overflow", "visible", false],
    ["padding", "0", false],
  ])(
    "identifies potential clipping declarations (%s:%s)",
    (prop, value, clips) => {
      expect(canClipText({ prop, value })).toBe(clips);
    },
  );
});
