import { planDocReconcile } from "@agent-native/toolkit/editor";
import type { Document } from "@shared/api";
import { docToNfm, nfmToDoc } from "@shared/nfm";
import { getSchema } from "@tiptap/core";

import {
  isDocumentUpdateConflict,
  isDocumentUpdatePreservationRequired,
  isDocumentUpdateSuperseded,
} from "@/hooks/use-documents";
import type {
  DocumentUpdateConflictResponse,
  DocumentUpdatePreservationResponse,
  DocumentUpdateSupersededResponse,
} from "@/hooks/use-documents";

import { createVisualEditorExtensions } from "./VisualEditor";

export type DocumentContentBase = {
  content: string;
  updatedAt: string | null;
  revision?: string;
};
export type RebasedDocumentSaveResult =
  | { status: "saved"; document: Document; content: string }
  | { status: "displaced"; document: Document; localDraft: string }
  | { status: "superseded"; document: Document }
  | {
      status: "preservation";
      localDraft: string;
      base: DocumentContentBase;
      checkpointId: string;
    }
  | { status: "conflict"; localDraft: string; base?: DocumentContentBase };

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
  ) => Promise<
    | Document
    | DocumentUpdateConflictResponse
    | DocumentUpdateSupersededResponse
    | DocumentUpdatePreservationResponse
  >;
  canRetry?: (winner: Document) => boolean;
  confirmsWrite?: (winner: Document) => boolean;
  owner?: {
    version: number;
    observationEpoch?: number;
    current: () => {
      version: number;
      content: string;
      observationEpoch?: number;
    };
    canPreferLive: (winner: Document) => boolean;
    confirm: (content: string) => void;
  };
}): Promise<RebasedDocumentSaveResult> {
  let attemptedBase = base;
  let candidate = content;
  const ownsCurrentSnapshot = () => {
    if (!owner) return false;
    const current = owner.current();
    return (
      current.version === owner.version &&
      current.observationEpoch === owner.observationEpoch
    );
  };
  const conflict = (): RebasedDocumentSaveResult => {
    const current = owner?.current();
    return {
      status: "conflict",
      localDraft:
        current && !ownsCurrentSnapshot() ? current.content : candidate,
      base: current && !ownsCurrentSnapshot() ? undefined : attemptedBase,
    };
  };
  const confirmed = (document: Document): RebasedDocumentSaveResult => {
    if (owner && ownsCurrentSnapshot()) owner.confirm(document.content);
    return { status: "saved", document, content: document.content };
  };
  for (let attempt = 0; attempt <= 2; attempt++) {
    const saved = await persist(candidate, attemptedBase);
    if (isDocumentUpdateSuperseded(saved)) {
      return { status: "superseded", document: saved.document };
    }
    if (isDocumentUpdatePreservationRequired(saved)) {
      return {
        status: "preservation",
        localDraft: candidate,
        base: attemptedBase,
        checkpointId: saved.checkpointId,
      };
    }
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
      let plan = planDocReconcile(
        localDoc,
        contentSchema.nodeFromJSON(nfmToDoc(attemptedBase.content)),
        contentSchema.nodeFromJSON(nfmToDoc(winner.content)),
      );
      if (
        plan.status === "conflict" &&
        owner &&
        ownsCurrentSnapshot() &&
        owner.canPreferLive(winner)
      ) {
        plan = planDocReconcile(
          localDoc,
          contentSchema.nodeFromJSON(nfmToDoc(attemptedBase.content)),
          contentSchema.nodeFromJSON(nfmToDoc(winner.content)),
          { overlapPolicy: "prefer-live" },
        );
      } else if (plan.status === "conflict" && owner) {
        if (!ownsCurrentSnapshot()) {
          return { status: "superseded", document: winner };
        }
        // This queued operation was not authored from the winning revision.
        // Preserve it as displaced work before adopting the canonical winner.
        return { status: "displaced", document: winner, localDraft: candidate };
      }
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
