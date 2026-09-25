import { describe, expect, it } from "vitest";

import { imageObjectFitMode, imageObjectFitValue } from "./image-properties";

describe("image object fitting controls", () => {
  it.each([
    ["cover", "crop"],
    ["contain", "fit"],
    ["scale-down", "fit"],
    ["fill", "stretch"],
    [undefined, "stretch"],
  ] as const)("reads %s as %s", (value, expected) => {
    expect(imageObjectFitMode(value)).toBe(expected);
  });

  it.each([
    ["crop", "cover"],
    ["fit", "contain"],
    ["stretch", "fill"],
  ] as const)("writes %s as object-fit %s", (mode, expected) => {
    expect(imageObjectFitValue(mode)).toBe(expected);
  });
});
