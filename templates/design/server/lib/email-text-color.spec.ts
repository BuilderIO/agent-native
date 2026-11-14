import { describe, expect, it } from "vitest";

import { classifyEmailTextColor } from "./email-text-color.js";

describe("email text color alpha", () => {
  it.each([
    ["RebeccaPurple", 1],
    ["#abc", 1],
    ["#abcdef", 1],
    ["transparent", 0],
    ["TRANSPARENT /* footer */", 0],
    ["#1230", 0],
    ["#11223300", 0],
    ["#1238", 8 / 15],
    ["#11223380", 128 / 255],
    ["rgb(1, 2, 3)", 1],
    ["rgba(1, 2, 3, 0)", 0],
    ["rgba(1, 2, 3, 25%)", 0.25],
    ["rgb(100% 0% 0% / 0%)", 0],
    ["rgb(1 2 3 / .5)", 0.5],
    ["hsl(210, 50%, 40%)", 1],
    ["hsla(210deg, 50%, 40%, 0)", 0],
    ["hsl(.5turn 50% 40% / 0%)", 0],
    ["hwb(120 0% 0% / .25)", 0.25],
    ["lab(50% 0 0 / 0)", 0],
    ["lch(50% 40 120 / 50%)", 0.5],
    ["oklab(50% .1 .1 / 0)", 0],
    ["oklch(50% .1 120 / 25%)", 0.25],
    ["color(display-p3 1 0 0 / 0%)", 0],
    ["color(srgb 1 0 0)", 1],
    ["rgb(1 2 3 / -50%)", 0],
    ["rgba(1, 2, 3, 2)", 1],
  ])("classifies absolute color %s", (value, alpha) => {
    expect(classifyEmailTextColor(value)).toEqual({ kind: "resolved", alpha });
  });

  it.each([undefined, "", "currentColor", "inherit /* footer */", "unset"])(
    "preserves inheritance for %s",
    (value) => {
      expect(classifyEmailTextColor(value)).toEqual({ kind: "inherit" });
    },
  );

  it("distinguishes the initial color reset from inheritance", () => {
    expect(classifyEmailTextColor("initial")).toEqual({ kind: "initial" });
  });

  it.each([
    "revert",
    "revert-layer",
    "notacolor",
    "#12345",
    "rgb(1 2)",
    "red blue",
    "rgb(1 2 3 /)",
    "rgb(1 2 3 / none)",
    "rgb(1 2 3 / calc(1 - 1))",
    "rgb(from red r g b / 0)",
    "var(--footer-color)",
    "color-mix(in srgb, transparent, transparent)",
    "light-dark(transparent, transparent)",
  ])("does not turn an unresolved color into visible text (%s)", (value) => {
    expect(classifyEmailTextColor(value)).toEqual({ kind: "unsupported" });
  });
});
