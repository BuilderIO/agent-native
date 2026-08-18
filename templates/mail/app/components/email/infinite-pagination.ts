interface ObserveNextPageOptions {
  element: Element;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<unknown>;
}

export interface PaginationRetryState {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
}

export function shouldShowPaginationRetry({
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
}: PaginationRetryState): boolean {
  return hasNextPage && isFetchNextPageError && !isFetchingNextPage;
}

/**
 * Run an explicit pagination retry without leaking a rejected provider promise
 * to the browser. The shared state closes the synchronous double-click window
 * before React Query has reflected isFetchingNextPage.
 */
export async function retryNextPage(
  fetchNextPage: () => Promise<unknown>,
  inFlightState: { current: boolean },
): Promise<void> {
  if (inFlightState.current) return;
  inFlightState.current = true;
  try {
    await fetchNextPage();
  } catch {
    // coercion-ok: React Query owns the error; catch prevents an unhandled retry rejection.
    // React Query owns the visible error state for the failed page.
  } finally {
    inFlightState.current = false;
  }
}

/**
 * Observe a visible infinite-scroll sentinel for one page at a time.
 *
 * The owning effect re-runs when `isFetchingNextPage` changes. That lets the
 * next observer receive the sentinel's already-visible state after a fetch,
 * including when several consecutive pages contain no filtered matches. A
 * failed page is deliberately left unobserved until the user explicitly
 * retries it, so a persistent provider error cannot create a request loop.
 */
export function observeNextPage({
  element,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  fetchNextPage,
}: ObserveNextPageOptions): () => void {
  if (!hasNextPage || isFetchingNextPage || isFetchNextPageError)
    return () => {};

  let fetchInFlight = false;
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries[0]?.isIntersecting || fetchInFlight) return;

      fetchInFlight = true;
      void fetchNextPage()
        .catch(() => {
          // React Query owns the visible error state; avoid a global
          // unhandledrejection for transient list-page fetch failures.
        })
        .finally(() => {
          fetchInFlight = false;
        });
    },
    { rootMargin: "200px" },
  );
  observer.observe(element);
  return () => observer.disconnect();
}
