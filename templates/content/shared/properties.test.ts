import { describe, expect, it } from "vitest";
import {
  defaultPropertyOptions,
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
    expect(isComputedPropertyType("created_time")).toBe(true);
    expect(normalizePropertyValue("created_time", "ignored")).toBeNull();
  });

  it("round-trips options and values through JSON storage", () => {
    const options = defaultPropertyOptions("status");
    expect(parsePropertyOptions(serializePropertyOptions(options))).toEqual(
      options,
    );
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
