import type { Document } from "@shared/api";

const pendingDocumentCreation = Symbol("pendingDocumentCreation");

type PendingDocument = Document & {
  [pendingDocumentCreation]?: true;
};

export function markDocumentCreationPending(document: Document): Document {
  return Object.assign(document, { [pendingDocumentCreation]: true as const });
}

export function isDocumentCreationPending(document: Document): boolean {
  return (document as PendingDocument)[pendingDocumentCreation] === true;
}

export function isDatabaseChoicePending(
  document: Document,
  databaseCreationPending: boolean,
): boolean {
  return databaseCreationPending || isDocumentCreationPending(document);
}

export function shouldCreateDocumentOptimistically(args: {
  localFileMode: boolean;
  filesDatabaseId?: string;
}): boolean {
  return !args.localFileMode || Boolean(args.filesDatabaseId);
}
