const ACTION_ERROR_TRANSLATIONS = {
  not_authenticated: "editorErrors.signInRequired",
  deck_not_found: "editorErrors.deckNotFound",
  slide_not_found: "editorErrors.slideNotFound",
  slide_source_missing: "editorErrors.slideSourceUnavailable",
  slide_source_conflict: "editorErrors.slideChanged",
  slide_content_stale: "editorErrors.slideChanged",
  slide_field_stale: "editorErrors.slideChanged",
  deck_revision_conflict: "editorErrors.deckChanged",
  deck_write_conflict: "editorErrors.deckChanged",
  slide_source_edit_failed: "editorErrors.slideSaveFailed",
  slide_source_revision_exhausted: "editorErrors.slideSaveFailed",
  slide_source_integrity_error: "editorErrors.deckDataUnavailable",
  invalid_deck_data: "editorErrors.deckDataUnavailable",
  invalid_slide_data: "editorErrors.deckDataUnavailable",
  invalid_deck_slide_order: "editorErrors.deckDataUnavailable",
  duplicate_deck_slide_ids: "editorErrors.deckDataUnavailable",
  slide_source_owner_required: "editorErrors.signInRequired",
  comment_thread_resolved: "editorErrors.commentThreadResolved",
  target_slide_count_reached: "editorErrors.slideLimitReached",
} as const;

export type EditorActionErrorTranslationKey =
  | (typeof ACTION_ERROR_TRANSLATIONS)[keyof typeof ACTION_ERROR_TRANSLATIONS]
  | "editorErrors.commentAnchorChanged";

export function getEditorActionErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return undefined;
  }
  const code = (error as { errorCode?: unknown }).errorCode;
  return typeof code === "string" ? code : undefined;
}

export function getEditorActionErrorTranslationKey(
  error: unknown,
  context?: "comment-anchor",
): EditorActionErrorTranslationKey | undefined {
  const code = getEditorActionErrorCode(error);
  if (!code) return undefined;
  if (context === "comment-anchor" && code === "slide_source_conflict") {
    return "editorErrors.commentAnchorChanged";
  }
  return ACTION_ERROR_TRANSLATIONS[
    code as keyof typeof ACTION_ERROR_TRANSLATIONS
  ];
}
