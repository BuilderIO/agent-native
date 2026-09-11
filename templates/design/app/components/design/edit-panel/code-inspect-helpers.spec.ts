import { describe, expect, it } from "vitest";

import {
  alpineDataValueLiteral,
  canRebuildAlpineDataLosslessly,
  elementHtmlPreview,
  formatInspectCodeOpeningTag,
  isBooleanPropValue,
  openingTagOf,
  parseAlpineDataObject,
  replaceAlpineDataKeyValue,
  serializeAlpineDataObject,
  truncateOpeningTag,
} from "./code-inspect-helpers";

// ---------------------------------------------------------------------------
// parseAlpineDataObject — regression guard for the escaped-quote bug: a
// string value containing a backslash-escaped quote (e.g. Alpine data like
// `{ label: 'it\'s ok' }`, a very ordinary English-text prop value) used to
// truncate at the escaped quote, silently dropping the remainder of the
// string instead of decoding it back to the literal apostrophe.
// ---------------------------------------------------------------------------

describe("parseAlpineDataObject", () => {
  it("parses simple flat string/boolean/number literals", () => {
    expect(
      parseAlpineDataObject("{ variant: 'outline', size: 'lg', open: false }"),
    ).toEqual({ variant: "outline", size: "lg", open: "false" });
  });

  it("decodes a backslash-escaped single quote inside a single-quoted value", () => {
    expect(parseAlpineDataObject("{ label: 'it\\'s ok' }")).toEqual({
      label: "it's ok",
    });
  });

  it("decodes a backslash-escaped double quote inside a double-quoted value", () => {
    expect(parseAlpineDataObject('{ label: "she said \\"hi\\"" }')).toEqual({
      label: 'she said "hi"',
    });
  });

  it("does not require escaping the opposite quote style", () => {
    // A single-quoted value may contain a literal double quote (and vice
    // versa) with no escaping at all — only the matching quote needs escapes.
    expect(parseAlpineDataObject("{ label: 'she said \"hi\"' }")).toEqual({
      label: 'she said "hi"',
    });
  });

  it("returns null for a value richer than a flat literal (nested object)", () => {
    expect(parseAlpineDataObject("{ config: { a: 1 } }")).toBeNull();
  });

  it("returns null when the literal isn't an object at all", () => {
    expect(parseAlpineDataObject("notAnObject")).toBeNull();
    expect(parseAlpineDataObject(null)).toBeNull();
    expect(parseAlpineDataObject(undefined)).toBeNull();
  });

  it("returns an empty object for an empty literal", () => {
    expect(parseAlpineDataObject("{}")).toEqual({});
  });
});

describe("serializeAlpineDataObject / alpineDataValueLiteral", () => {
  it("round-trips a value containing an apostrophe through escape/unescape", () => {
    const original = "it's ok";
    const literal = alpineDataValueLiteral(original);
    expect(literal).toBe("'it\\'s ok'");
    const serialized = serializeAlpineDataObject({ label: original });
    expect(parseAlpineDataObject(serialized)).toEqual({ label: original });
  });

  it("keeps booleans and numbers unquoted", () => {
    expect(serializeAlpineDataObject({ open: "true", count: "3" })).toBe(
      "{ open: true, count: 3 }",
    );
  });
});

describe("canRebuildAlpineDataLosslessly", () => {
  it("is true for an absent or empty literal", () => {
    expect(canRebuildAlpineDataLosslessly(undefined)).toBe(true);
    expect(canRebuildAlpineDataLosslessly(null)).toBe(true);
    expect(canRebuildAlpineDataLosslessly("{}")).toBe(true);
    expect(canRebuildAlpineDataLosslessly("{ }")).toBe(true);
  });

  it("is true for a flat object of simple literals", () => {
    expect(
      canRebuildAlpineDataLosslessly(
        "{ variant: 'outline', size: 'lg', open: false, count: 3 }",
      ),
    ).toBe(true);
  });

  it("is true for a flat object whose only string value contains an escaped quote (no longer a false positive from truncation — the value now decodes and re-encodes to the exact same source)", () => {
    expect(canRebuildAlpineDataLosslessly("{ label: 'it\\'s ok' }")).toBe(true);
  });

  it("is false when the literal holds a method (richer than simple literals)", () => {
    expect(
      canRebuildAlpineDataLosslessly(
        "{ open: false, toggle() { this.open = !this.open } }",
      ),
    ).toBe(false);
  });

  it("is false when the literal holds a nested object", () => {
    expect(canRebuildAlpineDataLosslessly("{ config: { a: 1 } }")).toBe(false);
  });

  it("is false when the literal isn't a `{ … }` object at all", () => {
    expect(canRebuildAlpineDataLosslessly("someExpression()")).toBe(false);
  });
});

describe("replaceAlpineDataKeyValue", () => {
  it("surgically replaces one key's value, preserving everything else", () => {
    expect(
      replaceAlpineDataKeyValue(
        "{ variant: 'outline', toggle() { this.open = !this.open } }",
        "variant",
        "solid",
      ),
    ).toBe("{ variant: 'solid', toggle() { this.open = !this.open } }");
  });

  it("returns null when the key's current value is not a simple literal", () => {
    expect(
      replaceAlpineDataKeyValue("{ config: { a: 1 } }", "config", "x"),
    ).toBeNull();
  });

  it("handles an escaped quote inside the ORIGINAL value while locating it", () => {
    // The target value itself contains an escaped quote before the key we're
    // replacing — the walk must skip over it correctly rather than getting
    // confused by the embedded quote.
    expect(
      replaceAlpineDataKeyValue(
        "{ label: 'it\\'s ok', variant: 'outline' }",
        "variant",
        "solid",
      ),
    ).toBe("{ label: 'it\\'s ok', variant: 'solid' }");
  });
});

describe("isBooleanPropValue", () => {
  it("is true for true/false, case-insensitively", () => {
    expect(isBooleanPropValue("true")).toBe(true);
    expect(isBooleanPropValue("FALSE")).toBe(true);
    expect(isBooleanPropValue(" True ")).toBe(true);
  });

  it("is false for any other string, including boolean-suggestive text", () => {
    expect(isBooleanPropValue("yes")).toBe(false);
    expect(isBooleanPropValue("1")).toBe(false);
    expect(isBooleanPropValue("")).toBe(false);
  });
});

describe("openingTagOf / truncateOpeningTag / elementHtmlPreview", () => {
  it("extracts the opening tag including attributes", () => {
    expect(openingTagOf('<main class="hero" data-x="y">body</main>')).toBe(
      '<main class="hero" data-x="y">',
    );
  });

  it("returns null when no tag can be parsed", () => {
    expect(openingTagOf("plain text")).toBeNull();
    expect(openingTagOf(null)).toBeNull();
    expect(openingTagOf(undefined)).toBeNull();
  });

  it("truncates a long attribute value while preserving surrounding quotes", () => {
    const openTag =
      '<div class="a-really-long-class-name-that-goes-on-and-on-and-on">';
    const truncated = truncateOpeningTag(openTag, 10);
    expect(truncated.startsWith('<div class="')).toBe(true);
    expect(truncated.endsWith('…">')).toBe(true);
  });

  it("strips runtime and style attributes before measuring the inline tag", () => {
    expect(
      formatInspectCodeOpeningTag(
        '<button data-agent-native-node-id="cta" data-agent-native-layer-name="Primary CTA" style="padding: 12px" type="button">',
      ),
    ).toBe('<button type="button">');
  });

  it("wraps retained attributes onto indented lines when the clean tag is long", () => {
    expect(
      formatInspectCodeOpeningTag(
        '<button id="checkout-call-to-action" class="button button-primary" aria-label="Continue to checkout">',
      ),
    ).toBe(
      '<button\n  id="checkout-call-to-action"\n  class="button button-primary"\n  aria-label="Continue to checkout">',
    );
  });

  it("keeps short retained attributes inline", () => {
    expect(formatInspectCodeOpeningTag('<input disabled name="email">')).toBe(
      '<input disabled name="email">',
    );
  });

  it("builds a fallback opening tag from metadata when there is no HTML", () => {
    expect(
      elementHtmlPreview({
        html: null,
        tagName: "button",
        id: "cta",
        classes: ["btn", "btn-primary"],
      }),
    ).toBe('<button id="cta" class="btn btn-primary">\n  ...\n</button>');
  });

  it("returns null when there is neither HTML nor any fallback metadata", () => {
    expect(
      elementHtmlPreview({ html: null, tagName: null, id: null, classes: [] }),
    ).toBeNull();
  });

  it("renders a self-closing void tag without a closing-tag suffix", () => {
    expect(
      elementHtmlPreview({
        html: '<img src="a.png">',
        tagName: "img",
        id: null,
        classes: [],
      }),
    ).toBe('<img src="a.png">');
  });
});
