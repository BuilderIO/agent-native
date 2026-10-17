import { createContext, useContext } from "react";

export type AccountFilterContextType = {
  activeAccounts: Set<string>;
  allAccounts: Array<{
    email: string;
    displayName?: string;
    photoUrl?: string;
  }>;
};

export const AccountFilterContext = createContext<AccountFilterContextType>({
  activeAccounts: new Set(),
  allAccounts: [],
});

export function useAccountFilter() {
  return useContext(AccountFilterContext);
}
