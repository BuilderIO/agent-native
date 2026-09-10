import { describe, expect, it } from "vitest";

import action from "./list-draft-assets.js";

describe("list-draft-assets schema", () => {
  it("defaults to no filters when given an empty object", () => {
    const parsed = action.schema.parse({});
    expect(parsed.libraryId).toBeUndefined();
    expect(parsed.limit).toBeUndefined();
  });

  it("coerces a numeric string limit", () => {
    const parsed = action.schema.parse({ limit: "5" });
    expect(parsed.limit).toBe(5);
  });

  it("rejects an out-of-range limit", () => {
    expect(() => action.schema.parse({ limit: 0 })).toThrow();
    expect(() => action.schema.parse({ limit: 999 })).toThrow();
  });
});
