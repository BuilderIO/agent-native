interface ObserveNextPageOptions {
  element: Element;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
}

/**
 * Observe a visible infinite-scroll sentinel for one page at a time.
 *
 * The owning effect re-runs when `isFetchingNextPage` changes. That lets the
 * next observer receive the sentinel's already-visible state after a fetch,
 * including when several consecutive pages contain no filtered matches.
 */
export function observeNextPage({
  element,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: ObserveNextPageOptions): () => void {
  if (!hasNextPage || isFetchingNextPage) return () => {};

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
