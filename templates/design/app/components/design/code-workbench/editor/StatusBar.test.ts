import { describe, expect, it } from "vitest";

import { languageDisplayName } from "./status-bar-lang";

describe("languageDisplayName", () => {
  it("maps known language ids to display names", () => {
    expect(languageDisplayName("typescript")).toBe("TypeScript");
    expect(languageDisplayName("javascript")).toBe("JavaScript");
    expect(languageDisplayName("html")).toBe("HTML");
    expect(languageDisplayName("css")).toBe("CSS");
    expect(languageDisplayName("json")).toBe("JSON");
  });

  it("falls back to plain text for undefined", () => {
    expect(languageDisplayName(undefined)).toBe("Plain Text");
  });

  it("passes through unknown language ids verbatim", () => {
    expect(languageDisplayName("rust")).toBe("rust");
  });
});
