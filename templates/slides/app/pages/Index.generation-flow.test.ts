import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "Index.tsx"),
  "utf8",
);
const flow = source.slice(
  source.indexOf("const handleCreateDeckWithPrompt"),
  source.indexOf("const handleConfirmDelete"),
);

describe("new deck generation flow", () => {
  it("persists and opens the empty editor before the agent asks dynamic questions", () => {
    const persistIndex = flow.indexOf("await ensureDeckPersisted(deck.id)");
    const openEditorIndex = flow.indexOf("navigate(`/deck/${deck.id}`");
    const askQuestionIndex = flow.indexOf("use the `ask-question` tool");

    expect(persistIndex).toBeGreaterThan(-1);
    expect(openEditorIndex).toBeGreaterThan(persistIndex);
    expect(askQuestionIndex).toBeGreaterThan(openEditorIndex);
    expect(flow).not.toContain("await askUserQuestion");
    expect(flow).toContain("prompt-specific question");
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
    const titleInstructionIndex = flow.indexOf(
      "After reading any requested or imported source material, but before adding the first slide",
    );
    const titlePatchIndex = flow.indexOf('"op": "patch-deck-fields"');
    const addSlideInstructionIndex = flow.indexOf(
      "Add slides ONE AT A TIME using the `add-slide` action",
    );
    const sparseTitleInstructionIndex = flow.indexOf(
      "Include only `title` in `fields`; omit all other optional fields.",
    );

    expect(titleInstructionIndex).toBeGreaterThan(-1);
    expect(titlePatchIndex).toBeGreaterThan(titleInstructionIndex);
    expect(sparseTitleInstructionIndex).toBeGreaterThan(titlePatchIndex);
    expect(addSlideInstructionIndex).toBeGreaterThan(titlePatchIndex);
  });

  it("keeps presentation generation multi-slide and persisted", () => {
    expect(flow).toContain(
      "infer a coherent multi-slide outline from the scope",
    );
    expect(flow).toContain("Do not call the legacy generate-slides-ai action");
    expect(flow).toContain(
      "Treat each successful add-slide result as confirmation",
    );
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
