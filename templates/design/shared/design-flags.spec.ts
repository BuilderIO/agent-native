import { describe, expect, it } from "vitest";

import { DESIGN_REVIEW_PANEL } from "./design-flags.js";

describe("DESIGN_REVIEW_PANEL", () => {
  it("is default-off", () => {
    expect(DESIGN_REVIEW_PANEL).toMatchObject({
      key: "design-review-panel",
      defaultValue: false,
    });
  });
});
