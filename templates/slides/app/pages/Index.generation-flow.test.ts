import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "Index.tsx"),
  "utf8",
);
const generationLibSource = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../lib/create-deck-generation.ts",
  ),
  "utf8",
);
const flow = source.slice(
  source.indexOf("const handleCreateDeckWithPrompt"),
  source.indexOf("const handlePromptSubmit"),
);

describe("new deck generation flow", () => {
  it("keeps the home prompt inline and lazy loaded", () => {
    expect(source).toContain(
      'const loadPromptPopover = () => import("@/components/editor/PromptDialog")',
    );
    expect(source).toContain(
      "const LazyPromptPopover = lazy(loadPromptPopover)",
    );
    expect(source).toContain(
      "(showNewDeckPrompt || hasOpenedNewDeckPrompt) &&",
    );
    expect(source).toContain("setNewDeckPromptOpen");
    expect(source).toContain(".then(clearInitialPromptFromUrl)");
    expect(source).toContain("inline");
    expect(source).toContain("toolbarSlot=");
    expect(source).toContain("<LazyChunkErrorBoundary");
  });

  it("opens the generating editor before persistence and dynamic questions", () => {
    const persistIndex = flow.indexOf("await ensureDeckPersisted(deck.id)");
    const openEditorIndex = flow.indexOf(
      "generationSubmitId=${encodeURIComponent(generationSubmitMessageId)}",
    );
    const askQuestionIndex = flow.indexOf("use the `ask-question` tool");

    expect(persistIndex).toBeGreaterThan(-1);
    expect(openEditorIndex).toBeGreaterThan(-1);
    expect(openEditorIndex).toBeLessThan(persistIndex);
    expect(flow).toContain(
      "generation_attempt_id=${encodeURIComponent(generationAttemptId)}",
    );
    expect(askQuestionIndex).toBeGreaterThan(openEditorIndex);
    expect(flow).not.toContain("await askUserQuestion");
    expect(flow).toContain("prompt-specific question");
    expect(flow).toContain("recoverFromGenerationSetupFailure");
  });

  it("carries the already-imported reference source into a retry", () => {
    // The failed attempt keeps which upload became the reference deck, and the
    // retry reuses it only while that same deck is still selected — otherwise
    // the retry re-reads a file the reference deck already represents.
    expect(source).toContain("retryImportedReference: importedReferenceSource");
    expect(source).toContain(
      "setNewDeckRetryImportedReference(state.retryImportedReference)",
    );
    expect(source).toContain(
      "selectedReferenceDeckId === carriedImportedReference.deckId",
    );
    expect(source).toContain("retryReferenceSource: referenceSource");
    expect(source).toContain(
      "setSelectedReferenceSource(state.retryReferenceSource ?? null)",
    );
    // A deleted reference deck must not keep its source excluded, or the run
    // has neither the deck nor the file it was built from.
    expect(source).toContain(
      "!decks.some((deck) => deck.id === carriedImportedReference.deckId)",
    );
    // A deck that is gone must also stop being passed as the reference, or it
    // reads as one while loading nothing.
    expect(source).toContain(
      "referenceDeckId: carriedDeckMissing ? null : selectedReferenceDeckId",
    );
  });

  it("shows the destination-shaped loading surface before navigation", () => {
    const loadingIndex = flow.indexOf("setIsStartingNewDeck(true)");
    const navigateIndex = flow.indexOf(
      "generationSubmitId=${encodeURIComponent(generationSubmitMessageId)}",
    );

    expect(loadingIndex).toBeGreaterThan(-1);
    expect(loadingIndex).toBeLessThan(navigateIndex);
    expect(source).toContain('data-testid="new-deck-loading"');
  });

  it("marks generation intent before submitting the agent run", () => {
    const generatingRouteIndex = flow.indexOf(
      "generationSubmitId=${encodeURIComponent(generationSubmitMessageId)}",
    );
    const submitIndex = flow.indexOf(
      "agentSubmit(createDeckAgentMessage(prompt)",
    );

    expect(generatingRouteIndex).toBeGreaterThan(-1);
    expect(submitIndex).toBeGreaterThan(generatingRouteIndex);
    expect(flow).toContain(
      "generation_attempt_id=${encodeURIComponent(generationAttemptId)}",
    );
    expect(flow).toContain("submitMessageId: generationSubmitMessageId");
  });

  it("carries hidden prompt context through generation retries", () => {
    expect(source).toContain("PENDING_PROMPT_CONTEXT_KEY");
    expect(source).toContain("PENDING_PROMPT_MODEL_SELECTION_KEY");
    expect(source).toContain("retryContext?: string");
    expect(source).toContain("modelSelection?: DeckModelSelection");
    expect(flow).toContain("retryContext: additionalContext || undefined");
    expect(flow).toContain("modelSelection,");
    expect(source).toContain("newDeckRetryPrompt");
    expect(source).toContain(
      "initialModelSelection={newDeckRetryModelSelection}",
    );
    expect(source).toContain(
      "prompt === newDeckRetryPrompt ? newDeckRetryContext : undefined",
    );
  });

  it("keeps imported reference exclusions through retries and repeats", () => {
    expect(source).toContain("retryReferenceFilePaths?: string[]");
    expect(source).toMatch(
      /newDeckRetryFiles\.length > 0\s*\? newDeckRetryReferenceFilePaths\s*:\s*\[\]/,
    );
    expect(source).toContain(
      "...(retryReferenceFilePaths.length > 0\n          ? { referenceFilePaths: retryReferenceFilePaths }",
    );
    expect(source).toContain(
      "setNewDeckRetryReferenceFilePaths(state.retryReferenceFilePaths ?? [])",
    );
    expect(source).toContain("...selectedReferenceFilePaths,");
  });

  it("requires a generated title before the first slide", () => {
    const titleInstructionIndex = flow.indexOf(
      "After reading any requested or attached reference material, but before adding the first slide",
    );
    const titlePatchIndex = flow.indexOf('"op": "patch-deck-fields"');
    const addSlideInstructionIndex = flow.indexOf(
      "Add every generated slide ONE AT A TIME using the `add-slide` action",
    );
    const sparseTitleInstructionIndex = flow.indexOf(
      "Include only `title` in `fields`; omit all other optional fields.",
    );

    expect(titleInstructionIndex).toBeGreaterThan(-1);
    expect(titlePatchIndex).toBeGreaterThan(titleInstructionIndex);
    expect(sparseTitleInstructionIndex).toBeGreaterThan(titlePatchIndex);
    expect(addSlideInstructionIndex).toBeGreaterThan(titlePatchIndex);
    expect(flow).toContain(
      "Never use the deck id, run id, file id, or another opaque alphanumeric token as the title",
    );
  });

  it("keeps presentation generation multi-slide and persisted", () => {
    expect(flow).toContain(
      "infer a coherent multi-slide outline from the scope",
    );
    expect(flow).toContain("Do not call the legacy generate-slides-ai action");
    expect(flow).toContain(
      "Treat each successful write and compact readback as confirmation",
    );
    expect(flow).toContain("deck-level visual contract");
    expect(flow).toContain(
      "Add every generated slide ONE AT A TIME using the `add-slide` action",
    );
    expect(flow).toContain(
      "Do not use `patch-deck` to append generated slides because `add-slide` records per-slide Creative Context provenance",
    );
    expect(flow).toContain(
      "call `get-deck` with its returned slideId and compact=false",
    );
    expect(flow).not.toContain("at most three `add-slide` operations");
    expect(flow).toContain("Never issue parallel writes to the same deck");
  });

  it("keeps unreferenced decks coherent instead of inventing text-covering boxes", () => {
    expect(flow).toContain(
      "When no reference deck or hydrated design system is available, choose a subject-appropriate editorial direction",
    );
    expect(flow).toContain(
      "semantic --deck-* values on every fmd-slide wrapper",
    );
    expect(flow).toContain(
      "Keep the canvas and type system consistent across slides",
    );
  });

  it("keeps ordinary attachments as reference material for a new deck", () => {
    expect(flow).toContain(
      "attached reference files must not seed it with imported slides",
    );
    expect(generationLibSource).toContain(
      "Attachments are context for the agent by default",
    );
    expect(flow).toContain("isSourceImprovementRequest");
    expect(flow).toContain("importUploadedDeckIntoDeck");
    expect(flow).toContain("Source-preserving improvement mode");
    expect(flow).toContain(
      "attached reference files must not seed it with imported slides",
    );
  });

  it("blocks generation when an attached reference cannot be read", () => {
    const hydrateIndex = flow.indexOf("await hydrateReferenceDocuments(");
    const submitIndex = flow.indexOf(
      "agentSubmit(createDeckAgentMessage(prompt)",
    );

    expect(hydrateIndex).toBeGreaterThan(-1);
    expect(hydrateIndex).toBeLessThan(submitIndex);
    expect(flow).toContain('referenceHydration.status === "unreadable"');
    expect(flow).toContain(
      "recoverFromGenerationSetupFailure(referenceHydration.message)",
    );
    expect(flow).toContain("referenceDocumentContext,");
    // The agent must not be told to fetch a reference it was already handed:
    // that instruction is what let a failed read surface only after the deck
    // had been generated from nothing.
    expect(generationLibSource).toContain(
      "PDF, PPTX, and DOCX files were already read before this run",
    );
    expect(generationLibSource).not.toContain(
      "when you need their text or structure",
    );
  });

  it("keeps prior attachment chips when a generation retry adds files", () => {
    expect(flow).toContain("const attachmentsForGeneration = [");
    expect(flow).toContain("...newDeckRetryAttachments");
    expect(flow).toContain("...attachments");
  });
  it("passes uploaded image references through the home agent submission", () => {
    expect(flow).toContain(
      "...getUploadedImageAgentOptions(filesForGeneration)",
    );
    expect(source).toContain("getUploadedImageAgentOptions");
  });

  it("preserves the composer model selection through the reference step", () => {
    expect(source).toContain("options?: PromptComposerSubmitOptions");
    expect(source).toContain("modelSelection: options");
    expect(flow).toContain("...modelSelection");
  });

  it("submits directly and keeps reference selection available in the prompt", () => {
    expect(source).toContain("const handlePromptSubmit");
    expect(source).toContain("onSubmit={handlePromptSubmit}");
    expect(source).toContain("setShowNewDeckReferenceStep(true)");
    expect(source).toContain(
      "setSelectedReferenceSource(selection.referenceSource ?? null)",
    );
    expect(source).not.toContain("setPendingDeck(");
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
    expect(source).toContain(
      "<ImportDeckMenu onImport={handleDirectImport} />",
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
    expect(referenceImportFlow).toContain(
      "timeoutMs: IMPORT_ACTION_TIMEOUT_MS",
    );
    expect(referenceImportFlow).toContain("importedReference = {");
    expect(referenceImportFlow).toContain('source: "pptx"');
    expect(referenceImportFlow).toContain("return importedReference");
    expect(referenceImportFlow).not.toContain("handleCreateDeckWithPrompt(");
  });

  it("imports an uploaded PDF into a reusable reference deck", () => {
    const referenceImportFlow = source.slice(
      source.indexOf("const handleReferenceImport"),
      source.indexOf("const handleReferenceSkip"),
    );

    expect(referenceImportFlow).toMatch(/callAction\(\s*"import-file"/);
    expect(referenceImportFlow).toContain(
      'const documentFormat = pdfReference ? "pdf" : "docx"',
    );
    expect(referenceImportFlow).toContain("importIntoDeck: true");
    expect(referenceImportFlow).toContain("setSelectedReferenceDeckId");
    expect(referenceImportFlow).toContain(
      "The target generation context must retain the source handle",
    );
    expect(referenceImportFlow).toContain(
      "const referenceFilePaths = uploaded\n          .filter((file) => /\\.(pdf|pptx|docx)$/i.test(file.originalName))",
    );
    expect(referenceImportFlow).toMatch(
      /source: "pptx",\s+referenceFilePaths,/,
    );
    expect(referenceImportFlow).toMatch(
      /source: documentFormat,\s+referenceFilePaths,/,
    );
    expect(referenceImportFlow).toContain("let generationFiles = uploaded;");
    expect(referenceImportFlow).toContain("referenceFilePaths");
    expect(referenceImportFlow).not.toMatch(
      /generationFiles = uploaded\.filter\(\s*\(file\) => file !== documentReference,/,
    );
    expect(referenceImportFlow).not.toContain(
      "generationFiles = uploaded.filter((file) => file !== pptxReference)",
    );
    expect(referenceImportFlow).not.toContain("handleCreateDeckWithPrompt(");
    expect(referenceImportFlow).toContain(
      't("editorToolbar.importFailedDescription")',
    );
  });

  it("imports an uploaded DOCX into a reusable reference deck", () => {
    const referenceImportFlow = source.slice(
      source.indexOf("const handleReferenceImport"),
      source.indexOf("const handleReferenceSkip"),
    );

    expect(referenceImportFlow).toContain("const docxReference =");
    expect(referenceImportFlow).toContain("format: documentFormat");
    expect(referenceImportFlow).toContain("slideCount?: unknown;");
    expect(referenceImportFlow).toContain("source: documentFormat");
    expect(referenceImportFlow).toContain(
      "timeoutMs: IMPORT_ACTION_TIMEOUT_MS",
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
