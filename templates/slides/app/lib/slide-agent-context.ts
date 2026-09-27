export const SLIDES_SELECTION_CHANGED_EVENT = "slides:selection-changed";

export interface SlidesAgentSelection {
  deckId?: string;
  slideId?: string;
  slideIndex?: number;
  slideNumber?: number;
  selectionRevision?: number;
  items?: readonly unknown[];
}

export interface SlidesAgentContext {
  context: string;
  contextVersion: string;
}

export type SlidesAgentScopeLabel =
  | { key: "agent.currentSelection" | "agent.thisSlide" }
  | { key: "agent.slideNumber"; number: number };

interface SlidesSelectionWindow extends Window {
  __slidesAgentSelection?: SlidesAgentSelection | null;
}

let selectionRevision = 0;

function getSlidesWindow(): SlidesSelectionWindow | null {
  return typeof window === "undefined"
    ? null
    : (window as SlidesSelectionWindow);
}

export function publishSlidesSelection(
  selection: SlidesAgentSelection | null,
): void {
  const slidesWindow = getSlidesWindow();
  if (!slidesWindow) return;
  const publishedSelection = selection
    ? { ...selection, selectionRevision: ++selectionRevision }
    : null;
  slidesWindow.__slidesAgentSelection = publishedSelection;
  slidesWindow.dispatchEvent(
    new CustomEvent<SlidesAgentSelection | null>(
      SLIDES_SELECTION_CHANGED_EVENT,
      { detail: publishedSelection },
    ),
  );
}

export function readPublishedSlidesSelection(): SlidesAgentSelection | null {
  return getSlidesWindow()?.__slidesAgentSelection ?? null;
}

function selectionItemKey(item: unknown, index: number): string {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return `item-${index}`;
  }
  const record = item as Record<string, unknown>;
  for (const key of ["objectId", "selector", "runtimeSelector"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return `item-${index}`;
}

export function buildSlidesAgentContext(
  selection: SlidesAgentSelection | null,
  deckId: string,
): SlidesAgentContext {
  const sameDeck = selection?.deckId === deckId;
  const slideId = sameDeck ? selection?.slideId?.trim() : undefined;
  const slideNumber =
    sameDeck &&
    typeof selection?.slideNumber === "number" &&
    Number.isFinite(selection.slideNumber) &&
    selection.slideNumber >= 1
      ? selection.slideNumber
      : undefined;
  const itemKeys = sameDeck
    ? (selection?.items ?? []).map(selectionItemKey)
    : [];
  const context = [
    slideId
      ? `Current slide id: ${slideId}.`
      : "Current slide id is not available.",
    slideNumber ? `Current slide number: ${slideNumber}.` : "",
    itemKeys.length > 0
      ? `Selected element targets: ${itemKeys.join(", ")}.`
      : "No slide element is selected.",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    context,
    contextVersion: [
      deckId,
      slideId ?? "",
      slideNumber ?? "",
      selection?.selectionRevision ?? "",
      ...itemKeys,
    ].join("|"),
  };
}

export function hasCurrentSlideSelection(
  selection: SlidesAgentSelection | null,
  deckId: string,
): boolean {
  return (
    selection?.deckId === deckId &&
    Array.isArray(selection.items) &&
    selection.items.length > 0
  );
}

export function getSlidesAgentScopeLabel(
  selection: SlidesAgentSelection | null,
  deckId: string,
): SlidesAgentScopeLabel {
  if (hasCurrentSlideSelection(selection, deckId)) {
    return { key: "agent.currentSelection" };
  }

  const slideNumber =
    selection?.deckId === deckId ? selection.slideNumber : undefined;
  return typeof slideNumber === "number" &&
    Number.isSafeInteger(slideNumber) &&
    slideNumber >= 1
    ? { key: "agent.slideNumber", number: slideNumber }
    : { key: "agent.thisSlide" };
}
