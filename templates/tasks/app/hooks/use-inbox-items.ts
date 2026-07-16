import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import type { InboxItem } from "../../server/inbox/store.js";
import type { Task } from "../../server/tasks/store.js";
import {
  invalidateInboxItems,
  invalidateTasks,
  LIST_INBOX_ITEMS_QUERY_KEY,
} from "./cache";

export type { InboxItem } from "../../server/inbox/store.js";

type ListInboxItemsData = { items: InboxItem[] };

type InboxMutationContext = {
  previous: [readonly unknown[], ListInboxItemsData | undefined][];
};

function patchListInboxItemsCache(
  queryClient: QueryClient,
  patch: (items: InboxItem[]) => InboxItem[],
) {
  queryClient.setQueriesData<ListInboxItemsData>(
    { queryKey: LIST_INBOX_ITEMS_QUERY_KEY },
    (old) => {
      if (!old?.items) return old;
      return { items: patch(old.items) };
    },
  );
}

function snapshotListInboxItemsQueries(queryClient: QueryClient) {
  return queryClient.getQueriesData<ListInboxItemsData>({
    queryKey: LIST_INBOX_ITEMS_QUERY_KEY,
  });
}

function restoreListInboxItemsQueries(
  queryClient: QueryClient,
  previous: InboxMutationContext["previous"],
) {
  for (const [key, data] of previous) {
    queryClient.setQueryData(key, data);
  }
}

export function runMarkInboxItemReadyInvalidation(queryClient: QueryClient) {
  invalidateInboxItems(queryClient);
  invalidateTasks(queryClient);
}

export function useInboxItems() {
  const query = useActionQuery("list-inbox-items", {});
  const listData = query.data as ListInboxItemsData | undefined;

  return {
    ...query,
    items: listData?.items ?? [],
  };
}

export function useCreateInboxItem() {
  const queryClient = useQueryClient();
  return useActionMutation<InboxItem, { title: string }>("create-inbox-item", {
    onSettled: () => {
      invalidateInboxItems(queryClient);
    },
  });
}

export function useUpdateInboxItem() {
  const queryClient = useQueryClient();
  return useActionMutation<InboxItem, { inboxItemId: string; title?: string }>(
    "update-inbox-item",
    {
      onSettled: () => {
        invalidateInboxItems(queryClient);
      },
    },
  );
}

export function useDeleteInboxItem() {
  const queryClient = useQueryClient();
  return useActionMutation<{ ok: true }, { inboxItemId: string }>(
    "delete-inbox-item",
    {
      onSettled: () => {
        invalidateInboxItems(queryClient);
      },
    },
  );
}

export function useMarkInboxItemReady() {
  const queryClient = useQueryClient();
  return useActionMutation<{ task: Task }, { inboxItemId: string }>(
    "mark-inbox-item-ready",
    {
      onMutate: async ({ inboxItemId }) => {
        await queryClient.cancelQueries({
          queryKey: LIST_INBOX_ITEMS_QUERY_KEY,
        });
        const previous = snapshotListInboxItemsQueries(queryClient);

        patchListInboxItemsCache(queryClient, (items) =>
          items.filter((item) => item.id !== inboxItemId),
        );

        return { previous };
      },
      onError: (_error, _variables, context) => {
        restoreListInboxItemsQueries(
          queryClient,
          (context as InboxMutationContext | undefined)?.previous ?? [],
        );
      },
      onSettled: () => {
        runMarkInboxItemReadyInvalidation(queryClient);
      },
    },
  );
}

export function useBulkMarkInboxItemsReady() {
  const queryClient = useQueryClient();
  return useActionMutation<{ tasks: Task[] }, { inboxItemIds: string[] }>(
    "bulk-mark-inbox-items-ready",
    {
      onMutate: async ({ inboxItemIds }) => {
        await queryClient.cancelQueries({
          queryKey: LIST_INBOX_ITEMS_QUERY_KEY,
        });
        const previous = snapshotListInboxItemsQueries(queryClient);
        const selected = new Set(inboxItemIds);

        patchListInboxItemsCache(queryClient, (items) =>
          items.filter((item) => !selected.has(item.id)),
        );

        return { previous };
      },
      onError: (_error, _variables, context) => {
        restoreListInboxItemsQueries(
          queryClient,
          (context as InboxMutationContext | undefined)?.previous ?? [],
        );
      },
      onSettled: () => {
        runMarkInboxItemReadyInvalidation(queryClient);
      },
    },
  );
}

export function useBulkDeleteInboxItems() {
  const queryClient = useQueryClient();
  return useActionMutation<
    { ok: true; deleted: number },
    { inboxItemIds: string[] }
  >("bulk-delete-inbox-items", {
    onMutate: async ({ inboxItemIds }) => {
      await queryClient.cancelQueries({ queryKey: LIST_INBOX_ITEMS_QUERY_KEY });
      const previous = snapshotListInboxItemsQueries(queryClient);
      const selected = new Set(inboxItemIds);

      patchListInboxItemsCache(queryClient, (items) =>
        items.filter((item) => !selected.has(item.id)),
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      restoreListInboxItemsQueries(
        queryClient,
        (context as InboxMutationContext | undefined)?.previous ?? [],
      );
    },
    onSettled: () => {
      invalidateInboxItems(queryClient);
    },
  });
}

export function useReorderInboxItems() {
  const queryClient = useQueryClient();
  return useActionMutation<{ items: InboxItem[] }, { inboxItemIds: string[] }>(
    "reorder-inbox-items",
    {
      onSettled: () => {
        invalidateInboxItems(queryClient);
      },
    },
  );
}
