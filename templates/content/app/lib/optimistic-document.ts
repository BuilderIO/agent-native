import type { Document } from "@shared/api";

const pendingDocumentCreation = Symbol("pendingDocumentCreation");
const confirmedDocumentCreations = new Set<string>();

type PendingDocument = Document & {
  [pendingDocumentCreation]?: true;
};
export function markDocumentCreationPending(document: Document): Document {
  return Object.assign(document, { [pendingDocumentCreation]: true as const });
}

export function isDocumentCreationPending(document: Document): boolean {
  return (
    (document as PendingDocument)[pendingDocumentCreation] === true &&
    !confirmedDocumentCreations.has(document.id)
  );
}

export function markDocumentCreationConfirmed(document: Document): Document {
  confirmedDocumentCreations.add(document.id);
  return document;
}

export function isDocumentCreationConfirmed(document: Document): boolean {
  return confirmedDocumentCreations.has(document.id);
}

export function clearDocumentCreationConfirmed<T extends Pick<Document, "id">>(
  document: T,
): T {
  confirmedDocumentCreations.delete(document.id);
  return document;
}

export function shouldCreateDocumentOptimistically(args: {
  localFileMode: boolean;
  filesDatabaseId?: string;
}): boolean {
  return !args.localFileMode || Boolean(args.filesDatabaseId);
}
