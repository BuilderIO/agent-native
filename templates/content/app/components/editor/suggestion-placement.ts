import {
  suggestionPlacementForRange,
  type SuggestionPlacement,
  type SuggestionPlacementBinding,
} from "@shared/suggestion-placement";
import type { EditorState } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";

import { suggestionHighlightKey } from "./extensions/SuggestionHighlight";

/**
 * Where this editor shows each suggestion's words in the live copy, so an
 * accept lands there while the Page keeps changing around them. Only a
 * suggestion drawn as one range has a placement.
 */
export function suggestionPlacements(
  state: EditorState,
  suggestionIds: readonly string[],
): Record<string, SuggestionPlacement> {
  const binding = ySyncPluginKey.getState(state)?.binding as
    | SuggestionPlacementBinding
    | null
    | undefined;
  const specs = suggestionHighlightKey.getState(state)?.specs ?? [];
  const placements: Record<string, SuggestionPlacement> = {};
  if (!binding) return placements;
  for (const id of suggestionIds) {
    const ranges = specs.filter((spec) => spec.suggestionId === id);
    const range = ranges.length === 1 ? ranges[0] : undefined;
    if (!range) continue;
    const placement = suggestionPlacementForRange(binding, range);
    if (placement) placements[id] = placement;
  }
  return placements;
}
