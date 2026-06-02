import { describe, expect, it } from "vitest";
import {
  defaultPropertyOptions,
  documentPropertyDateIncludesTime,
  documentPropertyDateKey,
  evaluateNumericExpression,
  evaluatePropertyFormula,
  isEmptyPropertyValue,
  isComputedPropertyType,
  normalizePropertyValue,
  normalizePropertyVisibility,
  parsePropertyOptions,
  parsePropertyValue,
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
