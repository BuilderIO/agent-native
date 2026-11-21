import {
  actionErrorMessage,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import type {
  BuilderArticleRowStatus,
  ListBuilderArticleAutosavesResponse,
} from "@shared/api";
import { useEffect, useState, useSyncExternalStore } from "react";

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
export const BUILDER_AUTOSAVE_RUN_RETRY_MS = 30_000;

const running = new Set<string>();
const failures = new Map<string, { at: number; error: string }>();
const followUps = new Map<string, number>();
const listeners = new Set<() => void>();
let busy = false;

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function retryWaitMs(documentId: string, now: number) {
  const failure = failures.get(documentId);
  const followUp = followUps.get(documentId);
  return Math.max(
    failure ? failure.at + BUILDER_AUTOSAVE_RUN_RETRY_MS - now : 0,
    followUp === undefined
      ? 0
      : followUp + BUILDER_AUTOSAVE_ACTIVE_POLL_MS - now,
  );
}

export function builderArticleAutosaveRows(
  data: ListBuilderArticleAutosavesResponse | undefined,
): BuilderArticleRowStatus[] {
  return Array.isArray(data?.rows) ? data.rows : [];
}

export function builderAutosavePollMs(
  data: ListBuilderArticleAutosavesResponse | undefined,
) {
  const now = Date.now();
  const active = builderArticleAutosaveRows(data).some(
    (row) =>
      running.has(row.documentId) ||
      (row.autosave?.enabled === true &&
        (row.autosave.state === "saving" ||
          row.autosave.dueSoon ||
          (row.autosave.due &&
            row.autosave.canSave &&
            retryWaitMs(row.documentId, now) <= 0))),
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
  { poll = true }: { poll?: boolean } = {},
) {
  return useActionQuery<ListBuilderArticleAutosavesResponse>(
    LIST_ACTION,
    target ?? undefined,
    {
      enabled: !!target,
      uiOnly: true,
      refetchInterval: poll
        ? (query) => builderAutosavePollMs(query.state.data)
        : false,
    },
  );
}

export function useBuilderAutosaveRunning(documentId: string) {
  return useSyncExternalStore(
    subscribe,
    () => running.has(documentId),
    () => false,
  );
}

export function useBuilderAutosaveRunError(documentId: string) {
  return useSyncExternalStore(
    subscribe,
    () => failures.get(documentId)?.error ?? null,
    () => null,
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
  const [recheck, setRecheck] = useState(0);
  useEffect(() => {
    if (!rows) return;
    let cleared = false;
    for (const row of rows) {
      if (row.autosave?.due) continue;
      followUps.delete(row.documentId);
      if (failures.delete(row.documentId)) cleared = true;
    }
    if (cleared) notify();
    if (busy) return;
    const now = Date.now();
    const due = rows.filter(
      (row) =>
        row.autosave?.due &&
        row.autosave.canSave &&
        !running.has(row.documentId),
    );
    const next = due.find((row) => retryWaitMs(row.documentId, now) <= 0);
    if (!next) {
      const waits = due.map((row) => retryWaitMs(row.documentId, now));
      if (waits.length === 0) return;
      const timer = setTimeout(
        () => setRecheck((count) => count + 1),
        Math.min(...waits),
      );
      return () => clearTimeout(timer);
    }
    busy = true;
    running.add(next.documentId);
    notify();
    followUps.delete(next.documentId);
    void mutateAsync(builderArticleRowIdentity(next))
      .then(
        (saved) => {
          failures.delete(next.documentId);
          if (saved.autosave?.due) followUps.set(next.documentId, Date.now());
        },
        (error: unknown) => {
          failures.set(next.documentId, {
            at: Date.now(),
            error: actionErrorMessage(error) ?? "",
          });
        },
      )
      .finally(() => {
        busy = false;
        running.delete(next.documentId);
        notify();
        if (followUps.has(next.documentId) || failures.has(next.documentId)) {
          setRecheck((count) => count + 1);
        }
      });
  }, [rows, mutateAsync, recheck]);
}
