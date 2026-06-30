import { describe, expect, it } from "vitest";

import {
  isBooleanPropValue,
  openingTagOf,
  parseAlpineDataObject,
  serializeAlpineDataObject,
  truncateOpeningTag,
} from "./EditPanel";

// ---------------------------------------------------------------------------
// openingTagOf / truncateOpeningTag — Inspect-code at-a-glance
// ---------------------------------------------------------------------------

describe("openingTagOf", () => {
  it("extracts the opening tag with attributes from outer HTML", () => {
    expect(
      openingTagOf(
        `<main class="hero" data-x="value">child<span>hi</span></main>`,
      ),
    ).toBe(`<main class="hero" data-x="value">`);
  });

  it("handles a bare tag with no attributes", () => {
    expect(openingTagOf(`<section>content</section>`)).toBe(`<section>`);
  });

  it("keeps the self-closing slash", () => {
    expect(openingTagOf(`<img src="a.png" alt="x"/>`)).toBe(
      `<img src="a.png" alt="x"/>`,
    );
  });

  it("does not break on `>` inside a quoted attribute value", () => {
    expect(openingTagOf(`<div title="a > b" class="c">x</div>`)).toBe(
      `<div title="a > b" class="c">`,
    );
  });

  it("tolerates leading whitespace", () => {
    expect(openingTagOf(`\n  <button>Go</button>`)).toBe(`<button>`);
  });

  it("returns null for empty / non-element input", () => {
    expect(openingTagOf("")).toBeNull();
    expect(openingTagOf(null)).toBeNull();
    expect(openingTagOf("just text")).toBeNull();
  });
});

describe("truncateOpeningTag", () => {
  it("truncates long attribute values but keeps quotes", () => {
    const long = `<div class="${"x".repeat(80)}">`;
    const out = truncateOpeningTag(long, 10);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("…");
    expect(out.startsWith(`<div class="`)).toBe(true);
    expect(out.endsWith(`">`)).toBe(true);
  });

  it("leaves short values untouched", () => {
    const tag = `<a href="#" class="btn">`;
    expect(truncateOpeningTag(tag)).toBe(tag);
  });
});

// ---------------------------------------------------------------------------
// parseAlpineDataObject / serializeAlpineDataObject — variant/state edits
// ---------------------------------------------------------------------------

describe("parseAlpineDataObject", () => {
  it("parses a flat object of strings, booleans, and numbers", () => {
    expect(
      parseAlpineDataObject(
        `{ variant: 'outline', disabled: false, count: 3 }`,
      ),
    ).toEqual({ variant: "outline", disabled: "false", count: "3" });
  });

  it("supports double-quoted string values and quoted keys", () => {
    expect(parseAlpineDataObject(`{ "size": "lg", 'tone': "muted" }`)).toEqual({
      size: "lg",
      tone: "muted",
    });
  });

  it("returns an empty object for an empty literal", () => {
    expect(parseAlpineDataObject(`{}`)).toEqual({});
  });

  it("returns null for non-object / unparseable input", () => {
    expect(parseAlpineDataObject(undefined)).toBeNull();
    expect(parseAlpineDataObject("open")).toBeNull();
    // A function expression is too complex to edit safely.
    expect(parseAlpineDataObject(`{ open() { return 1 } }`)).toBeNull();
  });
});

describe("serializeAlpineDataObject", () => {
  it("single-quotes strings and leaves booleans/numbers bare", () => {
    expect(
      serializeAlpineDataObject({
        variant: "outline",
        disabled: "false",
        count: "3",
      }),
    ).toBe(`{ variant: 'outline', disabled: false, count: 3 }`);
  });

  it("round-trips parse → mutate → serialize for a variant switch", () => {
    const parsed = parseAlpineDataObject(`{ variant: 'solid', open: true }`)!;
    const next = serializeAlpineDataObject({ ...parsed, variant: "outline" });
    expect(next).toBe(`{ variant: 'outline', open: true }`);
  });

  it("escapes single quotes inside string values", () => {
    expect(serializeAlpineDataObject({ label: "it's" })).toBe(
      `{ label: 'it\\'s' }`,
    );
  });

  it("produces an empty object literal for no keys", () => {
    expect(serializeAlpineDataObject({})).toBe("{}");
  });
});

// ---------------------------------------------------------------------------
// isBooleanPropValue — toggle detection
// ---------------------------------------------------------------------------

describe("isBooleanPropValue", () => {
  it("recognizes true/false case-insensitively", () => {
    expect(isBooleanPropValue("true")).toBe(true);
    expect(isBooleanPropValue("False")).toBe(true);
    expect(isBooleanPropValue("  TRUE ")).toBe(true);
  });

  it("rejects non-boolean values", () => {
    expect(isBooleanPropValue("outline")).toBe(false);
    expect(isBooleanPropValue("1")).toBe(false);
    expect(isBooleanPropValue("")).toBe(false);
  });
});
