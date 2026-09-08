import {
  DIAGNOSTIC_SNIPPET_CLOSE,
  DIAGNOSTIC_SNIPPET_OPEN,
} from "@agent-native/core/shared";
import { describe, expect, it } from "vitest";

import {
  applySlideContentEdits,
  SlideContentEditError,
} from "./slide-content-patch.js";

describe("applySlideContentEdits", () => {
  it("replaces a selected object's inner content without rewriting its wrapper", async () => {
    const result = await applySlideContentEdits(
      '<div class="fmd-slide"><div data-slide-object-id="title" style="color:red"><span>Old</span><p>Keep</p></div></div>',
      [{ objectId: "title", replace: "New", expectedMatches: 1 }],
    );

    expect(result.content).toBe(
      '<div class="fmd-slide"><div data-slide-object-id="title" style="color:red">New</div></div>',
    );
    expect(result.applied).toEqual(["replace:object"]);
  });

  it("requires a unique object id for selected-object edits", async () => {
    await expect(
      applySlideContentEdits('<div data-slide-object-id="title">One</div>', [
        { objectId: "missing", replace: "New" },
      ]),
    ).rejects.toThrow('objectId "missing" found no matching slide object');

    await expect(
      applySlideContentEdits(
        '<div data-slide-object-id="title">One</div><p data-slide-object-id="title">Two</p>',
        [{ objectId: "title", replace: "New" }],
      ),
    ).rejects.toThrow('objectId "title" matched 2 slide objects');
  });

  it("replaces an empty non-void selected element", async () => {
    const result = await applySlideContentEdits(
      '<div data-slide-object-id="title"></div>',
      [{ objectId: "title", replace: "New" }],
    );

    expect(result.content).toBe('<div data-slide-object-id="title">New</div>');
  });

  it("does not read object ids from another attribute's quoted value", async () => {
    await expect(
      applySlideContentEdits(
        '<div title="data-slide-object-id=title" data-slide-object-id="other">Keep</div>',
        [{ objectId: "title", replace: "New" }],
      ),
    ).rejects.toThrow('objectId "title" found no matching slide object');
  });

  it("rejects selected void elements without editable inner content", async () => {
    await expect(
      applySlideContentEdits(
        '<img data-slide-object-id="image" src="hero.png">',
        [{ objectId: "image", replace: "New" }],
      ),
    ).rejects.toThrow(
      'objectId "image" targets <img>, which has no editable text content',
    );
  });

  it("treats self-closing ordinary elements as non-void", async () => {
    const result = await applySlideContentEdits(
      '<div data-slide-object-id="title"/><span>Keep</span></div>',
      [{ objectId: "title", replace: "New" }],
    );

    expect(result.content).toBe('<div data-slide-object-id="title"/>New</div>');
  });

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

  it("never applies a whitespace-flexible match — reports the original bytes as a fenced candidate", async () => {
    let error: unknown;
    try {
      await applySlideContentEdits(
        "<div>\n  <span>Hello   World</span>\n</div>",
        [
          {
            find: "<span>Hello World</span>",
            replace: "<span>Hi There</span>",
          },
        ],
      );
    } catch (caught) {
      error = caught;
    }

    // Nothing applied: collapsing whitespace to match could otherwise
    // silently rewrite semantically significant whitespace (<pre>, embedded
    // JS/CSS) if it were spliced in.
    expect(error).toBeInstanceOf(SlideContentEditError);
    const message = (error as Error).message;
    expect(message).toContain("Closest matches in the current slide:");
    expect(message).toContain(DIAGNOSTIC_SNIPPET_OPEN);
    expect(message).toContain(DIAGNOSTIC_SNIPPET_CLOSE);
    expect(message).toContain("<span>Hello   World</span>");
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

  it("errors on { occurrence: 2, expectedMatches: 0 } when one match exists, instead of treating it as a no-op", async () => {
    await expect(
      applySlideContentEdits("<div>One</div>", [
        { find: "One", replace: "Two", occurrence: 2, expectedMatches: 0 },
      ]),
    ).rejects.toThrow("replace expected 0 match(es), found 1");
  });

  it("still treats { expectedMatches: 0 } as a no-op when zero matches exist, occurrence included", async () => {
    const result = await applySlideContentEdits("<div>One</div>", [
      { find: "Missing", replace: "Two", occurrence: 1, expectedMatches: 0 },
    ]);

    expect(result.content).toBe("<div>One</div>");
    expect(result.applied).toEqual(["replace:0"]);
  });
});
