import { describe, expect, it } from "vitest";

import {
  decodeNativeShaderLibraryCursor,
  encodeNativeShaderLibraryCursor,
  NativeShaderLibraryCursorError,
} from "./native-shader-library.js";

const cursor = {
  view: "favorites" as const,
  search: "grain",
  category: "generator" as const,
  sortAt: "2026-10-07T12:30:00.000Z",
  id: "library_1",
};

describe("Shader Library cursor", () => {
  it("round-trips a stable tie-breaker in the same view and filter", () => {
    const encoded = encodeNativeShaderLibraryCursor(cursor);
    expect(decodeNativeShaderLibraryCursor(encoded, cursor)).toEqual(cursor);
  });

  it("rejects a cursor from another view, search, or category", () => {
    const encoded = encodeNativeShaderLibraryCursor(cursor);
    for (const filter of [
      { ...cursor, view: "recent" as const },
      { ...cursor, search: "glass" },
      { ...cursor, category: "processor" as const },
    ]) {
      expect(() => decodeNativeShaderLibraryCursor(encoded, filter)).toThrow(
        NativeShaderLibraryCursorError,
      );
    }
  });

  it("fails malformed, oversized, and control-field payloads loudly", () => {
    for (const encoded of [
      "{broken",
      "x".repeat(513),
      JSON.stringify({ ...cursor, id: "../../other" }),
      JSON.stringify({ ...cursor, hidden: "unexpected" }),
    ]) {
      expect(() => decodeNativeShaderLibraryCursor(encoded, cursor)).toThrow(
        NativeShaderLibraryCursorError,
      );
    }
  });
});
