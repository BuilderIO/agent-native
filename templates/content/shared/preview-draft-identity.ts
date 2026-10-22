export interface PreviewDraftIdentity {
  id: string;
  editorSessionId: string | null;
  editGeneration: number | null;
}

export function expectedPreviewDraftIdentity(draft: PreviewDraftIdentity) {
  return {
    expectedDraftId: draft.id,
    expectedDraftEditorSessionId: draft.editorSessionId,
    expectedDraftEditGeneration: draft.editGeneration,
  };
}
