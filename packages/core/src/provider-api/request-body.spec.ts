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

  it("treats bracket and dotted indices as the same path and builds arrays", () => {
    expect(setBodyValueAtPath({}, "a[0].b", 1)).toEqual({ a: [{ b: 1 }] });
    expect(setBodyValueAtPath({}, "a.0.b", 1)).toEqual({ a: [{ b: 1 }] });
    expect(setBodyValueAtPath({ filter: {} }, "filter.ids[0]", "x")).toEqual({
      filter: { ids: ["x"] },
    });
  });

  it("keeps sibling array entries when writing one index", () => {
    const base = { a: [{ b: 1 }, { b: 2 }] };
    expect(setBodyValueAtPath(base, "a[1].b", 9)).toEqual({
      a: [{ b: 1 }, { b: 9 }],
    });
    expect(base).toEqual({ a: [{ b: 1 }, { b: 2 }] });
  });
});
