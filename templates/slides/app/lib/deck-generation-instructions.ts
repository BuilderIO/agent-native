/**
 * Agent instructions for a deck-generation run.
 *
 * Two entry points start a generation run: the decks home page
 * (`pages/Index.tsx`) and the first-deck onboarding flow (via
 * `startDeckGeneration` in `create-deck-generation.ts`). Both lists used to
 * live inline in each file, so a rule added to one silently missed the other.
 * That is how the "write requested speaker notes into `notes`" rule reached
 * onboarding but never reached the primary flow, and generated decks kept
 * coming back with empty speaker notes after the rule was supposedly added.
 * Every shared generation rule belongs here so neither caller can drift.
 */

export function buildSourceDeckContext(
  importedSourceSlideCount: number | null,
): string {
  if (importedSourceSlideCount === null) return "";
  return [
    "",
    "Source-preserving improvement mode:",
    `- The target deck already contains ${importedSourceSlideCount} imported source slides. Treat those slides as the user's complete source, not as inspiration for a new deck.`,
    "- Keep the exact source slide count, order, IDs, factual meaning, notes, images, charts, tables, diagrams, and freeform objects unless the user explicitly asks to change one of them.",
    "- Read get-deck once before editing to obtain every existing slide ID and source HTML, load the linked design system with get-design-system, then make a deck-wide restyle with one patch-deck call using requireAllSourceSlides=true and one patch-slide operation with fields.content for every source slide ID. Do not split a full-deck restyle into arbitrary batches or fall back to one-by-one update-slide calls; use update-slide only for a targeted one-slide edit. Keep every original image source and enough original factual copy for each slide; for PDF slides, use restrained design-system chrome around the page without obscuring it.",
    "- Do not call add-slide, delete slides, reorder slides, or replace source images with generic cards. Do not claim success until get-deck verifies the same slide IDs and count after the edits.",
    '- After the patch succeeds, verify with get-deck using compact: "true" so only slide IDs, count, and previews are returned. Do not report an initial or partial pass, and do not leave any source slides for a later run.',
    "- If get-deck reports partial source fidelity or skipped images, stop and report the exact warning instead of claiming a reliable restyle.",
  ].join("\n");
}

export function buildSourceModeInstructions(options: {
  deckId: string;
  hasImportedSourceDeck: boolean;
}): string {
  const { deckId, hasImportedSourceDeck } = options;
  if (hasImportedSourceDeck) {
    return [
      "The request is an in-place visual improvement of an imported source deck. Make a coherent style pass across every existing slide while preserving all source content and media.",
      "Do not use the new-deck add-slide workflow for this source-preserving request. Finish every source slide in this run; if patch-deck rejects incomplete coverage, continue with the returned missing IDs instead of reporting success with a partial deck.",
    ].join("\n");
  }
  return [
    "This is a new deck. Keep it empty until generation begins; attached reference files must not seed it with imported slides.",
    "Start a `manage-progress` run so progress appears in the app header. Add the first slide as soon as it is ready, then continue one slide at a time so the editor visibly fills in.",
    `After reading any requested or attached reference material, but before adding the first slide, choose a concise, specific deck title from the user's request and source material. Never use the deck id, run id, file id, uploaded filename, or another opaque alphanumeric token as the title. Do not reuse a generic placeholder like "Untitled scene" when the content or reference context gives you a better title. Call \`patch-deck\` with \`deckId: "${deckId}"\` and \`operations: [{ "op": "patch-deck-fields", "fields": { "title": "<generated title>" } }]\`. Include only \`title\` in \`fields\`; omit all other optional fields. Never leave a generated deck named "Untitled Deck" or another placeholder.`,
    "If the user asks for a standalone visual, diagram, hero, one-pager, poster, or a couple of visuals, create only the requested one/few polished visual slides. Do not pad the result into a full presentation.",
    "If the request is for a presentation or deck and does not explicitly ask for one slide, infer a coherent multi-slide outline from the scope and keep adding slides until that outline is complete. Do not stop after the first slide just because the prompt has few explicit instructions.",
    "When the user requests speaker notes, or the outline they asked for implies presenter narration, write presenter-only text into each slide's `notes` field on `add-slide` and keep it out of the slide HTML. An empty `notes` field is not an acceptable result for a request that asked for speaker notes.",
    `Add slides ONE AT A TIME using the \`add-slide\` action with --deckId=${deckId}. Wait for each \`add-slide\` result before calling it again; do not batch or parallelize slide writes.`,
    "Use create-deck and add-slide for this already-created deck. Do not call the legacy generate-slides-ai action: it returns Markdown drafts rather than persisted rendered slide HTML. Treat each successful add-slide result as confirmation to continue with the next planned slide.",
  ].join("\n");
}
