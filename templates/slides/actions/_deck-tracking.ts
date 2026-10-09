import {
  generationAttemptIdOf,
  promptLengthBucket,
  trackSlides,
} from "../server/lib/slides-tracking.js";

type TrackingSource = Parameters<typeof trackSlides>[2];

export type DeckCreationMethod =
  | "generated"
  | "import_pptx"
  | "import_pdf"
  | "import_docx"
  | "import_gslides"
  | "template"
  | "duplicate"
  | "blank"
  | "unknown";

export type DeckPurpose = "direct" | "reference";

export type SlideChangeKind =
  | "content"
  | "add_slide"
  | "delete_slide"
  | "reorder";

// User-visible slide fields only. Render bookkeeping such as layoutFitRevision
// and imageLoading changes without a user edit, so it must stay out of this
// list or every autosave would count as an edit.
const SLIDE_CONTENT_FIELDS = [
  "content",
  "notes",
  "layout",
  "background",
  "imageUrl",
  "excalidrawData",
  "animations",
  "transition",
  "skipped",
] as const;

function sameFieldValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function recordsOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (slide): slide is Record<string, unknown> =>
          !!slide && typeof slide === "object",
      )
    : [];
}

function slideKey(slide: Record<string, unknown>, index: number): string {
  return typeof slide.id === "string" && slide.id ? slide.id : `#${index}`;
}

export function slideChangeSummary(
  previousSlides: unknown,
  nextSlides: unknown,
): { changeKinds: SlideChangeKind[]; slidesChanged: number } {
  const previous = new Map(
    recordsOf(previousSlides).map((slide, index) => [
      slideKey(slide, index),
      slide,
    ]),
  );
  const next = new Map(
    recordsOf(nextSlides).map((slide, index) => [
      slideKey(slide, index),
      slide,
    ]),
  );
  const added = [...next.keys()].filter((key) => !previous.has(key));
  const deleted = [...previous.keys()].filter((key) => !next.has(key));
  const changed = new Set<string>();
  for (const [key, slide] of next) {
    const prior = previous.get(key);
    if (
      prior &&
      SLIDE_CONTENT_FIELDS.some(
        (field) => !sameFieldValue(prior[field], slide[field]),
      )
    ) {
      changed.add(key);
    }
  }
  const previousOrder = [...previous.keys()].filter((key) => next.has(key));
  const nextOrder = [...next.keys()].filter((key) => previous.has(key));
  // The funnel only needs to know the order changed; a reorder counts once.
  const reordered = previousOrder.some(
    (key, index) => nextOrder[index] !== key,
  );

  const changeKinds: SlideChangeKind[] = [];
  if (changed.size > 0) changeKinds.push("content");
  if (added.length > 0) changeKinds.push("add_slide");
  if (deleted.length > 0) changeKinds.push("delete_slide");
  if (reordered) changeKinds.push("reorder");
  return {
    changeKinds,
    slidesChanged:
      added.length + deleted.length + changed.size + (reordered ? 1 : 0),
  };
}

/**
 * Tracking runs after the deck write has committed, so a throw here would turn
 * a saved change into an error for the user. Every exported tracker is
 * wrapped so it can never fail or interrupt the operation it describes.
 */
function bestEffort<TArgs extends unknown[]>(
  track: (...args: TArgs) => void,
): (...args: TArgs) => void {
  return (...args) => {
    try {
      track(...args);
    } catch {
      // coercion-ok: analytics is best-effort; dropping one event beats failing a committed write.
    }
  };
}

export const trackSlideContentEdited = bestEffort(
  function trackSlideContentEdited(
    editMode: "save_deck" | "patch_deck",
    deckId: string,
    previousSlides: unknown,
    nextDeck: { slides?: unknown; generationContext?: unknown },
    source: TrackingSource,
  ): void {
    const { changeKinds, slidesChanged } = slideChangeSummary(
      previousSlides,
      nextDeck.slides,
    );
    if (changeKinds.length === 0) return;
    const generationAttemptId = generationAttemptIdOf(
      nextDeck.generationContext,
    );
    trackSlides(
      "deck_edited",
      {
        output_id: deckId,
        output_type: "deck",
        edit_mode: editMode,
        change_kinds: changeKinds,
        slides_changed: slidesChanged,
        slide_count: recordsOf(nextDeck.slides).length,
        ...(generationAttemptId
          ? { generation_attempt_id: generationAttemptId }
          : {}),
      },
      source,
    );
  },
);

export const trackDeckCreated = bestEffort(function trackDeckCreated(
  deckId: string,
  properties: {
    creationMethod: DeckCreationMethod;
    purpose: DeckPurpose | "unknown";
    slideCount: number;
    generationContext?: unknown;
  },
  source: TrackingSource,
): void {
  const generationAttemptId = generationAttemptIdOf(
    properties.generationContext,
  );
  trackSlides(
    "deck_created",
    {
      output_id: deckId,
      output_type: "deck",
      creation_method: properties.creationMethod,
      purpose: properties.purpose,
      slide_count: properties.slideCount,
      ...(generationAttemptId
        ? { generation_attempt_id: generationAttemptId }
        : {}),
    },
    source,
  );
});

function attachmentType(file: Record<string, unknown>): string {
  for (const name of [file.originalName, file.path]) {
    if (typeof name !== "string") continue;
    const match = /\.([a-z0-9]{1,10})$/i.exec(name.trim());
    if (match) return match[1]!.toLowerCase();
  }
  return "unknown";
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Emits `deck_creation_started` when a write persists a generation attempt id
 * the deck did not already have. Never includes prompt text or file names.
 */
export const trackDeckCreationStarted = bestEffort(
  function trackDeckCreationStarted(
    deckId: string | undefined,
    previousGenerationContext: unknown,
    nextGenerationContext: unknown,
    source: TrackingSource,
  ): void {
    const attemptId = generationAttemptIdOf(nextGenerationContext);
    const previousAttemptId = generationAttemptIdOf(previousGenerationContext);
    if (!attemptId || attemptId === previousAttemptId) return;
    const context = recordOf(nextGenerationContext) ?? {};
    const prompt = context.originalPrompt;
    const files = recordsOf(context.files);
    const targetSlideCount = context.targetSlideCount;
    trackSlides(
      "deck_creation_started",
      {
        ...(deckId ? { output_id: deckId } : {}),
        output_type: "deck",
        generation_attempt_id: attemptId,
        creation_method: "generated",
        mode:
          context.mode === "source-preserving" ? "source_preserving" : "new",
        has_text_prompt: typeof prompt === "string" && prompt.trim().length > 0,
        prompt_length_bucket: promptLengthBucket(prompt),
        attachment_count: files.length,
        attachment_types: [...new Set(files.map(attachmentType))].sort(),
        has_reference_deck:
          typeof context.referenceDeckId === "string" &&
          context.referenceDeckId.length > 0,
        has_design_system:
          typeof context.designSystemId === "string" &&
          context.designSystemId.length > 0,
        ...(typeof targetSlideCount === "number"
          ? { target_slide_count: targetSlideCount }
          : {}),
        is_retry: previousAttemptId !== undefined,
      },
      source,
    );
  },
);
