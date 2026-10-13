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

export function createSuggestionDraft(
  canonical: SuggestionNode,
): SuggestionDraft {
  return { canonical, pending: [] };
}

export function addPendingSuggestion(
  draft: SuggestionDraft,
  operation: SuggestionOperation,
): SuggestionDraft {
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
