import {
  currentSlideTextRangeSelection,
  type SlideTextRangeSelection,
} from "@shared/slide-text-range-selection";

export function currentAgentTextRangeSelection(
  value: unknown,
  sourceIdentity: {
    slideId: string;
    revision: number;
    sourceHash: string;
  } | null,
  locator: { line: number; column: number } | null,
  hasUnsavedEdits: boolean,
): SlideTextRangeSelection | null {
  if (hasUnsavedEdits) return null;
  return currentSlideTextRangeSelection(value, sourceIdentity, locator);
}
