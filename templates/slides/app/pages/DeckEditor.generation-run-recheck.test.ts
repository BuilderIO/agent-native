import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const deckEditorSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "DeckEditor.tsx"),
  "utf8",
);

describe("DeckEditor new-deck generation run cleanup", () => {
  it("forces a fresh guided-question check before dropping run correlation", () => {
    expect(deckEditorSource).toContain(
      "routeGenerationSubmitId ?? restoredGenerationSubmitId",
    );
    const clearCall = "clearNewDeckGenerationRun(id, generationSubmitId);";
    const clearIndex = deckEditorSource.indexOf(clearCall);
    expect(clearIndex).toBeGreaterThanOrEqual(0);
    const effectStart = deckEditorSource.lastIndexOf(
      "  useEffect(() => {",
      clearIndex,
    );
    expect(effectStart).toBeGreaterThanOrEqual(0);
    const effectBody = deckEditorSource.slice(
      effectStart,
      deckEditorSource.indexOf("  }, [", clearIndex),
    );

    expect(effectBody).toContain("!generationSubmitId");
    expect(effectBody).toContain("refetchPendingQuestion()");
    const thenIndex = effectBody.indexOf(".then((stillWaiting)");
    expect(thenIndex).toBeGreaterThanOrEqual(0);
    expect(effectBody.indexOf(clearCall)).toBeGreaterThan(thenIndex);
  });
});
