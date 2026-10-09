import type { Document } from "@shared/api";
import type { QueryClient } from "@tanstack/react-query";

import { documentQueryFilter } from "./document-query";

type DocumentCreationState = {
  pending: Set<string>;
  confirmed: Set<string>;
  baselines: Map<string, Document>;
};

const documentCreationStates = new WeakMap<
  QueryClient,
  DocumentCreationState
>();

function creationStateFor(queryClient: QueryClient) {
  let state = documentCreationStates.get(queryClient);
  if (state) return state;

  state = { pending: new Set(), confirmed: new Set(), baselines: new Map() };
  documentCreationStates.set(queryClient, state);
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "removed") return;
    const args = event.query.queryKey[2];
    if (!args || typeof args !== "object" || !("id" in args)) return;
    const { id } = args;
    if (
      typeof id === "string" &&
      queryClient.getQueryCache().findAll(documentQueryFilter(id)).length === 0
    ) {
      state!.pending.delete(id);
      state!.confirmed.delete(id);
      state!.baselines.delete(id);
    }
  });
  return state;
}

export function markDocumentCreationPending(
  queryClient: QueryClient,
  document: Document,
): Document {
  const state = creationStateFor(queryClient);
  state.pending.add(document.id);
  state.confirmed.delete(document.id);
  state.baselines.delete(document.id);
  return document;
}

export function isDocumentCreationPending(
  queryClient: QueryClient,
  document: Document,
): boolean {
  const state = documentCreationStates.get(queryClient);
  return Boolean(
    state?.pending.has(document.id) && !state.confirmed.has(document.id),
  );
}

export function clearDocumentCreationPending<T extends Pick<Document, "id">>(
  queryClient: QueryClient,
  document: T,
): T {
  documentCreationStates.get(queryClient)?.pending.delete(document.id);
  return document;
}

export function markDocumentCreationConfirmed(
  queryClient: QueryClient,
  document: Document,
): Document {
  const state = creationStateFor(queryClient);
  state.pending.delete(document.id);
  state.confirmed.add(document.id);
  state.baselines.set(document.id, document);
  return document;
}

export function getDocumentCreationBaseline(
  queryClient: QueryClient,
  document: Pick<Document, "id">,
): Document | undefined {
  return documentCreationStates.get(queryClient)?.baselines.get(document.id);
}

export function isDocumentCreationConfirmed(
  queryClient: QueryClient,
  document: Pick<Document, "id">,
): boolean {
  return (
    documentCreationStates.get(queryClient)?.confirmed.has(document.id) ?? false
  );
}

export function clearDocumentCreationConfirmed<T extends Pick<Document, "id">>(
  queryClient: QueryClient,
  document: T,
): T {
  const state = documentCreationStates.get(queryClient);
  state?.confirmed.delete(document.id);
  state?.baselines.delete(document.id);
  return document;
}

export function shouldCreateDocumentOptimistically(args: {
  localFileMode: boolean;
  filesDatabaseId?: string;
}): boolean {
  return !args.localFileMode || Boolean(args.filesDatabaseId);
}
