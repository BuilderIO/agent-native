import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "Index.tsx"),
  "utf8",
);

describe("Slides home header", () => {
  it("places deck search with the home tabs and keeps import in the header", () => {
    const headerStart = source.indexOf("const homeHeaderActions = useMemo(");
    const header = source.slice(
      headerStart,
      source.indexOf("</HomeHeaderActions>", headerStart),
    );
    const libraryStart = source.indexOf("<SlidesHomeLibrary");
    const library = source.slice(
      libraryStart,
      source.indexOf("</SlidesHomeLibrary>", libraryStart),
    );

    expect(header).toContain("<ImportDeckButton");
    expect(header).not.toContain("<DeckSearchInput");
    expect(header).not.toContain("<DeckFilterMenu");
    expect(library).toContain("search={");
    expect(library).toContain("<DeckSearchInput");
    expect(header).not.toContain("newDeck");
    expect(header).not.toContain('{t("home.newDeck")}');
    expect(source).toContain('data-home-search="true"');
    expect(source).not.toContain("slides-home-mobile-search");
    expect(source).not.toContain("searchShortcutLabel");
    expect(source).not.toContain("<kbd");
    expect(source).toContain("slides-home-mobile-toolbar");
    expect(source).toContain('presentation="inline"');
    expect(source).toContain("deckListViewState({");
  });
});
