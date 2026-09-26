import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import {
  contentRecentTargetKey,
  contentRecentVisitKey,
  type ContentRecentResult,
  type ContentRecentTarget,
} from "@shared/content-personal-navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

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

export function useContentRecent(spaceId?: string) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const scopeKey = org.data
    ? JSON.stringify([
        org.data.email.trim().toLowerCase(),
        org.data.orgId ?? null,
        spaceId ?? null,
      ])
    : undefined;
  const args = useMemo(
    () => contentRecentQueryArgs(scopeKey, spaceId),
    [scopeKey, spaceId],
  );
  const query = useActionQuery("get-content-recent", args, {
    enabled: Boolean(scopeKey) && !org.isFetching,
    placeholderData: undefined,
  });
  const [refreshingScope, setRefreshingScope] = useState<string | null>(null);
  const resyncedScopeRef = useRef<string | null>(null);
  const contextChanged = isContentRecentContextChanged(query.error);

  useEffect(() => {
    if (!scopeKey || !contextChanged) {
      if (!query.isError) resyncedScopeRef.current = null;
      return;
    }
    if (resyncedScopeRef.current === scopeKey) return;

    resyncedScopeRef.current = scopeKey;
    setRefreshingScope(scopeKey);
    void (async () => {
      try {
        const refreshedOrg = await org.refetch();
        if (refreshedOrg.isError) return;
        await queryClient.invalidateQueries({
          queryKey: ["action", "get-content-recent", args],
          exact: true,
        });
      } catch (error) {
        console.warn(
          "Could not refresh the Content Recent context after a scope mismatch.",
          error,
        );
      } finally {
        setRefreshingScope((current) =>
          current === scopeKey ? null : current,
        );
      }
    })();
  }, [
    args,
    contextChanged,
    org.refetch,
    query.error,
    query.isError,
    queryClient,
    scopeKey,
  ]);

  const recoveringContext =
    contextChanged &&
    (refreshingScope === scopeKey || resyncedScopeRef.current !== scopeKey);
  return {
    ...query,
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

/**
 * Reflect a pin change in cached Recent rows right away; the pin mutation's
 * own refresh reconciles the server value.
 */
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

/** Forget a Recent destination immediately, restoring it if the save fails. */
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
      // Remember only the removed entry and its place in each cached list, so
      // a failure restores it without undoing other visits or removals.
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

export function useContentVisitRecorder() {
  const queryClient = useQueryClient();
  const t = useT();
  const mutation = useActionMutation("record-content-visit", {
    skipActionQueryInvalidation: true,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-content-recent"],
      });
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
    record(targetRef.current);
  }, [enabled, key, record]);
}
