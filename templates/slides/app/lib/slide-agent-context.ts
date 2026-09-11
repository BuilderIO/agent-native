export const SLIDES_SELECTION_CHANGED_EVENT = "slides:selection-changed";

export interface SlidesAgentSelection {
  deckId?: string;
  slideId?: string;
  slideIndex?: number;
  slideNumber?: number;
  items?: readonly unknown[];
}

interface SlidesSelectionWindow extends Window {
  __slidesAgentSelection?: SlidesAgentSelection | null;
}

function getSlidesWindow(): SlidesSelectionWindow | null {
  return typeof window === "undefined"
    ? null
    : (window as SlidesSelectionWindow);
}

/**
 * Keep the visible scope chip responsive without making the browser event the
 * source of truth for agent context. The app-state write remains canonical.
 */
export function publishSlidesSelection(
  selection: SlidesAgentSelection | null,
): void {
  const slidesWindow = getSlidesWindow();
  if (!slidesWindow) return;
  slidesWindow.__slidesAgentSelection = selection;
  slidesWindow.dispatchEvent(
    new CustomEvent<SlidesAgentSelection | null>(
      SLIDES_SELECTION_CHANGED_EVENT,
      { detail: selection },
    ),
  );
}

export function readPublishedSlidesSelection(): SlidesAgentSelection | null {
  return getSlidesWindow()?.__slidesAgentSelection ?? null;
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
