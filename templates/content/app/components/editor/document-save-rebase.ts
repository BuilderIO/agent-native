import { planDocReconcile } from "@agent-native/toolkit/editor";
import type { Document } from "@shared/api";
import { docToNfm, nfmToDoc } from "@shared/nfm";
import { getSchema } from "@tiptap/core";

import { isDocumentUpdateConflict } from "@/hooks/use-documents";
import type { DocumentUpdateConflictResponse } from "@/hooks/use-documents";

import { createVisualEditorExtensions } from "./VisualEditor";

export type DocumentContentBase = {
  content: string;
  updatedAt: string | null;
  revision?: string;
};
export type RebasedDocumentSaveResult =
  | { status: "saved"; document: Document; content: string }
  | { status: "conflict"; localDraft: string };

let contentSchema: ReturnType<typeof getSchema> | undefined;

export async function saveDocumentWithRebase({
  base,
  content,
  persist,
  canRetry = () => true,
  confirmsWrite = () => true,
  owner,
}: {
  base: DocumentContentBase;
  content: string;
  persist: (
    content: string,
    base: DocumentContentBase,
  ) => Promise<Document | DocumentUpdateConflictResponse>;
  canRetry?: (winner: Document) => boolean;
  confirmsWrite?: (winner: Document) => boolean;
  owner?: {
    version: number;
    current: () => { version: number; content: string };
    confirm: (content: string) => void;
  };
}): Promise<RebasedDocumentSaveResult> {
  let attemptedBase = base;
  let candidate = content;
  const conflict = (): RebasedDocumentSaveResult => {
    const current = owner?.current();
    return {
      status: "conflict",
      localDraft:
        current && current.version !== owner!.version
          ? current.content
          : candidate,
    };
  };
  const confirmed = (document: Document): RebasedDocumentSaveResult => {
    if (owner && owner.current().version === owner.version)
      owner.confirm(document.content);
    return { status: "saved", document, content: document.content };
  };
  for (let attempt = 0; attempt <= 2; attempt++) {
    const saved = await persist(candidate, attemptedBase);
    if (!isDocumentUpdateConflict(saved)) {
      return confirmed(saved);
    }
    const winner = saved.document;
    if (winner.content === candidate && confirmsWrite(winner)) {
      return confirmed(winner);
    }
    if (
      !attemptedBase.updatedAt ||
      !winner.updatedAt ||
      attempt === 2 ||
      !canRetry(winner)
    ) {
      return conflict();
    }
    try {
      contentSchema ??= getSchema(createVisualEditorExtensions());
      const localDoc = contentSchema.nodeFromJSON(nfmToDoc(candidate));
      const plan = planDocReconcile(
        localDoc,
        contentSchema.nodeFromJSON(nfmToDoc(attemptedBase.content)),
        contentSchema.nodeFromJSON(nfmToDoc(winner.content)),
      );
      // Carry an unambiguous three-way merge into the retry. Ambiguous edits
      // still need recovery because choosing either side would discard work.
      if (plan.status === "applied") {
        candidate = docToNfm(plan.mergedDoc.toJSON());
      } else if (plan.status !== "noop") {
        return conflict();
      }
      attemptedBase = {
        content: winner.content,
        updatedAt: winner.updatedAt,
        revision: winner.revision,
      };
    } catch {
      return conflict();
    }
  }
  return conflict();
}
