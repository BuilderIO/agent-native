import {
  appApiPath,
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import type {
  CreateNotionPageRequest,
  Document,
  DocumentSyncStatus,
  LinkNotionPageRequest,
  NotionConnectionStatus,
  NotionSearchResponse,
  ResolveDocumentSyncConflictRequest,
} from "@shared/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

async function fetchNotionAuthUrl(): Promise<string> {
  const res = await fetch(appApiPath("/api/notion/auth-url"));
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      body?.error || body?.message || `${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as { url?: string };
  if (!body.url) throw new Error("Notion OAuth URL is unavailable");
  return body.url;
}

function invalidateDocumentQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  documentId: string,
) {
  queryClient.invalidateQueries({ queryKey: ["action"] });
  queryClient.invalidateQueries({
    queryKey: documentSyncStatusQueryKey(documentId),
  });
  queryClient.invalidateQueries({
    queryKey: documentSyncStatusQueryKey(documentId, { autoSync: true }),
  });
}

export function documentSyncStatusQueryKey(
  documentId: string,
  options?: { autoSync?: boolean },
) {
  return [
    "action",
    "refresh-notion-sync-status",
    { documentId, autoSync: !!options?.autoSync },
  ] as const;
}

export function useNotionConnection() {
  return useActionQuery<NotionConnectionStatus>(
    "connect-notion-status",
    undefined,
    {
      staleTime: 30_000,
    },
  );
}

export function useNotionAuthUrl(enabled: boolean) {
  return useQuery({
    queryKey: ["notion-auth-url"],
    queryFn: fetchNotionAuthUrl,
    enabled,
    staleTime: 30_000,
  });
}

export async function openNotionOAuthUrl() {
  return fetchNotionAuthUrl();
}

export function useDocumentSyncStatus(
  documentId: string | null,
  options?: { autoSync?: boolean },
) {
  const queryClient = useQueryClient();
  const lastObservedSyncedAtRef = useRef<string | null>(null);
  const query = useQuery<DocumentSyncStatus>({
    queryKey: documentId
      ? documentSyncStatusQueryKey(documentId, options)
      : ["action", "refresh-notion-sync-status", null],
    queryFn: () => {
      if (!documentId) throw new Error("documentId is required");
      return callAction<DocumentSyncStatus>("refresh-notion-sync-status", {
        documentId,
        autoSync: !!options?.autoSync,
      });
    },
    enabled: !!documentId,
    // Poll Notion aggressively when auto-sync is on so remote changes appear
    // within ~2s. Server throttles match (see REFRESH_THROTTLE_AUTO_SYNC_MS in
    // notion-sync.ts) so we make at most one real Notion request per 2s per doc.
    refetchInterval: options?.autoSync ? 2_000 : 30_000,
  });

  useEffect(() => {
    if (!documentId || !query.data?.lastSyncedAt) return;
    if (lastObservedSyncedAtRef.current === query.data.lastSyncedAt) return;

    lastObservedSyncedAtRef.current = query.data.lastSyncedAt;

    const cachedDocument = queryClient.getQueryData<Document>([
      "action",
      "get-document",
      { id: documentId },
    ]);
    const syncedLocalUpdatedAt = query.data.lastPushedLocalUpdatedAt;

    if (
      cachedDocument?.updatedAt &&
      syncedLocalUpdatedAt &&
      syncedLocalUpdatedAt > cachedDocument.updatedAt
    ) {
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document", { id: documentId }],
      });
      queryClient.invalidateQueries({ queryKey: ["action", "list-documents"] });
    }
  }, [
    documentId,
    query.data?.lastPushedLocalUpdatedAt,
    query.data?.lastSyncedAt,
    queryClient,
  ]);

  return query;
}

export function useDisconnectNotion() {
  const queryClient = useQueryClient();
  return useActionMutation<{ success: boolean; deleted: number }>(
    "disconnect-notion",
    {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["action", "connect-notion-status"],
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "refresh-notion-sync-status"],
        });
      },
    },
  );
}

export function useLinkDocumentToNotion(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    DocumentSyncStatus,
    LinkNotionPageRequest & { documentId: string }
  >("link-notion-page", {
    onSuccess: () => invalidateDocumentQueries(queryClient, documentId),
  });
}

export function useUnlinkDocumentFromNotion(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<{ success: boolean }, { documentId: string }>(
    "unlink-notion-page",
    {
      method: "DELETE",
      onSuccess: () => invalidateDocumentQueries(queryClient, documentId),
    },
  );
}

export function usePullDocumentFromNotion(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<DocumentSyncStatus, { documentId: string }>(
    "pull-notion-page",
    {
      onSuccess: () => invalidateDocumentQueries(queryClient, documentId),
    },
  );
}

export function usePushDocumentToNotion(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<DocumentSyncStatus, { documentId: string }>(
    "push-notion-page",
    {
      onSuccess: () => invalidateDocumentQueries(queryClient, documentId),
    },
  );
}

export function useResolveDocumentSyncConflict(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    DocumentSyncStatus,
    ResolveDocumentSyncConflictRequest & { documentId: string }
  >("resolve-notion-sync-conflict", {
    onSuccess: () => invalidateDocumentQueries(queryClient, documentId),
  });
}

export function useCreateAndLinkNotionPage(documentId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    DocumentSyncStatus,
    CreateNotionPageRequest & { documentId: string }
  >("create-and-link-notion-page", {
    onSuccess: () => invalidateDocumentQueries(queryClient, documentId),
  });
}

export function useSearchNotionPages(query: string, enabled: boolean) {
  return useActionQuery<NotionSearchResponse>(
    "search-notion-pages",
    { query },
    {
      enabled,
      staleTime: 10_000,
    },
  );
}
