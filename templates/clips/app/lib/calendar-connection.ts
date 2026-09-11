export interface CalendarConnectionAccount {
  id: string;
  status?: string | null;
}

export function isCalendarConnectionComplete(
  currentAccounts: CalendarConnectionAccount[],
  completedAccountId: string | null,
  expectedAccountId?: string,
): boolean {
  if (
    !completedAccountId ||
    (expectedAccountId && completedAccountId !== expectedAccountId)
  ) {
    return false;
  }

  return currentAccounts.some(
    (account) =>
      account.id === completedAccountId && account.status === "connected",
  );
}
