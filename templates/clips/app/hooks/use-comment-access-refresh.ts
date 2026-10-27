import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

// Password comment proof lasts ten minutes; renewing at half-life leaves a slow
// write time to arrive before it expires.
const COMMENT_ACCESS_RENEW_MS = 5 * 60_000;

export function useCommentAccessRefresh(
  token: string | null | undefined,
  refresh: () => Promise<unknown>,
): void {
  useEffect(() => {
    if (!token) return;
    const renew = () => void refresh();
    const renewWhenVisible = () => {
      if (document.visibilityState === "visible") renew();
    };
    // Finished shares stop media polling, but password comment proof expires in ten minutes.
    const timer = setInterval(renew, COMMENT_ACCESS_RENEW_MS);
    window.addEventListener("focus", renew);
    document.addEventListener("visibilitychange", renewWhenVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", renew);
      document.removeEventListener("visibilitychange", renewWhenVisible);
    };
  }, [token, refresh]);
}

// Clips targets ES2020, whose Error constructor takes no cause.
class CommentAccessRenewalError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super("Comment access renewal failed");
    this.name = "CommentAccessRenewalError";
    this.cause = cause;
  }
}

interface CommentAccessResponse {
  ok?: boolean;
  status?: number;
  data?: {
    error?: string;
    recording?: { commentAccessToken?: string | null };
  };
}

export function useCommentAccessToken(
  query: {
    data?: CommentAccessResponse | undefined;
    dataUpdatedAt: number;
    refetch: (options: {
      cancelRefetch: boolean;
    }) => Promise<{ data?: CommentAccessResponse | undefined; error: unknown }>;
  },
  queryKey: QueryKey,
) {
  const queryClient = useQueryClient();
  const { data, dataUpdatedAt, refetch } = query;
  const token = data?.data?.recording?.commentAccessToken;
  const renew = useCallback(() => refetch({ cancelRefetch: false }), [refetch]);
  useCommentAccessRefresh(token, renew);
  // Optimistic comment patches move dataUpdatedAt too, so a grant is aged from
  // the update that delivered it.
  const grantRef = useRef<{ token: string; receivedAt: number } | null>(null);
  useEffect(() => {
    if (token && grantRef.current?.token !== token) {
      grantRef.current = { token, receivedAt: dataUpdatedAt };
    }
  }, [token, dataUpdatedAt]);
  return useCallback(
    async (refusedToken?: string | null) => {
      const grant = grantRef.current;
      // A write cancels this query before it sends, so a fetch already running
      // must be joined, not aborted. Rendered isFetching can lag the click that
      // focused the tab and started one, so ask the cache.
      if (
        grant &&
        grant.token === token &&
        grant.token !== refusedToken &&
        Date.now() - grant.receivedAt < COMMENT_ACCESS_RENEW_MS &&
        !queryClient.isFetching({ queryKey, exact: true })
      ) {
        return grant.token;
      }
      const result = await renew();
      if (result.error instanceof Error) throw result.error;
      if (result.error) throw new CommentAccessRenewalError(result.error);
      if (!result.data?.ok) {
        throw new Error(
          result.data?.data?.error ?? String(result.data?.status),
        );
      }
      return result.data.data?.recording?.commentAccessToken;
    },
    [token, renew, queryClient, queryKey],
  );
}
