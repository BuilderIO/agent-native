export function creationSaveBarrierIsSettled(input: {
  saveQueueUnchanged: boolean;
  editGenerationUnchanged: boolean;
  hasPendingSave: boolean;
  hasDebounceTimer: boolean;
  hasRetry: boolean;
  hasCollaborationSeedBody: boolean;
  activeContentSaveCount: number;
  pendingPersistenceCount: number;
  localTitle: string;
  savedTitle: string;
  documentTitle: string;
  localContent: string;
  savedContent: string;
  documentContent: string;
}) {
  return (
    input.saveQueueUnchanged &&
    input.editGenerationUnchanged &&
    !input.hasPendingSave &&
    !input.hasDebounceTimer &&
    !input.hasRetry &&
    input.hasCollaborationSeedBody &&
    input.activeContentSaveCount === 0 &&
    input.pendingPersistenceCount === 0 &&
    input.localTitle === input.savedTitle &&
    input.localTitle === input.documentTitle &&
    input.localContent === input.savedContent &&
    input.localContent === input.documentContent
  );
}
