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

  it("keeps contact and local results in one keyboard-scrollable listbox", () => {
    const source = searchBarSource();

    expect(source).toContain('role="combobox"');
    expect(source).toContain(
      'showDropdown ? "mail-search-suggestions" : undefined',
    );
    expect(source).toContain('id="mail-search-suggestions"');
    expect(source).toContain("getActiveDescendantId(");
    expect(source).toContain('role="listbox"');
    expect(source).toContain("data-search-item");
    expect(source).toContain('querySelectorAll("[data-search-item]")');
    expect(source).not.toContain('querySelectorAll("[data-contact-item]")');
  });
});
