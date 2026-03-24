import { createContext, useContext } from "react";

export type AccountFilterContextType = {
  /** Set of active account emails. Empty = show all (no filtering). */
  activeAccounts: Set<string>;
  allAccounts: Array<{ email: string; photoUrl?: string }>;
};

export const AccountFilterContext = createContext<AccountFilterContextType>({
  activeAccounts: new Set(),
  allAccounts: [],
});

export function useAccountFilter() {
  return useContext(AccountFilterContext);
}
