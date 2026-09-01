export interface CalendarConnectionAccount {
  id: string;
  status?: string | null;
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
    // Sync metadata changes while the OAuth popup is open, so only a new row
    // or a status transition can prove this connection flow completed.
    return !previousAccount || previousAccount.status !== "connected";
  });
}
