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
    expect(result.changed).toBe(true);
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

  it("keeps a caller g flag from overriding all=false", async () => {
    const result = await applySlideContentEdits("<p>Old</p><p>Old</p>", [
      {
        op: "regex-replace",
        pattern: "Old",
        replace: "New",
        flags: "g",
        all: false,
        expectedMatches: 2,
      },
    ]);

    expect(result.content).toBe("<p>New</p><p>Old</p>");
  });

  it("reports edit changes separately from formatter output", async () => {
    const result = await applySlideContentEdits(
      "<div>Old</div>",
      [{ find: "Missing", replace: "Never written", required: false }],
      true,
    );

    expect(result.changed).toBe(false);
    expect(result.content).not.toBe("<div>Old</div>");
  });

  it("matches across differing whitespace and splices the replacement over the original bytes", async () => {
    const result = await applySlideContentEdits(
      "<div>\n  <span>Hello   World</span>\n</div>",
      [{ find: "<span>Hello World</span>", replace: "<span>Hi There</span>" }],
    );

    expect(result.content).toBe("<div>\n  <span>Hi There</span>\n</div>");
  });

  it("reports ambiguity instead of silently patching the first of several matches", async () => {
    await expect(
      applySlideContentEdits("<p>Same</p><p>Same</p>", [
        { find: "<p>Same</p>", replace: "<p>Different</p>" },
      ]),
    ).rejects.toThrow("matched 2 places; pass occurrence");
  });

  it("applies to a specific occurrence once the caller disambiguates", async () => {
    const result = await applySlideContentEdits("<p>Same</p><p>Same</p>", [
      { find: "<p>Same</p>", replace: "<p>Different</p>", occurrence: 2 },
    ]);

    expect(result.content).toBe("<p>Same</p><p>Different</p>");
  });

  it("treats expectedMatches: 0 as a no-op when the target is absent", async () => {
    const result = await applySlideContentEdits("<div>One</div>", [
      { find: "Missing", replace: "Never written", expectedMatches: 0 },
    ]);

    expect(result.content).toBe("<div>One</div>");
    expect(result.applied).toEqual(["replace:0"]);
  });

  it("reports ambiguity for an insert marker that appears more than once with no occurrence given", async () => {
    await expect(
      applySlideContentEdits("<p>Item</p><p>Item</p>", [
        { op: "insert-after", marker: "<p>Item</p>", content: "<hr>" },
      ]),
    ).rejects.toThrow("matched 2 places; pass occurrence");
  });

  it.each([0, 0.5])(
    "rejects an invalid occurrence (%s) and leaves the content untouched",
    async (occurrence) => {
      await expect(
        applySlideContentEdits("<div>One</div>", [
          { find: "One", replace: "Two", occurrence },
        ]),
      ).rejects.toThrow(
        `occurrence must be a positive integer, got ${occurrence}`,
      );
    },
  );
});
