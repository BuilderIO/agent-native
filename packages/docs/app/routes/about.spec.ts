import { describe, expect, it } from "vitest";

import { meta } from "./about";

describe("about page metadata", () => {
  it("includes the product name in the page title", () => {
    expect(meta()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringContaining("Agent-Native"),
        }),
      ]),
    );
  });
});
