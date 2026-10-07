import { describe, expect, it } from "vitest";

import { getPopoverAutoSizeOptions } from "./popover-sizing";

describe("getPopoverAutoSizeOptions", () => {
  it("sizes Settings while recording starts", () => {
    expect(getPopoverAutoSizeOptions("settings", false, true)).toEqual({
      disabled: false,
      width: 720,
    });
  });

  it("restores recorder and memory widths during a recording", () => {
    expect(getPopoverAutoSizeOptions("recorder", true, false)).toEqual({
      disabled: false,
      width: 320,
    });
    expect(getPopoverAutoSizeOptions("memory", true, false)).toEqual({
      disabled: false,
      width: 440,
    });
  });

  it("keeps recorder and memory sizing disabled while hidden", () => {
    expect(getPopoverAutoSizeOptions("recorder", false, false).disabled).toBe(
      true,
    );
    expect(getPopoverAutoSizeOptions("memory", false, false).disabled).toBe(
      true,
    );
  });

  it("keeps recorder and memory sizing disabled while recording starts", () => {
    expect(getPopoverAutoSizeOptions("recorder", true, true).disabled).toBe(
      true,
    );
    expect(getPopoverAutoSizeOptions("memory", true, true).disabled).toBe(true);
  });
});
