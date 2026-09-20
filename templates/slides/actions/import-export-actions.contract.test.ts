import { describe, expect, it } from "vitest";

import exportGoogleSlides from "./export-google-slides.js";
import exportPptx from "./export-pptx.js";
import importFile from "./import-file.js";
import importGoogleSlidesReference from "./import-google-slides-reference.js";

const ACTION_CONTRACTS = [
  {
    name: "import-file",
    action: importFile,
    input: { filePath: "uploads/deck.pptx", format: "pptx" },
  },
  {
    name: "import-google-slides-reference",
    action: importGoogleSlidesReference,
    input: {
      presentationUrl: "https://docs.google.com/presentation/d/deck-1/edit",
    },
  },
  {
    name: "export-pptx",
    action: exportPptx,
    input: { deckId: "deck-1" },
  },
  {
    name: "export-google-slides",
    action: exportGoogleSlides,
    input: { deckId: "deck-1" },
  },
] as const;

describe("Slides import/export action contracts", () => {
  it.each(ACTION_CONTRACTS)(
    "$name remains exposed with a valid representative input",
    ({ action, input }) => {
      expect(action.schema.safeParse(input).success).toBe(true);
      expect(action.readOnly).not.toBe(true);
      expect(action.run).toEqual(expect.any(Function));
    },
  );
});
