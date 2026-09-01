export interface CalendarConnectionAccount {
  id: string;
  status?: string | null;
  lastSyncError?: string | null;
  updatedAt?: string | null;
}

export function isCalendarConnectionComplete(
  previousAccounts: CalendarConnectionAccount[],
  currentAccounts: CalendarConnectionAccount[],
): boolean {
  return currentAccounts.some((currentAccount) => {
    if (currentAccount.status !== "connected") return false;

    const previousAccount = previousAccounts.find(
      (account) => account.id === currentAccount.id,
    );
    if (!previousAccount) return true;

    return (
      previousAccount.status !== "connected" ||
      previousAccount.lastSyncError != null ||
      previousAccount.updatedAt !== currentAccount.updatedAt
    );
  });
}
