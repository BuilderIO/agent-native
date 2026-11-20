import { describe, expect, it } from "vitest";

import { parseFilter } from "./submission-format";

describe("parseFilter", () => {
  it("accepts the three filters and falls back to all", () => {
    expect(parseFilter("partial")).toBe("partial");
    expect(parseFilter("completed")).toBe("completed");
    expect(parseFilter("bogus")).toBe("all");
    expect(parseFilter(null)).toBe("all");
  });
});
