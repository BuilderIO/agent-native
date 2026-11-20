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

export function findUnreportedCalendarConnection(
  previousAccounts: CalendarConnectionAccount[],
  currentAccounts: CalendarConnectionAccount[],
  expectedAccountId?: string,
): string | null {
  const wasConnected = new Set(
    previousAccounts
      .filter((account) => account.status === "connected")
      .map((account) => account.id),
  );
  const newlyConnected = currentAccounts.filter(
    (account) =>
      account.status === "connected" && !wasConnected.has(account.id),
  );
  if (expectedAccountId) {
    return newlyConnected.some((account) => account.id === expectedAccountId)
      ? expectedAccountId
      : null;
  }
  return newlyConnected[0]?.id ?? null;
}
