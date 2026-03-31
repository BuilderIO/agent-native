import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DocumentSyncStatus,
  LinkNotionPageRequest,
  NotionConnectionStatus,
  NotionSearchResponse,
  ResolveDocumentSyncConflictRequest,
} from "@shared/api";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
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
  queryClient.invalidateQueries({ queryKey: ["documents"] });
  queryClient.invalidateQueries({ queryKey: ["document", documentId] });
  queryClient.invalidateQueries({ queryKey: ["document-sync", documentId] });
}

export function useNotionConnection() {
  return useQuery({
    queryKey: ["notion-connection"],
    queryFn: () => fetchJson<NotionConnectionStatus>("/api/notion/status"),
    staleTime: 30_000,
  });
}

export function useDocumentSyncStatus(documentId: string | null) {
  return useQuery({
    queryKey: ["document-sync", documentId],
    queryFn: () =>
      fetchJson<DocumentSyncStatus>(
        `/api/documents/${documentId}/notion/refresh`,
        {
          method: "POST",
        },
      ),
    enabled: !!documentId,
    refetchInterval: 15_000,
  });
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
    mutationFn: () =>
      fetchJson<DocumentSyncStatus>(
        `/api/documents/${documentId}/notion/create-and-link`,
        { method: "POST" },
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
