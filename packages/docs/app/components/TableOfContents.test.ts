import { describe, expect, it } from "vitest";

import { getActiveTocId } from "./TableOfContents";

function headingAt(top: number): Pick<HTMLElement, "getBoundingClientRect"> {
  return {
    getBoundingClientRect: () =>
      ({
        bottom: top + 24,
        height: 24,
        left: 0,
        right: 0,
        top,
        width: 200,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) satisfies DOMRect,
  };
}

describe("getActiveTocId", () => {
  it("returns the deepest heading currently above the scroll offset", () => {
    const headings = new Map([
      ["intro", headingAt(-40)],
      ["actions", headingAt(48)],
      ["security", headingAt(180)],
    ]);

    expect(
      getActiveTocId(
        ["intro", "actions", "security"],
        (id) => headings.get(id) ?? null,
      ),
    ).toBe("actions");
  });
});
