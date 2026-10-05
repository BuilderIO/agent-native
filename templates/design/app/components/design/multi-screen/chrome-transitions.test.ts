import { describe, expect, it } from "vitest";

import { getChromeLabelTransition } from "./chrome-transitions";

describe("getChromeLabelTransition", () => {
  it("keeps label width and ellipsis changes in sync with frame resizing", () => {
    expect(getChromeLabelTransition(true)).toBe(
      "transform 150ms ease-out, opacity 150ms ease-out",
    );
  });
});
