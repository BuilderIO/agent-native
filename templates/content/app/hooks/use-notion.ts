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

// The server signs a `redirect` query param into the OAuth `state` and the
// callback route sends the user back there once the connection completes. If
// we never send it, `state.redirectPath` defaults to "/" server-side and
// every OAuth round-trip drops the user at the app root regardless of what
// document/view they started from. Current path + search (no hash — Notion's
// redirect_uri validation is stricter about odd characters, and in-page
// anchors aren't meaningful across a page reload anyway).
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
  // Targeted invalidation only — this fires on every link/unlink/pull/push/
  // resolve-conflict mutation success (including the auto-sync push-on-save
  // path after every debounced editor save). Invalidating the bare ["action"]
  // key would refetch every mounted query app-wide (sidebar tree, comments,
  // database views, search, connection status, ...) on each cycle.
  queryClient.invalidateQueries({
    queryKey: ["action", "get-document", { id: documentId }],
  });
  queryClient.invalidateQueries({
    queryKey: ["action", "list-documents"],
  });
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
  const normalizedDocumentId = documentId.trim();
  return [
    "action",
    "refresh-notion-sync-status",
    { documentId: normalizedDocumentId, autoSync: !!options?.autoSync },
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

// Not linked (no pageId) or the workspace isn't connected: there is nothing to
// sync, so fall back to a slow heartbeat instead of the 2s/30s cadence. This
// still notices a fresh link/connection made from another tab eventually,
// without hammering refresh-notion-sync-status (get-document + getSyncLink +
// connection lookup) for every open, unlinked document.
const UNLINKED_SYNC_POLL_MS = 60_000;

export function documentSyncRefetchIntervalMs(
  data: DocumentSyncStatus | undefined,
  autoSync: boolean,
): number {
  if (data && (!data.connected || !data.pageId)) return UNLINKED_SYNC_POLL_MS;
  return autoSync ? 2_000 : 30_000;
}

export function useDocumentSyncStatus(
  documentId: string | null,
  options?: { autoSync?: boolean },
) {
  const queryClient = useQueryClient();
  const lastObservedSyncedAtRef = useRef<string | null>(null);
  const normalizedDocumentId = documentId?.trim() || null;
  const autoSync = !!options?.autoSync;
  const query = useQuery<DocumentSyncStatus>({
    queryKey: normalizedDocumentId
      ? documentSyncStatusQueryKey(normalizedDocumentId, options)
      : ["action", "refresh-notion-sync-status", null],
    queryFn: () => {
      if (!normalizedDocumentId) throw new Error("documentId is required");
      return callAction<DocumentSyncStatus>("refresh-notion-sync-status", {
        documentId: normalizedDocumentId,
        autoSync,
      });
    },
    enabled: !!normalizedDocumentId,
    // Poll Notion aggressively when auto-sync is on so remote changes appear
    // within ~2s. Server throttles match (see REFRESH_THROTTLE_AUTO_SYNC_MS in
    // notion-sync.ts) so we make at most one real Notion request per 2s per doc.
    // Once we know the doc is unlinked/disconnected, back off to a slow
    // heartbeat (see documentSyncRefetchIntervalMs) instead of polling at full
    // speed forever.
    refetchInterval: (query) =>
      documentSyncRefetchIntervalMs(query.state.data, autoSync),
  });

  useEffect(() => {
    if (!normalizedDocumentId || !query.data?.lastSyncedAt) return;
    if (lastObservedSyncedAtRef.current === query.data.lastSyncedAt) return;

    lastObservedSyncedAtRef.current = query.data.lastSyncedAt;

    const cachedDocument = queryClient.getQueryData<Document>([
      "action",
      "get-document",
      { id: normalizedDocumentId },
    ]);
    const syncedLocalUpdatedAt = query.data.lastPushedLocalUpdatedAt;

    if (
      cachedDocument?.updatedAt &&
      syncedLocalUpdatedAt &&
      syncedLocalUpdatedAt > cachedDocument.updatedAt
    ) {
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document", { id: normalizedDocumentId }],
      });
      queryClient.invalidateQueries({ queryKey: ["action", "list-documents"] });
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

// Disconnect is workspace-wide, so every per-document auto-sync toggle is
// stale afterward. Without this, a doc that once had auto-sync ON keeps its
// localStorage flag set to true and re-arms the 2s poll (see
// documentSyncRefetchIntervalMs) the moment the workspace reconnects.
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
