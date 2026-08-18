import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { agentNativePath } from "../api-path.js";
import { useActionMutation, useActionQuery } from "../use-action.js";

export interface ShareQueryParams {
  resourceType: string;
  resourceId: string;
}

export type ShareQueryKey = readonly [
  "action",
  "list-resource-shares",
  ShareQueryParams,
];

export interface ShareOrgMember {
  email: string;
  name?: string | null;
  role?: string | null;
  joinedAt?: number | null;
}

export interface ShareOrgMemberSearchResult {
  members: ShareOrgMember[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: boolean;
  loadMore: () => void;
}

export interface OrgMemberPage {
  members: ShareOrgMember[];
  hasMore: boolean;
  nextOffset: number | null;
}

export const DEFAULT_MEMBER_SUGGESTION_LIMIT = 25;
export const DEFAULT_MEMBER_SEARCH_DEBOUNCE_MS = 140;

export function createShareQueryParams(
  resourceType: string,
  resourceId: string,
): ShareQueryParams {
  return { resourceType, resourceId };
}

export function createShareQueryKey(params: ShareQueryParams): ShareQueryKey {
  return ["action", "list-resource-shares", params];
}

export function useShareQuery<TResponse>(
  resourceType: string,
  resourceId: string,
): {
  params: ShareQueryParams;
  queryKey: ShareQueryKey;
  query: ReturnType<typeof useActionQuery<TResponse>>;
  queryClient: QueryClient;
} {
  const queryClient = useQueryClient();
  const params = useMemo(
    () => createShareQueryParams(resourceType, resourceId),
    [resourceId, resourceType],
  );
  const queryKey = useMemo(() => createShareQueryKey(params), [params]);
  const query = useActionQuery<TResponse>("list-resource-shares", params);
  return { params, queryKey, query, queryClient };
}

export function useShareMutations() {
  return {
    setVisibility: useActionMutation("set-resource-visibility"),
    share: useActionMutation("share-resource"),
    unshare: useActionMutation("unshare-resource"),
  };
}

/**
 * Apply an optimistic change and return the exact cache value to restore if
 * the action fails. Keeping this snapshot at the mutation boundary prevents a
 * stale request from restoring a newer optimistic result.
 */
export function optimisticallyUpdateShareCache<TData>(
  queryClient: QueryClient,
  queryKey: ShareQueryKey,
  updater: (previous: TData | undefined) => TData | undefined,
): TData | undefined {
  const previous = queryClient.getQueryData<TData>(queryKey);
  const next = updater(previous);
  if (next === undefined) {
    queryClient.removeQueries({ queryKey, exact: true });
  } else {
    queryClient.setQueryData(queryKey, next);
  }
  return previous;
}

export function rollbackShareCache<TData>(
  queryClient: QueryClient,
  queryKey: ShareQueryKey,
  previous: TData | undefined,
): void {
  if (previous === undefined) {
    queryClient.removeQueries({ queryKey, exact: true });
    return;
  }
  queryClient.setQueryData(queryKey, previous);
}

export function useShareMutationGuard() {
  const latestRequest = useRef(0);
  const begin = useCallback(() => {
    latestRequest.current += 1;
    return latestRequest.current;
  }, []);
  const isLatest = useCallback(
    (requestId: number) => requestId === latestRequest.current,
    [],
  );
  return { begin, isLatest };
}

export async function fetchOrgMemberPage(options: {
  search?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<OrgMemberPage> {
  const params = new URLSearchParams();
  const search = options.search?.trim();
  if (search) params.set("search", search);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  const query = params.toString();
  const response = await fetch(
    `${agentNativePath("/_agent-native/org/members")}${query ? `?${query}` : ""}`,
    { credentials: "include", signal: options.signal },
  );
  if (!response.ok) throw new Error("Could not load people");
  const result = (await response.json()) as {
    members?: unknown;
    hasMore?: unknown;
    nextOffset?: unknown;
  };
  return {
    members: normalizeOrgMembers(result?.members),
    hasMore: result?.hasMore === true,
    nextOffset:
      typeof result?.nextOffset === "number" ? result.nextOffset : null,
  };
}

export function useShareOrgMemberSearch(
  query: string,
  enabled: boolean,
  options: {
    limit?: number;
    debounceMs?: number;
  } = {},
): ShareOrgMemberSearchResult {
  const search = query.trim();
  const limit = options.limit;
  const debounceMs = options.debounceMs ?? DEFAULT_MEMBER_SEARCH_DEBOUNCE_MS;
  const [members, setMembers] = useState<ShareOrgMember[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    (offset: number, append: boolean) => {
      if (!enabled) return;
      const requestId = ++requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setMembers([]);
        setNextOffset(null);
        setHasMore(false);
      }
      setError(false);

      fetchOrgMemberPage({
        search,
        limit,
        offset,
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted || requestId !== requestIdRef.current)
            return;
          setMembers((previous) =>
            append ? mergeOrgMembers(previous, result.members) : result.members,
          );
          setHasMore(result.hasMore);
          setNextOffset(result.nextOffset);
        })
        .catch(() => {
          if (controller.signal.aborted || requestId !== requestIdRef.current)
            return;
          setError(true);
          setHasMore(false);
          setNextOffset(null);
          if (!append) setMembers([]);
        })
        .finally(() => {
          if (controller.signal.aborted || requestId !== requestIdRef.current)
            return;
          if (append) setIsLoadingMore(false);
          else setIsLoading(false);
        });
    },
    [enabled, limit, search],
  );

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      setMembers([]);
      setNextOffset(null);
      setHasMore(false);
      setIsLoading(false);
      setIsLoadingMore(false);
      setError(false);
      return;
    }
    const delay = search ? debounceMs : 0;
    if (delay === 0) {
      fetchPage(0, false);
      return () => abortRef.current?.abort();
    }
    const timeout = setTimeout(() => fetchPage(0, false), delay);
    return () => {
      clearTimeout(timeout);
      abortRef.current?.abort();
    };
  }, [debounceMs, enabled, fetchPage, search]);

  const loadMore = useCallback(() => {
    if (!enabled || !hasMore || nextOffset === null) return;
    if (isLoading || isLoadingMore) return;
    fetchPage(nextOffset, true);
  }, [enabled, fetchPage, hasMore, isLoading, isLoadingMore, nextOffset]);

  return { members, isLoading, isLoadingMore, hasMore, error, loadMore };
}

export function normalizeOrgMembers(value: unknown): ShareOrgMember[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((member: unknown): ShareOrgMember | null => {
      if (!member || typeof member !== "object") return null;
      const value = member as {
        email?: unknown;
        name?: unknown;
        role?: unknown;
        joinedAt?: unknown;
        joined_at?: unknown;
      };
      if (typeof value.email !== "string" || !value.email) return null;
      return {
        email: value.email,
        name: typeof value.name === "string" ? value.name : null,
        role: typeof value.role === "string" ? value.role : null,
        joinedAt:
          typeof value.joinedAt === "number"
            ? value.joinedAt
            : typeof value.joined_at === "number"
              ? value.joined_at
              : null,
      };
    })
    .filter((member): member is ShareOrgMember => member !== null);
}

export function mergeOrgMembers(
  existing: ShareOrgMember[],
  next: ShareOrgMember[],
): ShareOrgMember[] {
  const seen = new Set(existing.map((member) => member.email.toLowerCase()));
  const merged = [...existing];
  for (const member of next) {
    const key = member.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(member);
  }
  return merged;
}

export function extractShareErrorMessage(error: unknown): string {
  const fallback = "Could not update sharing — please try again.";
  if (!error) return fallback;
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error !== null
          ? ((error as { error?: unknown; message?: unknown }).error ??
            (error as { message?: unknown }).message)
          : null;
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  if (raw.trim().toLowerCase() === "failed to fetch") return fallback;
  return raw.replace(/^Action\s+[\w-]+\s+failed:\s*/i, "") || fallback;
}
