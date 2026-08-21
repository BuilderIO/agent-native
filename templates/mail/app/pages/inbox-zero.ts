export interface InboxZeroState {
  view: string;
  activeLabel: string | null | undefined;
  hasEmailData: boolean;
  isLoading: boolean;
  isError: boolean;
  hasThread: boolean;
  searchQuery: string | undefined;
  threadCount: number;
  hasNextPage: boolean;
}

export function shouldShowInboxZero({
  view,
  activeLabel,
  hasEmailData,
  isLoading,
  isError,
  hasThread,
  searchQuery,
  threadCount,
  hasNextPage,
}: InboxZeroState): boolean {
  return (
    view === "inbox" &&
    (!activeLabel || activeLabel === "important") &&
    hasEmailData &&
    !isLoading &&
    !isError &&
    !hasThread &&
    !searchQuery &&
    threadCount === 0 &&
    !hasNextPage
  );
}
