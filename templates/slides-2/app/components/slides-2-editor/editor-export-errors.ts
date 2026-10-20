import { isSourceRuntimeExportError } from "@shared/source-runtime-export";

import {
  getEditorActionErrorCode,
  getEditorActionErrorTranslationKey,
  type EditorActionErrorTranslationKey,
} from "./editor-action-errors";
import {
  getSandboxRenderErrorKey,
  type SandboxRenderErrorKey,
} from "./sandbox-render-errors";

const EXPORT_ACTION_ERROR_TRANSLATIONS = {
  empty_deck: "editorExport.exportFailed",
  export_revision_stale: "editorErrors.deckChanged",
  pptx_image_unavailable: "editorExport.pptxImageUnavailable",
} as const;
const EDITOR_EXPORT_ACTION_ERROR_CODES = new Set([
  "deck_not_found",
  "not_authenticated",
  "slide_not_found",
  "slide_source_missing",
  "slide_source_conflict",
  "slide_source_integrity_error",
  "slide_source_owner_required",
  "invalid_deck_data",
  "invalid_slide_data",
  "invalid_deck_slide_order",
  "deck_revision_conflict",
  "deck_write_conflict",
]);

export type EditorExportErrorTranslationKey =
  | EditorActionErrorTranslationKey
  | SandboxRenderErrorKey
  | "editorExport.sourceRuntimeExportUnavailable"
  | "editorExport.pptxImageUnavailable";

export function getEditorExportErrorTranslationKey(
  error: unknown,
): EditorExportErrorTranslationKey {
  const sandboxErrorKey = getSandboxRenderErrorKey(error);
  if (sandboxErrorKey) return sandboxErrorKey;
  if (isSourceRuntimeExportError(error)) {
    return "editorExport.sourceRuntimeExportUnavailable";
  }

  const errorCode = getEditorActionErrorCode(error);
  if (errorCode && errorCode in EXPORT_ACTION_ERROR_TRANSLATIONS) {
    return EXPORT_ACTION_ERROR_TRANSLATIONS[
      errorCode as keyof typeof EXPORT_ACTION_ERROR_TRANSLATIONS
    ];
  }
  if (errorCode && EDITOR_EXPORT_ACTION_ERROR_CODES.has(errorCode)) {
    const actionErrorKey = getEditorActionErrorTranslationKey(error);
    if (actionErrorKey) return actionErrorKey;
  }

  return "editorExport.exportFailed";
}
