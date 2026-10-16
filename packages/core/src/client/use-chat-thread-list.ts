import { useCallback, useEffect, useRef, useState } from "react";

import { agentNativePath } from "./api-path.js";
import {
  CHAT_THREADS_MAX_PAGE_SIZE,
  CHAT_THREADS_UPDATED_EVENT,
  ChatThreadListError,
  fetchChatThreadListPage,
  type ChatThreadOwnership,
  type ChatThreadListRow,
  type ChatThreadScope,
} from "./use-chat-threads.js";

const DEFAULT_PAGE_SIZE = 50;

export interface UseChatThreadListOptions {
  /** Which list this is. Narrowed on the server before paging. */
  ownership: ChatThreadOwnership;
  /** Rows per page, an integer from 1 to 200. Defaults to 50. Anything else throws `ChatThreadListConfigError`. */
  pageSize?: number;
  scope?: ChatThreadScope | null;
  includeExternal?: boolean;
  /** Search text. Empty lists the whole set. */
  query?: string;
  /** When false nothing is fetched and the list is empty. Defaults to true. */
  enabled?: boolean;
  apiUrl?: string;
}

export interface UseChatThreadListResult {
  threads: ChatThreadListRow[];
  /** True until the first page of the current list settles. */
  loading: boolean;
  loadingMore: boolean;
  /** The last request failed; `threads` keeps whatever was already loaded. */
  error: Error | null;
  /** The server has rows past the ones loaded. */
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

/** `pageSize` is not an integer between 1 and the server's page cap. */
export class ChatThreadListConfigError extends Error {
  constructor(pageSize: unknown) {
    super(
      `useChatThreadList pageSize must be an integer from 1 to ${CHAT_THREADS_MAX_PAGE_SIZE}, got ${String(pageSize)}.`,
    );
    this.name = "ChatThreadListConfigError";
  }
}

function resolvePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) return DEFAULT_PAGE_SIZE;
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > CHAT_THREADS_MAX_PAGE_SIZE
  ) {
    throw new ChatThreadListConfigError(pageSize);
  }
  return pageSize;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * One paginated chat history list (`mine`, `shared`, or `all`). Each list pages
 * independently, so a long Shared list never waits on My chats. It refetches
 * when any thread mutation in this tab calls `notifyChatThreadsUpdated`,
 * keeping every row already loaded, however many server pages that spans,
 * rather than collapsing to the first page.
 */
export function useChatThreadList(
  options: UseChatThreadListOptions,
): UseChatThreadListResult {
  const { ownership, includeExternal = false, enabled = true } = options;
  const apiUrl = options.apiUrl ?? agentNativePath("/_agent-native/agent-chat");
  const pageSize = resolvePageSize(options.pageSize);
  const query = options.query?.trim() ?? "";
  const scopeType = options.scope?.type ?? null;
  const scopeId = options.scope?.id ?? null;

  const [threads, setThreads] = useState<ChatThreadListRow[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  // Server rows consumed so far. Not `threads.length`: a page that overlaps
  // rows already shown is deduped on screen, but the next offset must still
  // move past it or a fully overlapping page would be requested forever.
  const nextOffsetRef = useRef(0);
  // Bumped by every request that replaces the list, and by a list change, so a
  // response for a superseded request is dropped instead of landing on the
  // wrong list.
  const requestRef = useRef(0);
  const inFlightRef = useRef<"replace" | "append" | null>(null);

  const request = useCallback(
    (page: { offset: number; limit: number }) =>
      fetchChatThreadListPage({
        apiUrl,
        offset: page.offset,
        limit: page.limit,
        query,
        ownership,
        includeExternal,
        scope: scopeType && scopeId ? { type: scopeType, id: scopeId } : null,
      }).then((result) => {
        if (result.hasMore === undefined) {
          throw new ChatThreadListError(
            "Chat history response did not say whether more threads exist.",
          );
        }
        // A page that claims more rows exist but returned none would be
        // requested again from the same offset forever.
        if (result.hasMore && result.threads.length === 0) {
          throw new ChatThreadListError(
            "Chat history response reported more threads but returned none.",
          );
        }
        return { threads: result.threads, hasMore: result.hasMore };
      }),
    [apiUrl, includeExternal, ownership, query, scopeId, scopeType],
  );

  // Reload the first `window` server rows, one capped page at a time, and swap
  // them in only once every page has arrived. A failure part-way leaves the
  // rows and offset already on screen untouched.
  const replace = useCallback(
    async (window: number): Promise<void> => {
      const requestId = ++requestRef.current;
      inFlightRef.current = "replace";
      setLoadingMore(false);
      try {
        const rows = new Map<string, ChatThreadListRow>();
        let consumed = 0;
        let more = true;
        while (more && consumed < window) {
          const page = await request({
            offset: consumed,
            limit: Math.min(CHAT_THREADS_MAX_PAGE_SIZE, window - consumed),
          });
          if (requestId !== requestRef.current) return;
          for (const thread of page.threads) {
            if (!rows.has(thread.id)) rows.set(thread.id, thread);
          }
          consumed += page.threads.length;
          more = page.hasMore;
        }
        nextOffsetRef.current = consumed;
        setThreads([...rows.values()]);
        setHasMore(more);
        setError(null);
      } catch (failure) {
        if (requestId !== requestRef.current) return;
        setError(asError(failure));
      } finally {
        if (requestId === requestRef.current) {
          inFlightRef.current = null;
          setLoading(false);
        }
      }
    },
    [request],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    // Reload every row already on screen so a mutation does not collapse a
    // list the person has paged through.
    await replace(Math.max(pageSize, nextOffsetRef.current));
  }, [enabled, pageSize, replace]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (inFlightRef.current || !hasMoreRef.current) return;
    const requestId = requestRef.current;
    inFlightRef.current = "append";
    setLoadingMore(true);
    try {
      const page = await request({
        offset: nextOffsetRef.current,
        limit: pageSize,
      });
      if (requestId !== requestRef.current) return;
      nextOffsetRef.current += page.threads.length;
      setThreads((previous) => {
        const known = new Set(previous.map((thread) => thread.id));
        return [
          ...previous,
          ...page.threads.filter((thread) => !known.has(thread.id)),
        ];
      });
      setHasMore(page.hasMore);
      setError(null);
    } catch (failure) {
      if (requestId !== requestRef.current) return;
      setError(asError(failure));
    } finally {
      if (requestId === requestRef.current) {
        inFlightRef.current = null;
        setLoadingMore(false);
      }
    }
  }, [pageSize, request]);

  useEffect(() => {
    requestRef.current += 1;
    inFlightRef.current = null;
    nextOffsetRef.current = 0;
    setThreads([]);
    setHasMore(false);
    setError(null);
    setLoadingMore(false);
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void replace(pageSize);
    // Unmount and every list change land here, so a late response cannot write
    // into a list that is gone or replaced.
    return () => {
      requestRef.current += 1;
      inFlightRef.current = null;
    };
  }, [enabled, pageSize, replace]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onUpdated = () => void refresh();
    window.addEventListener(CHAT_THREADS_UPDATED_EVENT, onUpdated);
    return () =>
      window.removeEventListener(CHAT_THREADS_UPDATED_EVENT, onUpdated);
  }, [enabled, refresh]);

  return { threads, loading, loadingMore, error, hasMore, loadMore, refresh };
}
