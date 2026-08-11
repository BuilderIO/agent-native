import { describe, expect, it } from "vitest";

import { isMacAppHideShortcut } from "./desktop-shortcuts";

describe("isMacAppHideShortcut", () => {
  it("recognizes plain Command+H", () => {
    expect(isMacAppHideShortcut({ key: "h", meta: true })).toBe(true);
    expect(isMacAppHideShortcut({ code: "KeyH", meta: true })).toBe(true);
  });

  it("does not consume other Command+H combinations", () => {
    expect(isMacAppHideShortcut({ key: "h", meta: true, shift: true })).toBe(
      false,
    );
    expect(isMacAppHideShortcut({ key: "h", meta: true, alt: true })).toBe(
      false,
    );
    expect(isMacAppHideShortcut({ key: "h", meta: true, control: true })).toBe(
      false,
    );
    expect(isMacAppHideShortcut({ key: "h" })).toBe(false);
  });
});
