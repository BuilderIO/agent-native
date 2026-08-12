import {
  callAction,
  deleteClientAppState,
} from "@agent-native/core/client/hooks";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import { extractGoogleDocUrls } from "@shared/google-docs";
import { flushSync } from "react-dom";

import type { NewDeckReferenceSelection } from "@/components/editor/NewDeckReferenceStep";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import type { Deck, DeckPersistenceResult } from "@/context/DeckContext";
import { createDeckAgentMessage } from "@/lib/agent-visible-message";
import {
  importUploadedDeckIntoDeck,
  type ImportedSourceDeck,
} from "@/lib/import-uploaded-deck";
import { TAB_ID } from "@/lib/tab-id";

interface DesignSystemGenerationContextResult {
  agentContext?: string;
}

async function loadDesignSystemGenerationContext(
  designSystemId?: string | null,
): Promise<string> {
  if (!designSystemId) return "";
  try {
    const result = (await callAction(
      "get-design-system",
      { id: designSystemId },
      { method: "GET" },
    )) as DesignSystemGenerationContextResult | undefined;
    if (result?.agentContext?.trim()) {
      return [
        "",
        result.agentContext.trim(),
        "",
        "The selected design system context above was hydrated before this agent run. Follow it directly; do not replace it with generic colors, fonts, spacing, imagery, or slide components.",
      ].join("\n");
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown loading error";
    return [
      "",
      "## Selected Design System Context",
      `The selected design system id "${designSystemId}" could not be loaded before generation: ${message}`,
      "Before adding slides, call `get-design-system` for this id. If it still fails, stop and tell the user the selected design system is unavailable instead of improvising a generic style.",
    ].join("\n");
  }
  return [
    "",
    "## Selected Design System Context",
    `The selected design system id "${designSystemId}" returned no generation context.`,
    "Call `get-design-system` for this id before adding slides. If it still has no usable tokens/docs, stop and ask the user to finish design-system indexing instead of improvising a generic style.",
  ].join("\n");
}

interface ReferenceDeckContextResult {
  agentContext?: string;
}

async function loadReferenceDeckGenerationContext(
  referenceDeckId?: string | null,
): Promise<string> {
  if (!referenceDeckId) return "";
  try {
    const result = (await callAction(
      "get-deck-reference-context",
      { id: referenceDeckId },
      { method: "GET" },
    )) as ReferenceDeckContextResult | undefined;
    if (result?.agentContext?.trim()) {
      return `\n${result.agentContext.trim()}`;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown loading error";
    return [
      "",
      "## Reference Deck",
      `The user picked deck "${referenceDeckId}" as a style reference, but it could not be loaded before generation: ${message}`,
      "Before adding slides, call `get-deck-reference-context` for this id. If it still fails, tell the user the reference deck is unavailable instead of inventing a style.",
    ].join("\n");
  }
  return [
    "",
    "## Reference Deck",
    `The user picked deck "${referenceDeckId}" as a style reference, but it returned no usable context.`,
    `Call \`get-deck --id ${referenceDeckId}\` before generating. If that deck is empty, tell the user instead of silently generating without a reference.`,
  ].join("\n");
}

export function isSourceImprovementRequest(
  prompt: string,
  files: UploadedFile[],
): boolean {
  const hasSourceDeck = files.some((file) =>
    /\.(pptx|pdf)$/i.test(file.originalName),
  );
  if (!hasSourceDeck) return false;

  const normalized = prompt.toLowerCase();
  const asksToImprove =
    /\b(restyl\w*|redesign\w*|rebrand\w*|revamp\w*|rework\w*|moderni[sz]\w*|refresh\w*|polish\w*|improv\w*|updat\w*|revis\w*|edit\w*)\b/.test(
      normalized,
    ) ||
    /\bmake\b[\s\S]{0,40}\b(better|modern|professional|polished|prett\w*)\b/.test(
      normalized,
    );
  const asksToPreserveSource =
    /(?:\b(turn|convert|transform)\b[\s\S]{0,50}\b(into|to)\b[\s\S]{0,30}\b(deck|presentation|slides?)\b|\b(create|build|make|generate)\b[\s\S]{0,80}\b(deck|presentation|slides?)\b[\s\S]{0,80}\bfrom\b)/.test(
      normalized,
    ) &&
    /\b(copy|slide[- ]for[- ]slide|preserv\w*|same order|before\s*\/?\s*after|placeholder\w*|out of order)\b/.test(
      normalized,
    );
  // A source deck attachment is the object being improved even when the
  // prompt uses an implicit phrase such as "make this prettier" or asks to
  // copy and restyle it. Requiring a source noun here silently falls back to
  // reference-only generation and can discard the uploaded deck's slide IDs
  // and content.
  return asksToImprove || asksToPreserveSource;
}

function describeUploadedFilesForAgent(
  files: UploadedFile[],
  deckId: string,
  importedSourceDeck?: ImportedSourceDeck | null,
): string {
  if (files.length === 0) return "";
  const fileList = files
    .map(
      (file) =>
        `- ${file.originalName} (${file.type}, ${(file.size / 1024).toFixed(1)}KB) at path: ${file.path}${file.url ? `; embeddable URL: ${file.url}` : ""}`,
    )
    .join("\n");
  return [
    "",
    importedSourceDeck
      ? `The user uploaded ${files.length} file(s). The ${importedSourceDeck.file.originalName} source deck has already been imported into target deck ${deckId} with ${importedSourceDeck.slideCount} source slide(s); do not import it again.`
      : `The user attached ${files.length} file(s) as reference material for this new deck. Attachments are context for the agent by default; do not import or append their slides to target deck ${deckId} merely because they were attached.`,
    fileList,
    "",
    "File handling rules:",
    importedSourceDeck
      ? "- The imported source deck is canonical. Preserve its slide count, order, IDs, factual copy, notes, imagery, charts, tables, diagrams, and freeform objects while improving styling. For a deck-wide restyle, use one patch-deck call with requireAllSourceSlides=true; use update-slide only for a targeted one-slide edit. Do not rebuild it with add-slide."
      : `- PDF, PPTX, and DOCX files: call \`import-file --filePath \"<path>\" --format auto\` (without \`importIntoDeck\`) when you need their text or structure. Use the returned material as reference while creating new slides with \`add-slide\`.`,
    importedSourceDeck
      ? "- For a PDF source, keep the original full-page image in every slide and add restrained design-system chrome around it without obscuring source content. Never OCR-reconstruct a source-faithful page from extracted text."
      : "- Do not pass `importIntoDeck: true` for an attached file unless the user explicitly asks to import or preserve the source pages in the current deck. An attached reference is not an instruction to replace or seed the deck.",
    "- Text-like files: use the uploaded-text-file blocks already included in the prompt; do not call import-file for them.",
    '- Image files with an embeddable URL are mandatory assets: if the user specified where to use one (e.g. "on the first and last slide"), embed it there with `<img src="...">` exactly as requested. Do not omit a requested image and continue silently — if it truly cannot be placed, say why in your final chat response.',
    "- Image files without a URL are visual/reference assets only; do not claim to have processed a PPTX/PDF/DOCX unless the relevant import action succeeds.",
    importedSourceDeck
      ? "- Before your final response, verify the same source slide IDs and count with get-deck after the restyle. If source fidelity is partial or images were skipped, report the exact warning instead of claiming success."
      : "- Before your final response, verify every uploaded file above was either used as reference or placed as explicitly requested. If any file's content or requested placement is missing from the deck, say so explicitly instead of reporting success.",
  ].join("\n");
}

function mergeUploadedFilesForRetry(
  savedFiles: UploadedFile[],
  newFiles: UploadedFile[],
): UploadedFile[] {
  const seen = new Set<string>();
  return [...savedFiles, ...newFiles].filter((file) => {
    const key = file.path || file.url || file.filename;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type Navigate = (
  to: string,
  options?: { flushSync?: boolean; replace?: boolean },
) => void;

type CreateDeck = (
  title?: string,
  options?: { noDefaultSlides?: boolean; designSystemId?: string | null },
) => Deck;

type SubmitAgent = (
  message: string,
  context: string,
  options: {
    newTab: boolean;
    reuseEmptyTab: boolean;
    openSidebar: boolean;
  },
) => void;

export interface StartDeckGenerationOptions {
  session: unknown | null;
  prompt: string;
  files: UploadedFile[];
  retryFiles?: UploadedFile[];
  referenceSelection?: NewDeckReferenceSelection;
  selectedDesignSystemId?: string | null;
  selectedReferenceDeckId?: string | null;
  designSystems: Array<{ id: string; title: string }>;
  createDeck: CreateDeck;
  ensureDeckPersisted: (id: string) => Promise<DeckPersistenceResult>;
  deleteDeck: (id: string) => void;
  navigate: Navigate;
  agentSubmit: SubmitAgent;
  onPromptClosed: () => void;
  onUnauthenticated: (prompt: string, hadFiles: boolean) => void;
  onPersistenceFailure: (
    prompt: string,
    files: UploadedFile[],
    failure: DeckPersistenceResult,
  ) => void;
  onSetupFailure?: (
    prompt: string,
    files: UploadedFile[],
    failure: unknown,
  ) => void;
}

/** Create the optimistic deck, hydrate references, and start the agent run. */
export async function startDeckGeneration({
  session,
  prompt,
  files,
  retryFiles = [],
  referenceSelection = {},
  selectedDesignSystemId,
  selectedReferenceDeckId,
  designSystems,
  createDeck,
  ensureDeckPersisted,
  deleteDeck,
  navigate,
  agentSubmit,
  onPromptClosed,
  onUnauthenticated,
  onPersistenceFailure,
  onSetupFailure,
}: StartDeckGenerationOptions): Promise<
  "started" | "failed" | "unauthenticated"
> {
  if (!session) {
    onUnauthenticated(prompt, files.length > 0);
    return "unauthenticated";
  }

  const filesForGeneration = mergeUploadedFilesForRetry(retryFiles, files);
  const designSystemId =
    referenceSelection.designSystemId !== undefined
      ? referenceSelection.designSystemId
      : selectedDesignSystemId && selectedDesignSystemId !== "none"
        ? selectedDesignSystemId
        : null;
  const referenceDeckId =
    referenceSelection.referenceDeckId !== undefined
      ? referenceSelection.referenceDeckId
      : selectedReferenceDeckId && selectedReferenceDeckId !== "none"
        ? selectedReferenceDeckId
        : null;
  const selectedDesignSystem = designSystemId
    ? designSystems.find((designSystem) => designSystem.id === designSystemId)
    : undefined;

  let deck: Deck | undefined;
  flushSync(() => {
    deck = createDeck(undefined, {
      noDefaultSlides: true,
      designSystemId: selectedDesignSystem?.id ?? null,
    });
  });
  if (!deck) return "failed";
  const deckId = deck.id;

  const persisted = await ensureDeckPersisted(deck.id);
  if (!persisted.persisted) {
    onPersistenceFailure(prompt, filesForGeneration, persisted);
    deleteDeck(deckId);
    return "failed";
  }

  let importedSourceDeck: ImportedSourceDeck | null = null;
  if (isSourceImprovementRequest(prompt, filesForGeneration)) {
    try {
      importedSourceDeck = await importUploadedDeckIntoDeck(
        filesForGeneration,
        deckId,
      );
    } catch (error) {
      deleteDeck(deckId);
      onSetupFailure?.(prompt, filesForGeneration, error);
      return "failed";
    }
  }

  onPromptClosed();

  navigate(`/deck/${deck.id}`, { flushSync: true });

  const trimmedPrompt = prompt.trim();
  const hasImportedGoogleDocContext = trimmedPrompt.includes("<google-doc ");
  const googleDocUrls = hasImportedGoogleDocContext
    ? []
    : extractGoogleDocUrls(trimmedPrompt);
  const fileContext = describeUploadedFilesForAgent(
    filesForGeneration,
    deckId,
    importedSourceDeck,
  );
  const googleDocContext =
    googleDocUrls.length > 0
      ? [
          "",
          "The request includes Google Docs URL(s):",
          ...googleDocUrls.map((url) => `- ${url}`),
          "Before adding slides, call `import-google-doc` for each URL and use the returned text as source material.",
          "If the action cannot read a private document, tell the user the exact sharing step from the action error instead of generating from the URL alone.",
        ].join("\n")
      : "";
  const referenceDeckContext =
    await loadReferenceDeckGenerationContext(referenceDeckId);
  const hydratedDesignSystemContext = await loadDesignSystemGenerationContext(
    selectedDesignSystem?.id,
  );
  const designSystemContext = selectedDesignSystem
    ? [
        "",
        "Design system selection:",
        `- Use "${selectedDesignSystem.title}" (id: ${selectedDesignSystem.id}).`,
        "- The deck has already been linked to this design system.",
        "- Use the hydrated design system context below for colors, typography, spacing, imagery, and slide defaults.",
        hydratedDesignSystemContext,
        "- Do not choose or apply a different design system.",
      ].join("\n")
    : [
        "",
        "Design system selection:",
        "- No design system was selected in the picker.",
        "- Before generating a bare or on-brand deck, call `get-workspace-defaults`. If it returns a usable design system, patch this deck with that designSystemId, call `get-design-system`, and follow its exact tokens, assets, and custom instructions.",
        "- If no workspace default exists, use the product's configured design-system action and report the missing configuration instead of inventing a generic Builder-like palette.",
      ].join("\n");
  const referenceSource = referenceSelection.referenceSource;
  const referenceSourceContext = referenceSource
    ? [
        "",
        "Additional reference source selected in the reference step:",
        `- ${referenceSource.kind}: ${referenceSource.value}`,
        referenceSource.kind === "google-docs"
          ? "Call `import-google-doc` before generating and use the returned text as source material."
          : referenceSource.kind === "website"
            ? "Call `import-from-url` before generating and use the returned page context as a reference."
            : "Use the Figma source as the design reference. If Builder or Figma access is required, report the exact connection step instead of guessing.",
      ].join("\n")
    : "";
  const sourceDeckContext = importedSourceDeck
    ? [
        "",
        "Source-preserving improvement mode:",
        `- The target deck already contains ${importedSourceDeck.slideCount} imported source slides. Treat those slides as the user's complete source, not as inspiration for a new deck.`,
        "- Keep the exact source slide count, order, IDs, factual meaning, notes, images, charts, tables, diagrams, and freeform objects unless the user explicitly asks to change one of them.",
        "- Read get-deck once before editing to obtain every existing slide ID and source HTML, load the linked design system with get-design-system, then make a deck-wide restyle with one patch-deck call using requireAllSourceSlides=true and one patch-slide operation with fields.content for every source slide ID. Do not split a full-deck restyle into arbitrary batches or fall back to one-by-one update-slide calls; use update-slide only for a targeted one-slide edit. Keep every original image source and enough original factual copy for each slide; for PDF slides, use restrained design-system chrome around the page without obscuring it.",
        "- Do not call add-slide, delete slides, reorder slides, or replace source images with generic cards. Do not claim success until get-deck verifies the same slide IDs and count after the edits.",
        '- After the patch succeeds, verify with get-deck using compact: "true" so only slide IDs, count, and previews are returned. Do not report an initial or partial pass, and do not leave any source slides for a later run.',
        "- If get-deck reports partial source fidelity or skipped images, stop and report the exact warning instead of claiming a reliable restyle.",
      ].join("\n")
    : "";
  const sourceModeInstructions = importedSourceDeck
    ? [
        "The request is an in-place visual improvement of an imported source deck. Make a coherent style pass across every existing slide while preserving all source content and media.",
        "Do not use the new-deck add-slide workflow for this source-preserving request. Finish every source slide in this run; if patch-deck rejects incomplete coverage, continue with the returned missing IDs instead of reporting success with a partial deck.",
      ].join("\n")
    : [
        "This is a new deck. Keep it empty until generation begins; attached reference files must not seed it with imported slides.",
        "Start a `manage-progress` run so progress appears in the app header. Add the first slide as soon as it is ready, then continue one slide at a time so the editor visibly fills in.",
        `After reading any requested or attached reference material, but before adding the first slide, choose a concise, specific deck title from the user's request and source material. Never use the deck id, run id, file id, uploaded filename, or another opaque alphanumeric token as the title. Do not reuse a generic placeholder like "Untitled scene" when the content or reference context gives you a better title. Call \`patch-deck\` with \`deckId: \"${deckId}\"\` and \`operations: [{ \"op\": \"patch-deck-fields\", \"fields\": { \"title\": \"<generated title>\" } }]\`. Include only \`title\` in \`fields\`; omit all other optional fields. Never leave a generated deck named \"Untitled Deck\" or another placeholder.`,
        "If the user asks for a standalone visual, diagram, hero, one-pager, poster, or a couple of visuals, create only the requested one/few polished visual slides. Do not pad the result into a full presentation.",
        "If the request is for a presentation or deck and does not explicitly ask for one slide, infer a coherent multi-slide outline from the scope and keep adding slides until that outline is complete. Do not stop after the first slide just because the prompt has few explicit instructions.",
        `Add slides ONE AT A TIME using the \`add-slide\` action with --deckId=${deckId}. Wait for each \`add-slide\` result before calling it again; do not batch or parallelize slide writes.`,
        "Use create-deck and add-slide for this already-created deck. Do not call the legacy generate-slides-ai action: it returns Markdown drafts rather than persisted rendered slide HTML. Treat each successful add-slide result as confirmation to continue with the next planned slide.",
      ].join("\n");

  const context = [
    importedSourceDeck
      ? `The user uploaded a source presentation into target deck (id: "${deckId}") and wants a reliable visual improvement.`
      : `The user just created a new empty deck (id: "${deckId}") and wants to create a presentation or standalone visual.`,
    "The visible user message above contains the user's request and/or pasted source material for the deck. Treat pasted memo content as source material even if the user did not explicitly say they are pasting it.",
    googleDocContext,
    fileContext,
    referenceDeckContext,
    designSystemContext,
    referenceSourceContext,
    sourceDeckContext,
    "",
    "Before generating, if the request or selected references leave a meaningful choice unresolved, use the `ask-question` tool to ask one concise, prompt-specific question in the inline guided-question flow. Generate the question wording and 2 to 4 options from the user's request and selected references, like Claude's design-question flow; do not use a fixed generic questionnaire. Ask only a choice that materially affects the deck, such as audience, tone, structure, or length. If the prompt already makes the choice clear, do not ask it again. Wait for the user's answer or skip before adding slides.",
    sourceModeInstructions,
    "If the user asked for a specific slide count, keep going sequentially until that count is reached unless a tool error blocks you. If no explicit count was given (including when the guided slide-count question was skipped), infer the count from the distinct topics/sections implied by the request — one slide per section plus a title and closing slide — and add slides for every section before considering the deck done. Do not stop at an arbitrary round number (e.g. 10) if sections remain uncovered, and never call `generate-slides-ai` for this flow; it is a legacy single-shot helper capped at 10 slides.",
    "Every slide is rendered into a fixed native canvas (default 16:9 is 960x540 CSS pixels, with 740x380px available inside standard 80px 110px padding). Keep the main content within that fit budget; split dense source material across more slides instead of packing it tightly. Never use zoom, transform: scale(), clipping, or scroll overflow to hide content overflow, and keep body text at least 16px.",
    "Each slide's --content must be full HTML. Slide HTML templates are in your AGENTS.md.",
    "Do NOT use create-deck (the deck already exists). Do NOT call db-schema, the resources tool, or search-files.",
  ].join("\n");

  // A guided-question card from the previous deck's still-finishing agent run
  // shares this browser tab's single "guided-questions" slot. Without
  // clearing it here, a late answer to that stale question can render on top
  // of the deck we're about to navigate to. Best-effort: if the previous
  // run's question arrives after this clear, it can still reappear, but this
  // closes the common case where it's already pending when a new deck starts.
  deleteClientAppState(
    appStateKeyForBrowserTab("guided-questions", TAB_ID),
  ).catch(() => {});
  deleteClientAppState("guided-questions").catch(() => {});

  navigate(`/deck/${deck.id}?generating=1`, {
    replace: true,
    flushSync: true,
  });
  agentSubmit(createDeckAgentMessage(trimmedPrompt), context, {
    newTab: true,
    reuseEmptyTab: true,
    openSidebar: true,
  });
  return "started";
}
