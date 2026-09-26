import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "Index.tsx"),
  "utf8",
);

describe("Slides empty deck list", () => {
  it("hides search and filtering only when the settled deck list is empty", () => {
    const header = source.slice(
      source.indexOf("useSetHeaderActions("),
      source.indexOf(
        "if (isStartingNewDeck)",
        source.indexOf("useSetHeaderActions("),
      ),
    );

    expect(header).toMatch(
      /viewState !== "empty" \? \([\s\S]*?<DeckSearchInput[\s\S]*?<DeckFilterMenu[\s\S]*?: null/,
    );
    expect(header).not.toContain('{t("home.newDeck")}');
    expect(source).toContain('presentation="inline"');
    expect(source).toContain("deckListViewState({");
  });
});
