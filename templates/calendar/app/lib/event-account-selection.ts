export interface ConnectedCalendarAccount {
  email: string;
}

export function resolveEventAccountEmail(
  accounts: ConnectedCalendarAccount[],
  requestedAccountEmail?: string,
): string | undefined {
  if (
    requestedAccountEmail &&
    accounts.some((account) => account.email === requestedAccountEmail)
  ) {
    return requestedAccountEmail;
  }
  return accounts[0]?.email;
}

export function reconcileEventAccountEmail(
  accounts: ConnectedCalendarAccount[],
  currentAccountEmail?: string,
  draftAccountEmail?: string,
): string | undefined {
  if (
    currentAccountEmail &&
    accounts.some((account) => account.email === currentAccountEmail)
  ) {
    return currentAccountEmail;
  }
  return resolveEventAccountEmail(accounts, draftAccountEmail);
}

export function shouldShowEventAccountSelector(
  accounts: ConnectedCalendarAccount[],
): boolean {
  return accounts.length > 1;
}
