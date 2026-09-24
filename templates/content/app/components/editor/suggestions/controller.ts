import {
  applySuggestionOperations,
  suggestionDecorations,
  type SuggestionDecoration,
  type SuggestionNode,
  type SuggestionOperation,
} from "./model";

export type SuggestionDraft = {
  canonical: SuggestionNode;
  pending: readonly SuggestionOperation[];
};

/**
 * Isolated, persistence-free state for a suggesting editor. The canonical tree
 * is retained as an immutable baseline; only the derived preview is projected
 * from pending operations, so this controller cannot write SQL or Yjs state.
 */
export function createSuggestionDraft(
  canonical: SuggestionNode,
): SuggestionDraft {
  return { canonical, pending: [] };
}

export function addPendingSuggestion(
  draft: SuggestionDraft,
  operation: SuggestionOperation,
): SuggestionDraft {
  // Validate against the current preview before retaining the operation.
  applySuggestionOperations(draft.canonical, [...draft.pending, operation]);
  return { ...draft, pending: [...draft.pending, operation] };
}

export function removePendingSuggestion(
  draft: SuggestionDraft,
  operationId: string,
): SuggestionDraft {
  return {
    ...draft,
    pending: draft.pending.filter((operation) => operation.id !== operationId),
  };
}

export function previewSuggestionDraft(draft: SuggestionDraft): SuggestionNode {
  return applySuggestionOperations(draft.canonical, draft.pending);
}

export function suggestionDraftDecorations(
  draft: SuggestionDraft,
): SuggestionDecoration[] {
  return suggestionDecorations(draft.canonical, draft.pending);
}
