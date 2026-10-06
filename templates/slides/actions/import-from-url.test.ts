import { describe, expect, it } from "vitest";

import action from "./import-from-url.js";

describe("import-from-url action schema", () => {
  it("accepts HTTP and HTTPS website URLs", () => {
    expect(
      action.schema.safeParse({ url: "https://example.com" }).success,
    ).toBe(true);
    expect(action.schema.safeParse({ url: "http://example.com" }).success).toBe(
      true,
    );
  });

  it("rejects malformed and non-web URLs before import runs", () => {
    expect(action.schema.safeParse({ url: "example.com" }).success).toBe(false);
    expect(
      action.schema.safeParse({ url: "mailto:user@example.com" }).success,
    ).toBe(false);
  });
});
