import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "Index.tsx"),
  "utf8",
);

describe("Slides home header", () => {
  it("keeps search and import available without create or filter controls", () => {
    const header = source.slice(
      source.indexOf("useSetHeaderActions("),
      source.indexOf(
        "if (isStartingNewDeck)",
        source.indexOf("useSetHeaderActions("),
      ),
    );

    expect(header).toContain("<DeckSearchInput");
    expect(header).toContain("<ImportDeckButton");
    expect(header).not.toContain("<DeckFilterMenu");
    expect(header).not.toContain("newDeck");
    expect(header).not.toContain('{t("home.newDeck")}');
    expect(source).toContain('shortcutLabel("cmd+k")');
    expect(source).toContain("slides-home-mobile-toolbar");
    expect(source).toContain('presentation="inline"');
    expect(source).toContain("deckListViewState({");
  });
});
