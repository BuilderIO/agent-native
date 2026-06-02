import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appApiPath } from "@agent-native/core/client";
import type {
  CreateNotionPageRequest,
  Document,
  DocumentSyncStatus,
  LinkNotionPageRequest,
  NotionConnectionStatus,
  NotionSearchResponse,
  ResolveDocumentSyncConflictRequest,
} from "@shared/api";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(appApiPath(url), init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      body?.error || body?.message || `${res.status} ${res.statusText}`,
    );
  }
  return res.json();
}

function invalidateDocumentQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  documentId: string,
) {
  queryClient.invalidateQueries({ queryKey: ["action"] });
  queryClient.invalidateQueries({ queryKey: ["document-sync", documentId] });
}

export function useNotionConnection() {
  return useQuery({
    queryKey: ["notion-connection"],
    queryFn: () => fetchJson<NotionConnectionStatus>("/api/notion/status"),
    staleTime: 30_000,
  });
}

export function useDocumentSyncStatus(
  documentId: string | null,
  options?: { autoSync?: boolean },
) {
  const queryClient = useQueryClient();
  const lastObservedSyncedAtRef = useRef<string | null>(null);
  const query = useQuery({
    queryKey: ["document-sync", documentId],
    queryFn: () =>
      fetchJson<DocumentSyncStatus>(
        `/api/documents/${documentId}/notion/refresh`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoSync: !!options?.autoSync }),
        },
      ),
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
  return useMutation({
    mutationFn: () =>
      fetchJson<{ success: boolean }>("/api/notion/disconnect", {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notion-connection"] });
      queryClient.invalidateQueries({ queryKey: ["document-sync"] });
    },
  });
}

export function useLinkDocumentToNotion(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: LinkNotionPageRequest) =>
      fetchJson<DocumentSyncStatus>(
        `/api/documents/${documentId}/notion/link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => invalidateDocumentQueries(queryClient, documentId),
  });
}

export function useUnlinkDocumentFromNotion(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<{ success: boolean }>(
        `/api/documents/${documentId}/notion/unlink`,
        {
          method: "DELETE",
        },
      ),
    onSuccess: () => invalidateDocumentQueries(queryClient, documentId),
  });
}

export function usePullDocumentFromNotion(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<DocumentSyncStatus>(
        `/api/documents/${documentId}/notion/pull`,
        {
          method: "POST",
        },
      ),
    onSuccess: () => invalidateDocumentQueries(queryClient, documentId),
  });
}

export function usePushDocumentToNotion(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<DocumentSyncStatus>(
        `/api/documents/${documentId}/notion/push`,
        {
          method: "POST",
        },
      ),
    onSuccess: () => invalidateDocumentQueries(queryClient, documentId),
  });
}

export function useResolveDocumentSyncConflict(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ResolveDocumentSyncConflictRequest) =>
      fetchJson<DocumentSyncStatus>(
        `/api/documents/${documentId}/notion/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => invalidateDocumentQueries(queryClient, documentId),
  });
}

export function useCreateAndLinkNotionPage(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data?: CreateNotionPageRequest) =>
      fetchJson<DocumentSyncStatus>(
        `/api/documents/${documentId}/notion/create-and-link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data ?? {}),
        },
      ),
    onSuccess: () => invalidateDocumentQueries(queryClient, documentId),
  });
}

export function useSearchNotionPages(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ["notion-search", query],
    queryFn: () =>
      fetchJson<NotionSearchResponse>("/api/notion/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      }),
    enabled,
    staleTime: 10_000,
  });
}
