import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import type {
  ContentLinkTarget,
  ContentLinkTargetsResponse,
} from "@shared/api";
import { CONTENT_LINK_BATCH_MAX, isContentLinkId } from "@shared/content-links";
import { useQuery } from "@tanstack/react-query";

type PageLinkWaiter = {
  resolve: (target: ContentLinkTarget | null) => void;
  reject: (error: unknown) => void;
};

let pendingPageLinks: Map<string, PageLinkWaiter[]> | null = null;

function settlePageLinks(
  waiters: Map<string, PageLinkWaiter[]>,
  ids: string[],
  settle: (waiter: PageLinkWaiter, id: string) => void,
) {
  for (const id of ids) {
    for (const waiter of waiters.get(id) ?? []) settle(waiter, id);
  }
}

function flushPageLinks() {
  const waiters = pendingPageLinks;
  pendingPageLinks = null;
  if (!waiters) return;
  const ids = [...waiters.keys()];
  for (let start = 0; start < ids.length; start += CONTENT_LINK_BATCH_MAX) {
    const batch = ids.slice(start, start + CONTENT_LINK_BATCH_MAX);
    callAction<ContentLinkTargetsResponse>(
      "resolve-content-links",
      { ids: batch },
      { method: "GET" },
    ).then(
      (response) => {
        const targets = new Map(
          response.links.map(({ id, ...target }) => [id, target]),
        );
        settlePageLinks(waiters, batch, (waiter, id) =>
          waiter.resolve(targets.get(id) ?? null),
        );
      },
      (error) =>
        settlePageLinks(waiters, batch, (waiter) => waiter.reject(error)),
    );
  }
}

// Page-link blocks render one at a time; collect the ids a render pass asks
// for and resolve them with one request. A malformed id cannot name a
// document, and sending it would fail the whole batch.
export function loadPageLinkTarget(id: string) {
  if (!isContentLinkId(id)) return Promise.resolve(null);
  return new Promise<ContentLinkTarget | null>((resolve, reject) => {
    if (!pendingPageLinks) {
      pendingPageLinks = new Map();
      setTimeout(flushPageLinks, 0);
    }
    const waiters = pendingPageLinks.get(id) ?? [];
    waiters.push({ resolve, reject });
    pendingPageLinks.set(id, waiters);
  });
}

export const CONTENT_LINK_TARGETS_QUERY_KEY = [
  "action",
  "resolve-content-links",
] as const;

export function pageLinkTargetQueryKey(id: string | null) {
  return [...CONTENT_LINK_TARGETS_QUERY_KEY, { id }] as const;
}

/**
 * Resolves one page-link block's Content document id or Notion page id.
 * `data` is `null` when the target does not exist or the caller cannot read
 * it; a failed lookup is an error, not `null`.
 */
export function usePageLinkTarget(id: string | null) {
  return useQuery({
    queryKey: pageLinkTargetQueryKey(id),
    queryFn: () => loadPageLinkTarget(id!),
    enabled: id !== null,
  });
}

export function useLocalSourceDocument(
  sourcePath: string | null,
  fromDocumentId?: string | null,
) {
  const query = useActionQuery<ContentLinkTargetsResponse>(
    "resolve-content-links",
    sourcePath
      ? {
          sourcePaths: [sourcePath],
          ...(fromDocumentId ? { fromDocumentId } : {}),
        }
      : undefined,
    { enabled: sourcePath !== null },
  );
  return {
    ...query,
    data: query.data
      ? (query.data.sources.find(
          (source) => source.sourcePath === sourcePath,
        ) ?? null)
      : undefined,
  };
}
