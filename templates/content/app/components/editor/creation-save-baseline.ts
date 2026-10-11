import type { Document } from "@shared/api";

type ContentBase = {
  content: string;
  updatedAt: string | null;
  revision?: string;
};

type AuthoredContentIntent = {
  editGeneration: number;
  baseRevision?: string;
  baseContent: string;
  candidateContent: string;
};

type PendingCreationSave = {
  content: string;
  contentBase: ContentBase;
  contentAuthoredAfterRevision?: string;
  authoredContentIntent?: AuthoredContentIntent;
  editGeneration: number;
  titleBase: string;
};

type PreparedCreationSave = {
  contentBase: ContentBase;
  contentAuthoredAfterRevision?: string;
  authoredContentIntent?: AuthoredContentIntent;
  titleBase: string;
};

export function prepareInitialCreationSave(args: {
  pending: PendingCreationSave;
  creationBaseline?: Document;
  observedDocument: Document;
}): PreparedCreationSave {
  const { pending, creationBaseline, observedDocument } = args;
  if (pending.content === observedDocument.content) {
    return {
      contentBase: {
        content: observedDocument.content,
        updatedAt: observedDocument.updatedAt ?? null,
        revision: observedDocument.revision,
      },
      contentAuthoredAfterRevision: observedDocument.revision,
      titleBase: pending.titleBase,
    };
  }

  const pendingContentBase = pending.contentBase;
  const contentBaseMatchesCreation =
    creationBaseline &&
    pendingContentBase.content === creationBaseline.content &&
    (!pendingContentBase.revision ||
      pendingContentBase.revision === creationBaseline.revision);
  const contentBase =
    !pendingContentBase.revision && contentBaseMatchesCreation
      ? {
          content: creationBaseline.content,
          updatedAt: creationBaseline.updatedAt ?? null,
          revision: creationBaseline.revision,
        }
      : pendingContentBase;

  const pendingIntent = pending.authoredContentIntent;
  const intentBaseContent =
    pendingIntent?.baseContent ?? pendingContentBase.content;
  const intentBaseRevision =
    pendingIntent?.baseRevision ??
    (pendingContentBase.content === intentBaseContent
      ? pendingContentBase.revision
      : undefined);
  const intentBaseMatchesCreation =
    creationBaseline &&
    intentBaseContent === creationBaseline.content &&
    (!intentBaseRevision || intentBaseRevision === creationBaseline.revision);
  const authoredContentIntent =
    pending.content === contentBase.content
      ? undefined
      : {
          ...pendingIntent,
          editGeneration: pending.editGeneration,
          baseRevision:
            intentBaseRevision ??
            (intentBaseMatchesCreation ? creationBaseline.revision : undefined),
          baseContent: intentBaseContent,
          candidateContent: pending.content,
        };

  return {
    contentBase,
    contentAuthoredAfterRevision:
      pending.contentAuthoredAfterRevision ??
      authoredContentIntent?.baseRevision ??
      contentBase.revision,
    authoredContentIntent,
    titleBase: pending.titleBase,
  };
}
