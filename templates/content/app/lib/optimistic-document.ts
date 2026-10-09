import type { Document } from "@shared/api";

const pendingDocumentCreation = Symbol("pendingDocumentCreation");
const confirmedDocumentCreation = Symbol("confirmedDocumentCreation");

type PendingDocument = Document & {
  [pendingDocumentCreation]?: true;
};
type ConfirmedDocument = Document & {
  [confirmedDocumentCreation]?: true;
};

export function markDocumentCreationPending(document: Document): Document {
  return Object.assign(document, { [pendingDocumentCreation]: true as const });
}

export function isDocumentCreationPending(document: Document): boolean {
  return (document as PendingDocument)[pendingDocumentCreation] === true;
}

export function markDocumentCreationConfirmed(document: Document): Document {
  return Object.assign(
    { ...document },
    {
      [confirmedDocumentCreation]: true as const,
    },
  );
}

export function isDocumentCreationConfirmed(document: Document): boolean {
  return (document as ConfirmedDocument)[confirmedDocumentCreation] === true;
}

export function clearDocumentCreationConfirmed(document: Document): Document {
  if (!isDocumentCreationConfirmed(document)) return document;
  const clean = { ...document } as ConfirmedDocument;
  delete clean[confirmedDocumentCreation];
  return clean;
}

export function shouldCreateDocumentOptimistically(args: {
  localFileMode: boolean;
  filesDatabaseId?: string;
}): boolean {
  return !args.localFileMode || Boolean(args.filesDatabaseId);
}
