// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { shortcutLabel } from "./utils";

describe("shortcutLabel", () => {
  it("separates shortcut keys without a plus sign", () => {
    const label = shortcutLabel("cmd+alt+c");

    expect(label).not.toContain("+");
    expect(label.endsWith("C")).toBe(true);
  });
});
