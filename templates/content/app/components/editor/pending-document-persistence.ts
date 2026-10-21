export type DocumentPersistenceIdentity = {
  editorSessionId?: string;
  editGeneration?: number;
  saveAttemptId?: string;
  persistenceSequence?: number;
};

export type DocumentPersistenceFailure = DocumentPersistenceIdentity & {
  error: unknown;
};

export function settleAcceptedDocumentPersistence<Field>(
  failures: Map<Field, DocumentPersistenceFailure>,
  fields: readonly Field[],
  accepted: DocumentPersistenceIdentity,
): void {
  for (const field of fields) {
    const failure = failures.get(field);
    if (!failure || failure.editorSessionId !== accepted.editorSessionId)
      continue;
    const coveredGeneration =
      accepted.editGeneration !== undefined &&
      failure.editGeneration !== undefined &&
      (failure.editGeneration < accepted.editGeneration ||
        (failure.editGeneration === accepted.editGeneration &&
          failure.saveAttemptId === accepted.saveAttemptId));
    const coveredRequest =
      accepted.editGeneration === failure.editGeneration &&
      accepted.persistenceSequence !== undefined &&
      failure.persistenceSequence !== undefined &&
      failure.persistenceSequence <= accepted.persistenceSequence;
    if (coveredGeneration || coveredRequest) failures.delete(field);
  }
}

export function trackPendingDocumentPersistence<T>(
  pending: Set<Promise<unknown>>,
  request: Promise<T>,
  onResolved: (result: T) => void,
  onRejected: (error: unknown) => void,
): Promise<void> {
  const settled = request.then(onResolved, onRejected);
  const tracked = settled.finally(() => pending.delete(tracked));
  pending.add(tracked);
  return tracked;
}
