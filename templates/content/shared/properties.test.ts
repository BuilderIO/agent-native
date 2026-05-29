import { describe, expect, it } from "vitest";
import {
  defaultPropertyOptions,
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
    expect(normalizePropertyValue("person", "Alice Moore")).toBe("Alice Moore");
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
    expect(normalizePropertyValue("date", "")).toBeNull();
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
  });

  it("round-trips options and values through JSON storage", () => {
    const options = defaultPropertyOptions("status");
    expect(parsePropertyOptions(serializePropertyOptions(options))).toEqual(
      options,
    );
    expect(
      parsePropertyOptions(serializePropertyOptions({ formula: "{MSV} * 2" })),
    ).toEqual({ formula: "{MSV} * 2" });
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
    expect(isEmptyPropertyValue(false)).toBe(false);
    expect(isEmptyPropertyValue(0)).toBe(false);
  });
});
