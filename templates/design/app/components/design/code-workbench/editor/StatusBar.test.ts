import { describe, expect, it } from "vitest";

import { languageDisplayName } from "./status-bar-lang";

// StatusBar.tsx (and `countProblemsForOpenTabs`) transitively import
// `monaco-editor`/model-registry, which require a `window` global and can't
// load under vitest's node environment (see monaco-theme.test.ts for the
// same split elsewhere). The monaco-free display-name mapping lives in
// status-bar-lang.ts specifically so it stays unit-testable in isolation.

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
