import { planDocReconcile } from "@agent-native/toolkit/editor";
import type { Document } from "@shared/api";
import { nfmToDoc } from "@shared/nfm";
import { getSchema } from "@tiptap/core";

import { isDocumentUpdateConflict } from "@/hooks/use-documents";
import type { DocumentUpdateConflictResponse } from "@/hooks/use-documents";

import { createVisualEditorExtensions } from "./VisualEditor";

export type DocumentContentBase = { content: string; updatedAt: string | null };
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
  const draft = content;
  const conflict = (): RebasedDocumentSaveResult => {
    const current = owner?.current();
    return {
      status: "conflict",
      localDraft:
        current && current.version !== owner!.version ? current.content : draft,
    };
  };
  const confirmed = (document: Document): RebasedDocumentSaveResult => {
    if (owner && owner.current().version === owner.version)
      owner.confirm(document.content);
    return { status: "saved", document, content: document.content };
  };
  for (let attempt = 0; attempt <= 2; attempt++) {
    const saved = await persist(draft, attemptedBase);
    if (!isDocumentUpdateConflict(saved)) {
      return confirmed(saved);
    }
    const winner = saved.document;
    if (winner.content === draft && confirmsWrite(winner)) {
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
      const localDoc = contentSchema.nodeFromJSON(nfmToDoc(draft));
      const plan = planDocReconcile(
        localDoc,
        contentSchema.nodeFromJSON(nfmToDoc(attemptedBase.content)),
        contentSchema.nodeFromJSON(nfmToDoc(winner.content)),
      );
      // Only advance the CAS base when the editor already contains the winner.
      // A server-only change must reach the live Y.Doc through its elected
      // reconciler before later keystrokes can safely include that change.
      if (plan.status !== "noop") {
        return conflict();
      }
      attemptedBase = { content: winner.content, updatedAt: winner.updatedAt };
    } catch {
      return conflict();
    }
  }
  return conflict();
}
