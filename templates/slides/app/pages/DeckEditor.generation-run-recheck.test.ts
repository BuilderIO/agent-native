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
    const effectStart = deckEditorSource.indexOf(
      'const submitMessageId = searchParams.get("generationSubmitId");',
    );
    expect(effectStart).toBeGreaterThanOrEqual(0);
    const effectBody = deckEditorSource.slice(
      effectStart,
      deckEditorSource.indexOf("}, [", effectStart),
    );

    expect(effectBody).toContain("refetchPendingQuestion()");
    const clearIndex = effectBody.indexOf("clearNewDeckGenerationRun(id");
    const thenIndex = effectBody.indexOf(".then((stillWaiting)");
    expect(thenIndex).toBeGreaterThanOrEqual(0);
    expect(clearIndex).toBeGreaterThan(thenIndex);
  });
});
