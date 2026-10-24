import { describe, expect, it } from "vitest";

import { setBodyValueAtPath } from "./request-body.js";

describe("setBodyValueAtPath", () => {
  it("sets a nested value on an object body without mutating it", () => {
    const base = { filter: { team: "sales" }, limit: 5 };
    expect(setBodyValueAtPath(base, "filter.cursor", "c2")).toEqual({
      filter: { team: "sales", cursor: "c2" },
      limit: 5,
    });
    expect(base).toEqual({ filter: { team: "sales" }, limit: 5 });
  });

  it("keeps a JSON-string body's fields and returns a string", () => {
    const result = setBodyValueAtPath(
      JSON.stringify({ filter: { team: "sales" } }),
      "cursor",
      "c2",
    );
    expect(typeof result).toBe("string");
    expect(JSON.parse(result as string)).toEqual({
      filter: { team: "sales" },
      cursor: "c2",
    });
  });

  it("treats blank and missing bodies as empty", () => {
    expect(setBodyValueAtPath(undefined, "a.b", 1)).toEqual({ a: { b: 1 } });
    expect(setBodyValueAtPath(null, "a", 1)).toEqual({ a: 1 });
    expect(JSON.parse(setBodyValueAtPath("  ", "a", 1) as string)).toEqual({
      a: 1,
    });
  });

  it("throws on malformed JSON and on non-object bodies", () => {
    expect(() => setBodyValueAtPath("{not json", "a", 1)).toThrow(
      "JSON object request body",
    );
    expect(() => setBodyValueAtPath("[1]", "a", 1)).toThrow(
      "JSON object request body",
    );
    expect(() => setBodyValueAtPath([1], "a", 1)).toThrow(
      "JSON object request body",
    );
  });
});
