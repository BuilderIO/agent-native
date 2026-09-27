export interface DocumentBodyIntent {
  operationId: string;
  writerId: string;
  generation?: number;
  authoredBaseRevision: number;
}

export interface CommittedDocumentBodyIntent extends DocumentBodyIntent {
  committedRevision: number;
}

export type DocumentIntentOrder =
  | "same"
  | "incoming-after"
  | "committed-after"
  | "incoming-concurrent-wins"
  | "committed-concurrent-wins";

export function compareDocumentBodyIntents(
  incoming: DocumentBodyIntent,
  committed: CommittedDocumentBodyIntent,
): DocumentIntentOrder {
  if (
    incoming.writerId === committed.writerId &&
    incoming.operationId === committed.operationId
  ) {
    return "same";
  }
  const incomingObservedCommitted =
    incoming.authoredBaseRevision >= committed.committedRevision;
  if (incomingObservedCommitted) return "incoming-after";

  if (
    incoming.writerId === committed.writerId &&
    incoming.generation !== undefined &&
    committed.generation !== undefined &&
    incoming.generation !== committed.generation
  ) {
    return incoming.generation > committed.generation
      ? "incoming-after"
      : "committed-after";
  }

  if (incoming.authoredBaseRevision < committed.authoredBaseRevision) {
    return "committed-after";
  }

  const incomingKey = `${incoming.writerId}\u0000${incoming.operationId}`;
  const committedKey = `${committed.writerId}\u0000${committed.operationId}`;
  return incomingKey > committedKey
    ? "incoming-concurrent-wins"
    : "committed-concurrent-wins";
}
