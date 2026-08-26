import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildSourceDeckContext,
  buildSourceModeInstructions,
} from "./deck-generation-instructions";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every surface that starts a deck-generation run. A rule added to one of these
 * used to miss the others, which is why generated decks kept coming back with
 * empty speaker notes after the rule was added to only one of them.
 */
const generationEntryPoints = [
  "pages/Index.tsx",
  "lib/create-deck-generation.ts",
];

const newDeckInstructions = buildSourceModeInstructions({
  deckId: "deck-1",
  hasImportedSourceDeck: false,
});

describe("deck generation instructions", () => {
  it("asks the agent to write requested speaker notes into the notes field", () => {
    expect(newDeckInstructions).toContain("speaker notes");
    expect(newDeckInstructions).toContain("`notes` field");
    expect(newDeckInstructions).toContain("keep it out of the slide HTML");
    expect(newDeckInstructions).toContain(
      "An empty `notes` field is not an acceptable result",
    );
  });

  it("keeps every generation entry point on the shared instruction builder", () => {
    for (const entryPoint of generationEntryPoints) {
      const source = readFileSync(path.join(appDir, entryPoint), "utf8");
      expect(source, entryPoint).toContain("buildSourceModeInstructions(");
      expect(source, entryPoint).toContain("buildSourceDeckContext(");
      // An inlined copy of either list is how the two paths drifted apart.
      expect(source, entryPoint).not.toContain("Add slides ONE AT A TIME");
      expect(source, entryPoint).not.toContain(
        "Source-preserving improvement mode:",
      );
    }
  });

  it("carries the new-deck rules only when there is no imported source deck", () => {
    const sourceMode = buildSourceModeInstructions({
      deckId: "deck-1",
      hasImportedSourceDeck: true,
    });

    expect(sourceMode).toContain("in-place visual improvement");
    expect(sourceMode).not.toContain("Add slides ONE AT A TIME");
    expect(newDeckInstructions).toContain("Add slides ONE AT A TIME");
  });

  it("preserves existing notes when restyling an imported source deck", () => {
    const context = buildSourceDeckContext(7);

    expect(context).toContain("7 imported source slides");
    expect(context).toContain(
      "Keep the exact source slide count, order, IDs, factual meaning, notes",
    );
    expect(buildSourceDeckContext(null)).toBe("");
  });
});
