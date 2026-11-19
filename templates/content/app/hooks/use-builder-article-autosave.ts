import { useActionQuery } from "@agent-native/core/client/hooks";
import type {
  BuilderArticleRowStatus,
  ListBuilderArticleAutosavesResponse,
} from "@shared/api";
import { useEffect, useSyncExternalStore } from "react";

import {
  useContentActionMutation,
  type ContentQueryTarget,
} from "./use-content-action-mutation";
import {
  contentDatabaseConstrainedQueryFilter,
  contentDatabaseItemsContainingDocumentFilter,
} from "./use-content-database";

const LIST_ACTION = "list-builder-article-autosaves";

export const BUILDER_AUTOSAVE_ACTIVE_POLL_MS = 3_000;
export const BUILDER_AUTOSAVE_IDLE_POLL_MS = 30_000;

export function builderAutosavePollMs(
  data: ListBuilderArticleAutosavesResponse | undefined,
) {
  const active = data?.rows.some(
    (row) =>
      row.autosave?.enabled &&
      row.autosave.state !== "failed" &&
      row.autosave.state !== "review",
  );
  return active
    ? BUILDER_AUTOSAVE_ACTIVE_POLL_MS
    : BUILDER_AUTOSAVE_IDLE_POLL_MS;
}

export type BuilderArticleAutosaveTarget =
  | { documentId: string }
  | { rowDocumentId: string; databaseId?: string };

export function builderArticleRowTarget(
  rowDocumentId: string,
  databaseId: string | null | undefined,
): BuilderArticleAutosaveTarget {
  return databaseId ? { rowDocumentId, databaseId } : { rowDocumentId };
}

export interface BuilderArticleRowIdentity {
  rowDocumentId: string;
  databaseId?: string;
  sourceId?: string;
}

export function builderArticleRowIdentity(
  row: BuilderArticleRowStatus,
): BuilderArticleRowIdentity {
  return {
    rowDocumentId: row.documentId,
    databaseId: row.databaseId,
    sourceId: row.sourceId,
  };
}

export function useBuilderArticleAutosaves(
  target: BuilderArticleAutosaveTarget | null,
) {
  return useActionQuery<ListBuilderArticleAutosavesResponse>(
    LIST_ACTION,
    target ?? undefined,
    {
      enabled: !!target,
      uiOnly: true,
      refetchInterval: (query) => builderAutosavePollMs(query.state.data),
    },
  );
}

const running = new Set<string>();
const listeners = new Set<() => void>();
let busy = false;

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBuilderAutosaveRunning(documentId: string) {
  return useSyncExternalStore(
    subscribe,
    () => running.has(documentId),
    () => false,
  );
}

function rowTargets(documentId: string): ContentQueryTarget[] {
  return [
    ["action", LIST_ACTION],
    ["action", "list-document-properties"],
    ["action", "get-content-database-source"],
    contentDatabaseConstrainedQueryFilter(),
    contentDatabaseItemsContainingDocumentFilter(documentId),
  ];
}

export function useRunBuilderArticleAutosave() {
  return useContentActionMutation<
    BuilderArticleRowStatus,
    BuilderArticleRowIdentity & { retry?: boolean }
  >("run-builder-article-autosave", {
    invalidates: (_data, variables) => rowTargets(variables.rowDocumentId),
  });
}

export function useSetBuilderArticleAutosave() {
  return useContentActionMutation<
    BuilderArticleRowStatus,
    BuilderArticleRowIdentity & { enabled: boolean }
  >("set-builder-article-autosave", {
    invalidates: [["action", LIST_ACTION]],
  });
}

export function useBuilderArticleAutosaveRunner(
  rows: BuilderArticleRowStatus[] | undefined,
) {
  const { mutateAsync } = useRunBuilderArticleAutosave();
  useEffect(() => {
    if (busy || !rows) return;
    const next = rows.find(
      (row) => row.autosave?.due && !running.has(row.documentId),
    );
    if (!next) return;
    busy = true;
    running.add(next.documentId);
    notify();
    void mutateAsync(builderArticleRowIdentity(next))
      .catch(() => {})
      .finally(() => {
        busy = false;
        running.delete(next.documentId);
        notify();
      });
  }, [rows, mutateAsync]);
}
