import { useCallback, useEffect, useLayoutEffect, useState } from "react";

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

type ListSnapshot = Pick<
  UseChatThreadListResult,
  "threads" | "loading" | "loadingMore" | "error" | "hasMore"
>;

function createListState(identity: string, enabled: boolean) {
  return {
    identity,
    session: {
      active: false,
      requestId: 0,
      inFlight: null as "replace" | "append" | null,
      // Deduped rows can be fewer than the server rows consumed.
      nextOffset: 0,
      hasMore: false,
    },
    threads: [] as ChatThreadListRow[],
    loading: enabled,
    loadingMore: false,
    error: null as Error | null,
    hasMore: false,
  };
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

  const identity = JSON.stringify([
    apiUrl,
    ownership,
    query,
    scopeType,
    scopeId,
    pageSize,
    includeExternal,
    enabled,
  ]);
  const [stored, setState] = useState(() => createListState(identity, enabled));
  // Reset during render: consumers must never observe the preceding list,
  // including during their layout effects before passive cleanup runs.
  const state =
    stored.identity === identity ? stored : createListState(identity, enabled);
  if (state !== stored) setState(state);
  const { session } = state;
  const update = useCallback(
    (patch: Partial<ListSnapshot>) => {
      setState((previous) =>
        previous.session === session ? { ...previous, ...patch } : previous,
      );
    },
    [session],
  );

  useLayoutEffect(() => {
    session.active = true;
    return () => {
      session.active = false;
      session.requestId += 1;
      session.inFlight = null;
    };
  }, [session]);

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
      if (!session.active) return;
      const requestId = ++session.requestId;
      const isCurrent = () => session.active && requestId === session.requestId;
      session.inFlight = "replace";
      update({ loadingMore: false });
      try {
        const rows = new Map<string, ChatThreadListRow>();
        let consumed = 0;
        let more = true;
        while (more && consumed < window) {
          const page = await request({
            offset: consumed,
            limit: Math.min(CHAT_THREADS_MAX_PAGE_SIZE, window - consumed),
          });
          if (!isCurrent()) return;
          for (const thread of page.threads) {
            if (!rows.has(thread.id)) rows.set(thread.id, thread);
          }
          consumed += page.threads.length;
          more = page.hasMore;
        }
        session.nextOffset = consumed;
        session.hasMore = more;
        update({ threads: [...rows.values()], hasMore: more, error: null });
      } catch (failure) {
        if (!isCurrent()) return;
        update({ error: asError(failure) });
      } finally {
        if (isCurrent()) {
          session.inFlight = null;
          update({ loading: false });
        }
      }
    },
    [request, session, update],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    // Reload every row already on screen so a mutation does not collapse a
    // list the person has paged through.
    await replace(Math.max(pageSize, session.nextOffset));
  }, [enabled, pageSize, replace, session]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!session.active || session.inFlight || !session.hasMore) return;
    const requestId = session.requestId;
    const isCurrent = () => session.active && requestId === session.requestId;
    session.inFlight = "append";
    update({ loadingMore: true });
    try {
      const page = await request({
        offset: session.nextOffset,
        limit: pageSize,
      });
      if (!isCurrent()) return;
      session.nextOffset += page.threads.length;
      session.hasMore = page.hasMore;
      setState((previous) => {
        if (previous.session !== session) return previous;
        const known = new Set(previous.threads.map((thread) => thread.id));
        return {
          ...previous,
          threads: [
            ...previous.threads,
            ...page.threads.filter((thread) => !known.has(thread.id)),
          ],
          hasMore: page.hasMore,
          error: null,
        };
      });
    } catch (failure) {
      if (!isCurrent()) return;
      update({ error: asError(failure) });
    } finally {
      if (isCurrent()) {
        session.inFlight = null;
        update({ loadingMore: false });
      }
    }
  }, [pageSize, request, session, update]);

  useEffect(() => {
    if (enabled) void replace(pageSize);
  }, [enabled, pageSize, replace]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onUpdated = () => void refresh();
    window.addEventListener(CHAT_THREADS_UPDATED_EVENT, onUpdated);
    return () =>
      window.removeEventListener(CHAT_THREADS_UPDATED_EVENT, onUpdated);
  }, [enabled, refresh]);

  const { threads, loading, loadingMore, error, hasMore } = state;
  return { threads, loading, loadingMore, error, hasMore, loadMore, refresh };
}
