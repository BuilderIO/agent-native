import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  booleanQueryParam,
  optionalBooleanQueryParam,
} from "./boolean-query-param.js";

describe("booleanQueryParam", () => {
  const schema = z.object({ includeDone: booleanQueryParam(false) });

  it("defaults to false when omitted", () => {
    expect(schema.parse({}).includeDone).toBe(false);
  });

  it("accepts booleans and common string forms", () => {
    expect(schema.parse({ includeDone: true }).includeDone).toBe(true);
    expect(schema.parse({ includeDone: false }).includeDone).toBe(false);
    expect(schema.parse({ includeDone: "true" }).includeDone).toBe(true);
    expect(schema.parse({ includeDone: "false" }).includeDone).toBe(false);
    expect(schema.parse({ includeDone: "1" }).includeDone).toBe(true);
    expect(schema.parse({ includeDone: "0" }).includeDone).toBe(false);
  });
});

describe("optionalBooleanQueryParam", () => {
  const schema = optionalBooleanQueryParam();

  it("stays undefined when omitted", () => {
    expect(schema.parse(undefined)).toBeUndefined();
  });

  it("coerces provided values", () => {
    expect(schema.parse("true")).toBe(true);
    expect(schema.parse("false")).toBe(false);
  });
});
