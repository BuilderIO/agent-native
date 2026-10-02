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

  it("defers new empty deck persistence until generation setup is ready", () => {
    const createIndex = flow.indexOf("deck = createDeck(undefined, {");
    const hydrationIndex = flow.indexOf("await hydrateReferenceDocuments(");
    const contextIndex = flow.indexOf(
      "updateDeck(deckId, { generationContext:",
    );
    const latePersistenceIndex = flow.indexOf(
      "const persisted = await ensureDeckPersisted(deckId)",
      contextIndex,
    );

    expect(createIndex).toBeGreaterThan(-1);
    expect(flow.slice(createIndex, createIndex + 260)).toContain(
      "deferPersistence: true",
    );
    expect(contextIndex).toBeGreaterThan(hydrationIndex);
    expect(latePersistenceIndex).toBeGreaterThan(contextIndex);
    expect(flow).toContain("if (sourceImprovementRequest)");
  });

  it("marks generation intent before submitting the agent run", () => {
    const generatingRouteIndex = flow.indexOf(
      "generationSubmitId=${encodeURIComponent(generationSubmitMessageId)}",
    );
    const submitIndex = flow.indexOf("const submission = await agentSubmit(");

    expect(generatingRouteIndex).toBeGreaterThan(-1);
    expect(submitIndex).toBeGreaterThan(generatingRouteIndex);
    expect(flow).toContain(
      "generation_attempt_id=${encodeURIComponent(generationAttemptId)}",
    );
    expect(flow).toContain("submitMessageId: generationSubmitMessageId");
    expect(flow).toContain("if (!submission.delivered)");
    expect(flow).toContain('"agent_submit_failed"');
    expect(flow).toContain("submission.reason ??");
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
    const submitIndex = flow.indexOf("const submission = await agentSubmit(");

    expect(hydrateIndex).toBeGreaterThan(-1);
    expect(hydrateIndex).toBeLessThan(submitIndex);
    expect(flow).toContain('referenceHydration.status === "unreadable"');
    expect(flow).toContain(
      "recoverFromGenerationSetupFailure(referenceHydration.message)",
    );
    expect(flow).toContain("referenceDocumentContext,");
    expect(generationLibSource).toContain(
      "PDF, PPTX, and DOCX files were already read before this run",
    );
    expect(generationLibSource).not.toContain(
      "when you need their text or structure",
    );
  });
});
