import { describe, expect, it } from "vitest";

import { buildComponentPropRows } from "./edit-panel/component-section";
import {
  alpineDataValueLiteral,
  canRebuildAlpineDataLosslessly,
  elementHtmlPreview,
  isBooleanPropValue,
  mergeRotationValue,
  normalizeRotationDegrees,
  openingTagOf,
  parseAlpineDataObject,
  replaceAlpineDataKeyValue,
  serializeAlpineDataObject,
  truncateOpeningTag,
} from "./EditPanel";


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

describe("elementHtmlPreview", () => {
  it("includes the selected element's content in the inspect output", () => {
    expect(
      elementHtmlPreview({
        html: `<article class="card" data-kind="story"><h1>Hello</h1></article>`,
        tagName: "article",
      }),
    ).toBe(
      `<article class="card" data-kind="story">\n  <h1>Hello</h1>\n</article>`,
    );
  });

  it("uses tag metadata when outer HTML is unavailable", () => {
    expect(
      elementHtmlPreview({
        html: null,
        tagName: "div",
        id: "hero",
        classes: ["rounded", "featured"],
      }),
    ).toBe(`<div id="hero" class="rounded featured">\n  ...\n</div>`);
  });

  it("keeps void image tags as a single highlighted line", () => {
    expect(
      elementHtmlPreview({
        html: `<img src="/hero.png" alt="Hero">`,
        tagName: "img",
      }),
    ).toBe(`<img src="/hero.png" alt="Hero">`);
  });
});


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


describe("alpineDataValueLiteral", () => {
  it("single-quotes string values and escapes single quotes", () => {
    expect(alpineDataValueLiteral("outline")).toBe(`'outline'`);
    expect(alpineDataValueLiteral("it's")).toBe(`'it\\'s'`);
  });

  it("leaves booleans and numbers bare", () => {
    expect(alpineDataValueLiteral("true")).toBe("true");
    expect(alpineDataValueLiteral("false")).toBe("false");
    expect(alpineDataValueLiteral("3")).toBe("3");
    expect(alpineDataValueLiteral("-1.5")).toBe("-1.5");
  });
});


describe("replaceAlpineDataKeyValue", () => {
  it("edits one key while preserving a sibling method byte-for-byte", () => {
    const original = `{ open: false, toggle() { this.open = !this.open } }`;
    const out = replaceAlpineDataKeyValue(original, "open", "true");
    expect(out).toBe(`{ open: true, toggle() { this.open = !this.open } }`);
    expect(out).toContain("toggle() { this.open = !this.open }");
  });

  it("edits a string value and keeps a trailing method", () => {
    const original = `{ variant: 'solid', render() { return this.variant } }`;
    expect(replaceAlpineDataKeyValue(original, "variant", "outline")).toBe(
      `{ variant: 'outline', render() { return this.variant } }`,
    );
  });

  it("preserves escaped quotes inside other string values", () => {
    const original = `{ label: 'a', note: 'it\\'s fine' }`;
    expect(replaceAlpineDataKeyValue(original, "label", "b")).toBe(
      `{ label: 'b', note: 'it\\'s fine' }`,
    );
  });

  it("does not match a key that lives inside another string value", () => {
    const original = `{ note: 'open the door', open: false }`;
    expect(replaceAlpineDataKeyValue(original, "open", "true")).toBe(
      `{ note: 'open the door', open: true }`,
    );
  });

  it("handles quoted keys", () => {
    const original = `{ "size": 'lg', 'tone': 'muted' }`;
    expect(replaceAlpineDataKeyValue(original, "size", "sm")).toBe(
      `{ "size": 'sm', 'tone': 'muted' }`,
    );
  });

  it("preserves a nested object sibling", () => {
    const original = `{ open: false, meta: { a: 1, b: 2 } }`;
    expect(replaceAlpineDataKeyValue(original, "open", "true")).toBe(
      `{ open: true, meta: { a: 1, b: 2 } }`,
    );
  });

  it("does not match a nested key with the same name", () => {
    const original = `{ open: false, meta: { open: true } }`;
    expect(replaceAlpineDataKeyValue(original, "open", "true")).toBe(
      `{ open: true, meta: { open: true } }`,
    );
  });

  it("returns null when the key is absent (caller decides fallback)", () => {
    expect(
      replaceAlpineDataKeyValue(`{ open: false }`, "variant", "outline"),
    ).toBeNull();
  });

  it("returns null when the value is an expression, not a simple literal", () => {
    expect(
      replaceAlpineDataKeyValue(
        `{ open: someFn(), variant: 'solid' }`,
        "open",
        "true",
      ),
    ).toBeNull();
  });

  it("returns null for non-object / empty input", () => {
    expect(replaceAlpineDataKeyValue("", "open", "true")).toBeNull();
    expect(replaceAlpineDataKeyValue(undefined, "open", "true")).toBeNull();
    expect(replaceAlpineDataKeyValue("open", "open", "true")).toBeNull();
  });

  it("does not match a key that is a prefix of a longer identifier", () => {
    const original = `{ openState: 'a', other: 'b' }`;
    expect(replaceAlpineDataKeyValue(original, "open", "x")).toBeNull();
  });
});


describe("canRebuildAlpineDataLosslessly", () => {
  it("allows rebuild for an empty / absent literal", () => {
    expect(canRebuildAlpineDataLosslessly("")).toBe(true);
    expect(canRebuildAlpineDataLosslessly(undefined)).toBe(true);
    expect(canRebuildAlpineDataLosslessly("{}")).toBe(true);
    expect(canRebuildAlpineDataLosslessly("{ }")).toBe(true);
  });

  it("allows rebuild for a flat simple object", () => {
    expect(
      canRebuildAlpineDataLosslessly(`{ variant: 'solid', open: false }`),
    ).toBe(true);
  });

  it("forbids rebuild when a method is present", () => {
    expect(
      canRebuildAlpineDataLosslessly(
        `{ open: false, toggle() { this.open = !this.open } }`,
      ),
    ).toBe(false);
  });

  it("forbids rebuild when a nested object is present", () => {
    expect(
      canRebuildAlpineDataLosslessly(`{ open: false, meta: { a: 1 } }`),
    ).toBe(false);
  });

  it("forbids rebuild when a value is an expression", () => {
    expect(canRebuildAlpineDataLosslessly(`{ open: false, x: someFn() }`)).toBe(
      false,
    );
  });
});



describe("buildComponentPropRows", () => {
  it("lists Alpine x-data keys first, tagged for the alpineData surface", () => {
    const rows = buildComponentPropRows({
      instance: { alpineData: "{ variant: 'solid', open: false }" },
      observedProps: [],
      persistedVariants: { variant: ["solid", "outline"] },
    });
    const variantRow = rows.find((r) => r.name === "variant");
    expect(variantRow).toMatchObject({
      value: "solid",
      surface: "alpineData",
      options: ["solid", "outline"],
    });
    const openRow = rows.find((r) => r.name === "open");
    expect(openRow).toMatchObject({ value: "false", surface: "alpineData" });
  });

  it("lists observed data-attribute props not already in x-data, tagged attribute", () => {
    const rows = buildComponentPropRows({
      instance: { alpineData: "{ open: false }" },
      observedProps: [{ name: "label", value: "Save" }],
      persistedVariants: {},
    });
    expect(rows.find((r) => r.name === "label")).toMatchObject({
      value: "Save",
      surface: "attribute",
    });
    expect(rows.filter((r) => r.name === "open")).toHaveLength(1);
  });

  it("defaults a never-observed persisted-variant group to the attribute surface even when x-data exists for other keys", () => {
    const rows = buildComponentPropRows({
      instance: { alpineData: "{ open: false }" },
      observedProps: [],
      persistedVariants: { size: ["sm", "md", "lg"] },
    });
    const sizeRow = rows.find((r) => r.name === "size");
    expect(sizeRow).toMatchObject({
      value: "sm",
      surface: "attribute",
      options: ["sm", "md", "lg"],
    });
  });

  it("defaults a never-observed persisted-variant group to attribute when there is no x-data at all", () => {
    const rows = buildComponentPropRows({
      instance: null,
      observedProps: [],
      persistedVariants: { size: ["sm", "lg"] },
    });
    expect(rows.find((r) => r.name === "size")).toMatchObject({
      value: "sm",
      surface: "attribute",
    });
  });

  it("does not duplicate a group already covered by x-data or an observed attribute", () => {
    const rows = buildComponentPropRows({
      instance: { alpineData: "{ variant: 'solid' }" },
      observedProps: [{ name: "label", value: "Save" }],
      persistedVariants: { variant: ["solid", "outline"], label: [] },
    });
    expect(rows.filter((r) => r.name === "variant")).toHaveLength(1);
    expect(rows.filter((r) => r.name === "label")).toHaveLength(1);
  });
});

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


describe("normalizeRotationDegrees", () => {
  it("maps angles into (-180, 180]", () => {
    expect(normalizeRotationDegrees(0)).toBe(0);
    expect(normalizeRotationDegrees(45)).toBe(45);
    expect(normalizeRotationDegrees(180)).toBe(180);
    expect(normalizeRotationDegrees(-180)).toBe(180);
    expect(normalizeRotationDegrees(190)).toBe(-170);
    expect(normalizeRotationDegrees(270)).toBe(-90);
    expect(normalizeRotationDegrees(-270)).toBe(90);
    expect(normalizeRotationDegrees(360)).toBe(0);
    expect(normalizeRotationDegrees(540)).toBe(180);
    expect(normalizeRotationDegrees(-540)).toBe(180);
    expect(normalizeRotationDegrees(725)).toBe(5);
  });

  it("never returns -0 and handles non-finite input", () => {
    expect(Object.is(normalizeRotationDegrees(-360), -0)).toBe(false);
    expect(normalizeRotationDegrees(Number.NaN)).toBe(0);
    expect(normalizeRotationDegrees(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("mergeRotationValue", () => {
  it("normalizes the committed angle into (-180, 180]", () => {
    expect(mergeRotationValue(undefined, 270)).toBe("rotate(-90deg)");
    expect(mergeRotationValue("none", 360)).toBe("rotate(0deg)");
    expect(mergeRotationValue(undefined, -180)).toBe("rotate(180deg)");
  });

  it("replaces an existing rotate() in any unit without compounding", () => {
    expect(mergeRotationValue("rotate(30deg)", 190)).toBe("rotate(-170deg)");
    expect(mergeRotationValue("translateX(4px) rotate(0.5turn)", 45)).toBe(
      "translateX(4px) rotate(45deg)",
    );
  });

  it("appends rotate when the transform has none", () => {
    expect(mergeRotationValue("scale(2)", 90)).toBe("scale(2) rotate(90deg)");
  });

  it("rounds to one decimal before normalizing", () => {
    expect(mergeRotationValue(undefined, -179.96)).toBe("rotate(180deg)");
    expect(mergeRotationValue(undefined, 12.34)).toBe("rotate(12.3deg)");
  });
});
