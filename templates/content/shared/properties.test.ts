import { describe, expect, it } from "vitest";

import {
  CREATABLE_DOCUMENT_PROPERTY_TYPES,
  DEFAULT_BLOCKS_FIELD_NAME,
  EDITABLE_DOCUMENT_PROPERTY_TYPES,
  blocksRenderMode,
  blocksStorageTarget,
  countWords,
  defaultPropertyOptions,
  documentPropertyDateIncludesTime,
  documentPropertyDateKey,
  evaluateNormalizationFormula,
  evaluateNumericExpression,
  evaluatePropertyFormula,
  formatWordCount,
  isBlocksPropertyType,
  isEmptyPropertyValue,
  isComputedPropertyType,
  isOnlyBlocksFieldDeletion,
  isPrimaryBlocksField,
  normalizePropertyValue,
  normalizePropertyVisibility,
  parsePropertyOptions,
  parsePropertyValue,
  resolveBlocksFieldValue,
  sanitizeNormalizationFormula,
  serializePropertyOptions,
  serializePropertyValue,
} from "./properties";

describe("document properties", () => {
  it("normalizes editable values by property type", () => {
    expect(normalizePropertyValue("text", "Draft")).toBe("Draft");
    expect(normalizePropertyValue("person", "Alice Moore")).toEqual([
      "Alice Moore",
    ]);
    expect(normalizePropertyValue("person", "Alice\nTaylor")).toEqual([
      "Alice",
      "Taylor",
    ]);
    expect(normalizePropertyValue("place", "Indianapolis, IN")).toBe(
      "Indianapolis, IN",
    );
    expect(
      normalizePropertyValue(
        "files_media",
        "https://example.com/brief.pdf\n image.png \n",
      ),
    ).toEqual(["https://example.com/brief.pdf", "image.png"]);
    expect(normalizePropertyValue("number", "42")).toBe(42);
    expect(normalizePropertyValue("number", "not a number")).toBeNull();
    expect(normalizePropertyValue("checkbox", 1)).toBe(true);
    expect(normalizePropertyValue("checkbox", "false")).toBe(false);
    expect(normalizePropertyValue("checkbox", "0")).toBe(false);
    expect(normalizePropertyValue("multi_select", ["a", 2, "b"])).toEqual([
      "a",
      "b",
    ]);
    expect(normalizePropertyValue("relation", ["doc-a", 2, "doc-b"])).toEqual([
      "doc-a",
      "doc-b",
    ]);
    expect(normalizePropertyValue("date", "")).toBeNull();
    expect(normalizePropertyValue("date", "2026-05-28")).toEqual({
      start: "2026-05-28",
      includeTime: false,
    });
    expect(
      normalizePropertyValue("date", {
        start: "2026-05-28T10:30",
        end: "2026-05-29T16:00",
        includeTime: true,
      }),
    ).toEqual({
      start: "2026-05-28T10:30",
      end: "2026-05-29T16:00",
      includeTime: true,
    });
    // Builder CMS date fields arrive as epoch-millis numbers.
    const epochResult = normalizePropertyValue(
      "date",
      Date.parse("2026-05-28T15:30:00.000Z"),
    );
    expect(epochResult).not.toBeNull();
    expect((epochResult as { start: string }).start).toContain("2026-05-28");
  });

  it("reads date keys and include-time state from legacy and range values", () => {
    expect(documentPropertyDateKey("2026-05-28T12:34:00.000Z")).toBe(
      "2026-05-28",
    );
    expect(
      documentPropertyDateKey({
        start: "2026-05-28T10:30",
        end: "2026-05-30T17:00",
        includeTime: true,
      }),
    ).toBe("2026-05-28");
    expect(
      documentPropertyDateKey(
        {
          start: "2026-05-28T10:30",
          end: "2026-05-30T17:00",
          includeTime: true,
        },
        "end",
      ),
    ).toBe("2026-05-30");
    expect(documentPropertyDateIncludesTime("2026-05-28")).toBe(false);
    expect(documentPropertyDateIncludesTime("2026-05-28T10:30")).toBe(true);
  });

  it("keeps computed property values read-only", () => {
    expect(isComputedPropertyType("formula")).toBe(true);
    expect(isComputedPropertyType("created_time")).toBe(true);
    expect(defaultPropertyOptions("formula")).toEqual({ formula: "" });
    expect(isComputedPropertyType("last_edited_by")).toBe(true);
    expect(normalizePropertyValue("formula", "ignored")).toBeNull();
    expect(normalizePropertyValue("created_time", "ignored")).toBeNull();
    expect(normalizePropertyValue("last_edited_by", "ignored")).toBeNull();
  });

  it("evaluates simple safe formula expressions", () => {
    expect(evaluateNumericExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateNumericExpression("(2 + 3) * 4")).toBe(20);
    expect(evaluateNumericExpression("2 + nope")).toBeNull();
    expect(
      evaluatePropertyFormula("{MSV} * 2", {
        MSV: 1000,
      }),
    ).toBe(2000);
    expect(
      evaluatePropertyFormula("Owner: {Owner}", {
        Owner: "Alice Moore",
      }),
    ).toBe("Owner: Alice Moore");
    expect(
      evaluatePropertyFormula('if({MSV} >= 1000, "High", "Low")', {
        MSV: 1000,
      }),
    ).toBe("High");
    expect(
      evaluatePropertyFormula('concat("SEO: ", {Keyword})', {
        Keyword: "generative ui",
      }),
    ).toBe("SEO: generative ui");
    expect(
      evaluatePropertyFormula("round({MSV} / 3)", {
        MSV: 1000,
      }),
    ).toBe(333);
    expect(
      evaluatePropertyFormula('contains({Keyword}, "ui")', {
        Keyword: "generative ui",
      }),
    ).toBe(true);
    expect(evaluatePropertyFormula("2 + nope", {})).toBe("2 + nope");
  });

  it("normalizes keys with the string ops used by source federation", () => {
    expect(evaluatePropertyFormula("lower({URL})", { URL: "/Blog/Foo" })).toBe(
      "/blog/foo",
    );
    expect(evaluatePropertyFormula("upper({k})", { k: "foo" })).toBe("FOO");
    expect(evaluatePropertyFormula("trim({k})", { k: "  foo  " })).toBe("foo");
    expect(
      evaluatePropertyFormula('replace({URL}, "/blog/", "")', {
        URL: "/blog/foo",
      }),
    ).toBe("foo");
    expect(evaluatePropertyFormula('replace({k}, "", "x")', { k: "ab" })).toBe(
      "ab",
    );
    expect(
      evaluatePropertyFormula("slug({title})", { title: "My First Post!" }),
    ).toBe("my-first-post");
    expect(
      evaluatePropertyFormula("striphost({URL})", {
        URL: "https://site.com/blog/foo",
      }),
    ).toBe("/blog/foo");
    expect(
      evaluatePropertyFormula("striphost({URL})", {
        URL: "https://site.com/blog/foo?utm=x#frag",
      }),
    ).toBe("/blog/foo");
    expect(
      evaluatePropertyFormula("striphost({URL})", { URL: "/blog/foo" }),
    ).toBe("/blog/foo");
    expect(
      evaluatePropertyFormula("striphost({URL})", {
        URL: "/blog/foo?utm=x#frag",
      }),
    ).toBe("/blog/foo");
    expect(
      evaluatePropertyFormula("striphost({URL})", {
        URL: "site.com/blog/foo/",
      }),
    ).toBe("/blog/foo");
    // The canonical case: host-qualified and relative URLs collapse to one key.
    expect(
      evaluatePropertyFormula('replace(striphost({URL}), "/blog/", "")', {
        URL: "https://site.com/blog/foo",
      }),
    ).toBe("foo");
    expect(
      evaluatePropertyFormula('regexextract({URL}, "/blog/([^/]+)", 1)', {
        URL: "/blog/foo/bar",
      }),
    ).toBe("foo");
    expect(
      evaluatePropertyFormula('regexreplace({k}, "[0-9]+", "#")', {
        k: "a12b3",
      }),
    ).toBe("a#b#");
  });

  it("evaluates normalization formulas strictly (null = un-joinable)", () => {
    expect(
      evaluateNormalizationFormula('replace(striphost({URL}), "/blog/", "")', {
        URL: "https://site.com/blog/foo",
      }),
    ).toBe("foo");
    expect(evaluateNormalizationFormula("lower({slug})", { slug: "FOO" })).toBe(
      "foo",
    );
    // Empty result collapses to null so empty keys never match each other.
    expect(evaluateNormalizationFormula("trim({k})", { k: "   " })).toBeNull();
    expect(evaluateNormalizationFormula("", { k: "x" })).toBeNull();
    // A broken regex pattern fails as a null key rather than a garbage literal.
    expect(
      evaluateNormalizationFormula('regexextract({k}, "(", 1)', { k: "foo" }),
    ).toBeNull();
    expect(
      sanitizeNormalizationFormula('regexextract({k}, "(a+)+$", 1)'),
    ).toBeNull();
    expect(
      evaluateNormalizationFormula('regexextract({k}, "(a+)+$", 1)', {
        k: "aaaaaaaaaaaaaaaa!",
      }),
    ).toBeNull();
  });

  it("round-trips options and values through JSON storage", () => {
    const options = defaultPropertyOptions("status");
    expect(parsePropertyOptions(serializePropertyOptions(options))).toEqual(
      options,
    );
    expect(
      parsePropertyOptions(serializePropertyOptions({ formula: "{MSV} * 2" })),
    ).toEqual({ formula: "{MSV} * 2" });
    expect(
      parsePropertyOptions(
        serializePropertyOptions({
          relation: { databaseId: "database" },
          rollup: {
            relationPropertyId: "relation",
            targetPropertyId: "number",
            aggregation: "sum",
          },
        }),
      ),
    ).toEqual({
      relation: { databaseId: "database" },
      rollup: {
        relationPropertyId: "relation",
        targetPropertyId: "number",
        aggregation: "sum",
      },
    });
    expect(parsePropertyValue(serializePropertyValue(["done"]))).toEqual([
      "done",
    ]);
  });

  it("normalizes property visibility settings", () => {
    expect(normalizePropertyVisibility("hide_when_empty")).toBe(
      "hide_when_empty",
    );
    expect(normalizePropertyVisibility("unexpected")).toBe("always_show");
  });

  it("detects empty property values for visibility", () => {
    expect(isEmptyPropertyValue(null)).toBe(true);
    expect(isEmptyPropertyValue("")).toBe(true);
    expect(isEmptyPropertyValue([])).toBe(true);
    expect(isEmptyPropertyValue({ start: "", includeTime: false })).toBe(true);
    expect(isEmptyPropertyValue(false)).toBe(false);
    expect(isEmptyPropertyValue(0)).toBe(false);
  });
});

describe("Blocks property type", () => {
  it("is a creatable, editable, non-computed property type", () => {
    expect(isBlocksPropertyType("blocks")).toBe(true);
    expect(isBlocksPropertyType("text")).toBe(false);
    expect(EDITABLE_DOCUMENT_PROPERTY_TYPES).toContain("blocks");
    expect(CREATABLE_DOCUMENT_PROPERTY_TYPES).toContain("blocks");
    expect(isComputedPropertyType("blocks")).toBe(false);
  });

  it("normalizes a Blocks value to its markdown string", () => {
    expect(normalizePropertyValue("blocks", "# Heading\n\nBody")).toBe(
      "# Heading\n\nBody",
    );
    expect(normalizePropertyValue("blocks", "")).toBeNull();
  });

  it("defaults a manually-added Blocks field to non-primary", () => {
    const options = defaultPropertyOptions("blocks");
    expect(options).toEqual({ blocks: { primary: false } });
    expect(isPrimaryBlocksField(options)).toBe(false);
  });

  it("round-trips the primary flag through JSON storage", () => {
    const primary = parsePropertyOptions(
      serializePropertyOptions({ blocks: { primary: true } }),
    );
    expect(primary).toEqual({ blocks: { primary: true } });
    expect(isPrimaryBlocksField(primary)).toBe(true);

    const additional = parsePropertyOptions(
      serializePropertyOptions({ blocks: { primary: false } }),
    );
    expect(isPrimaryBlocksField(additional)).toBe(false);
    // A Blocks field with no options is treated as non-primary.
    expect(isPrimaryBlocksField({})).toBe(false);
  });

  it("counts words from markdown, ignoring syntax", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(null)).toBe(0);
    expect(countWords("one two three")).toBe(3);
    expect(countWords("# Heading with five words here")).toBe(5);
    // List markers and emphasis punctuation are stripped; the bracketed link
    // text and its URL each remain as tokens (a, b, c, bold, italic, link, url).
    expect(
      countWords("- a\n- b\n- c\n\n**bold** _italic_ [link](https://x.com)"),
    ).toBe(7);
    expect(countWords("```\ncode block ignored\n```\nreal words here")).toBe(3);
  });

  it("formats a word count for table cells", () => {
    expect(formatWordCount("")).toBe("Empty");
    expect(formatWordCount("just one word here")).toBe("4 words");
    expect(formatWordCount("solo")).toBe("1 word");
    expect(formatWordCount("a ".repeat(412))).toBe("412 words");
  });

  it("renders solo vs multi by Blocks field count", () => {
    expect(blocksRenderMode(0)).toBe("solo");
    expect(blocksRenderMode(1)).toBe("solo");
    expect(blocksRenderMode(2)).toBe("multi");
    expect(blocksRenderMode(5)).toBe("multi");
  });

  it("warns only when deleting the last Blocks field", () => {
    expect(
      isOnlyBlocksFieldDeletion({ type: "blocks", blocksFieldCount: 1 }),
    ).toBe(true);
    expect(
      isOnlyBlocksFieldDeletion({ type: "blocks", blocksFieldCount: 2 }),
    ).toBe(false);
    // Deleting a non-Blocks property never triggers the body warning.
    expect(
      isOnlyBlocksFieldDeletion({ type: "text", blocksFieldCount: 1 }),
    ).toBe(false);
  });

  it("routes the primary field to the document body and others to their own store", () => {
    expect(blocksStorageTarget({ blocks: { primary: true } })).toBe(
      "document_body",
    );
    expect(blocksStorageTarget({ blocks: { primary: false } })).toBe(
      "block_field_store",
    );
    expect(blocksStorageTarget({})).toBe("block_field_store");
  });

  it("resolves each Blocks field to its OWN independent content", () => {
    const documentBody = "PRIMARY body content";
    const blockFieldContent = "ADDITIONAL field content";

    // Primary reads from the body, never from the additional store.
    expect(
      resolveBlocksFieldValue({
        options: { blocks: { primary: true } },
        documentBody,
        blockFieldContent,
      }),
    ).toBe(documentBody);

    // An additional field reads from its own store, never from the body.
    expect(
      resolveBlocksFieldValue({
        options: { blocks: { primary: false } },
        documentBody,
        blockFieldContent,
      }),
    ).toBe(blockFieldContent);

    // A brand-new additional field (no stored content yet) is empty — NOT the
    // body. This is the core "second Blocks field is empty & independent" rule.
    expect(
      resolveBlocksFieldValue({
        options: { blocks: { primary: false } },
        documentBody,
        blockFieldContent: undefined,
      }),
    ).toBe("");

    // Editing the additional field does not change what the primary resolves to.
    const editedBlockFieldContent = "edited additional content";
    expect(
      resolveBlocksFieldValue({
        options: { blocks: { primary: true } },
        documentBody,
        blockFieldContent: editedBlockFieldContent,
      }),
    ).toBe(documentBody);
  });

  it("uses 'Content' as the default seeded Blocks field name", () => {
    expect(DEFAULT_BLOCKS_FIELD_NAME).toBe("Content");
  });
});
