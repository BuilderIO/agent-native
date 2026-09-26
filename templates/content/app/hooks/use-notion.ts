import { appApiPath } from "@agent-native/core/client/api-path";
import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
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

import { useLocalStorage } from "@/hooks/use-local-storage";

import { documentQueryFilter } from "./use-documents";

export function currentRedirectTarget(): string {
  if (typeof window === "undefined") return "/";
  const { pathname, search } = window.location;
  return `${pathname}${search}` || "/";
}

async function fetchNotionAuthUrl(): Promise<string> {
  const redirect = currentRedirectTarget();
  const url = appApiPath(
    `/api/notion/auth-url?redirect=${encodeURIComponent(redirect)}`,
  );
  const res = await fetch(url);
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

export function invalidateDocumentQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  documentId: string,
) {
  void queryClient.invalidateQueries(documentQueryFilter(documentId));
  void queryClient.invalidateQueries({
    queryKey: ["action", "list-documents"],
  });
  void queryClient.invalidateQueries({
    queryKey: documentSyncStatusQueryKey(documentId),
  });
}

export function documentSyncStatusQueryKey(documentId: string) {
  return [
    "action",
    "refresh-notion-sync-status",
    { documentId: documentId.trim() },
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

const UNLINKED_SYNC_POLL_MS = 60_000;

export function documentSyncRefetchIntervalMs(
  data: DocumentSyncStatus | undefined,
  autoSync: boolean,
): number {
  if (data && (!data.connected || !data.pageId)) return UNLINKED_SYNC_POLL_MS;
  return autoSync ? 2_000 : 30_000;
}

export function useDocumentSyncStatus(documentId: string | null) {
  const queryClient = useQueryClient();
  const lastObservedSyncedAtRef = useRef<string | null>(null);
  const normalizedDocumentId = documentId?.trim() || null;
  const [autoSync] = useLocalStorage(
    `notion-auto-sync:${normalizedDocumentId ?? ""}`,
    false,
  );
  const query = useQuery<DocumentSyncStatus>({
    queryKey: normalizedDocumentId
      ? documentSyncStatusQueryKey(normalizedDocumentId)
      : ["action", "refresh-notion-sync-status", null],
    queryFn: () => {
      if (!normalizedDocumentId) throw new Error("documentId is required");
      return callAction<DocumentSyncStatus>("refresh-notion-sync-status", {
        documentId: normalizedDocumentId,
        autoSync,
      });
    },
    enabled: !!normalizedDocumentId,
    refetchInterval: (query) =>
      documentSyncRefetchIntervalMs(query.state.data, autoSync),
  });

  useEffect(() => {
    if (!normalizedDocumentId || !query.data?.lastSyncedAt) return;
    if (lastObservedSyncedAtRef.current === query.data.lastSyncedAt) return;

    lastObservedSyncedAtRef.current = query.data.lastSyncedAt;

    const cachedDocuments = queryClient
      .getQueriesData<Document>(documentQueryFilter(normalizedDocumentId))
      .map(([, document]) => document)
      .filter((document): document is Document => !!document);
    const syncedLocalUpdatedAt = query.data.lastPushedLocalUpdatedAt;

    if (
      cachedDocuments.some(
        (cachedDocument) =>
          !!cachedDocument.updatedAt &&
          !!syncedLocalUpdatedAt &&
          syncedLocalUpdatedAt > cachedDocument.updatedAt,
      ) &&
      syncedLocalUpdatedAt &&
      cachedDocuments.length > 0
    ) {
      void queryClient.invalidateQueries(
        documentQueryFilter(normalizedDocumentId),
      );
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
    }
  }, [
    normalizedDocumentId,
    query.data?.lastPushedLocalUpdatedAt,
    query.data?.lastSyncedAt,
    queryClient,
  ]);

  return query;
}

const AUTO_SYNC_STORAGE_PREFIX = "notion-auto-sync:";

export function clearAllAutoSyncToggles() {
  if (typeof window === "undefined") return;
  try {
    const staleKeys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(AUTO_SYNC_STORAGE_PREFIX)) staleKeys.push(key);
    }
    for (const key of staleKeys) window.localStorage.removeItem(key);
  } catch {
    // Best-effort — localStorage may be unavailable (private mode, etc.).
  }
}

export function useDisconnectNotion() {
  const queryClient = useQueryClient();
  return useActionMutation<{ success: boolean; deleted: number }>(
    "disconnect-notion",
    {
      onSuccess: () => {
        clearAllAutoSyncToggles();
        void queryClient.invalidateQueries({
          queryKey: ["action", "connect-notion-status"],
        });
        void queryClient.invalidateQueries({
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
  return useActionMutation<
    DocumentSyncStatus,
    { documentId: string; flushOpenEditor?: boolean }
  >("push-notion-page", {
    onSuccess: () => invalidateDocumentQueries(queryClient, documentId),
  });
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
