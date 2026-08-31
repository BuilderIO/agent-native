import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function searchBarSource(): string {
  return readFileSync(new URL("./SearchBar.tsx", import.meta.url), "utf8");
}

describe("SearchBar saved-filter flow", () => {
  it("uses the shared dialog instead of a blocking browser prompt", () => {
    const source = searchBarSource();

    expect(source).toContain("<Dialog");
    expect(source).toContain("submitSavedSearch");
    expect(source).toContain("setSaveError");
    expect(source).toContain("await onSaveSearch");
    expect(source).not.toContain("window.prompt");
  });
});
