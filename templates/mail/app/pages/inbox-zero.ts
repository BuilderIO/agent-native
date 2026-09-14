export interface InboxZeroState {
  view: string;
  activeLabel: string | null | undefined;
  hasEmailData: boolean;
  isLoading: boolean;
  isError: boolean;
  hasThread: boolean;
  searchQuery: string | undefined;
  isSavedFilter?: boolean;
  threadCount: number;
  hasNextPage: boolean;
  /** True when the fetch behind `threadCount` silently dropped part of the
   * inbox (some connected account failed). An empty result under a partial
   * failure is not Inbox Zero — it's missing mail. */
  hasAccountErrors?: boolean;
}

export function shouldShowInboxZero({
  view,
  activeLabel,
  hasEmailData,
  isLoading,
  isError,
  hasThread,
  searchQuery,
  isSavedFilter = false,
  threadCount,
  hasNextPage,
  hasAccountErrors = false,
}: InboxZeroState): boolean {
  return (
    (view === "inbox" || Boolean(activeLabel)) &&
    hasEmailData &&
    !isLoading &&
    !isError &&
    !hasThread &&
    (!searchQuery || isSavedFilter) &&
    threadCount === 0 &&
    !hasNextPage &&
    !hasAccountErrors
  );
}
