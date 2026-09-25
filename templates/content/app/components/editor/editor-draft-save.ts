export type EditorDraftSaveResult =
  | boolean
  | "persisted"
  | "retained"
  | "scheduled"
  | "unchanged"
  | "failed";

export function isEditorDraftSaveAccepted(
  result: EditorDraftSaveResult,
): boolean {
  return result !== false && result !== "failed";
}
