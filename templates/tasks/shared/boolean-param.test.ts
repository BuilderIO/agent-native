import { describe, expect, it } from "vitest";
import {
  coerceBooleanParam,
  parseIncludeDoneParam,
} from "./boolean-param.js";

describe("coerceBooleanParam", () => {
  it("returns undefined when absent", () => {
    expect(coerceBooleanParam(null)).toBeUndefined();
    expect(coerceBooleanParam(undefined)).toBeUndefined();
    expect(coerceBooleanParam("")).toBeUndefined();
  });

  it("coerces common true/false forms", () => {
    expect(coerceBooleanParam(true)).toBe(true);
    expect(coerceBooleanParam(false)).toBe(false);
    expect(coerceBooleanParam("true")).toBe(true);
    expect(coerceBooleanParam("false")).toBe(false);
    expect(coerceBooleanParam("1")).toBe(true);
    expect(coerceBooleanParam("0")).toBe(false);
  });
});

describe("parseIncludeDoneParam", () => {
  it("defaults to false when absent or falsey", () => {
    expect(parseIncludeDoneParam(null)).toBe(false);
    expect(parseIncludeDoneParam(undefined)).toBe(false);
    expect(parseIncludeDoneParam("false")).toBe(false);
    expect(parseIncludeDoneParam("0")).toBe(false);
  });

  it("returns true for enabled forms", () => {
    expect(parseIncludeDoneParam("true")).toBe(true);
    expect(parseIncludeDoneParam("1")).toBe(true);
  });
});
