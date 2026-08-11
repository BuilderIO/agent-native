import { describe, expect, it } from "vitest";

import {
  applySlideContentEdits,
  SlideContentEditError,
} from "./slide-content-patch.js";

describe("applySlideContentEdits", () => {
  it("applies several exact edits in order without regenerating untouched source", async () => {
    const result = await applySlideContentEdits(
      '<section data-id="hero"><h1>Old</h1><p>Keep\nthis</p></section>',
      [
        { find: ">Old<", replace: ">New<", expectedMatches: 1 },
        {
          op: "insert-before",
          marker: "<p>",
          content: '<span class="eyebrow">Now</span>',
          expectedMatches: 1,
        },
      ],
    );

    expect(result.content).toBe(
      '<section data-id="hero"><h1>New</h1><span class="eyebrow">Now</span><p>Keep\nthis</p></section>',
    );
    expect(result.applied).toEqual(["replace:first", "insert-before:1"]);
  });

  it("fails the whole patch when a later edit misses", async () => {
    await expect(
      applySlideContentEdits("<h1>Old</h1>", [
        { find: "Old", replace: "New" },
        { find: "Missing", replace: "Never written" },
      ]),
    ).rejects.toThrow("replace found no matches");
  });

  it("requires explicit match counts for ambiguous structural patches", async () => {
    await expect(
      applySlideContentEdits(
        "<!-- start -->one<!-- end --><!-- start -->two<!-- end -->",
        [
          {
            op: "replace-between",
            start: "<!-- start -->",
            end: "<!-- end -->",
            content: "updated",
          },
        ],
      ),
    ).rejects.toBeInstanceOf(SlideContentEditError);
  });

  it("supports regex edits with an explicit all flag", async () => {
    const result = await applySlideContentEdits("<p>Old</p><p>Old</p>", [
      {
        op: "regex-replace",
        pattern: "Old",
        replace: "New",
        all: true,
        expectedMatches: 2,
      },
    ]);

    expect(result.content).toBe("<p>New</p><p>New</p>");
  });
});
