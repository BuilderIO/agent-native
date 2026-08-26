import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildSourceDeckContext,
  buildSourceModeInstructions,
} from "../lib/deck-generation-instructions";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "Index.tsx"),
  "utf8",
);
const flow = source.slice(
  source.indexOf("const handleCreateDeckWithPrompt"),
  source.indexOf("const handlePromptSubmit"),
);

// The generation instruction lists are shared with the first-deck onboarding
// flow, so assert them against the one builder both callers use rather than
// against this file's inline source.
const newDeckInstructions = buildSourceModeInstructions({
  deckId: "deck-1",
  hasImportedSourceDeck: false,
});
const sourceDeckContext = buildSourceDeckContext(4);

describe("new deck generation flow", () => {
  it("opens the generating editor before persistence and dynamic questions", () => {
    const persistIndex = flow.indexOf("await ensureDeckPersisted(deck.id)");
    const openEditorIndex = flow.indexOf(
      "navigate(`/deck/${deck.id}?generating=1`",
    );
    const askQuestionIndex = flow.indexOf("use the `ask-question` tool");

    expect(persistIndex).toBeGreaterThan(-1);
    expect(openEditorIndex).toBeGreaterThan(-1);
    expect(openEditorIndex).toBeLessThan(persistIndex);
    expect(askQuestionIndex).toBeGreaterThan(openEditorIndex);
    expect(flow).not.toContain("await askUserQuestion");
    expect(flow).toContain("prompt-specific question");
    expect(flow).toContain("recoverFromGenerationSetupFailure");
  });

  it("shows the destination-shaped loading surface before navigation", () => {
    const loadingIndex = flow.indexOf("setIsStartingNewDeck(true)");
    const navigateIndex = flow.indexOf(
      "navigate(`/deck/${deck.id}?generating=1`",
    );

    expect(loadingIndex).toBeGreaterThan(-1);
    expect(loadingIndex).toBeLessThan(navigateIndex);
    expect(source).toContain('data-testid="new-deck-loading"');
  });

  it("marks generation intent before submitting the agent run", () => {
    const generatingRouteIndex = flow.indexOf(
      "navigate(`/deck/${deck.id}?generating=1`",
    );
    const submitIndex = flow.indexOf(
      "agentSubmit(createDeckAgentMessage(trimmedPrompt)",
    );

    expect(generatingRouteIndex).toBeGreaterThan(-1);
    expect(submitIndex).toBeGreaterThan(generatingRouteIndex);
  });

  it("requires a generated title before the first slide", () => {
    const titleInstructionIndex = newDeckInstructions.indexOf(
      "After reading any requested or attached reference material, but before adding the first slide",
    );
    const titlePatchIndex = newDeckInstructions.indexOf(
      '"op": "patch-deck-fields"',
    );
    const addSlideInstructionIndex = newDeckInstructions.indexOf(
      "Add slides ONE AT A TIME using the `add-slide` action",
    );
    const sparseTitleInstructionIndex = newDeckInstructions.indexOf(
      "Include only `title` in `fields`; omit all other optional fields.",
    );

    expect(titleInstructionIndex).toBeGreaterThan(-1);
    expect(titlePatchIndex).toBeGreaterThan(titleInstructionIndex);
    expect(sparseTitleInstructionIndex).toBeGreaterThan(titlePatchIndex);
    expect(addSlideInstructionIndex).toBeGreaterThan(titlePatchIndex);
    expect(newDeckInstructions).toContain(
      "Never use the deck id, run id, file id, uploaded filename, or another opaque alphanumeric token as the title",
    );
  });

  it("keeps presentation generation multi-slide and persisted", () => {
    expect(newDeckInstructions).toContain(
      "infer a coherent multi-slide outline from the scope",
    );
    expect(newDeckInstructions).toContain(
      "Do not call the legacy generate-slides-ai action",
    );
    expect(newDeckInstructions).toContain(
      "Treat each successful add-slide result as confirmation",
    );
  });

  it("keeps unreferenced decks content-first instead of inventing text-covering boxes", () => {
    expect(flow).toContain(
      "When no reference deck or hydrated design system is available",
    );
    expect(flow).toContain(
      "Do not invent colorful cards, boxes, or decorative rectangles behind or over text",
    );
    expect(flow).toContain(
      "leaves the text unobscured. Prefer typography, spacing, alignment, and one restrained accent.",
    );
  });

  it("keeps ordinary attachments as reference material for a new deck", () => {
    expect(newDeckInstructions).toContain(
      "attached reference files must not seed it with imported slides",
    );
    expect(source).toContain(
      "Attachments are context for the agent by default",
    );
    expect(flow).toContain("isSourceImprovementRequest");
    expect(flow).toContain("importUploadedDeckIntoDeck");
    expect(sourceDeckContext).toContain("Source-preserving improvement mode");
  });

  it("routes both prompt submit and prompt skip into the reference step", () => {
    expect(source).toContain("const handlePromptSubmit");
    expect(source).toContain("const handlePromptSkip");
    expect(source).toContain('setPendingDeck({ prompt: "", files: [] })');
    expect(source).toContain("onSubmit={handlePromptSubmit}");
    expect(source).toContain("onSkip={handlePromptSkip}");
    expect(source).toContain("setShowNewDeckReferenceStep(true)");
  });

  it("imports directly from the new-deck prompt and opens the imported deck", () => {
    const directImportFlow = source.slice(
      source.indexOf("const handleDirectImport"),
      source.indexOf("const handleReferenceSelect"),
    );

    expect(directImportFlow).toContain(
      'callAction("import-google-slides-reference"',
    );
    expect(directImportFlow).toContain('callAction("import-pptx"');
    expect(directImportFlow).toContain('callAction("import-file"');
    expect(directImportFlow).toContain("navigate(`/deck/${imported.id}`");
    expect(source).toContain("onImport={handleDirectImport}");
    expect(source).toContain('importFromLabel={t("home.importFrom")}');
  });

  it("turns an imported PPTX into a reusable reference deck", () => {
    const referenceImportFlow = source.slice(
      source.indexOf("const handleReferenceImport"),
      source.indexOf("const handleReferenceSkip"),
    );

    // Whitespace-tolerant: passing the extended import timeout wraps the call
    // across lines, and this asserts the call exists, not how it is formatted.
    expect(referenceImportFlow).toMatch(/callAction\(\s*"import-pptx"/);
    expect(referenceImportFlow).toContain("importedReference = {");
    expect(referenceImportFlow).toContain('source: "pptx"');
    expect(referenceImportFlow).toContain("setPendingDeck((current) =>");
    expect(referenceImportFlow).toContain("return importedReference");
    expect(referenceImportFlow).not.toContain("handleCreateDeckWithPrompt(");
  });

  it("imports an uploaded PDF into a reusable reference deck", () => {
    const referenceImportFlow = source.slice(
      source.indexOf("const handleReferenceImport"),
      source.indexOf("const handleReferenceSkip"),
    );

    expect(referenceImportFlow).toMatch(/callAction\(\s*"import-file"/);
    expect(referenceImportFlow).toContain('format: "pdf"');
    expect(referenceImportFlow).toContain("importIntoDeck: true");
    expect(referenceImportFlow).toContain("setSelectedReferenceDeckId");
    expect(referenceImportFlow).toContain(
      "generationFiles = uploaded.filter((file) => file !== pdfReference)",
    );
    expect(referenceImportFlow).not.toContain("handleCreateDeckWithPrompt(");
    expect(referenceImportFlow).toContain(
      "The PDF reference deck could not be imported.",
    );
  });

  it("imports a pasted Google Slides URL before selecting the reference deck", () => {
    const referenceSourceImportFlow = source.slice(
      source.indexOf("const handleReferenceSourceImport"),
      source.indexOf("const handleReferenceSkip"),
    );

    expect(referenceSourceImportFlow).toContain(
      'callAction("import-google-slides-reference"',
    );
    expect(referenceSourceImportFlow).toContain("return importedReference");
    expect(source).toContain("onImportSource={handleReferenceSourceImport}");
  });
});
