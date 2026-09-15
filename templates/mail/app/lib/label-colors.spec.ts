import { describe, expect, it } from "vitest";

import { getLabelStyle } from "./label-colors";

describe("getLabelStyle", () => {
  it("keeps a label color consistent between list and detail views", () => {
    expect(getLabelStyle("social")).toEqual(getLabelStyle("SOCIAL"));
    expect(getLabelStyle("label:custom")).toEqual(getLabelStyle("custom"));
  });

  it("uses distinct palette entries for known Gmail categories", () => {
    expect(getLabelStyle("social")).not.toEqual(getLabelStyle("updates"));
  });
});
