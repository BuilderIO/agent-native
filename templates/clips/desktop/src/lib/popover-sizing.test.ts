import { describe, expect, it } from "vitest";

import { getPopoverAutoSizeOptions } from "./popover-sizing";

describe("getPopoverAutoSizeOptions", () => {
  it("sizes Settings while a recording is active", () => {
    expect(getPopoverAutoSizeOptions("settings", false, true)).toEqual({
      disabled: false,
      width: 720,
      purpose: "settings",
    });
  });

  it("keeps recorder resizing disabled during a recording", () => {
    expect(getPopoverAutoSizeOptions("recorder", true, true)).toEqual({
      disabled: true,
      width: 320,
      purpose: "popover",
    });
  });

  it("keeps the memory popover at its own width", () => {
    expect(getPopoverAutoSizeOptions("memory", true, false)).toEqual({
      disabled: false,
      width: 440,
      purpose: "popover",
    });
  });
});
