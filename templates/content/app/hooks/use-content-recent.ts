import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import { scheduleAfterStartup } from "@agent-native/core/client/use-after-paint";
import {
  CONTENT_RECENT_LIMIT,
  contentRecentTargetKey,
  contentRecentVisitKey,
  type ContentRecentResult,
  type ContentRecentTarget,
} from "@shared/content-personal-navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const contentRecentRecoveries = new WeakMap<
  ReturnType<typeof useQueryClient>,
  Map<string, Promise<void>>
>();

function recoverContentRecentScope(
  queryClient: ReturnType<typeof useQueryClient>,
  scopeKey: string,
  refresh: () => Promise<void>,
) {
  let recoveries = contentRecentRecoveries.get(queryClient);
  if (!recoveries) {
    recoveries = new Map();
    contentRecentRecoveries.set(queryClient, recoveries);
  }
  const recovery = recoveries.get(scopeKey);
  if (recovery) return recovery;

  let nextRecovery: Promise<void>;
  nextRecovery = Promise.resolve()
    .then(refresh)
    .finally(() => {
      if (recoveries.get(scopeKey) === nextRecovery) {
        recoveries.delete(scopeKey);
      }
    });
  recoveries.set(scopeKey, nextRecovery);
  return nextRecovery;
}

function contentRecentScopeKey(
  org: ReturnType<typeof useOrg>["data"],
  spaceId?: string,
) {
  if (!org) return undefined;
  return JSON.stringify([
    org.email.trim().toLowerCase(),
    org.orgId ?? null,
    spaceId ?? null,
  ]);
}

export function contentRecentQueryArgs(
  scopeKey: string | undefined,
  spaceId?: string,
) {
  if (!scopeKey) return undefined;
  return { scopeKey, ...(spaceId ? { spaceId } : {}) };
}

export function isContentRecentContextChanged(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { errorCode?: unknown }).errorCode === "context_changed"
  );
}

export function useContentRecent(
  spaceId?: string,
  options: { enabled?: boolean } = {},
) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const scopeKey = contentRecentScopeKey(org.data, spaceId);
  const args = useMemo(
    () => contentRecentQueryArgs(scopeKey, spaceId),
    [scopeKey, spaceId],
  );
  const query = useActionQuery("get-content-recent", args, {
    enabled: (options.enabled ?? true) && Boolean(scopeKey) && !org.isFetching,
    placeholderData: undefined,
  });
  const [refreshingScopes, setRefreshingScopes] = useState<Set<string>>(
    () => new Set(),
  );
  const resyncedScopesRef = useRef(new Set<string>());
  const contextChanged = isContentRecentContextChanged(query.error);

  useEffect(() => {
    if (!contextChanged) {
      if (scopeKey) {
        resyncedScopesRef.current.delete(scopeKey);
      }
      return;
    }
    if (!scopeKey) return;
    if (resyncedScopesRef.current.has(scopeKey)) return;

    resyncedScopesRef.current.add(scopeKey);
    setRefreshingScopes((current) => new Set(current).add(scopeKey));
    void recoverContentRecentScope(queryClient, scopeKey, async () => {
      try {
        const refreshedOrg = await org.refetch({ cancelRefetch: false });
        if (refreshedOrg.isError) return;
        const refreshedArgs = contentRecentQueryArgs(
          contentRecentScopeKey(refreshedOrg.data, spaceId),
          spaceId,
        );
        if (!refreshedArgs) return;
        await queryClient.invalidateQueries(
          {
            queryKey: ["action", "get-content-recent", refreshedArgs],
            exact: true,
          },
          { cancelRefetch: false },
        );
      } catch (error) {
        console.warn(
          "Could not refresh the Content Recent context after a scope mismatch.",
          error,
        );
      }
    }).finally(() => {
      setRefreshingScopes((current) => {
        if (!current.has(scopeKey)) return current;
        const next = new Set(current);
        next.delete(scopeKey);
        return next;
      });
    });
  }, [
    contextChanged,
    org.refetch,
    query.error,
    query.isError,
    queryClient,
    scopeKey,
    spaceId,
  ]);

  const refetch = useCallback(
    (...args: Parameters<typeof query.refetch>) => {
      if (contextChanged && scopeKey) {
        resyncedScopesRef.current.delete(scopeKey);
        contentRecentRecoveries.get(queryClient)?.delete(scopeKey);
      }
      return query.refetch(...args);
    },
    [contextChanged, query.refetch, scopeKey],
  );

  const recoveringContext =
    contextChanged &&
    (!scopeKey ||
      refreshingScopes.has(scopeKey) ||
      !resyncedScopesRef.current.has(scopeKey));
  return {
    ...query,
    refetch,
    data:
      !org.isFetching && query.data?.scopeKey === scopeKey
        ? query.data
        : undefined,
    isLoading:
      org.isLoading || org.isFetching || query.isLoading || recoveringContext,
    isError: org.isError || (query.isError && !recoveringContext),
  };
}

type ContentRecentQueryData = {
  scopeKey: string;
  entries: ContentRecentResult[];
};

export function setCachedRecentPinnedState(
  queryClient: ReturnType<typeof useQueryClient>,
  documentId: string,
  isFavorite: boolean,
) {
  queryClient.setQueriesData<ContentRecentQueryData>(
    { queryKey: ["action", "get-content-recent"] },
    (current) =>
      current
        ? {
            ...current,
            entries: current.entries.map((entry) =>
              entry.target.documentId === documentId
                ? { ...entry, isFavorite }
                : entry,
            ),
          }
        : current,
  );
}

export function useRemoveContentRecent() {
  const queryClient = useQueryClient();
  const t = useT();
  const mutation = useActionMutation("remove-content-recent", {
    skipActionQueryInvalidation: true,
  });
  const mutationRef = useRef(mutation);
  mutationRef.current = mutation;
  return useCallback(
    (target: ContentRecentTarget) => {
      const queryKey = ["action", "get-content-recent"];
      const key = contentRecentTargetKey(target);
      const removed = new Map<
        string,
        { index: number; entry: ContentRecentQueryData["entries"][number] }
      >();
      for (const [
        cachedKey,
        data,
      ] of queryClient.getQueriesData<ContentRecentQueryData>({ queryKey })) {
        const index =
          data?.entries.findIndex(
            (entry) => contentRecentTargetKey(entry.target) === key,
          ) ?? -1;
        if (data && index >= 0) {
          removed.set(JSON.stringify(cachedKey), {
            index,
            entry: data.entries[index],
          });
        }
      }
      queryClient.setQueriesData<ContentRecentQueryData>(
        { queryKey },
        (current) =>
          current
            ? {
                ...current,
                entries: current.entries.filter(
                  (entry) => contentRecentTargetKey(entry.target) !== key,
                ),
              }
            : current,
      );
      mutationRef.current.mutate(target, {
        onError: () => {
          for (const [
            cachedKey,
            data,
          ] of queryClient.getQueriesData<ContentRecentQueryData>({
            queryKey,
          })) {
            const restore = removed.get(JSON.stringify(cachedKey));
            if (
              !data ||
              !restore ||
              data.entries.some(
                (entry) => contentRecentTargetKey(entry.target) === key,
              )
            ) {
              continue;
            }
            const entries = [...data.entries];
            entries.splice(
              Math.min(restore.index, entries.length),
              0,
              restore.entry,
            );
            queryClient.setQueryData(cachedKey, { ...data, entries });
          }
          toast.error(t("sidebar.failedRemoveFromRecent"));
        },
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey });
        },
      });
    },
    [queryClient, t],
  );
}

/**
 * Gives a visited entry the server's visit time in every cached Recent list
 * of the account and organization it was stored under, and moves it to its
 * place by that time, as the server just did. An answer older than the visit
 * a list already shows changes nothing, so answers that arrive out of order
 * keep the later visit first. Lists of another organization are left alone:
 * the server keeps Recent per organization. Returns false when one of those
 * lists lacks the entry: that list needs the server's title and icon.
 */
export function moveCachedRecentVisit(
  queryClient: ReturnType<typeof useQueryClient>,
  target: ContentRecentTarget,
  visitedAt: string,
  accountKey: string,
): boolean {
  const key = contentRecentTargetKey(target);
  const visitKey = contentRecentVisitKey(target);
  // A scope key is `[email, orgId, spaceId]` as JSON and the account key is
  // `[email, orgId]`, so the account's lists in every space share this prefix.
  const scopePrefix = `${accountKey.slice(0, -1)},`;
  let complete = true;
  for (const [
    cachedKey,
    data,
  ] of queryClient.getQueriesData<ContentRecentQueryData>({
    queryKey: ["action", "get-content-recent"],
  })) {
    if (!data?.scopeKey.startsWith(scopePrefix)) continue;
    const entry = data.entries.find(
      (candidate) => contentRecentTargetKey(candidate.target) === key,
    );
    if (!entry || contentRecentVisitKey(entry.target) !== visitKey) {
      complete = false;
      continue;
    }
    if (entry.visitedAt >= visitedAt) continue;
    const rest = data.entries.filter((candidate) => candidate !== entry);
    const at = rest.findIndex((candidate) => candidate.visitedAt < visitedAt);
    rest.splice(at < 0 ? rest.length : at, 0, { ...entry, visitedAt });
    queryClient.setQueryData<ContentRecentQueryData>(cachedKey, {
      ...data,
      entries: rest.slice(0, CONTENT_RECENT_LIMIT),
    });
  }
  return complete;
}

export function useContentVisitRecorder() {
  const queryClient = useQueryClient();
  const t = useT();
  const mutation = useActionMutation("record-content-visit", {
    skipActionQueryInvalidation: true,
    onSuccess: (result, target) => {
      // Reopening a page already in Recent only reorders the list, so it
      // skips the refetch; a first visit still reads the new entry. An
      // answer without a visit time comes from an older server.
      const { visitedAt, accountKey } = result as {
        visitedAt?: unknown;
        accountKey?: unknown;
      };
      if (
        typeof visitedAt !== "string" ||
        typeof accountKey !== "string" ||
        !moveCachedRecentVisit(queryClient, target, visitedAt, accountKey)
      ) {
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-content-recent"],
        });
      }
    },
    onError: () => {
      toast.error(t("sidebar.failedSaveSidebarState"));
    },
  });
  const mutationRef = useRef(mutation);
  mutationRef.current = mutation;
  return useCallback((target: ContentRecentTarget) => {
    mutationRef.current.mutate(target);
  }, []);
}

export function useRecordContentVisit(
  target: ContentRecentTarget | null,
  enabled: boolean,
) {
  const record = useContentVisitRecorder();
  const targetRef = useRef(target);
  targetRef.current = target;
  const key = target ? contentRecentVisitKey(target) : null;
  const recordedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !key) return;
    if (recordedKey.current === key || !targetRef.current) return;
    recordedKey.current = key;
    const visited = targetRef.current;
    // Nothing on the page being opened waits on Recent's order, so the write
    // waits for the load to settle. It isn't cancelled when the page closes:
    // a page opened and left still counts as visited.
    scheduleAfterStartup(() => record(visited));
  }, [enabled, key, record]);
}
